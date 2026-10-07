import { describe, expect, it } from "vitest";
import type { MealRecord } from "./meal";
import { monthlyChallenge, recordConsistency, type ChallengeParticipant } from "./recordConsistency";

function meal(at: string): MealRecord {
  return { id: at, consumedAt: at, createdAt: at, updatedAt: at, sourceText: "test",
    items: [{ id: "food", name: "test", calories: 100, caloriesEstimated: false }] };
}
function participant(publicId: string, dates: string[], optedIn = true): ChallengeParticipant {
  return { publicId, alias: `별명 ${publicId}`, dates, optedIn };
}

describe("personal recording consistency", () => {
  it("counts distinct KST meal dates, not entries, calories or empty records", () => {
    const records = [meal("2026-10-06T15:00:00Z"), meal("2026-10-07T12:00:00+09:00"),
      { ...meal("2026-10-06T12:00:00+09:00"), items: [] }, meal("invalid"), meal("2026-10-08T00:00:00+09:00")];
    expect(recordConsistency(records, "2026-10-07")).toEqual({ streak: 1, total: 1, month: 1, recordedToday: true });
  });
  it("keeps yesterday's streak while today is still in progress", () => {
    expect(recordConsistency([meal("2026-10-05T12:00:00+09:00"), meal("2026-10-06T12:00:00+09:00")], "2026-10-07"))
      .toEqual({ streak: 2, total: 2, month: 2, recordedToday: false });
  });
  it("resets a broken streak but retains total days", () => {
    expect(recordConsistency([meal("2026-10-05T12:00:00+09:00")], "2026-10-07"))
      .toEqual({ streak: 0, total: 1, month: 1, recordedToday: false });
  });
  it("crosses month and leap-year boundaries without losing personal totals", () => {
    expect(recordConsistency([meal("2024-02-28T12:00:00+09:00"), meal("2024-02-29T12:00:00+09:00"), meal("2024-03-01T12:00:00+09:00")], "2024-03-01"))
      .toEqual({ streak: 3, total: 3, month: 1, recordedToday: true });
  });
  it("recomputes deletion and restoration rather than keeping a stale counter", () => {
    const records = [meal("2026-10-05T12:00:00+09:00"), meal("2026-10-06T12:00:00+09:00"), meal("2026-10-07T12:00:00+09:00")];
    expect(recordConsistency(records, "2026-10-07").streak).toBe(3);
    expect(recordConsistency(records.filter((_, index) => index !== 1), "2026-10-07").streak).toBe(1);
    expect(recordConsistency(records, "2026-10-07").streak).toBe(3);
  });
  it("returns zero for empty history", () => {
    expect(recordConsistency([], "2026-10-07")).toEqual({ streak: 0, total: 0, month: 0, recordedToday: false });
  });
});

describe("monthly challenge preparation (not published)", () => {
  it("isolates calendar months, excludes future/invalid dates and does not mutate input", () => {
    const entries = [participant("a", ["2026-09-30", "2026-10-01", "2026-10-01", "2026-10-32", "2026-10-08"] )];
    const snapshot = JSON.stringify(entries);
    expect(monthlyChallenge(entries, "2026-10-07", "a").mine?.days).toBe(1);
    expect(monthlyChallenge(entries, "2026-11-01", "a").top).toEqual([]);
    expect(JSON.stringify(entries)).toBe(snapshot);
  });
  it("uses shared competition ranks and viewer-specific self markers", () => {
    const entries = [participant("b", ["2026-10-01", "2026-10-02"]), participant("a", ["2026-10-01", "2026-10-02"]), participant("c", ["2026-10-01"])];
    const result = monthlyChallenge(entries, "2026-10-07", "b");
    expect(result.top.map(row => [row.publicId, row.rank, row.isMe])).toEqual([["a", 1, false], ["b", 1, true], ["c", 3, false]]);
    expect(monthlyChallenge(entries, "2026-10-07", null).top.every(row => !row.isMe)).toBe(true);
  });
  it("keeps my rank available outside the top ten", () => {
    const entries = Array.from({ length: 12 }, (_, i) => participant(String(i), Array.from({ length: 12 - i }, (_, day) => `2026-10-${String(day + 1).padStart(2, "0")}`)));
    const result = monthlyChallenge(entries, "2026-10-20", "11");
    expect(result.top).toHaveLength(10);
    expect(result.mine?.rank).toBe(12);
  });
  it("includes all users tied at rank ten", () => {
    const entries = Array.from({ length: 11 }, (_, i) => participant(String(i), Array.from({ length: i < 9 ? 2 : 1 }, (_, day) => `2026-10-0${day + 1}`)));
    expect(monthlyChallenge(entries, "2026-10-07", null).top.map(row => row.rank)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 10, 10]);
  });
  it("excludes opt-outs and users with no current month records", () => {
    expect(monthlyChallenge([participant("a", ["2026-10-01"], false), participant("b", ["2026-09-30"])], "2026-10-07", "a"))
      .toEqual({ month: "2026-10", top: [], mine: null });
  });
  it("rejects duplicate identities and invalid dates", () => {
    expect(() => monthlyChallenge([participant("a", []), participant("a", [])], "2026-10-07", null)).toThrow();
    expect(() => recordConsistency([], "2026-02-30")).toThrow();
  });
});
