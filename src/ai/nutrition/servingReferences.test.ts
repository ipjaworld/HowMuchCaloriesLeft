import { describe, expect, it } from "vitest";
import { KOREAN_FOODS, MFDS_FOOD_ENTRIES } from "./koreanFoods";
import { FOOD_SEEDS } from "./mfds/seeds";
import { SERVING_REFERENCES, withServingReferences, type ServingReference } from "./servingReferences";
import type { FoodEntry } from "./types";

/**
 * The reference table is the one place in the nutrition layer that holds a
 * number a person typed. These pin what keeps that honest: every figure has
 * a printed source, none is a calorie, and none overrides MFDS.
 */

describe("the shipped reference table", () => {
  it("cites a source and the printed measure for every entry", () => {
    for (const reference of SERVING_REFERENCES) {
      expect(reference.citation.length, reference.foodId).toBeGreaterThan(5);
      expect(reference.printed, reference.foodId).toMatch(/\d/);
    }
  });

  it("holds plausible gram weights only — never a calorie figure", () => {
    for (const reference of SERVING_REFERENCES) {
      expect(reference.gramsPerUnit).toBeGreaterThan(0);
      expect(reference.gramsPerUnit).toBeLessThan(1000);
      expect(reference).not.toHaveProperty("calories");
      expect(reference).not.toHaveProperty("caloriesPer100g");
      expect(reference).not.toHaveProperty("kcal");
    }
  });

  it("names only foods that are actually seeded, so none is silently dropped", () => {
    const seeded = new Set(FOOD_SEEDS.map((seed) => seed.foodCode));
    for (const reference of SERVING_REFERENCES) {
      expect(seeded.has(reference.foodId), reference.foodId).toBe(true);
    }
  });

  it("lands every reference on a shipped entry", () => {
    for (const reference of SERVING_REFERENCES) {
      const entry = KOREAN_FOODS.find((candidate) => candidate.id === reference.foodId);
      expect(entry, reference.foodId).toBeDefined();
      expect(entry?.servings?.some((serving) => serving.unit === reference.unit)).toBe(true);
    }
  });

  it("keeps a pick from a range, or a borrowed size, as typical — never reference", () => {
    const kindOf = (foodId: string, unit: string) =>
      SERVING_REFERENCES.find((r) => r.foodId === foodId && r.unit === unit)?.kind;
    // 우유 · 저지방우유 · 두유 1팩: the source prints 180~200 mL, not a carton.
    for (const milk of ["R113-009000000-0000", "R121-026090000-0000", "R121-029040200-0000"]) {
      expect(kindOf(milk, "팩")).toBe("typical");
      expect(kindOf(milk, "컵")).toBe("reference");
    }
    // 아메리카노: borrowed from the café-latte rows.
    expect(kindOf("D320-748080000-0001", "잔")).toBe("typical");
  });

  it("marks volume-based measures so the note says mL, not g", () => {
    for (const reference of SERVING_REFERENCES) {
      const isVolume = /cc|mL/.test(reference.printed) || reference.citation.includes("mL");
      expect(reference.measure === "mL", `${reference.foodId} ${reference.unit}`).toBe(isVolume);
    }
  });

  it("does not list the same unit twice for one food", () => {
    const keys = SERVING_REFERENCES.map((reference) => `${reference.foodId}/${reference.unit}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("marks every reference portion as not the row's own", () => {
    for (const entry of KOREAN_FOODS) {
      const raw = MFDS_FOOD_ENTRIES.find((candidate) => candidate.id === entry.id);
      const ownUnits = new Set((raw?.servings ?? []).map((serving) => serving.unit));
      for (const serving of entry.servings ?? []) {
        if (ownUnits.has(serving.unit)) {
          expect(serving.basis, `${entry.name} ${serving.unit}`).toBeUndefined();
        } else {
          expect(serving.basis?.kind, `${entry.name} ${serving.unit}`).toMatch(/reference|typical/);
        }
      }
    }
  });

  it("leaves every calorie figure exactly as MFDS published it", () => {
    for (const entry of KOREAN_FOODS) {
      const raw = MFDS_FOOD_ENTRIES.find((candidate) => candidate.id === entry.id);
      expect(entry.caloriesPer100g).toBe(raw?.caloriesPer100g);
      expect(entry.source).toBe(raw?.source);
    }
  });
});

describe("withServingReferences", () => {
  const soup: FoodEntry = {
    id: "soup",
    name: "국",
    caloriesPer100g: 50,
    servings: [{ unit: "그릇", grams: 400 }],
    source: "t",
  };
  const egg: FoodEntry = { id: "egg", name: "달걀", caloriesPer100g: 150, source: "t" };

  const references: ServingReference[] = [
    { foodId: "soup", unit: "그릇", gramsPerUnit: 999, kind: "reference", printed: "1그릇 999 g", citation: "c" },
    { foodId: "soup", unit: "컵", gramsPerUnit: 200, kind: "reference", printed: "1컵 200 g", citation: "c" },
    { foodId: "egg", unit: "개", gramsPerUnit: 50, kind: "reference", printed: "1개 50 g", citation: "c" },
    { foodId: "absent", unit: "개", gramsPerUnit: 10, kind: "reference", printed: "1개 10 g", citation: "c" },
  ];

  const merged = withServingReferences([soup, egg], references);

  it("never replaces a portion MFDS states", () => {
    const bowl = merged[0]?.servings?.find((serving) => serving.unit === "그릇");
    expect(bowl).toEqual({ unit: "그릇", grams: 400 });
  });

  it("keeps the MFDS portion first, so a bare name still means one bowl", () => {
    expect(merged[0]?.servings?.[0]?.unit).toBe("그릇");
    expect(merged[0]?.servings?.[1]).toMatchObject({ unit: "컵", grams: 200, basis: { kind: "reference" } });
  });

  it("gives a portion-less entry its first reference as the default", () => {
    expect(merged[1]?.servings?.[0]).toMatchObject({ unit: "개", grams: 50 });
  });

  it("ignores a reference to a food that is not there", () => {
    expect(merged).toHaveLength(2);
  });

  it("does not mutate the entries it was given", () => {
    expect(egg.servings).toBeUndefined();
    expect(soup.servings).toHaveLength(1);
  });
});
