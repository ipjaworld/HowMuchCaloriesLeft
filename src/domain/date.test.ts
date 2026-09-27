import { describe, expect, it } from "vitest";
import { addDays, compareDateKeys, dateKeyOf, isDateKey, toDateKey, todayKey } from "./date";

describe("toDateKey — the day is always a KST day", () => {
  it("23:59 KST is still that day", () => {
    expect(toDateKey(new Date("2026-09-27T23:59:59+09:00"))).toBe("2026-09-27");
  });

  it("00:00 KST is the next day", () => {
    expect(toDateKey(new Date("2026-09-28T00:00:00+09:00"))).toBe("2026-09-28");
  });

  it("a UTC string is not sliced: 15:10Z is already the next morning in Seoul", () => {
    // "2026-09-27T15:10:00.000Z".slice(0, 10) would say 09-27.
    expect(toDateKey(new Date("2026-09-27T15:10:00.000Z"))).toBe("2026-09-28");
  });

  it("early-morning KST does not fall back onto the previous UTC date", () => {
    expect(toDateKey(new Date("2026-09-28T08:59:00+09:00"))).toBe("2026-09-28");
  });

  it("crosses a year boundary on KST, not UTC", () => {
    expect(toDateKey(new Date("2026-12-31T23:30:00+09:00"))).toBe("2026-12-31");
    expect(toDateKey(new Date("2027-01-01T00:05:00+09:00"))).toBe("2027-01-01");
  });

  it("zero-pads single-digit months and days", () => {
    expect(toDateKey(new Date("2026-01-05T12:00:00+09:00"))).toBe("2026-01-05");
  });
});

describe("todayKey", () => {
  it("formats the moment it is given", () => {
    expect(todayKey(new Date("2026-09-20T14:00:00+09:00"))).toBe("2026-09-20");
  });

  it("returns a well-formed key for the real clock", () => {
    expect(isDateKey(todayKey())).toBe(true);
  });
});

describe("dateKeyOf", () => {
  it("reads the KST day out of a stored UTC datetime", () => {
    // What `new Date().toISOString()` writes at 00:10 KST on 9/28.
    expect(dateKeyOf("2026-09-27T15:10:00.000Z")).toBe("2026-09-28");
    expect(dateKeyOf("2026-09-27T14:50:00.000Z")).toBe("2026-09-27");
  });

  it("reads an offset datetime", () => {
    expect(dateKeyOf("2026-09-20T12:40:00+09:00")).toBe("2026-09-20");
  });

  it("is null for something unparseable", () => {
    expect(dateKeyOf("점심때쯤")).toBeNull();
    expect(dateKeyOf("")).toBeNull();
  });
});

describe("addDays", () => {
  it("steps across month and year ends", () => {
    expect(addDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
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
