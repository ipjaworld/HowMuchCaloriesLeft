import type { ChatRequest } from "@/app/api/chat/schema";
import type { MealRecord } from "@/domain/meal";

/**
 * The one place the `/api/chat` body is built.
 *
 * Pulled out of the screen so what leaves the browser can be pinned by a
 * test: a sentence, the clock, the day's goal and today's items — and nothing
 * else. In particular, never the diet profile. The profile lives in its own
 * repository that this module does not import, and the parameter list below
 * has no slot it could arrive through.
 *
 * `dailyGoalCalories` is the target in effect, whether typed or calculated.
 * It is the same single number the judge has always received; how it was
 * reached — weight, height, age — stays on the device.
 */
export function buildChatRequest(input: {
  message: string;
  now: Date;
  dailyGoalCalories: number | null;
  records: MealRecord[];
}): ChatRequest {
  return {
    message: input.message,
    now: input.now.toISOString(),
    dailyGoalCalories: input.dailyGoalCalories,
    recentItems: toRecentItems(input.records),
  };
}

/** The judge only needs the items, flattened, with their record's context. */
export function toRecentItems(records: MealRecord[]): ChatRequest["recentItems"] {
  return records.flatMap((record) =>
    record.items.map((item) => ({
      id: item.id,
      name: item.name,
      ...(item.amount === undefined ? {} : { amount: item.amount }),
      calories: item.calories,
      ...(item.calorieSource === undefined ? {} : { calorieSource: item.calorieSource }),
      ...(record.mealType === undefined ? {} : { mealType: record.mealType }),
      consumedAt: record.consumedAt,
    })),
  );
}
