import { describe, expect, it } from "vitest";
import type { FoodItem } from "@/domain/meal";
import { describeItemBasis } from "./itemBasis";

const item = (extra: Partial<FoodItem>): FoodItem => ({
  id: "1",
  name: "제육볶음",
  amount: "1인분",
  calories: 488,
  caloriesEstimated: false,
  ...extra,
});

describe("describeItemBasis", () => {
  it("adds nothing to a figure priced from an amount the user said", () => {
    expect(describeItemBasis(item({}))).toBeNull();
  });

  it("says an estimate rests on the MFDS serving when no other source is noted", () => {
    expect(describeItemBasis(item({ caloriesEstimated: true }))).toBe("추정값 · 식약처 1회 제공량 기준");
  });

  it("quotes the household measure an estimate came from", () => {
    expect(
      describeItemBasis(item({ caloriesEstimated: true, portionNote: "1개 50g 기준 (중) · 식품교환표" })),
    ).toBe("추정값 · 1개 50g 기준 (중) · 식품교환표");
  });

  it("adds the spread of a representative figure", () => {
    expect(describeItemBasis(item({ caloriesEstimated: true, calorieVariance: "high" }))).toBe(
      "추정값 · 식약처 1회 제공량 기준 · 재료와 양에 따라 차이가 커요",
    );
  });

  it("names a figure the user gave as theirs", () => {
    expect(describeItemBasis(item({ calorieSource: "user" }))).toBe("직접 말한 칼로리");
  });
});
