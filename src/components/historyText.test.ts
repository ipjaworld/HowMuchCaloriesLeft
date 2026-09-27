import { describe, expect, it } from "vitest";
import { summarizeHistoryDay } from "@/domain/history";
import type { MealRecord } from "@/domain/meal";
import { describeHistoryDate, describeHistoryDay } from "./historyText";

function recordOf(calories: number[]): MealRecord {
  return {
    id: "r",
    consumedAt: "2026-09-27T12:00:00+09:00",
    sourceText: "",
    items: calories.map((value, index) => ({
      id: `i${index}`,
      name: "x",
      calories: value,
      caloriesEstimated: false,
    })),
    createdAt: "2026-09-27T12:00:00+09:00",
    updatedAt: "2026-09-27T12:00:00+09:00",
  };
}

describe("describeHistoryDay", () => {
  it("under: the gap, as what was logged", () => {
    const day = summarizeHistoryDay("2026-09-27", [recordOf([1000, 878])], 2250);
    expect(describeHistoryDay(day)).toEqual({
      figures: "1,878 / 2,250 kcal",
      note: "목표보다 372 kcal 적게 기록",
      count: "2건",
      isOver: false,
    });
  });

  it("over: the excess, set apart", () => {
    const day = summarizeHistoryDay("2026-09-26", [recordOf([2310])], 2250);
    expect(describeHistoryDay(day)).toMatchObject({
      figures: "2,310 / 2,250 kcal",
      note: "60 kcal 초과",
      isOver: true,
    });
  });

  it("an empty day just says so", () => {
    expect(describeHistoryDay(summarizeHistoryDay("2026-09-25", [], 2250))).toEqual({
      figures: null,
      note: "기록 없음",
      count: null,
      isOver: false,
    });
  });

  it("before any goal, only the total", () => {
    const day = summarizeHistoryDay("2026-09-24", [recordOf([620])], null);
    expect(describeHistoryDay(day)).toMatchObject({ figures: "620 kcal", note: "목표 정하기 전" });
  });

  it("never grades the day", () => {
    const days = [
      summarizeHistoryDay("2026-09-27", [recordOf([100])], 2250),
      summarizeHistoryDay("2026-09-27", [recordOf([4000])], 2250),
      summarizeHistoryDay("2026-09-27", [recordOf([2250])], 2250),
    ];
    for (const day of days) {
      expect(describeHistoryDay(day).note).not.toMatch(/성공|실패|위험|잘했|아쉬|과식|부족/);
    }
  });
});

describe("describeHistoryDate", () => {
  it("names today and yesterday, and dates the rest with a weekday", () => {
    expect(describeHistoryDate("2026-09-27", "2026-09-27")).toBe("오늘");
    expect(describeHistoryDate("2026-09-26", "2026-09-27")).toBe("어제");
    expect(describeHistoryDate("2026-09-25", "2026-09-27")).toBe("9월 25일 (금)");
    expect(describeHistoryDate("2025-12-31", "2026-01-02")).toBe("2025년 12월 31일 (수)");
  });
});
