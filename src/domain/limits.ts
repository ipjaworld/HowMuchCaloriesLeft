/**
 * Technical input bounds — the single place these numbers live.
 *
 * These are NOT health guidance and must never be presented as such. They
 * exist to stop typos and corrupt storage from producing nonsense totals:
 * a mistyped "21000" goal, or a food item that somehow parsed as 1e9 kcal.
 */

/** Largest calorie value accepted for one food item. */
export const MAX_FOOD_ITEM_CALORIES = 20_000;

/** Accepted range for a daily goal. Wide on purpose — it is not advice. */
export const MIN_DAILY_GOAL_CALORIES = 500;
export const MAX_DAILY_GOAL_CALORIES = 20_000;

/** A usable calorie number: finite, not negative, not absurd. */
export function isValidCalorieValue(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_FOOD_ITEM_CALORIES
  );
}

export function isValidDailyGoal(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= MIN_DAILY_GOAL_CALORIES &&
    value <= MAX_DAILY_GOAL_CALORIES
  );
}
