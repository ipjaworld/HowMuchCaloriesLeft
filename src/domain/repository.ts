import type { DailyGoal, MealRecord, UpdateMealRecordInput } from "./meal";

/**
 * Storage ports. The domain and application layers only ever see these; no
 * module above `src/infrastructure` touches `window.localStorage`.
 *
 * The methods are async even though localStorage is synchronous, so that
 * swapping in a server database later changes the implementation and nothing
 * that calls it.
 */

export interface MealRecordRepository {
  /** Records whose `consumedAt` falls on this local date key. */
  getByDate(date: string): Promise<MealRecord[]>;
  add(record: MealRecord): Promise<void>;
  /** No-op when the id is unknown. */
  update(id: string, input: UpdateMealRecordInput): Promise<void>;
  remove(id: string): Promise<void>;
}

export interface DailyGoalRepository {
  /**
   * The goal in effect on this date: the one set for it, or failing that the
   * most recent goal set before it. Carrying forward is what makes the app
   * usable on day two without re-entering the number.
   */
  get(date: string): Promise<DailyGoal | null>;
  /** The goal set for exactly this date, ignoring carry-forward. */
  getExact(date: string): Promise<DailyGoal | null>;
  set(goal: DailyGoal): Promise<void>;
}
