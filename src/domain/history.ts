import { calculateDailyCalories, calculateGoalStatus, type GoalStatus } from "./calories";
import { addDays, compareDateKeys, dateKeyOf } from "./date";
import type { DailyGoal, MealRecord } from "./meal";

/**
 * Looking back over past days. Derived entirely from what is already stored:
 * meal records are the source of truth for what was eaten, and the goal list
 * already keeps one entry per date the goal was changed on.
 *
 * That second fact is what preserves a past day's goal. Changing the goal on
 * 9/28 writes a 9/28 entry and leaves 9/27's alone, so 9/27 keeps resolving
 * to the number that applied on 9/27. Nothing is snapshotted, because
 * nothing needs to be.
 */

/**
 * The goal in effect on a date: the one set for it, or failing that the most
 * recent one set before it. The single definition of carry-forward — the
 * repository and the history both use it, so today and yesterday can never
 * disagree about which goal applied.
 */
export function effectiveGoal(goals: DailyGoal[], date: string): DailyGoal | null {
  let found: DailyGoal | null = null;
  for (const goal of goals) {
    if (compareDateKeys(goal.date, date) > 0) continue;
    if (found === null || compareDateKeys(goal.date, found.date) > 0) found = goal;
  }
  return found;
}

/**
 * How a day ended, as a fact rather than a verdict.
 *
 *   - `no_record`: nothing was logged.
 *   - `no_goal`:   food was logged before any goal was set.
 *   - `under` / `exact` / `over`: the logged total against that day's goal.
 *
 * Deliberately no "on target" band. There is no tolerance anywhere in the
 * app, and choosing one (±5 %? ±100 kcal?) is a product decision, not
 * something to slip in here. `exact` is rare, and that is honest.
 */
export type DayOutcome = "no_record" | "no_goal" | GoalStatus;

export type DayHistory = {
  /** KST date key. */
  date: string;
  /** The goal that applied on this date. Null before the first goal. */
  calorieTarget: number | null;
  consumedCalories: number;
  /** consumed − target. Positive is over. Null without a goal. */
  difference: number | null;
  /** Foods logged — what the day's list shows as rows. */
  itemCount: number;
  outcome: DayOutcome;
  /** The day's records, oldest first, for showing what was eaten. */
  records: MealRecord[];
};

/** One day, from its own records and that day's goal. */
export function summarizeHistoryDay(
  date: string,
  records: MealRecord[],
  calorieTarget: number | null,
): DayHistory {
  const itemCount = records.reduce((total, record) => total + record.items.length, 0);
  const consumedCalories = calculateDailyCalories(records);
  const difference = calorieTarget === null ? null : consumedCalories - calorieTarget;

  const outcome: DayOutcome =
    itemCount === 0
      ? "no_record"
      : calorieTarget === null
        ? "no_goal"
        : calculateGoalStatus(calorieTarget - consumedCalories);

  return { date, calorieTarget, consumedCalories, difference, itemCount, outcome, records };
}

/**
 * The first day history covers: the earliest day the user either logged
 * food or set a goal. Before that the app was not in use, and showing those
 * days as "기록 없음" would count days nobody could have logged.
 */
export function historyStart(
  records: MealRecord[],
  goals: DailyGoal[],
): string | null {
  let start: string | null = null;
  const consider = (date: string | null) => {
    if (date !== null && (start === null || compareDateKeys(date, start) < 0)) {
      start = date;
    }
  };
  for (const record of records) consider(dateKeyOf(record.consumedAt));
  for (const goal of goals) consider(goal.date);
  return start;
}

/**
 * Every day from the start of use to `today`, newest first. Days in between
 * with nothing logged are included — within the span of use, an empty day is
 * a fact worth seeing.
 */
export function summarizeHistory(
  records: MealRecord[],
  goals: DailyGoal[],
  today: string,
): DayHistory[] {
  const start = historyStart(records, goals);
  if (start === null) return [];

  const byDate = new Map<string, MealRecord[]>();
  for (const record of records) {
    const date = dateKeyOf(record.consumedAt);
    if (date === null) continue;
    const day = byDate.get(date) ?? [];
    day.push(record);
    byDate.set(date, day);
  }

  const days: DayHistory[] = [];
  // A record dated after today (a clock that was wrong) still gets its day.
  let last = today;
  for (const date of byDate.keys()) {
    if (compareDateKeys(date, last) > 0) last = date;
  }

  for (let date = last; compareDateKeys(date, start) >= 0; date = addDays(date, -1)) {
    const dayRecords = (byDate.get(date) ?? [])
      .slice()
      .sort((a, b) => a.consumedAt.localeCompare(b.consumedAt));
    days.push(
      summarizeHistoryDay(date, dayRecords, effectiveGoal(goals, date)?.calorieTarget ?? null),
    );
  }
  return days;
}
