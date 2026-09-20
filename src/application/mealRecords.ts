import { isValidCalorieValue } from "@/domain/limits";
import type {
  FoodItem,
  MealRecord,
  MealType,
  UpdateMealRecordInput,
} from "@/domain/meal";
import type { MealRecordRepository } from "@/domain/repository";

/**
 * Use cases, as plain functions. No command bus: Phase 4 will call these from
 * the route handler's Command switch, and a function is already the right
 * shape for that.
 */

export type NewFoodItem = Omit<FoodItem, "id">;

export type AddMealRecordInput = {
  /** What the user typed. Kept so a later correction can refer back to it. */
  sourceText: string;
  items: NewFoodItem[];
  /** Defaults to now. */
  consumedAt?: string;
  mealType?: MealType;
};

export type Deps = {
  now?: () => Date;
  createId?: () => string;
};

/** `crypto.randomUUID` is available in every browser we target and in Node 19+. */
function defaultCreateId(): string {
  return globalThis.crypto.randomUUID();
}

export async function addMealRecord(
  repository: MealRecordRepository,
  input: AddMealRecordInput,
  { now = () => new Date(), createId = defaultCreateId }: Deps = {},
): Promise<MealRecord> {
  assertUsableCalories(input.items);

  const timestamp = now().toISOString();
  const record: MealRecord = {
    id: createId(),
    consumedAt: input.consumedAt ?? timestamp,
    ...(input.mealType !== undefined ? { mealType: input.mealType } : {}),
    sourceText: input.sourceText,
    items: input.items.map((item) => ({ ...item, id: createId() })),
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await repository.add(record);
  return record;
}

export async function updateMealRecord(
  repository: MealRecordRepository,
  id: string,
  input: UpdateMealRecordInput,
): Promise<void> {
  if (input.items !== undefined) assertUsableCalories(input.items);
  await repository.update(id, input);
}

export async function deleteMealRecord(
  repository: MealRecordRepository,
  id: string,
): Promise<void> {
  await repository.remove(id);
}

/**
 * A guard against the AI layer, not against the user. Phase 5 resolves
 * calories from a dataset; if that ever yields NaN or 1e9, it stops here
 * rather than in the totals.
 */
function assertUsableCalories(items: readonly { calories: number }[]): void {
  for (const item of items) {
    if (!isValidCalorieValue(item.calories)) {
      throw new Error(`Unusable calorie value: ${String(item.calories)}`);
    }
  }
}
