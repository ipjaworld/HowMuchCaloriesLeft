/**
 * Date handling, kept deliberately small — no date-fns, no dayjs.
 *
 * Two kinds of string appear in this app and they must not be confused:
 *
 *   - an ISO datetime with offset  ("2026-09-20T12:40:00+09:00") — `consumedAt`
 *   - a date-only key             ("2026-09-20")                 — `DailyGoal.date`
 *
 * A date key is always in the *user's own* timezone. Asia/Seoul is never
 * hardcoded: whatever zone the browser is in decides where the day starts.
 */

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Local calendar date of a moment, as YYYY-MM-DD.
 *
 * Built from the local getters on purpose. `toISOString().slice(0, 10)` would
 * convert to UTC first and report the wrong day for anyone east or west of it
 * — in Seoul, everything before 09:00 would fall on the previous date.
 */
export function toDateKey(date: Date): string {
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today's date key in the user's timezone. */
export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

/** The date key an ISO datetime falls on, locally. Null if unparseable. */
export function dateKeyOf(isoDateTime: string): string | null {
  const parsed = new Date(isoDateTime);
  return Number.isNaN(parsed.getTime()) ? null : toDateKey(parsed);
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;

  // Rejects "2026-02-30": the parts must survive a round trip.
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const asDate = new Date(year, month - 1, day);
  return (
    asDate.getFullYear() === year &&
    asDate.getMonth() === month - 1 &&
    asDate.getDate() === day
  );
}

/**
 * Chronological comparison of two date keys. They are zero-padded, so plain
 * string order is already date order — no Date parsing, no timezone shift.
 */
export function compareDateKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
