/**
 * "제보하기": a food the dataset does not have, told to the operator.
 *
 * What is kept is the name and how many times it was reported. Not the
 * sentence it came from, not who sent it, not when they ate it — the report
 * exists to decide what to add next, and a name with a count is all that
 * decision needs. The user presses the button for each one; nothing is
 * collected from a sentence that was merely typed.
 */

export const FOOD_REPORT_MAX_LENGTH = 30;

/**
 * The name as it is stored, or null when it is not something to store.
 *
 * Spaces are collapsed so "비빔  막국수" and "비빔 막국수" count together. A
 * name has to contain a letter and nothing outside ordinary food wording:
 * what arrives here is whatever a caller chose to send, not only what the
 * button sends, and it ends up in a list a person reads.
 */
export function normalizeFoodReport(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  if (name.length === 0 || name.length > FOOD_REPORT_MAX_LENGTH) return null;
  if (!/^[가-힣a-zA-Z0-9 ()·&%.+-]+$/.test(name)) return null;
  if (!/[가-힣a-zA-Z]/.test(name)) return null;
  // An address or a contact is not a food, whatever else it is.
  if (/https?|www\.|\.(?:com|net|kr|io)\b|\d{7,}/i.test(name)) return null;
  return name;
}

export interface FoodReportStore {
  /** Counts one more report of `name`. Rejects when it could not be kept. */
  add(name: string, now: Date): Promise<void>;
}
