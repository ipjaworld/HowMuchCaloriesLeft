import { describe, expect, it } from "vitest";
import { findByName } from "./dataset";
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

  it("식빵 2조각 — two slices of bread", async () => {
    const match = await resolved("식빵 2조각 먹었어");
    expect(match.entry.name).toBe("식빵");
    expect(match.calories).toBe(Math.round((match.entry.caloriesPer100g * 70) / 100));
  });

  it("a bare 빵 is not narrowed to 식빵 — nothing says it was the sliced loaf", async () => {
    // With several breads in the dataset it asks which; it never picks one.
    expect((await resolveOne("빵 2조각 먹었어")).status).not.toBe("resolved");
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

describe("a name inside a longer word is not that food", () => {
  /**
   * The matcher once scored "the phrase contains a dataset name" at 0.65,
   * which priced 감자탕 as 감자 and 딸기케이크 as one strawberry. A name now
   * counts inside a phrase only as a word of its own, with at most a particle
   * after it; otherwise the answer is unknown.
   */
  it.each([
    "감자튀김", "딸기케이크", "수박바", "불닭볶음면",
    "치킨버거", "컵라면", "스팸김밥", "로제떡볶이", "커피우유", "두부김치",
    "김치전", "깍두기볶음밥", "뼈다귀감자탕", "백순대", "순대곱창볶음", "감자전골",
  ])("%s → unknown", async (food) => {
    expect((await resolveOne(`${food} 먹었어`)).status).toBe("unknown");
  });

  // 감자탕 and 참치김밥 were in the list above until they got rows of their
  // own (2026-10-01). What matters now is that each is its own entry and not
  // the shorter name inside it.
  it.each([
    ["감자탕", "감자탕"],
    ["참치김밥", "참치김밥"],
    ["치즈김밥", "치즈김밥"],
    ["불고기덮밥", "불고기덮밥"],
    ["해물파전", "해물파전"],
    ["유부초밥", "유부초밥"],
    ["잡채", "잡채"],
    ["깍두기", "깍두기"],
    ["감자", "감자"],
    ["김밥", "김밥"],
    ["불고기", "소불고기"],
    ["잡채밥", "잡채밥"],
    ["순대볶음", "순대볶음"],
    ["순대", "순대"],
    ["감자전", "감자전"],
  ])("a compound with its own row is that row: %s", async (food, name) => {
    expect((await resolved(`${food} 먹었어`)).entry.name).toBe(name);
  });

  it("감자전 한 장 asks instead of pricing a 장 the row never sized", async () => {
    expect((await resolveOne("감자전 한 장 먹었어")).status).not.toBe("resolved");
  });

  it.each(["파전", "덮밥", "전", "밥", "튀김", "빵", "회", "죽", "갈비"])(
    "a generic dish name is not narrowed to the one variant in the dataset: %s",
    async (word) => {
      expect((await resolveOne(`${word} 먹었어`)).status).not.toBe("resolved");
    },
  );

  it.each([
    ["오늘 기분이 안좋아서 떡볶이를 먹었어", "떡볶이"],
    ["엄마가 해준 김치찌개 먹었어", "김치찌개"],
    ["너무 배고파서 짜장면 먹었어", "짜장면"],
    ["배달로 떡볶이 시켜 먹었어", "떡볶이"],
    ["회사 근처에서 제육덮밥 먹었어", "제육덮밥"],
  ])("still finds the food a story ends on: %s", async (sentence, name) => {
    expect((await resolved(sentence)).entry.name).toBe(name);
  });

  it("prefers the longest name: 그릭 요거트 is not also 요거트", async () => {
    const result = await resolveOne("운동 끝나고 그릭 요거트 하나 먹었어");
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.entries.map((entry) => entry.name)).toEqual(["그릭요거트"]);
  });

  it("does not take a food that something else follows", () => {
    // The parser now cuts this sentence at 먹으려다; the matcher must still
    // refuse the phrase on its own, for whatever the parser cannot cut.
    expect(findByName(KOREAN_FOODS, "떡볶이 먹으려다 참고 샐러드").kind).toBe("none");
  });

  it("never reads 사과 inside a longer phrase — it is an apology as often as an apple", async () => {
    expect(findByName(KOREAN_FOODS, "친구한테 사과").kind).toBe("none");
    expect((await resolved("사과 하나 먹었어")).entry.name).toBe("사과");
  });

  it.each(["김", "떡"])(
    "a single syllable is not narrowed to the one food it is part of: %s",
    async (word) => {
      expect((await resolveOne(`${word} 먹었어`)).status).toBe("unknown");
    },
  );

  it("a single syllable that heads several foods still asks", async () => {
    expect((await resolveOne("밥 한 공기 먹었어")).status).toBe("ambiguous");
  });
});

describe("real ambiguity is still asked about", () => {
  it.each([
    ["냉면 한 그릇", ["물냉면", "비빔냉면"]],
    ["만두 1인분", ["고기만두", "군만두", "김치만두", "물만두"]],
    ["스파게티 한 접시", ["오일 스파게티", "크림 스파게티", "토마토 스파게티"]],
    ["샌드위치 하나", ["닭가슴살 샌드위치", "참치 샌드위치", "햄에그 샌드위치"]],
  ])("%s", async (phrase, expected) => {
    const result = await resolveOne(`${phrase} 먹었어`);
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.candidates.map((c) => c.entry.name).sort()).toEqual([...expected].sort());
  });
});

describe("what is still not covered stays unknown", () => {
  it.each(["마라샹궈", "소주 한 병", "타코", "포케", "엽떡"])("%s", async (phrase) => {
    const result = await resolveOne(`${phrase} 먹었어`);
    expect(result.status).toBe("unknown");
    expect(result).not.toHaveProperty("match");
  });
});

describe("diet and fitness foods — the everyday wording reaches the row", () => {
  it.each([
    ["그릭요거트 100g 먹었어", "그릭요거트"],
    ["그릭 요거트 100g 먹었어", "그릭요거트"],
    ["무가당 그릭요거트 150g", "그릭요거트"],
    ["닭찌찌살 100g 먹었어", "닭가슴살"],
    ["닭안심 100g 먹었어", "닭안심"],
    ["오트밀 40g 먹었어", "오트밀"],
    ["오트밀크 200ml 마셨어", "오트밀크"],
    ["두부 100g 먹었어", "두부"],
    ["계란 흰자 100g 먹었어", "달걀흰자"],
    ["참치캔 100g 먹었어", "참치캔"],
    ["아몬드 20g 먹었어", "아몬드"],
    ["프로틴 파우더 30g 먹었어", "단백질 보충제"],
    ["닭가슴살 샐러드 한 그릇 먹었어", "닭가슴살 샐러드"],
  ])("%s → %s", async (sentence, name) => {
    const match = await resolved(sentence);
    expect(match.entry.name).toBe(name);
  });

  it("a bare 샐러드 asks which, rather than picking one", async () => {
    expect((await resolveOne("샐러드 먹었어")).status).toBe("ambiguous");
  });

  it("a salad that is not in the dataset is not priced as one that is", async () => {
    expect((await resolveOne("연어 샐러드 먹었어")).status).toBe("unknown");
    expect((await resolved("참치 샐러드 먹었어")).entry.name).toBe("참치 샐러드");
  });

  it("a protein shake is never priced as powder", async () => {
    const result = await resolveOne("프로틴 쉐이크 300ml 마셨어");
    if (result.status === "resolved") {
      expect(result.match.entry.name).not.toBe("단백질 보충제");
    }
  });

  it("plain 요거트 still means the spoon yoghurt", async () => {
    const match = await resolved("요거트 100g 먹었어");
    expect(match.entry.name).toBe("떠먹는 요거트");
  });
});

describe("v1 coverage expansion (2026-10-02)", () => {
  it.each([
    ["마라탕", "마라탕"],
    ["치킨", "치킨"],
    ["교촌 치킨", "치킨"],
    ["피자", "피자"],
    ["샤브샤브", "샤브샤브"],
    ["우동", "우동"],
    ["라멘", "라멘"],
    ["초밥", "초밥"],
    ["탕수육", "탕수육"],
    ["김치", "배추김치"],
    ["돈가스김밥", "돈가스김밥"],
    ["참치 샐러드", "참치 샐러드"],
  ])("%s is recorded as %s without a question", async (food, name) => {
    expect((await resolved(`${food} 먹었어`)).entry.name).toBe(name);
  });

  it.each(["치킨 한 마리", "피자 한 판", "피자 두 조각", "초밥 10개"])(
    "%s asks rather than pricing a unit the row never sized",
    async (phrase) => {
      expect((await resolveOne(`${phrase} 먹었어`)).status).toBe("unmeasurable");
    },
  );

  it.each(["회 1인분", "빵 2조각", "회", "튀김", "치킨버거", "불고기피자", "연어초밥", "김치우동", "치킨 샐러드"])(
    "%s is not settled on the one food the data happens to carry",
    async (phrase) => {
      expect((await resolveOne(`${phrase} 먹었어`)).status).not.toBe("resolved");
    },
  );

  it("marks the varying foods and only those", () => {
    const high = KOREAN_FOODS.filter((entry) => entry.variance === "high").map((entry) => entry.name);
    expect(high).toEqual(expect.arrayContaining(["마라탕", "치킨", "피자", "샤브샤브", "초밥", "탕수육"]));
    expect(high).not.toContain("김밥");
    expect(high).not.toContain("쌀밥");
    expect(high.length).toBe(27);
  });
});
