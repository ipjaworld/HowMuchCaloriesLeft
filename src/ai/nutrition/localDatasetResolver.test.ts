import { describe, expect, it } from "vitest";
import { MIN_MATCH_SCORE, findByName, nameVariants, parseFoodEntries } from "./dataset";
import { parseFoodPhrases } from "./foodPhrases";
import { koreanFoodResolver } from "./koreanFoods";
import { caloriesFor, createLocalDatasetResolver, toGrams, narrowByServingUnit } from "./localDatasetResolver";
import { assumedQuantity } from "./quantity";
import type { Quantity, Unit } from "./quantity";
import type { FoodEntry } from "./types";

/**
 * TEST FIXTURE — not product data.
 *
 * The figures below are round invented numbers chosen to make the arithmetic
 * easy to read. They exist to exercise matching and scaling and must never be
 * shipped: real calories come from the MFDS dataset, with provenance.
 */
const ENTRIES: FoodEntry[] = [
  {
    id: "f-rice",
    name: "흰쌀밥",
    aliases: ["공기밥", "쌀밥"],
    caloriesPer100g: 150,
    servings: [{ unit: "공기", grams: 200 }],
    source: "test-fixture",
  },
  {
    id: "f-brown-rice",
    name: "현미밥",
    caloriesPer100g: 140,
    servings: [{ unit: "공기", grams: 200 }],
    source: "test-fixture",
  },
  {
    id: "f-galbitang",
    name: "갈비탕",
    caloriesPer100g: 100,
    servings: [{ unit: "그릇", grams: 600 }],
    source: "test-fixture",
  },
  {
    id: "f-americano",
    name: "아이스 아메리카노",
    aliases: ["아아", "아메리카노"],
    caloriesPer100g: 2,
    servings: [{ unit: "잔", grams: 350 }],
    source: "test-fixture",
  },
  {
    id: "f-milk",
    name: "우유",
    caloriesPer100g: 60,
    servings: [{ unit: "팩", grams: 200 }],
    source: "test-fixture",
  },
  {
    id: "f-egg",
    name: "삶은 계란",
    aliases: ["계란", "달걀"],
    caloriesPer100g: 155,
    // One egg. This is what makes a bare "계란" resolve to 1개.
    servings: [{ unit: "개", grams: 50 }],
    source: "test-fixture",
  },
  {
    // Deliberately has no portion table — some source rows will not.
    id: "f-seaweed",
    name: "미역",
    caloriesPer100g: 12,
    source: "test-fixture",
  },
];

const resolver = createLocalDatasetResolver(ENTRIES);

/** By id, so inserting a fixture entry never silently shifts a test. */
function entry(id: string) {
  const found = ENTRIES.find((candidate) => candidate.id === id);
  if (found === undefined) throw new Error(`no fixture entry ${id}`);
  return found;
}

function only(sentence: string) {
  const phrase = parseFoodPhrases(sentence)[0];
  if (phrase === undefined) throw new Error(`no phrase parsed from ${sentence}`);
  return phrase;
}

describe("nameVariants", () => {
  it("removes spacing, which Korean food names are not consistent about", () => {
    expect(nameVariants("삶은 계란")).toContain("삶은계란");
  });

  it("offers a particle-stripped form as a candidate", () => {
    expect(nameVariants("갈비탕은")).toEqual(["갈비탕은", "갈비탕"]);
  });

  it("still offers the original for names that end like a particle", () => {
    // 오이 must survive; the dataset decides whether 오 is a food.
    expect(nameVariants("오이")[0]).toBe("오이");
  });
});

describe("findByName", () => {
  it("matches an exact name", () => {
    const found = findByName(ENTRIES, "갈비탕");
    expect(found).toMatchObject({ kind: "one", score: 1 });
  });

  it("matches an alias", () => {
    const found = findByName(ENTRIES, "아아");
    expect(found.kind === "one" && found.entry.id).toBe("f-americano");
  });

  it("matches through a trailing particle", () => {
    const found = findByName(ENTRIES, "갈비탕은");
    expect(found.kind === "one" && found.entry.id).toBe("f-galbitang");
  });

  it("matches despite spacing", () => {
    // The entry is stored as "삶은 계란"; people type it either way.
    const found = findByName(ENTRIES, "삶은계란");
    expect(found.kind === "one" && found.entry.id).toBe("f-egg");
  });

  it("reports several when the word does not tell them apart", () => {
    // 밥 is inside 흰쌀밥 and 현미밥 alike.
    const found = findByName(ENTRIES, "밥");
    expect(found.kind).toBe("several");
  });

  it("finds nothing for a food the dataset does not have", () => {
    expect(findByName(ENTRIES, "제육볶음").kind).toBe("none");
  });

  it("never returns a match below the floor", () => {
    const found = findByName(ENTRIES, "갈비탕");
    expect(found.kind === "one" && found.score).toBeGreaterThanOrEqual(
      MIN_MATCH_SCORE,
    );
  });
});

describe("toGrams", () => {
  const rice = entry("f-rice");
  const seaweed = entry("f-seaweed");

  it("scales a known counter from the portion table", () => {
    expect(toGrams({ value: 2, unit: "공기", text: "두 공기", assumed: false }, rice))
      .toMatchObject({ grams: 400, estimated: false, unit: "공기" });
  });

  it("takes grams at face value", () => {
    expect(toGrams({ value: 150, unit: "g", text: "150g", assumed: false }, rice))
      .toEqual({ grams: 150, estimated: false, unit: "g" });
  });

  it("marks millilitres as an approximation", () => {
    expect(toGrams({ value: 200, unit: "ml", text: "200ml", assumed: false }, rice))
      .toEqual({ grams: 200, estimated: true, unit: "ml" });
  });

  it("refuses to price a counter the food has no portion for", () => {
    // It used to swap in the default portion, which turned "만두 5개" into
    // five 인분. A portion multiplied by a count of something else is a
    // silent wrong number; refusing makes the caller ask.
    const weighed = toGrams(
      { value: 1, unit: "접시", text: "한 접시", assumed: false },
      rice,
    );
    expect(weighed).toBeNull();
  });

  it("counts a bare name as one of the entry's natural portion", () => {
    expect(toGrams(assumedQuantity(), rice)).toMatchObject({
      grams: 200,
      estimated: true,
      unit: "공기",
    });
  });

  it("refuses to weigh a food with no portion table", () => {
    expect(toGrams(assumedQuantity(), seaweed)).toBeNull();
  });
});

describe("caloriesFor", () => {
  it("scales the dataset figure and rounds to whole calories", () => {
    const rice = entry("f-rice");
    const match = caloriesFor(
      { value: 1, unit: "공기", text: "한 공기", assumed: false },
      rice,
    );
    // 150 kcal/100g × 200 g
    expect(match?.calories).toBe(300);
    expect(match?.estimated).toBe(false);
  });

  it("halves a half portion", () => {
    const rice = entry("f-rice");
    const match = caloriesFor(
      { value: 0.5, unit: "공기", text: "반 공기", assumed: false },
      rice,
    );
    expect(match?.calories).toBe(150);
  });
});

describe("a bare food name resolves to one natural unit", () => {
  it("counts 계란 as 1개 without being asked", async () => {
    const result = await resolver.resolve(only("계란"));
    if (result.status !== "resolved") throw new Error("expected resolved");

    expect(result.match.entry.id).toBe("f-egg");
    expect(result.match.amount).toEqual({ value: 1, unit: "개", text: "1개" });
    // 155 kcal/100g × 50 g
    expect(result.match.calories).toBe(78);
  });

  it("counts 갈비탕 as 1그릇, not 1개 — the counter comes from the entry", async () => {
    const result = await resolver.resolve(only("갈비탕 먹었어"));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.match.amount).toEqual({ value: 1, unit: "그릇", text: "1그릇" });
  });

  it("always flags the assumption so it can be corrected", async () => {
    const result = await resolver.resolve(only("계란"));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.match.estimated).toBe(true);
  });

  it("keeps the user's own wording when they gave an amount", async () => {
    const result = await resolver.resolve(only("계란 두 개 먹었어"));
    if (result.status !== "resolved") throw new Error("expected resolved");

    expect(result.match.amount).toEqual({ value: 2, unit: "개", text: "두 개" });
    expect(result.match.calories).toBe(155);
    expect(result.match.estimated).toBe(false);
  });

  it("will not invent a count for a food with no portion", async () => {
    // 미역 is sold by weight; "1개 of 미역" is not a thing. The food is in
    // the dataset, so this is `unmeasurable`, not `unknown` — naming grams
    // would answer it.
    const result = await resolver.resolve(only("미역"));
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.reason).toBe("missing_serving");
    expect(result.entries.map((entry) => entry.name)).toEqual(["미역"]);
  });
});

describe("resolver, end to end from a sentence", () => {
  it("resolves a food with an explicit portion", async () => {
    const result = await resolver.resolve(only("갈비탕 한 그릇 먹었어"));
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.match.entry.id).toBe("f-galbitang");
    expect(result.match.calories).toBe(600);
    expect(result.match.estimated).toBe(false);
  });

  it("flags an assumed portion rather than hiding it", async () => {
    const result = await resolver.resolve(only("갈비탕 먹었어"));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.match.calories).toBe(600);
    expect(result.match.estimated).toBe(true);
  });

  it("resolves an abbreviation through an alias", async () => {
    const result = await resolver.resolve(only("아아 한잔 마셨어"));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.match.entry.id).toBe("f-americano");
    expect(result.match.calories).toBe(7);
  });

  it("asks rather than guessing between two rices", async () => {
    const result = await resolver.resolve(only("밥 한 공기 먹었어"));
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;
    expect(result.candidates.map((c) => c.entry.id).sort()).toEqual([
      "f-brown-rice",
      "f-rice",
    ]);
  });

  it("says unknown for a food the dataset does not have", async () => {
    const result = await resolver.resolve(only("제육볶음 먹었어"));
    expect(result.status).toBe("unknown");
  });

  it("separates a food it cannot weigh from one it does not know", async () => {
    // The distinction the reply depends on: one of these the user can fix by
    // naming an amount, the other they cannot fix at all.
    const known = await resolver.resolve(only("미역 먹었어"));
    expect(known.status).toBe("unmeasurable");

    const absent = await resolver.resolve(only("마라탕 먹었어"));
    expect(absent.status).toBe("unknown");
  });

  it("resolves the food it could not weigh once an amount is given", async () => {
    const result = await resolver.resolve(only("미역 100g 먹었어"));
    expect(result.status).toBe("resolved");
  });

  it("never returns a calorie figure it was not given", async () => {
    const results = await Promise.all(
      ["갈비탕 먹었어", "제육볶음 먹었어", "밥 먹었어", "미역 먹었어"].map((s) =>
        resolver.resolve(only(s)),
      ),
    );

    for (const result of results) {
      if (result.status === "resolved") {
        expect(result.match.entry.source).toBe("test-fixture");
      }
      // unknown and ambiguous carry no single number at all.
    }
  });
});

describe("parseFoodEntries", () => {
  it("keeps the good rows and drops the broken ones", () => {
    const parsed = parseFoodEntries([
      ENTRIES[0],
      { id: "bad" },
      { ...ENTRIES[1], caloriesPer100g: -5 },
      { ...ENTRIES[2], caloriesPer100g: Number.NaN },
      { ...ENTRIES[3], servings: [{ unit: "잔", grams: 0 }] },
    ]);
    expect(parsed.map((entry) => entry.id)).toEqual(["f-rice"]);
  });
});

describe("narrowByServingUnit", () => {
  const rice = { id: "e-rice", name: "쌀밥", caloriesPer100g: 167, source: "t", servings: [{ unit: "공기", grams: 210 }] };
  const brown = { id: "e-brown", name: "현미밥", caloriesPer100g: 172, source: "t", servings: [{ unit: "공기", grams: 230 }] };
  const gimbap = { id: "e-gimbap", name: "김밥", caloriesPer100g: 140, source: "t", servings: [{ unit: "줄", grams: 230 }] };
  const bibimbap = { id: "e-bibim", name: "비빔밥", caloriesPer100g: 142, source: "t", servings: [{ unit: "그릇", grams: 450 }] };
  const noPortion = { id: "e-none", name: "삼각김밥", caloriesPer100g: 199, source: "t" };

  const all = [rice, brown, gimbap, bibimbap];
  const quantity = (unit: Unit | null, assumed = false): Quantity => ({
    value: 1,
    unit,
    text: `한 ${String(unit)}`,
    assumed,
  });

  it("keeps only the foods that publish the counter the user used", () => {
    const narrowed = narrowByServingUnit(all, quantity("공기"));
    expect(narrowed.map((e) => e.name)).toEqual(["쌀밥", "현미밥"]);
  });

  it("narrows nothing when no counter was given", () => {
    expect(narrowByServingUnit(all, quantity(null))).toHaveLength(4);
  });

  it("narrows nothing when the amount was assumed", () => {
    expect(narrowByServingUnit(all, quantity("공기", true))).toHaveLength(4);
  });

  it("narrows nothing for a weight, which applies to every food", () => {
    expect(narrowByServingUnit(all, quantity("g"))).toHaveLength(4);
    expect(narrowByServingUnit(all, quantity("ml"))).toHaveLength(4);
  });

  it("keeps every candidate when the counter matches none of them", () => {
    // Better to fall back to the natural portion downstream than to answer
    // that we know nothing.
    expect(narrowByServingUnit(all, quantity("조각"))).toHaveLength(4);
  });

  it("drops a food with no portion table when others do publish the counter", () => {
    const narrowed = narrowByServingUnit([rice, noPortion], quantity("공기"));
    expect(narrowed.map((e) => e.name)).toEqual(["쌀밥"]);
  });
});

describe("an explicit counter the food does not publish", () => {
  const dumpling: FoodEntry = {
    id: "f-dumpling",
    name: "고기만두",
    caloriesPer100g: 160,
    servings: [{ unit: "인분", grams: 220 }],
    source: "test-fixture",
  };
  const dumplingResolver = createLocalDatasetResolver([dumpling]);

  it("asks instead of multiplying a portion by a count of something else", async () => {
    const result = await dumplingResolver.resolve(only("고기만두 5개 먹었어"));
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.reason).toBe("unsupported_unit");
    expect(result.unit).toBe("개");
    expect(result).not.toHaveProperty("match");
  });

  it("still prices the counter it does publish", async () => {
    const result = await dumplingResolver.resolve(only("고기만두 1인분 먹었어"));
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.match.calories).toBe(352);
    expect(result.match.estimated).toBe(false);
  });

  it("still counts a bare number in the natural portion", async () => {
    // "하나" names no counter, so one 인분 is what it means.
    const result = await dumplingResolver.resolve(only("고기만두 하나 먹었어"));
    expect(result.status).toBe("resolved");
  });

  it("keeps missing_serving for a food with no portion at all", async () => {
    const result = await resolver.resolve(only("미역 두 개"));
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.reason).toBe("missing_serving");
  });
});

describe("a reference portion converts a human unit and says so", () => {
  const egg: FoodEntry = {
    id: "f-ref-egg",
    name: "삶은 달걀",
    caloriesPer100g: 150,
    servings: [
      {
        unit: "개",
        grams: 50,
        basis: { kind: "reference", note: "계란 1개 50 g", citation: "test citation" },
      },
    ],
    source: "test-fixture",
  };
  const eggResolver = createLocalDatasetResolver([egg]);

  it("prices 두 개 from the reference weight, marked estimated", async () => {
    const result = await eggResolver.resolve(only("삶은 달걀 두 개 먹었어"));
    if (result.status !== "resolved") throw new Error("expected resolved");
    // 150 kcal/100 g × 2 × 50 g — the energy is still the row's.
    expect(result.match.calories).toBe(150);
    expect(result.match.estimated).toBe(true);
    expect(result.match.portionNote).toBe("1개 50g 기준 (계란 1개 50 g) · test citation");
  });

  it("leaves an MFDS-stated portion unmarked", async () => {
    const result = await resolver.resolve(only("갈비탕 한 그릇 먹었어"));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.match.estimated).toBe(false);
    expect(result.match).not.toHaveProperty("portionNote");
  });

  it("still takes grams at face value, with no reference involved", async () => {
    const result = await eggResolver.resolve(only("삶은 달걀 120g 먹었어"));
    if (result.status !== "resolved") throw new Error("expected resolved");
    expect(result.match.calories).toBe(180);
    expect(result.match.estimated).toBe(false);
    expect(result.match).not.toHaveProperty("portionNote");
  });
});

describe("one food left standing because the others have no portion", () => {
  /**
   * TEST FIXTURE — invented round numbers, as above. Three drinks share the
   * word 음료 and only one states a glass; two foods share a phrase and only
   * one states a portion.
   */
  const FOODS: FoodEntry[] = [
    { id: "d-cola", name: "탄산 음료", caloriesPer100g: 40, source: "test-fixture" },
    { id: "d-soy", name: "단백질 음료", caloriesPer100g: 70, source: "test-fixture" },
    {
      id: "d-ion",
      name: "이온음료",
      caloriesPer100g: 30,
      servings: [{ unit: "잔", grams: 200 }],
      source: "test-fixture",
    },
    { id: "f-chicken", name: "닭가슴살", caloriesPer100g: 110, source: "test-fixture" },
    {
      id: "f-kimchi",
      name: "김치",
      caloriesPer100g: 40,
      servings: [{ unit: "인분", grams: 50 }],
      source: "test-fixture",
    },
  ];
  const resolver = createLocalDatasetResolver(FOODS);
  const resolve = async (sentence: string) => {
    const phrase = parseFoodPhrases(sentence)[0];
    if (phrase === undefined) throw new Error("no phrase");
    return resolver.resolve(phrase);
  };

  it("does not record the one drink that happens to state a glass", async () => {
    const result = await resolve("음료 마셨어");
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.entries.map((entry) => entry.name).sort()).toEqual(["단백질 음료", "이온음료", "탄산 음료"]);
  });

  it("does not drop the food beside it: 닭가슴살 김치 is not just the kimchi", async () => {
    // Cut into two foods since 2026-10-06, so the guard is not what keeps
    // 닭가슴살 any more: it is its own phrase, and asked about on its own.
    const result = await resolve("닭가슴살 김치 먹었어");
    expect(result.status).toBe("listed");
    if (result.status !== "listed") return;
    expect(result.pieces.map((piece) => piece.name)).toEqual(["닭가슴살", "김치"]);
  });

  it("still asks which when two of them can be priced", async () => {
    // Grams apply to every food, so all three drinks are candidates again.
    expect((await resolve("음료 200g 마셨어")).status).toBe("ambiguous");
  });

  it("still records a food named outright", async () => {
    const result = await resolve("이온음료 마셨어");
    expect(result.status).toBe("resolved");
  });
});

describe("foods listed with only a space between them (2026-10-06 feedback)", () => {
  const shipped = async (sentence: string) => {
    const [phrase] = parseFoodPhrases(sentence);
    if (phrase === undefined) throw new Error(`no phrase: ${sentence}`);
    return koreanFoodResolver.resolve(phrase);
  };
  const pieces = async (sentence: string) => {
    const result = await shipped(sentence);
    if (result.status !== "listed") return result.status;
    return result.pieces.map((piece) => [piece.name, piece.quantity.text]);
  };

  it("cuts two foods apart instead of offering them as one choice", async () => {
    expect(await pieces("제육 김치 먹었어")).toEqual([["제육", ""], ["김치", ""]]);
    expect(await pieces("라면 김밥 먹었어")).toEqual([["라면", ""], ["김밥", ""]]);
  });

  it("gives the amount at the end to the last food, and an amount between to the one before", async () => {
    // Before, 줄 narrowed the choice to 김밥 and 라면 vanished without a word.
    expect(await pieces("라면 김밥 두 줄 먹었어")).toEqual([["라면", ""], ["김밥", "두 줄"]]);
    expect(await pieces("라면 하나 김밥 두 줄 먹었어")).toEqual([["라면", "하나"], ["김밥", "두 줄"]]);
  });

  it.each([
    ["참치 김밥 먹었어", "a name of its own"],
    ["그릭 요거트 먹었어", "a spaced name"],
    ["우유 넣은 커피 마셨어", "an addition between the foods"],
    ["편의점 김밥 라면 먹었어", "a word before the first food"],
    ["라면 끓여서 계란 두 개 넣고 먹었어", "a story, not a list"],
    ["고구마 케이크 먹었어", "a kind of a generic representative"],
  ])("leaves %s alone — %s", async (sentence) => {
    expect(await shipped(sentence)).not.toMatchObject({ status: "listed" });
  });
});

describe("a brand's product is reached by its own names only (2026-10-06)", () => {
  const products: FoodEntry[] = [
    { id: "p-shrimp", name: "새우깡", brand: true, caloriesPer100g: 517, servings: [{ unit: "봉지", grams: 90 }], source: "test-fixture" },
    { id: "p-shrimp-rice", name: "새우볶음밥", caloriesPer100g: 160, servings: [{ unit: "그릇", grams: 300 }], source: "test-fixture" },
    { id: "p-chips", name: "포카칩 오리지널", aliases: ["포카칩"], brand: true, caloriesPer100g: 557, source: "test-fixture" },
  ];

  it("is found by its name and its alias, said in full", () => {
    expect(findByName(products, "새우깡")).toMatchObject({ kind: "one" });
    expect(findByName(products, "포카칩")).toMatchObject({ kind: "one" });
    expect(findByName(products, "포카칩을")).toMatchObject({ kind: "one" });
  });

  it("is never offered for a word inside its name", () => {
    // Without the mark, "새우" tied 새우깡 with 새우볶음밥 and became a choice.
    expect(findByName(products, "새우")).toEqual({ kind: "none" });
    expect(findByName(products, "칩")).toEqual({ kind: "none" });
  });
});
