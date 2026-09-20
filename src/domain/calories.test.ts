import { describe, expect, it } from "vitest";
import {
  calculateDailyCalories,
  calculateGoalStatus,
  calculateMealRecordCalories,
  calculateRemainingCalories,
  sumFoodItemCalories,
  summarizeDay,
} from "./calories";
import type { FoodItem, MealRecord } from "./meal";

function item(name: string, calories: number): FoodItem {
  return { id: `i-${name}`, name, calories, caloriesEstimated: false };
}

function record(id: string, items: FoodItem[]): MealRecord {
  return {
    id,
    consumedAt: "2026-09-20T12:40:00+09:00",
    sourceText: "",
    items,
    createdAt: "2026-09-20T12:40:00+09:00",
    updatedAt: "2026-09-20T12:40:00+09:00",
  };
}

describe("sumFoodItemCalories", () => {
  it("adds the items up", () => {
    expect(sumFoodItemCalories([item("갈비탕", 650), item("흰쌀밥", 320)])).toBe(
      970,
    );
  });

  it("is 0 for no items", () => {
    expect(sumFoodItemCalories([])).toBe(0);
  });
});

describe("calculateMealRecordCalories", () => {
  it("derives the total from the items rather than a stored field", () => {
    const lunch = record("r1", [
      item("갈비탕", 650),
      item("흰쌀밥", 320),
      item("김치", 35),
    ]);
    expect(calculateMealRecordCalories(lunch)).toBe(1005);
  });
});

describe("calculateDailyCalories", () => {
  it("is 0 with no records", () => {
    expect(calculateDailyCalories([])).toBe(0);
  });

  it("adds several records with several items each", () => {
    const records = [
      record("breakfast", [item("삼각김밥", 210), item("두유", 120)]),
      record("lunch", [item("갈비탕", 650), item("흰쌀밥", 320)]),
      record("snack", [item("아메리카노", 10)]),
    ];
    expect(calculateDailyCalories(records)).toBe(1310);
  });

  it("ignores records that have no items", () => {
    expect(calculateDailyCalories([record("empty", [])])).toBe(0);
  });
});

describe("calculateRemainingCalories", () => {
  const records = [record("lunch", [item("갈비탕", 650), item("흰쌀밥", 320)])];

  it("is positive under the goal", () => {
    expect(calculateRemainingCalories(records, 2100)).toBe(1130);
  });

  it("is 0 exactly on the goal", () => {
    expect(calculateRemainingCalories(records, 970)).toBe(0);
  });

  it("goes negative over the goal — wording is not the domain's job", () => {
    expect(calculateRemainingCalories(records, 830)).toBe(-140);
  });

  it("equals the goal when nothing was eaten", () => {
    expect(calculateRemainingCalories([], 2100)).toBe(2100);
  });
});

describe("calculateGoalStatus", () => {
  it.each([
    [520, "under"],
    [0, "exact"],
    [-140, "over"],
  ] as const)("%d is %s", (remaining, expected) => {
    expect(calculateGoalStatus(remaining)).toBe(expected);
  });
});

describe("summarizeDay", () => {
  const records = [record("lunch", [item("갈비탕", 650), item("흰쌀밥", 320)])];

  it("reports consumed calories but no remainder without a goal", () => {
    expect(summarizeDay(records, null)).toEqual({
      consumedCalories: 970,
      calorieTarget: null,
      remainingCalories: null,
      status: null,
    });
  });

  it("reports the full picture with a goal", () => {
    expect(summarizeDay(records, 2100)).toEqual({
      consumedCalories: 970,
      calorieTarget: 2100,
      remainingCalories: 1130,
      status: "under",
    });
  });

  it("handles a first run: nothing eaten, no goal", () => {
    expect(summarizeDay([], null)).toEqual({
      consumedCalories: 0,
      calorieTarget: null,
      remainingCalories: null,
      status: null,
    });
  });

  it("marks going over without flipping the sign", () => {
    expect(summarizeDay(records, 830)).toMatchObject({
      remainingCalories: -140,
      status: "over",
    });
  });
});
