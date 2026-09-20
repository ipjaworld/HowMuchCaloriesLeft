/**
 * The domain model. Plain data and no dependencies — not React, not storage,
 * not the AI layer.
 *
 * Only fields the MVP actually uses. Macros, weight and user profiles are
 * deliberately absent; the remaining-calorie number comes first.
 */

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

export type MealType = (typeof MEAL_TYPES)[number];

export type FoodItem = {
  id: string;
  name: string;
  /** As the user said it: "1개", "1공기", "200ml". */
  amount?: string;
  calories: number;
  /**
   * True when the calorie figure came from a portion guess rather than a
   * direct match. The UI can mark it; nothing in the maths treats it
   * differently.
   */
  caloriesEstimated: boolean;
};

export type MealRecord = {
  id: string;
  /** ISO datetime with offset. The day it belongs to is derived, not stored. */
  consumedAt: string;
  mealType?: MealType;
  /** What the user originally typed, kept verbatim for later corrections. */
  sourceText: string;
  items: FoodItem[];
  createdAt: string;
  updatedAt: string;
};

export type DailyGoal = {
  /** Date-only key, YYYY-MM-DD, in the user's own timezone. */
  date: string;
  calorieTarget: number;
};

/**
 * A record's total is always derived from its items, never stored, so the two
 * can never disagree after an edit.
 */
export type UpdateMealRecordInput = Partial<
  Pick<MealRecord, "consumedAt" | "mealType" | "sourceText" | "items">
>;
