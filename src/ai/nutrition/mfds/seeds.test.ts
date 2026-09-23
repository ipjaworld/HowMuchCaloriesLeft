import { describe, expect, it } from "vitest";
import { KOREAN_FOODS } from "../koreanFoods";
import { FOOD_SEEDS } from "./seeds";

/**
 * `seeds.ts` and `data/korean-foods.json` are joined only by someone
 * remembering to run `pnpm sync:mfds`. Nothing else notices when they drift,
 * and drift is quiet: a seed edited without a re-sync leaves the app serving
 * the old figures while the source of truth says otherwise.
 *
 * These are invariants over that pair, not a test of the importer — the
 * importer is covered against a captured response in `importer.test.ts`.
 */

describe("the shipped dataset matches the seeds it was built from", () => {
  it("contains exactly the foods the seeds name", () => {
    const seeded = [...new Set(FOOD_SEEDS.map((seed) => seed.foodCode))].sort();
    const shipped = KOREAN_FOODS.map((entry) => entry.id).sort();

    // A mismatch means one of: a seed was added or removed without a
    // re-sync, the dataset was hand-edited, or MFDS stopped publishing a row
    // and the sync skipped it. All three want a human to look.
    expect(shipped).toEqual(seeded);
  });

  it("gives every seed a food code, never a bare name", () => {
    // Name search is a substring match and even exact matches mislead, so a
    // seed without a pinned code would be selecting a row by luck.
    for (const seed of FOOD_SEEDS) {
      expect(seed.foodCode).toMatch(/^[A-Z]\d{3}-/);
      expect(seed.query.length).toBeGreaterThan(0);
    }
  });

  it("does not pin the same row twice", () => {
    const codes = FOOD_SEEDS.map((seed) => seed.foodCode);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("carries the display names and aliases the seeds asked for", () => {
    for (const seed of FOOD_SEEDS) {
      const entry = KOREAN_FOODS.find((candidate) => candidate.id === seed.foodCode);
      expect(entry, `no entry for ${seed.query}`).toBeDefined();
      if (entry === undefined) continue;

      if (seed.name !== undefined) expect(entry.name).toBe(seed.name);
      if (seed.aliases !== undefined) expect(entry.aliases).toEqual(seed.aliases);
    }
  });

  it("only publishes a portion under the counter its seed named", () => {
    for (const entry of KOREAN_FOODS) {
      const seed = FOOD_SEEDS.find((candidate) => candidate.foodCode === entry.id);
      if (seed === undefined) continue;

      if (seed.counter === undefined) {
        // No counter means MFDS gave no trustworthy per-portion weight, so
        // the entry must not have acquired one from somewhere else.
        expect(entry.servings, `${entry.name} should have no portion`).toBeUndefined();
        continue;
      }

      for (const serving of entry.servings ?? []) {
        expect(serving.unit).toBe(seed.counter);
      }
    }
  });

  it("never carries a nutrition figure in the seed file itself", () => {
    // The seeds say which row to read and what people call it. Every number
    // comes from MFDS. This asserts the rule structurally.
    for (const seed of FOOD_SEEDS) {
      expect(seed).not.toHaveProperty("caloriesPer100g");
      expect(seed).not.toHaveProperty("grams");
      expect(seed).not.toHaveProperty("calories");
    }
  });
});
