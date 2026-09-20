import { describe, expect, it } from "vitest";
import { compareDateKeys, dateKeyOf, isDateKey, toDateKey, todayKey } from "./date";

describe("toDateKey", () => {
  it("uses the local calendar date, not UTC", () => {
    // Built from local parts, so this holds in every timezone the test runs
    // in — which is the point: `toISOString().slice(0, 10)` would not.
    const local = new Date(2026, 8, 20, 1, 30);
    expect(toDateKey(local)).toBe("2026-09-20");
  });

  it("does not roll back across midnight the way a UTC conversion would", () => {
    const justAfterMidnight = new Date(2026, 0, 1, 0, 5);
    expect(toDateKey(justAfterMidnight)).toBe("2026-01-01");
  });

  it("does not roll forward late in the evening", () => {
    const lateEvening = new Date(2026, 11, 31, 23, 55);
    expect(toDateKey(lateEvening)).toBe("2026-12-31");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toDateKey(new Date(2026, 0, 5, 12, 0))).toBe("2026-01-05");
  });
});

describe("todayKey", () => {
  it("formats the moment it is given", () => {
    expect(todayKey(new Date(2026, 8, 20, 14, 0))).toBe("2026-09-20");
  });

  it("returns a well-formed key for the real clock", () => {
    expect(isDateKey(todayKey())).toBe(true);
  });
});

describe("dateKeyOf", () => {
  it("reads the local day out of an ISO datetime", () => {
    const iso = new Date(2026, 8, 20, 12, 40).toISOString();
    expect(dateKeyOf(iso)).toBe("2026-09-20");
  });

  it("is null for something unparseable", () => {
    expect(dateKeyOf("점심때쯤")).toBeNull();
    expect(dateKeyOf("")).toBeNull();
  });
});

describe("isDateKey", () => {
  it("accepts a real date", () => {
    expect(isDateKey("2026-09-20")).toBe(true);
    expect(isDateKey("2024-02-29")).toBe(true);
  });

  it("rejects a date that does not exist", () => {
    expect(isDateKey("2026-02-30")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2025-02-29")).toBe(false);
  });

  it("rejects anything that is not a bare date key", () => {
    expect(isDateKey("2026-9-20")).toBe(false);
    expect(isDateKey("2026-09-20T12:00:00+09:00")).toBe(false);
    expect(isDateKey(20260920)).toBe(false);
    expect(isDateKey(null)).toBe(false);
    expect(isDateKey(undefined)).toBe(false);
  });
});

describe("compareDateKeys", () => {
  it("orders chronologically", () => {
    expect(compareDateKeys("2026-09-19", "2026-09-20")).toBe(-1);
    expect(compareDateKeys("2026-09-20", "2026-09-20")).toBe(0);
    expect(compareDateKeys("2026-10-01", "2026-09-30")).toBe(1);
  });

  it("sorts a list into date order", () => {
    const keys = ["2026-10-01", "2026-09-09", "2026-09-10"];
    expect([...keys].sort(compareDateKeys)).toEqual([
      "2026-09-09",
      "2026-09-10",
      "2026-10-01",
    ]);
  });
});
