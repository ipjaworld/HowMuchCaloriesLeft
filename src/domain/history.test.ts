import { describe, expect, it } from "vitest";
import { setDailyGoal } from "@/application/dailyGoal";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { createLocalStorageMealRecordRepository } from "@/infrastructure/localStorageMealRecordRepository";
import { STORAGE_KEYS, createMemoryStorage } from "@/infrastructure/storage";
import {
  effectiveGoal,
  historyStart,
  summarizeHistory,
  summarizeHistoryDay,
} from "./history";
import type { FoodItem, MealRecord } from "./meal";

let nextId = 0;

function item(calories: number, extra: Partial<FoodItem> = {}): FoodItem {
  nextId += 1;
  return { id: `i${nextId}`, name: `food${nextId}`, calories, caloriesEstimated: false, ...extra };
}

function record(consumedAt: string, items: FoodItem[]): MealRecord {
  nextId += 1;
  return {
    id: `r${nextId}`,
    consumedAt,
    sourceText: "test",
    items,
    createdAt: consumedAt,
    updatedAt: consumedAt,
  };
}

describe("KST day boundaries", () => {
  it("puts 23:59 KST on that day and 00:00 KST on the next", () => {
    const late = record("2026-09-27T23:59:00+09:00", [item(100)]);
    const midnight = record("2026-09-28T00:00:00+09:00", [item(200)]);
    const days = summarizeHistory([late, midnight], [], "2026-09-28");

    expect(days.map((day) => [day.date, day.consumedCalories])).toEqual([
      ["2026-09-28", 200],
      ["2026-09-27", 100],
    ]);
  });

  it("does not push a stored UTC timestamp back a day", () => {
    // 00:10 KST on 9/28, as `toISOString()` stores it.
    const days = summarizeHistory(
      [record("2026-09-27T15:10:00.000Z", [item(300)])],
      [],
      "2026-09-28",
    );
    expect(days).toHaveLength(1);
    expect(days[0]?.date).toBe("2026-09-28");
  });
});

describe("a past day keeps the goal it had", () => {
  it("9/27 stays 1800 / 2250 after the goal changes to 2000 on 9/28", async () => {
    const storage = createMemoryStorage();
    const goals = createLocalStorageDailyGoalRepository({ storage });
    const meals = createLocalStorageMealRecordRepository({ storage });

    await setDailyGoal(goals, "2026-09-27", 2250);
    await meals.add(record("2026-09-27T12:00:00+09:00", [item(1800)]));
    await setDailyGoal(goals, "2026-09-28", 2000);

    const days = summarizeHistory(await meals.getAll(), await goals.getAll(), "2026-09-28");
    const sept27 = days.find((day) => day.date === "2026-09-27");
    const sept28 = days.find((day) => day.date === "2026-09-28");

    expect(sept27).toMatchObject({ consumedCalories: 1800, calorieTarget: 2250, difference: -450 });
    expect(sept28).toMatchObject({ calorieTarget: 2000, outcome: "no_record" });
  });

  it("carries a goal forward to days it was not changed on", () => {
    const goals = [
      { date: "2026-09-20", calorieTarget: 2100 },
      { date: "2026-09-25", calorieTarget: 1900 },
    ];
    expect(effectiveGoal(goals, "2026-09-19")).toBeNull();
    expect(effectiveGoal(goals, "2026-09-22")?.calorieTarget).toBe(2100);
    expect(effectiveGoal(goals, "2026-09-25")?.calorieTarget).toBe(1900);
    expect(effectiveGoal(goals, "2026-10-01")?.calorieTarget).toBe(1900);
  });

  it("the repository resolves goals with the same rule", async () => {
    const goals = createLocalStorageDailyGoalRepository({ storage: createMemoryStorage() });
    await setDailyGoal(goals, "2026-09-25", 1900);
    await setDailyGoal(goals, "2026-09-20", 2100);
    expect((await goals.get("2026-09-22"))?.calorieTarget).toBe(2100);
    expect((await goals.get("2026-09-26"))?.calorieTarget).toBe(1900);
  });
});

describe("one day's figures", () => {
  it("no records is no_record, not zero against the goal", () => {
    expect(summarizeHistoryDay("2026-09-27", [], 2250)).toMatchObject({
      consumedCalories: 0,
      itemCount: 0,
      outcome: "no_record",
    });
  });

  it("one record", () => {
    expect(
      summarizeHistoryDay("2026-09-27", [record("2026-09-27T08:00:00+09:00", [item(400)])], 2250),
    ).toMatchObject({ consumedCalories: 400, itemCount: 1, difference: -1850, outcome: "under" });
  });

  it("sums dataset, serving-reference and user-stated items alike", () => {
    const records = [
      record("2026-09-27T08:00:00+09:00", [
        item(172, { calorieSource: "dataset" }),
        item(75, { caloriesEstimated: true, portionNote: "1개 50g 기준" }),
      ]),
      record("2026-09-27T13:00:00+09:00", [item(600, { calorieSource: "user" })]),
      // A record written before `calorieSource` existed.
      record("2026-09-27T19:00:00+09:00", [item(1413)]),
    ];
    expect(summarizeHistoryDay("2026-09-27", records, 2250)).toMatchObject({
      consumedCalories: 2260,
      itemCount: 4,
      difference: 10,
      outcome: "over",
    });
  });

  it("exactly on the goal is exact", () => {
    expect(
      summarizeHistoryDay("2026-09-27", [record("2026-09-27T08:00:00+09:00", [item(2250)])], 2250)
        .outcome,
    ).toBe("exact");
  });

  it("food before any goal is no_goal, with no difference", () => {
    expect(
      summarizeHistoryDay("2026-09-27", [record("2026-09-27T08:00:00+09:00", [item(500)])], null),
    ).toMatchObject({ outcome: "no_goal", difference: null, calorieTarget: null });
  });
});

describe("where history starts", () => {
  it("starts at the first record or goal, not before the app was used", () => {
    const records = [record("2026-09-24T12:00:00+09:00", [item(500)])];
    const goals = [{ date: "2026-09-22", calorieTarget: 2000 }];
    expect(historyStart(records, goals)).toBe("2026-09-22");

    const days = summarizeHistory(records, goals, "2026-09-25");
    expect(days.map((day) => day.date)).toEqual([
      "2026-09-25",
      "2026-09-24",
      "2026-09-23",
      "2026-09-22",
    ]);
    expect(days.find((day) => day.date === "2026-09-23")?.outcome).toBe("no_record");
  });

  it("is empty for someone who has done nothing yet", () => {
    expect(summarizeHistory([], [], "2026-09-27")).toEqual([]);
  });
});

describe("storage written by the previous version", () => {
  it("loads unchanged and summarises correctly", async () => {
    // The exact shapes v0.2 wrote: no calorieSource, estimated flags, notes.
    const storage = createMemoryStorage({
      [STORAGE_KEYS.mealRecords]: JSON.stringify({
        version: 1,
        records: [
          {
            id: "a",
            consumedAt: "2026-09-26T23:30:00.000Z",
            sourceText: "삶은 달걀 1개",
            items: [
              {
                id: "a1",
                name: "삶은 달걀",
                amount: "1개",
                calories: 75,
                caloriesEstimated: true,
                portionNote: "1개 50g 기준 · 주달래, Korean Clin Diabetes J 2010",
              },
            ],
            createdAt: "2026-09-26T23:30:00.000Z",
            updatedAt: "2026-09-26T23:30:00.000Z",
          },
          {
            id: "b",
            consumedAt: "2026-09-27T03:00:00.000Z",
            sourceText: "요거트 200g",
            items: [{ id: "b1", name: "떠먹는 요거트", amount: "200g", calories: 172, caloriesEstimated: false }],
            createdAt: "2026-09-27T03:00:00.000Z",
            updatedAt: "2026-09-27T03:00:00.000Z",
          },
        ],
      }),
      [STORAGE_KEYS.dailyGoals]: JSON.stringify({
        version: 1,
        goals: [{ date: "2026-09-27", calorieTarget: 2250 }],
      }),
    });

    const meals = createLocalStorageMealRecordRepository({ storage });
    const goals = createLocalStorageDailyGoalRepository({ storage });
    const all = await meals.getAll();
    expect(all).toHaveLength(2);

    const [today] = summarizeHistory(all, await goals.getAll(), "2026-09-27");
    // 08:30 KST and 12:00 KST on 9/27 — both on 9/27, not split by UTC.
    expect(today).toMatchObject({
      date: "2026-09-27",
      consumedCalories: 247,
      calorieTarget: 2250,
      itemCount: 2,
    });
  });
});
