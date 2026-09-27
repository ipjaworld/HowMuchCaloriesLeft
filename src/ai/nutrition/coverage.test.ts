import { describe, expect, it } from "vitest";
import { parseFoodPhrases } from "./foodPhrases";
import { KOREAN_FOODS, koreanFoodResolver } from "./koreanFoods";

/**
 * What changed after the first days of real use: many more foods, and the
 * units people actually say. Over the shipped dataset, asserted by behaviour
 * rather than by calorie figures — a re-sync may legitimately move a number,
 * but it must never turn a resolved food into a question, a question into a
 * silent guess, or a trap row into a match.
 */

async function resolveOne(sentence: string) {
  const phrase = parseFoodPhrases(sentence)[0];
  if (phrase === undefined) throw new Error(`no food phrase in "${sentence}"`);
  return koreanFoodResolver.resolve(phrase);
}

async function resolved(sentence: string) {
  const result = await resolveOne(sentence);
  if (result.status !== "resolved") {
    throw new Error(`"${sentence}" did not resolve: ${result.status}`);
  }
  return result.match;
}

describe("human units — the serving reference layer", () => {
  it("삶은 달걀 두 개 — no longer asks for grams", async () => {
    const match = await resolved("삶은 달걀 두 개 먹었어");
    expect(match.entry.name).toBe("삶은 달걀");
    // 2 × 50 g at the MFDS row's own kcal/100 g.
    expect(match.calories).toBe(Math.round(match.entry.caloriesPer100g));
    expect(match.estimated).toBe(true);
    expect(match.portionNote).toContain("1개 50g");
    expect(match.portionNote).toContain("주달래");
  });

  it("계란 2개 — the everyday word reaches the same row", async () => {
    const match = await resolved("계란 2개 먹었어");
    expect(match.entry.name).toBe("삶은 달걀");
    expect(match.estimated).toBe(true);
  });

  it("바나나 1개 — a raw banana, not the 454 kcal/100 g snack", async () => {
    const match = await resolved("바나나 1개 먹었어");
    expect(match.entry.id).toBe("R108-037000001-0000");
    expect(match.entry.caloriesPer100g).toBeLessThan(100);
    expect(match.calories).toBe(match.entry.caloriesPer100g); // 100 g
    expect(match.estimated).toBe(true);
    expect(match.portionNote).toContain("식품교환표");
  });

  it("사과 반 개 — half of a 240 g apple", async () => {
    const match = await resolved("사과 반 개 먹었어");
    expect(match.calories).toBe(Math.round((match.entry.caloriesPer100g * 120) / 100));
    expect(match.amount.value).toBe(0.5);
  });

  it("두유 1팩 — the top of the published 180-200 mL carton range", async () => {
    const match = await resolved("두유 1팩 마셨어");
    expect(match.calories).toBe(Math.round((match.entry.caloriesPer100g * 200) / 100));
    expect(match.estimated).toBe(true);
    // A pick from a printed range, shown as the volume it is and as a pick.
    expect(match.portionNote).toContain("1팩 200mL 기준");
    expect(match.portionNote).toContain("180~200 mL 범위의 상단값");
  });

  it("귤·참외·복숭아 by the piece ask for grams — only the pre-2010 table counts them", async () => {
    for (const sentence of ["귤 1개 먹었어", "참외 1개 먹었어", "복숭아 1개 먹었어"]) {
      const result = await resolveOne(sentence);
      expect(result.status, sentence).toBe("unmeasurable");
    }
  });

  it("빵 2조각 — two slices of bread", async () => {
    const match = await resolved("빵 2조각 먹었어");
    expect(match.entry.name).toBe("식빵");
    expect(match.calories).toBe(Math.round((match.entry.caloriesPer100g * 70) / 100));
  });

  it("우유 한 컵 and a bare 바나나 each count one unit", async () => {
    expect((await resolved("우유 한 컵 마셨어")).amount.text).toBe("한 컵");
    expect((await resolved("바나나 먹었어")).amount.text).toBe("1개");
  });

  it("아메리카노 한 잔 — a typical café cup, marked estimated", async () => {
    const match = await resolved("아메리카노 한 잔 마셨어");
    expect(match.estimated).toBe(true);
    expect(match.portionNote).toContain("355");
    // The cup changes grams, never the brewed coffee's own kcal/100 g.
    expect(match.entry.caloriesPer100g).toBeLessThan(10);
  });

  it("keeps an MFDS-stated portion unmarked", async () => {
    const match = await resolved("갈비탕 한 그릇 먹었어");
    expect(match.estimated).toBe(false);
    expect(match.portionNote).toBeUndefined();
  });

  it("asks rather than multiplying a portion by a count of something else", async () => {
    // 만두 is published per 인분. "5개" used to become five 인분.
    const result = await resolveOne("고기만두 5개 먹었어");
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.reason).toBe("unsupported_unit");
    expect(result.unit).toBe("개");
  });

  it("asks for 김밥 by the piece rather than pricing 3개 as three rolls", async () => {
    const result = await resolveOne("김밥 3개 먹었어");
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.reason).toBe("unsupported_unit");
  });
});

describe("coverage", () => {
  /** The fourteen foods the MVP shipped with. None may regress. */
  const ORIGINAL = [
    "쌀밥 한 공기",
    "현미밥 한 공기",
    "김밥 한 줄",
    "비빔밥 한 그릇",
    "갈비탕 한 그릇",
    "김치찌개 한 그릇",
    "된장찌개 한 그릇",
    "라면 한 그릇",
    "제육볶음 1인분",
    "소불고기 1인분",
    "삼겹살 1인분",
    "삶은 달걀 1개",
    "아메리카노 한 잔",
    "삼각김밥 110g",
  ];

  it("still resolves every food the MVP shipped with", async () => {
    for (const phrase of ORIGINAL) {
      const result = await resolveOne(`${phrase} 먹었어`);
      expect(result.status, phrase).toBe("resolved");
    }
  });

  /** One everyday way of saying each newly added food. */
  const ADDED = [
    "잡곡밥 한 공기", "볶음밥 한 그릇", "김치볶음밥", "카레라이스", "제육덮밥", "오므라이스",
    "순두부찌개", "부대찌개", "미역국", "설렁탕", "육개장", "삼계탕", "떡국", "순대국밥", "콩나물국",
    "짜장면", "짬뽕", "칼국수", "물냉면", "비빔냉면", "잔치국수", "비빔국수", "쫄면", "쌀국수",
    "토마토 스파게티", "크림 스파게티",
    "닭갈비", "돈가스", "족발", "떡볶이", "라볶이", "순대", "고기만두", "군만두",
    "바나나", "사과", "귤 100g", "오렌지", "배 한 개", "딸기 10개", "수박 한 쪽", "참외 200g", "복숭아 150g",
    "고구마", "감자", "우유 한 컵", "저지방우유 1팩", "두유 1팩", "식빵 한 장",
    "햄에그 샌드위치", "참치 샌드위치", "닭가슴살 샌드위치", "햄버거", "불고기버거",
    "카페라떼 한 잔", "아이스 카페라떼", "카페모카",
    "닭가슴살 150g", "포도 100g", "키위 80g", "토마토 150g", "방울토마토 100g", "옥수수 100g",
    "떠먹는 요거트 90g", "마시는 요구르트 150ml", "달걀프라이 50g",
    "콜라 250ml", "제로콜라 355ml", "사이다 250ml",
  ];

  it("resolves every food added in this round", async () => {
    for (const phrase of ADDED) {
      const result = await resolveOne(`${phrase} 먹었어`);
      expect(result.status, phrase).toBe("resolved");
      if (result.status !== "resolved") continue;
      expect(result.match.calories, phrase).toBeGreaterThanOrEqual(0);
    }
  });

  it("ships more than five times the original fourteen", () => {
    expect(KOREAN_FOODS.length).toBeGreaterThanOrEqual(75);
  });
});

describe("the traps name search sets are still avoided", () => {
  it("커피 is the brewed drink, not 커피번 or a powder", async () => {
    const match = await resolved("커피 200ml 마셨어");
    expect(match.entry.id).toBe("D320-748080000-0001");
    expect(match.entry.caloriesPer100g).toBeLessThan(10);
  });

  it("no shipped fruit is a snack or a jam in disguise", () => {
    for (const name of ["바나나", "사과", "귤", "딸기", "포도", "배", "오렌지", "복숭아"]) {
      const entry = KOREAN_FOODS.find((candidate) => candidate.name === name);
      expect(entry, name).toBeDefined();
      // Fresh fruit sits well under 100 kcal/100 g; a chip or jam does not.
      expect(entry?.caloriesPer100g, name).toBeLessThan(100);
      expect(entry?.id, name).toMatch(/^R108-/);
    }
  });

  it("every shipped name is unique, so a stored name finds its row again", () => {
    const names = KOREAN_FOODS.map((entry) => entry.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("real ambiguity is still asked about", () => {
  it.each([
    ["냉면 한 그릇", ["물냉면", "비빔냉면"]],
    ["만두 1인분", ["고기만두", "군만두"]],
    ["스파게티 한 접시", ["크림 스파게티", "토마토 스파게티"]],
    ["샌드위치 하나", ["닭가슴살 샌드위치", "참치 샌드위치", "햄에그 샌드위치"]],
  ])("%s", async (phrase, expected) => {
    const result = await resolveOne(`${phrase} 먹었어`);
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.candidates.map((c) => c.entry.name).sort()).toEqual([...expected].sort());
  });
});

describe("what is still not covered stays unknown", () => {
  it.each(["마라탕", "치킨", "소주 한 병", "우동", "타코"])("%s", async (phrase) => {
    const result = await resolveOne(`${phrase} 먹었어`);
    expect(result.status).toBe("unknown");
    expect(result).not.toHaveProperty("match");
  });
});
