import type { FoodItem } from "@/domain/meal";

/**
 * What a logged figure stands on, in one short line — or null when there is
 * nothing to add to the row itself.
 *
 * It used to live in a `title`, which only a mouse can reach: on a phone the
 * "~" said "estimate" and nothing more (2026-10-06 feedback, where a tester
 * had to look a product up to see why a figure was what it was). Only what
 * the record actually holds is said; nothing is worked out again here.
 */
export function describeItemBasis(item: FoodItem): string | null {
  if (item.calorieSource === "user") return "직접 말한 칼로리";
  if (!item.caloriesEstimated) return null;

  const parts = [
    item.portionNote === undefined ? "추정값 · 식약처 1회 제공량 기준" : `추정값 · ${item.portionNote}`,
  ];
  if (item.calorieVariance === "high") parts.push("재료와 양에 따라 차이가 커요");
  return parts.join(" · ");
}
