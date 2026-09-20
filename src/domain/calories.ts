import type { FoodItem, MealRecord } from "./meal";

/**
 * Every number the app shows comes from here. Pure functions, no formatting:
 * `calculateRemainingCalories` returns -140, and it is the UI's job to decide
 * that this reads "140 kcal 더 먹었어요".
 */

export type GoalStatus = "under" | "exact" | "over";

export type DailySummary = {
  consumedCalories: number;
  /** Null when the user has not set a goal yet. */
  calorieTarget: number | null;
  /** Null without a goal. Negative means the goal was passed. */
  remainingCalories: number | null;
  /** Null without a goal. */
  status: GoalStatus | null;
};

export function sumFoodItemCalories(items: FoodItem[]): number {
  return items.reduce((total, item) => total + item.calories, 0);
}

/** A record's total is always derived, never stored. */
export function calculateMealRecordCalories(record: MealRecord): number {
  return sumFoodItemCalories(record.items);
}

export function calculateDailyCalories(records: MealRecord[]): number {
  return records.reduce(
    (total, record) => total + calculateMealRecordCalories(record),
    0,
  );
}

/** Negative when the goal has been passed. The caller decides how to say that. */
export function calculateRemainingCalories(
  records: MealRecord[],
  calorieTarget: number,
): number {
  return calorieTarget - calculateDailyCalories(records);
}

export function calculateGoalStatus(remainingCalories: number): GoalStatus {
  if (remainingCalories > 0) return "under";
  if (remainingCalories === 0) return "exact";
  return "over";
}

/** One call for everything the today screen needs. */
export function summarizeDay(
  records: MealRecord[],
  calorieTarget: number | null,
): DailySummary {
  const consumedCalories = calculateDailyCalories(records);

  if (calorieTarget === null) {
    return {
      consumedCalories,
      calorieTarget: null,
      remainingCalories: null,
      status: null,
    };
  }

  const remainingCalories = calorieTarget - consumedCalories;
  return {
    consumedCalories,
    calorieTarget,
    remainingCalories,
    status: calculateGoalStatus(remainingCalories),
  };
}
