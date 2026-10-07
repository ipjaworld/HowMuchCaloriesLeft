import { dateKeyOf } from "@/domain/date";
import { isValidCalorieValue } from "@/domain/limits";
import type { MealRecordRepository } from "@/domain/repository";
import { parseAmountOnly } from "@/ai/nutrition/quantity";
import { addMealRecord, updateMealRecord, type AddMealRecordInput } from "./mealRecords";

export type AccumulatedConsumption = { name: string; addedAmount: string; totalAmount: string };

function measure(amount: string | undefined) {
  const parsed = amount ? parseAmountOnly(amount) : null;
  if (!parsed || parsed.value <= 0) return null;
  if (parsed.unit === "g" || parsed.unit === "그램") return { value: parsed.value, unit: "g" };
  if (parsed.unit === "kg") return { value: parsed.value * 1000, unit: "g" };
  if (parsed.unit === "ml" || parsed.unit === "mL") return { value: parsed.value, unit: "ml" };
  if (parsed.unit === "리터") return { value: parsed.value * 1000, unit: "ml" };
  return null;
}

/** One clear, compatible measured food can accumulate in one write. Other
 * foods remain separate additions: never guess a target or mix serving units.
 */
export async function addConsumption(repository: MealRecordRepository, input: AddMealRecordInput): Promise<AccumulatedConsumption | null> {
  const item = input.items.length === 1 ? input.items[0] : undefined;
  const added = measure(item?.amount);
  const day = input.consumedAt ? dateKeyOf(input.consumedAt) : null;
  if (item && added && day) {
    const records = await repository.getByDate(day);
    const candidates = records.filter(record => record.mealType === input.mealType)
      .flatMap(record => record.items.filter(old => old.name === item.name).map(old => ({ record, old })));
    const candidate = candidates.length === 1 ? candidates[0] : undefined;
    const previous = measure(candidate?.old.amount);
    if (candidate && previous?.unit === added.unit &&
        candidate.old.calorieSource === item.calorieSource &&
        candidate.old.portionNote === item.portionNote &&
        candidate.old.calorieVariance === item.calorieVariance &&
        isValidCalorieValue(item.calories) && isValidCalorieValue(candidate.old.calories + item.calories)) {
      const amount = `${Number((previous.value + added.value).toFixed(6))}${added.unit}`;
      await updateMealRecord(repository, candidate.record.id, {
        items: candidate.record.items.map(old => old.id === candidate.old.id ? {
          ...old, amount, calories: old.calories + item.calories,
          caloriesEstimated: old.caloriesEstimated || item.caloriesEstimated,
        } : old),
        sourceText: `${candidate.record.sourceText}\n추가: ${input.sourceText}`,
      });
      return { name: item.name, addedAmount: item.amount!, totalAmount: amount };
    }
  }
  await addMealRecord(repository, input);
  return null;
}
