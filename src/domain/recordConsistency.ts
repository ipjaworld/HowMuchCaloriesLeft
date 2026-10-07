import { addDays, dateKeyOf, isDateKey } from "./date";
import type { MealRecord } from "./meal";

/** Recomputed from saved meals: edits, deletion and restore stay consistent. */
export function recordedDates(records: readonly MealRecord[], today: string): string[] {
  if (!isDateKey(today)) throw new Error("Invalid date");
  return [...new Set(records.filter(record => record.items.length > 0)
    .map(record => dateKeyOf(record.consumedAt))
    .filter((date): date is string => date !== null && date <= today))].sort();
}

export function recordConsistency(records: readonly MealRecord[], today: string) {
  const dates = recordedDates(records, today);
  const days = new Set(dates);
  // Today is still in progress; yesterday's streak survives until day end.
  let cursor = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
  return {
    streak,
    total: days.size,
    month: dates.filter(date => date.slice(0, 7) === today.slice(0, 7)).length,
    recordedToday: days.has(today),
  };
}

/** Future server-side input. Use an opaque public ID and an opt-in alias only. */
export type ChallengeParticipant = {
  publicId: string;
  alias: string;
  optedIn: boolean;
  dates: readonly string[];
};

/** Calendar months are separate buckets, never a deletion of personal history.
 * Call only with server-verified dates, not scores supplied by a browser.
 * Equal counts share a rank; all participants tied at rank 10 are included.
 */
export function monthlyChallenge(participants: readonly ChallengeParticipant[], today: string, viewerId: string | null) {
  if (!isDateKey(today)) throw new Error("Invalid date");
  const month = today.slice(0, 7);
  const ids = new Set<string>();
  const scores = participants.filter(participant => {
    if (ids.has(participant.publicId)) throw new Error("Duplicate participant");
    ids.add(participant.publicId);
    return participant.optedIn;
  }).map(participant => ({
    publicId: participant.publicId,
    alias: participant.alias,
    days: new Set(participant.dates.filter(date => isDateKey(date) && date <= today && date.slice(0, 7) === month)).size,
  })).filter(entry => entry.days > 0)
    .sort((a, b) => b.days - a.days || a.publicId.localeCompare(b.publicId));
  let rank = 0;
  const entries = scores.map((entry, index) => {
    if (scores[index - 1]?.days !== entry.days) rank = index + 1;
    return { ...entry, rank, isMe: entry.publicId === viewerId };
  });
  return { month, top: entries.filter(entry => entry.rank <= 10), mine: entries.find(entry => entry.isMe) ?? null };
}
