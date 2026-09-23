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

describe("a food we know but cannot weigh is not a food we do not know", () => {
  it("will not price a boiled egg by the piece — MFDS states no egg weight", async () => {
    const result = await resolveOne("삶은계란 두 개 먹었어");
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.entries[0]?.name).toContain("달걀");
  });

  it("will not price an americano by the cup — MFDS states no cup size", async () => {
    const result = await resolveOne("아메리카노 한 잔 마셨어");
    expect(result.status).toBe("unmeasurable");
  });

  it("will not price a 삼각김밥 by the piece", async () => {
    // MFDS gives a 200 g weight for this row, which is not one triangle, so
    // the seed deliberately carries no counter.
    const result = await resolveOne("삼각김밥 하나 먹었어");
    expect(result.status).toBe("unmeasurable");
  });

  it("prices those same foods once the user names a weight", async () => {
    // This is what makes the distinction worth drawing: the user can fix it.
    for (const sentence of ["커피 200ml 마셨어", "삶은계란 100g 먹었어"]) {
      const result = await resolveOne(sentence);
      expect(result.status).toBe("resolved");
    }
  });
});

describe("a food that is not in the dataset stays unknown", () => {
  it("returns unknown for a food that is simply not there", async () => {
    const result = await resolveOne("마라탕 먹었어");
    expect(result.status).toBe("unknown");
  });

  it("never returns a calorie figure for an unknown food", async () => {
    const result = await resolveOne("타코 먹었어");
    expect(result.status).toBe("unknown");
    expect(result).not.toHaveProperty("match");
  });
});

/**
 * The six sentences that stand for the whole contract. Promoted from a
 * throwaway probe, because between them they cover every state the resolver
 * can return and every reply Phase 6 has to be able to write.
 */
describe("representative scenarios", () => {
  it("갈비탕 하나 → resolved", async () => {
    const result = await resolveOne("갈비탕 하나 먹었어");
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.match.entry.name).toBe("갈비탕");
    expect(result.match.calories).toBeGreaterThan(0);
  });

  it("밥 한 공기 → 쌀밥과 현미밥 사이의 진짜 ambiguity", async () => {
    const result = await resolveOne("밥 한 공기 먹었어");
    expect(result.status).toBe("ambiguous");
    if (result.status !== "ambiguous") return;

    // 김밥 and 비빔밥 also contain "밥" and score identically on the name,
    // but neither publishes a 공기 portion, so the counter rules them out.
    const names = result.candidates.map((c) => c.entry.name).sort();
    expect(names).toEqual(["쌀밥", "현미밥"]);
  });

  it("커피 한잔 → unmeasurable", async () => {
    const result = await resolveOne("커피 한잔 마셨어");
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.reason).toBe("missing_serving");
    expect(result.entries[0]?.name).toContain("아메리카노");
  });

  it("커피 200ml → resolved", async () => {
    const result = await resolveOne("커피 200ml 마셨어");
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    // Millilitres are read as grams, which the match reports as estimated.
    expect(result.match.estimated).toBe(true);
  });

  it("마라탕 → unknown", async () => {
    const result = await resolveOne("마라탕 먹었어");
    expect(result.status).toBe("unknown");
  });

  it("삶은계란 두 개 → unmeasurable", async () => {
    const result = await resolveOne("삶은계란 두 개 먹었어");
    expect(result.status).toBe("unmeasurable");
    if (result.status !== "unmeasurable") return;
    expect(result.reason).toBe("missing_serving");
  });
});
