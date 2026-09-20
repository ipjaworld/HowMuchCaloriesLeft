import { isDateKey } from "@/domain/date";
import {
  MAX_DAILY_GOAL_CALORIES,
  MIN_DAILY_GOAL_CALORIES,
  isValidDailyGoal,
} from "@/domain/limits";
import type { DailyGoal } from "@/domain/meal";
import type { DailyGoalRepository } from "@/domain/repository";

/**
 * The goal comes straight from a text field, so a bad value is an ordinary
 * thing that happens rather than a bug. It is reported back for the UI to
 * show, not thrown.
 */
export type SetDailyGoalResult =
  | { ok: true; goal: DailyGoal }
  | { ok: false; reason: "not_a_number" | "out_of_range" | "invalid_date" };

export const DAILY_GOAL_RANGE = {
  min: MIN_DAILY_GOAL_CALORIES,
  max: MAX_DAILY_GOAL_CALORIES,
} as const;

export async function setDailyGoal(
  repository: DailyGoalRepository,
  date: string,
  calorieTarget: number,
): Promise<SetDailyGoalResult> {
  if (!isDateKey(date)) return { ok: false, reason: "invalid_date" };

  if (!Number.isFinite(calorieTarget) || !Number.isInteger(calorieTarget)) {
    return { ok: false, reason: "not_a_number" };
  }
  if (!isValidDailyGoal(calorieTarget)) {
    return { ok: false, reason: "out_of_range" };
  }

  const goal: DailyGoal = { date, calorieTarget };
  await repository.set(goal);
  return { ok: true, goal };
}

/** The goal in effect on a date, carried forward from the last one set. */
export async function getEffectiveDailyGoal(
  repository: DailyGoalRepository,
  date: string,
): Promise<DailyGoal | null> {
  return repository.get(date);
}
