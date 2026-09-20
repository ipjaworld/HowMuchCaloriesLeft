import { describe, expect, it } from "vitest";
import { MIN_MATCH_SCORE, findByName, nameVariants, parseFoodEntries } from "./dataset";
import { parseFoodPhrases } from "./foodPhrases";
import { caloriesFor, createLocalDatasetResolver, toGrams } from "./localDatasetResolver";
import { assumedQuantity } from "./quantity";
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
      .toEqual({ grams: 400, estimated: false, unit: "공기" });
  });

  it("takes grams at face value", () => {
    expect(toGrams({ value: 150, unit: "g", text: "150g", assumed: false }, rice))
      .toEqual({ grams: 150, estimated: false, unit: "g" });
  });

  it("marks millilitres as an approximation", () => {
    expect(toGrams({ value: 200, unit: "ml", text: "200ml", assumed: false }, rice))
      .toEqual({ grams: 200, estimated: true, unit: "ml" });
  });

  it("falls back to the default portion for a counter it does not know", () => {
    const weighed = toGrams(
      { value: 1, unit: "접시", text: "한 접시", assumed: false },
      rice,
    );
    expect(weighed).toEqual({ grams: 200, estimated: true, unit: "공기" });
  });

  it("counts a bare name as one of the entry's natural portion", () => {
    expect(toGrams(assumedQuantity(), rice)).toEqual({
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
    // 미역 is sold by weight; "1개 of 미역" is not a thing.
    const result = await resolver.resolve(only("미역"));
    expect(result.status).toBe("unknown");
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

  it("says unknown for a known food it cannot weigh", async () => {
    const result = await resolver.resolve(only("미역 먹었어"));
    expect(result.status).toBe("unknown");
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
