import { describe, expect, it } from "vitest";
import { resolveAddParts } from "@/application/addFood";
import { findByName } from "./dataset";
import { parseFoodPhrases } from "./foodPhrases";
import { KOREAN_FOODS, koreanFoodResolver } from "./koreanFoods";
import { cleanFoodLabel } from "./statedCalories";

/**
 * Which words may stand for which entry — the alias review of 2026-10-03.
 *
 * An alias is a different way of saying the *same* food. A bare word that
 * names a category, an ingredient, or a dish commonly cooked another way is
 * not an alias of one kind, however close the figures and however few other
 * kinds the dataset carries; `variance: "high"` does not license it either.
 * Each row below is the product decision first — what the user should see —
 * with the reason beside it.
 */

async function resolve(word: string) {
  const phrase = parseFoodPhrases(`${word} 먹었어`)[0];
  if (phrase === undefined) throw new Error(`no food phrase in "${word}"`);
  return koreanFoodResolver.resolve(phrase);
}

describe("the same food, said another way: recorded as that food", () => {
  it.each([
    ["호빵", "찐빵", "호빵 is the everyday name of the 팥 찐빵"],
    ["코코아", "핫초코", "the drink, not the powder"],
    ["보쌈 200g", "수육", "보쌈 is this boiled pork, served wrapped"],
    ["고사리", "고사리나물", "eaten on its own only as the 나물"],
    ["김구이", "조미김", "MFDS's own name for the row (김구이_조미김)"],
    ["도시락김", "조미김", "the lunch-box packet the row describes"],
    ["코다리조림", "코다리찜", "the same braise under either name"],
    ["소고기뭇국", "소고기무국", "spelling"],
    ["비빔라면", "비빔면", "the instant 비빔면 the row is"],
    ["블랙밀크티", "밀크티", "the row's own kind"],
    ["모듬회", "회", "the assorted row, recorded under the bare name"],
  ])("%s → %s (%s)", async (word, name) => {
    const result = await resolve(word);
    expect(result.status, word).toBe("resolved");
    if (result.status === "resolved") expect(result.match.entry.name).toBe(name);
  });
});

describe("a bare category or ingredient is not narrowed to one kind", () => {
  it.each([
    ["구운김", "plain roasted 김, not the seasoned row"],
    ["버블티", "the pearls make it a different drink, not a variance"],
    ["볶음면", "a record named 비빔면 would name the other kind"],
    ["볶음라면", "as 볶음면"],
    ["꽃게장", "간장 or 양념"],
    ["무국", "소고기 is an ingredient the word does not say"],
    ["골뱅이", "the shellfish, not the 무침"],
    ["골뱅이소면", "the 무침 plus noodles"],
    ["코다리", "the fish; 구이 is as common as 찜"],
    ["숙주", "숙주볶음 is as common as the 나물"],
    ["등갈비", "구이 is as common as 찜"],
    ["구운계란", "baked in the shell, not boiled — close figures are not the same food"],
    ["훈제란", "smoked, not boiled"],
  ])("%s → asks for the calories (%s)", async (word) => {
    expect((await resolve(word)).status).toBe("unknown");
  });

  it.each([
    ["빙수", ["인절미빙수", "팥빙수"]],
    ["게장", ["간장게장", "양념게장"]],
    ["튀김", ["감자튀김", "고구마튀김"]],
    ["에이드", ["레몬에이드", "자몽에이드"]],
  ])("%s asks which, between kinds of it (and '다른 음식이에요')", async (word, names) => {
    const result = await resolve(word);
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((candidate) => candidate.entry.name).sort()).toEqual(names);
    }
  });

  it("게장 asks which, between the two the dataset has", async () => {
    const result = await resolve("게장");
    expect(result.status).toBe("ambiguous");
    if (result.status === "ambiguous") {
      expect(result.candidates.map((candidate) => candidate.entry.name).sort()).toEqual(["간장게장", "양념게장"]);
    }
  });

  it("the specific names still resolve as themselves", async () => {
    for (const name of ["팥빙수", "조미김", "밀크티", "비빔면", "간장게장", "양념게장", "소고기무국", "골뱅이무침", "코다리찜", "숙주나물", "등갈비찜", "삶은 달걀"]) {
      const result = await resolve(name);
      expect(result.status, name).toBe("resolved");
      if (result.status === "resolved") expect(result.match.entry.name).toBe(name);
    }
  });
});

describe("the shipped dataset carries none of the removed aliases", () => {
  const removed = ["빙수", "구운김", "버블티", "볶음면", "볶음라면", "게장", "꽃게장", "무국", "뭇국", "골뱅이", "골뱅이소면", "코다리", "숙주", "등갈비", "구운계란", "구운 달걀", "구운란", "훈제란"];

  it.each(removed)("%s is no entry's alias", (word) => {
    const owners = KOREAN_FOODS.filter((food) => (food.aliases ?? []).includes(word)).map((food) => food.name);
    expect(owners).toEqual([]);
  });
});

describe("held for a separate decision (not changed in this review)", () => {
  it("김 stays 조미김: without the alias the one-syllable rule would ask '감자튀김 / 조미김?'", async () => {
    // By the alias rule 조미 is a kind the bare word does not say. But a one-
    // syllable word is matched as the *head* of longer names (쌀밥 · 현미밥
    // for 밥), and 김 is the last syllable of 감자튀김. Removing the alias
    // would trade a seasoning assumption for a question offering fries.
    const result = await resolve("김");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") expect(result.match.entry.name).toBe("조미김");

    const withoutAlias = KOREAN_FOODS.map((food) =>
      food.name === "조미김" ? { ...food, aliases: (food.aliases ?? []).filter((alias) => alias !== "김") } : food,
    );
    const asked = findByName(withoutAlias, "김");
    expect(asked.kind).toBe("several");
    if (asked.kind === "several") expect(asked.entries.map((food) => food.name)).toContain("감자튀김");
  });

  it("계란 · 달걀 still reach 삶은 달걀, as in production since v0.2", async () => {
    // By the same rule a bare 계란 is an ingredient. It is the most common
    // egg input and has been since v0.2, so changing it is its own decision,
    // recorded in the handoff rather than made inside this review.
    for (const word of ["계란 2개", "달걀 1개"]) {
      const result = await resolve(word);
      expect(result.status).toBe("resolved");
      if (result.status === "resolved") expect(result.match.entry.name).toBe("삶은 달걀");
    }
  });
});

describe("a cooking method the user states is not dropped by a space (2026-10-03)", () => {
  // Before: "구운계란" asked for the calories, but "구운 계란" was taken as the
  // last word 계란 → 삶은 달걀 and stored as a boiled egg. A modifier in front
  // of an alias of a specific food now keeps the food unknown, as without
  // the space. Plain 계란 · 달걀 → 삶은 달걀 is held as before (see above).
  const statusOf = async (sentence: string) => {
    const parts = await resolveAddParts(sentence, koreanFoodResolver);
    return parts.map((part) =>
      part.status === "resolved"
        ? `${part.item.name}${part.item.amount === undefined ? "" : ` ${part.item.amount}`}`
        : part.status === "unknown"
          ? `unknown:${cleanFoodLabel(part.phraseName)}${part.amount === undefined ? "" : ` ${part.amount}`}`
          : part.status,
    );
  };

  it.each([
    ["구운계란 먹었어", "unknown:구운계란"],
    ["구운 계란 먹었어", "unknown:구운 계란"],
    ["구운달걀 먹었어", "unknown:구운달걀"],
    ["구운 달걀 먹었어", "unknown:구운 달걀"],
    ["훈제계란 먹었어", "unknown:훈제계란"],
    ["훈제 계란 먹었어", "unknown:훈제 계란"],
    ["구운 계란 두 개 먹었어", "unknown:구운 계란 두 개"],
  ])("%s → %s (asks for the calories under the user's own name and amount)", async (sentence, expected) => {
    expect(await statusOf(sentence)).toEqual([expected]);
  });

  it.each([
    ["삶은계란 먹었어", "삶은 달걀 1개"],
    ["삶은 계란 먹었어", "삶은 달걀 1개"],
    ["삶은 달걀 두 개 먹었어", "삶은 달걀 두 개"],
    ["계란 2개 먹었어", "삶은 달걀 2개"],
    ["아침에 계란 두 개 먹었어", "삶은 달걀 두 개"],
    ["아침은 계란 두 개 먹었어", "삶은 달걀 두 개"],
    ["계란말이 먹었어", "계란말이 1인분"],
    ["훈제 닭가슴살 100g 먹었어", "훈제 닭가슴살 100g"],
    ["생크림 케이크 먹었어", "케이크 1조각"],
    ["봉골레 파스타 먹었어", "스파게티 1접시"],
    ["교촌 치킨 먹었어", "치킨 1인분"],
    ["맛있는 김밥 먹었어", "김밥 1줄"],
    ["친구가 사준 커피 마셨어", "아메리카노 1잔"],
  ])("%s → %s, as before", async (sentence, expected) => {
    expect(await statusOf(sentence)).toEqual([expected]);
  });

  it("계란후라이 still reaches its own entry (asks for the amount, as before)", async () => {
    expect(await statusOf("계란후라이 먹었어")).toEqual(["unmeasurable"]);
  });

  it("a stated figure keeps the user's name", async () => {
    const parts = await resolveAddParts("구운 계란 150kcal 먹었어", koreanFoodResolver);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({ status: "resolved", item: { name: "구운 계란", calories: 150, calorieSource: "user" } });
  });

  it("beside another food: nothing dropped, nothing doubled", async () => {
    expect(await statusOf("구운 계란 두 개랑 바나나 먹었어")).toEqual(["unknown:구운 계란 두 개", "바나나 1개"]);
  });

  it.each(["큰 계란 두 개 먹었어", "따뜻한 커피 마셨어", "구운 삼겹살 먹었어", "편의점 삼각김밥 먹었어"])(
    "%s now asks too — one modifier in front of an alias of a specific food (intended, conservative)",
    async (sentence) => {
      expect((await statusOf(sentence))[0]).toMatch(/^unknown:/);
    },
  );
});
