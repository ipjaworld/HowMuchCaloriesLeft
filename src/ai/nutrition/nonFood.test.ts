import { describe, expect, it } from "vitest";
import { describePart } from "@/application/foodCoverage";
import { resolveAddParts } from "@/application/addFood";
import { koreanFoodResolver } from "./koreanFoods";
import { isNonFoodPhrase } from "./nonFood";

/**
 * 2026-11-10, Phase 3 batch 1. Each sentence below asked the calories of
 * something that is not a food before this batch (coverage ids in comments).
 */

describe("talk around a meal is not a food", () => {
  it.each([
    "너무 맛있었어", // blind-17
    "ㅎㅎ 맛있었다", // review-20
    "너무 매워", // review-15
    "나니까 배불러", // review-13
    "배불러 죽겠다", // homo-neg-08
    "진짜 죽겠다", // homo-neg-02
    "운동했어", // narr-20
    "그냥 굶었어", // pol-08
    "참았어", // blind-28
    "굶고 점심", // review-11
    "점심을 걸러서 저녁", // blind-14
    "저녁은 굶었어", // blind-23
    "다이어트 때문", // blind-23
    "헬스장 가기 전", // blind-06
    "동생이", // blind-26
    "고민 중이야", // pol-07
    "좀 짜네",
    "진짜 별로였어",
  ])("%s", (phrase) => {
    expect(isNonFoodPhrase(phrase)).toBe(true);
  });

  it.each([
    // Foods whose names begin like a comment or contain a framing word.
    "짜장면", "짜글이", "달걀", "달고나", "맵쌀", "배", "좋은느낌 과자", "전", "김치전", "후라이",
    // A comment about something else in the slice: still asked about.
    "마들렌 맛있었어", "너무 맛있는 휘낭시에", "아침 거르고 마들렌", "굶고 크로플",
    // Too little said to throw away, or a name the app cannot know is a person.
    "그냥", "진짜", "민수", "빵 터졌네", "사과했는데 안 받아줬어",
    // 전 after a noun is a food as often as a time.
    "감자 전", "운동 전", "회사 때문에 치킨",
    "",
  ])("keeps %s", (phrase) => {
    expect(isNonFoodPhrase(phrase)).toBe(false);
  });
});

describe("the add pipeline after this batch", () => {
  const parts = async (sentence: string) => (await resolveAddParts(sentence, koreanFoodResolver)).map(describePart);

  it("records the food and asks nothing about the talk around it", async () => {
    expect(await parts("김밥 먹었는데 너무 맛있었어")).toEqual(['resolved 김밥 (1줄) ← "김밥"']);
    expect(await parts("김밥 먹고 운동했어")).toEqual(['resolved 김밥 (1줄) ← "김밥"']);
    expect(await parts("아침 굶고 점심에 김밥 먹었어")).toEqual(['resolved 김밥 (1줄) ← "김밥"']);
    expect(await parts("헬스장 가기 전에 바나나 먹었어")).toEqual(['resolved 바나나 (1개) ← "바나나"']);
  });

  it("reads 먹는 중 as eating, and company before the verb as company", async () => {
    expect(await parts("김치찌개 먹는 중")).toEqual(['resolved 김치찌개 (1그릇) ← "김치찌개"']);
    expect(await parts("김치찌개 먹는 중이야")).toEqual(['resolved 김치찌개 (1그릇) ← "김치찌개"']);
    expect(await parts("치킨 배달시켜서 동생이랑 먹었어")).toEqual(['resolved 치킨 (1인분) ← "치킨"']);
    expect(await parts("떡볶이 친구랑 같이 먹었어")).toEqual(['resolved 떡볶이 (1인분) ← "떡볶이"']);
  });

  it("never drops a food, known or not, because of these rules", async () => {
    // Known foods that look like the patterns.
    expect(await parts("김치전에 막걸리 마셨어")).toEqual(expect.arrayContaining([expect.stringContaining("김치전")]));
    expect(await parts("짜장면 먹었어")).toEqual([expect.stringContaining("resolved")]);
    // A food listed with 이랑 right before the verb is a food, not company.
    expect((await parts("김밥 라면이랑 먹었어")).join(" ")).toContain("라면");
    // An unknown food next to a comment is still asked about.
    expect(await parts("뽀로롱떡 먹었는데 맛있었어")).toEqual(['unknown ← "뽀로롱떡"']);
    expect(await parts("아침 거르고 뽀로롱떡 먹었어")).toEqual([expect.stringContaining("뽀로롱떡")]);
    // An unknown slice that carries its own amount is kept.
    expect((await parts("김밥이랑 운동했어 2개 먹었어")).length).toBe(2);
  });
});
