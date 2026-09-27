/**
 * Date handling, kept deliberately small — no date-fns, no dayjs.
 *
 * Two kinds of string appear in this app and they must not be confused:
 *
 *   - an ISO datetime            ("2026-09-20T03:40:00.000Z") — `consumedAt`
 *   - a date-only key            ("2026-09-20")               — `DailyGoal.date`
 *
 * **A day is a day in Korea.** Every date key is the calendar date in
 * Asia/Seoul, 00:00:00 to 23:59:59 KST, whatever timezone the device is set
 * to. The app is for Korean users and a travelling phone should not split
 * one evening's meals across two days. This module is the only place that
 * turns a moment into a day; nothing else may slice an ISO string or call
 * the local date getters for that.
 */

/** The zone every day boundary is drawn in. */
export const APP_TIME_ZONE = "Asia/Seoul";

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// en-CA formats a date as YYYY-MM-DD. Built once: constructing an
// Intl.DateTimeFormat is far slower than using one.
const dateKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * The KST calendar date of a moment, as YYYY-MM-DD.
 *
 * Never `toISOString().slice(0, 10)`: that is the UTC date, and in Seoul
 * everything before 09:00 would land on the previous day.
 */
export function toDateKey(date: Date): string {
  const parts = dateKeyFormat.formatToParts(date);
  const part = (type: "year" | "month" | "day") =>
    parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Today's date key, in KST. */
export function todayKey(now: Date = new Date()): string {
  return toDateKey(now);
}

/** The KST date key an ISO datetime falls on. Null if unparseable. */
export function dateKeyOf(isoDateTime: string): string | null {
  const parsed = new Date(isoDateTime);
  return Number.isNaN(parsed.getTime()) ? null : toDateKey(parsed);
}

export function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_KEY_PATTERN.test(value)) return false;

  // Rejects "2026-02-30": the parts must survive a round trip. UTC so the
  // check is pure calendar arithmetic, untouched by any zone.
  const [year, month, day] = value.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const asDate = new Date(Date.UTC(year, month - 1, day));
  return (
    asDate.getUTCFullYear() === year &&
    asDate.getUTCMonth() === month - 1 &&
    asDate.getUTCDate() === day
  );
}

/**
 * Chronological comparison of two date keys. They are zero-padded, so plain
 * string order is already date order — no Date parsing, no timezone shift.
 */
export function compareDateKeys(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The date key `days` after (or before) another. Calendar arithmetic on the
 * key itself, done in UTC where no day is 23 or 25 hours long.
 */
export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  return `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}-${pad(shifted.getUTCDate(), 2)}`;
}
