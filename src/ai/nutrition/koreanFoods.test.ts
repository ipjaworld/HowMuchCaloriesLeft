import { describe, expect, it } from "vitest";
import { parseFoodPhrases } from "./foodPhrases";
import { KOREAN_FOODS, koreanFoodResolver, DATASET_SOURCE } from "./koreanFoods";

/**
 * End-to-end over the *shipped* dataset: a Korean sentence goes in, and what
 * comes out is whatever the MFDS figures actually support.
 *
 * These assert behaviour, not specific calorie numbers — `pnpm sync:mfds` can
 * legitimately move a figure when MFDS updates a row, and a test that pins
 * 362 kcal would turn that into a failure. What must not drift is the
 * contract: a food we have a portion for resolves, a food we do not stays
 * unknown, and nothing is ever invented.
 */

async function resolveOne(sentence: string) {
  const phrases = parseFoodPhrases(sentence);
  const phrase = phrases[0];
  if (phrase === undefined) throw new Error(`no food phrase in "${sentence}"`);
  return koreanFoodResolver.resolve(phrase);
}

describe("the shipped dataset", () => {
  it("carries its provenance", () => {
    expect(DATASET_SOURCE.name).toContain("식품의약품안전처");
    expect(DATASET_SOURCE.license).toBeTruthy();
    expect(DATASET_SOURCE.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("traces every figure back to an MFDS row", () => {
    expect(KOREAN_FOODS.length).toBeGreaterThan(0);
    for (const entry of KOREAN_FOODS) {
      expect(entry.source).toContain("식약처");
      // The id is the MFDS food code, so a number can always be re-checked.
      expect(entry.id).toMatch(/^[A-Z]\d{3}-/);
      expect(entry.caloriesPer100g).toBeGreaterThanOrEqual(0);
    }
  });

  it("never ships a portion of zero grams", () => {
    for (const entry of KOREAN_FOODS) {
      for (const serving of entry.servings ?? []) {
        expect(serving.grams).toBeGreaterThan(0);
      }
    }
  });
});

describe("resolving what people actually say", () => {
  it("prices a bowl of 갈비탕", async () => {
    const result = await resolveOne("갈비탕 한 그릇 먹었어");
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.match.entry.name).toBe("갈비탕");
    expect(result.match.calories).toBeGreaterThan(0);
    expect(result.match.amount.text).toContain("그릇");
  });

  it("prices 공기밥 through an alias", async () => {
    const result = await resolveOne("공기밥 한 공기 먹었어");
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.match.entry.name).toBe("쌀밥");
  });

  it("scales a half portion", async () => {
    const full = await resolveOne("갈비탕 한 그릇");
    const half = await resolveOne("갈비탕 반 그릇");
    if (full.status !== "resolved" || half.status !== "resolved") {
      throw new Error("both should resolve");
    }
    expect(half.match.calories).toBe(Math.round(full.match.calories / 2));
  });

  it("counts a bare food name as one natural portion and says so", async () => {
    const result = await resolveOne("라면 먹었어");
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    // The portion was assumed, and the app has to be able to show that.
    expect(result.match.amount.text).toBeTruthy();
  });
});

describe("what the data does not support stays unknown", () => {
  it("will not price a boiled egg by the piece — MFDS states no egg weight", async () => {
    const result = await resolveOne("삶은계란 두 개 먹었어");
    expect(result.status).toBe("unknown");
  });

  it("will not price an americano by the cup — MFDS states no cup size", async () => {
    const result = await resolveOne("아메리카노 한 잔 마셨어");
    expect(result.status).toBe("unknown");
  });

  it("will not price a 삼각김밥 by the piece", async () => {
    // MFDS gives a 200 g weight for this row, which is not one triangle, so
    // the seed deliberately carries no counter.
    const result = await resolveOne("삼각김밥 하나 먹었어");
    expect(result.status).toBe("unknown");
  });

  it("returns unknown for a food that is simply not in the dataset", async () => {
    const result = await resolveOne("마라탕 먹었어");
    expect(result.status).toBe("unknown");
  });

  it("never returns a calorie figure for an unknown food", async () => {
    const result = await resolveOne("타코 먹었어");
    expect(result.status).toBe("unknown");
    expect(result).not.toHaveProperty("match");
  });
});
