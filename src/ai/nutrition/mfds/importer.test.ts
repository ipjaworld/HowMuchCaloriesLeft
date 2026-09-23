import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { mfdsRowSchema, type MfdsRow } from "./client";
import {
  energyLooksRight,
  parseAmount,
  parseWeight,
  selectRow,
  statedServingGrams,
  toFoodEntry,
} from "./importer";

/**
 * These run against `fixtures/mfds-sample.json`, which is a verbatim capture
 * of a real MFDS response — not a hand-written imitation of one. That is the
 * point: the field names, the "54.00" strings, the "670.000g" weights and
 * the six competing 갈비탕 rows are all exactly what the API sends.
 */

const captured: unknown = JSON.parse(
  readFileSync("fixtures/mfds-sample.json", "utf8"),
);

const ROWS: MfdsRow[] = (
  (captured as { body: { items: unknown[] } }).body.items
).map((item) => mfdsRowSchema.parse(item));

const byCode = (code: string): MfdsRow => {
  const row = ROWS.find((candidate) => candidate.FOOD_CD === code);
  if (row === undefined) throw new Error(`fixture is missing ${code}`);
  return row;
};

/** The 음식/품목대표 갈비탕, measured per 100 g. */
const GALBITANG = "D105-199000000-0001";
/** Brewed americano: real energy, no stated cup size. */
const AMERICANO = "D320-748080000-0001";

describe("the captured response still looks like the API we mapped", () => {
  it("keeps nutrients in numbered columns and states its measurement basis", () => {
    const row = byCode(GALBITANG);
    expect(row.SERVING_SIZE).toBe("100g");
    expect(row.AMT_NUM1).toBe("54.00");
    expect(row.Z10500).toBe("670.000g");
  });
});

describe("parseAmount", () => {
  it.each([
    ["137.000", 137],
    ["54.00", 54],
    ["1,670.000", 1670],
    ["0.00", 0],
  ])("%s → %s", (raw, expected) => {
    expect(parseAmount(raw)).toBe(expected);
  });

  it("treats an empty or missing value as absent, not as zero", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount(null)).toBeNull();
    expect(parseAmount(undefined)).toBeNull();
  });
});

describe("parseWeight", () => {
  it.each([
    ["670.000g", 670, "g"],
    ["210g", 210, "g"],
    ["200ml", 200, "ml"],
    ["797.000mL", 797, "ml"],
  ] as const)("%s → %s%s", (raw, value, unit) => {
    expect(parseWeight(raw)).toEqual({ value, unit });
  });

  it("rejects anything that is not a weight", () => {
    expect(parseWeight("")).toBeNull();
    expect(parseWeight(null)).toBeNull();
    expect(parseWeight("적당량")).toBeNull();
  });
});

describe("energyLooksRight — the guard on an unnamed column", () => {
  it("accepts a row whose macros reproduce its stated energy", () => {
    // 갈비탕: 8.51 P + 2.06 F + 0.40 C ≈ 54 kcal, which is the stated value.
    expect(energyLooksRight(byCode(GALBITANG))).toBe(true);
  });

  it("rejects a row where the energy column cannot be energy", () => {
    // What a column-order shift would look like: protein-sized number in
    // AMT_NUM1 while the macros imply a few hundred kcal.
    const shifted = { ...byCode(GALBITANG), AMT_NUM1: "8.51", AMT_NUM3: "20", AMT_NUM4: "15", AMT_NUM6: "30" };
    expect(energyLooksRight(shifted)).toBe(false);
  });

  it("does not judge a row that is missing the macros it would check against", () => {
    const sparse = { ...byCode(GALBITANG), AMT_NUM3: "", AMT_NUM4: "", AMT_NUM6: "" };
    expect(energyLooksRight(sparse)).toBe(true);
  });

  it("skips the ratio test on near-zero foods, where rounding dominates", () => {
    expect(energyLooksRight(byCode(AMERICANO))).toBe(true);
  });
});

describe("statedServingGrams", () => {
  it("reads the weight of the food as served", () => {
    expect(statedServingGrams(byCode(GALBITANG))).toBe(670);
  });

  it("reads a value equal to the measurement basis as 'no portion given'", () => {
    // Z10500 of exactly 100 g means the row states no portion of its own —
    // it does not mean the food weighs 100 g.
    const basisOnly = { ...byCode(GALBITANG), Z10500: "100.000g", NUTRI_AMOUNT_SERVING: "" };
    expect(statedServingGrams(basisOnly)).toBeNull();
  });

  it("prefers a packaged label serving over the total weight", () => {
    const packaged = { ...byCode(GALBITANG), NUTRI_AMOUNT_SERVING: "210g" };
    expect(statedServingGrams(packaged)).toBe(210);
  });
});

describe("toFoodEntry", () => {
  it("copies the energy figure and records where it came from", () => {
    const { entry, issue } = toFoodEntry(byCode(GALBITANG), {
      name: "갈비탕",
      counter: "그릇",
    });

    expect(issue).toBeNull();
    expect(entry).toMatchObject({
      id: GALBITANG,
      name: "갈비탕",
      caloriesPer100g: 54,
      servings: [{ unit: "그릇", grams: 670 }],
    });
    expect(entry?.source).toContain(GALBITANG);
  });

  it("ships a food with no stated portion rather than inventing one", () => {
    // MFDS knows what an americano costs per 100 g but not what a cup holds,
    // so the entry carries energy and no serving — and "한 잔" stays unknown.
    const { entry } = toFoodEntry(byCode(AMERICANO), { counter: "잔" });
    expect(entry?.caloriesPer100g).toBe(4);
    expect(entry?.servings).toBeUndefined();
  });

  it("omits the portion when the seed names no counter for it", () => {
    const { entry } = toFoodEntry(byCode(GALBITANG), {});
    expect(entry?.servings).toBeUndefined();
  });

  it("drops a row measured against a basis other than 100", () => {
    const perPiece = { ...byCode(GALBITANG), SERVING_SIZE: "1개" };
    const { entry, issue } = toFoodEntry(perPiece);
    expect(entry).toBeNull();
    expect(issue?.reason).toBe("unknown_basis");
  });

  it("drops a row whose energy column fails the macro check", () => {
    const shifted = { ...byCode(GALBITANG), AMT_NUM1: "8.51", AMT_NUM3: "20", AMT_NUM4: "15", AMT_NUM6: "30" };
    const { entry, issue } = toFoodEntry(shifted);
    expect(entry).toBeNull();
    expect(issue?.reason).toBe("energy_failed_macro_check");
  });

  it("drops a row with no energy at all", () => {
    const { entry, issue } = toFoodEntry({ ...byCode(GALBITANG), AMT_NUM1: "" });
    expect(entry).toBeNull();
    expect(issue?.reason).toBe("no_energy");
  });
});

describe("selectRow — the name search is not enough on its own", () => {
  it("refuses to choose between the several rows one name returns", () => {
    // Six 갈비탕 rows, 27-75 kcal/100 g. Picking one by position would be
    // picking one at random.
    const { row, matched } = selectRow(ROWS, { exactName: "갈비탕" });
    expect(matched).toBeGreaterThan(1);
    expect(row).toBeNull();
  });

  it("resolves that same name once a food code pins the row", () => {
    const { row, matched } = selectRow(ROWS, { foodCode: GALBITANG });
    expect(matched).toBe(1);
    expect(row?.AMT_NUM1).toBe("54.00");
  });

  it("prefers the gram-basis row when a food is published both ways", () => {
    const { row } = selectRow(ROWS, {
      exactName: "갈비탕",
      group: "음식",
      foodClass: "품목대표",
    });
    expect(row?.FOOD_CD).toBe(GALBITANG);
    expect(row?.SERVING_SIZE).toBe("100g");
  });

  it("finds nothing when the code is not in the response", () => {
    const { row, matched } = selectRow(ROWS, { foodCode: "NOPE-000" });
    expect(row).toBeNull();
    expect(matched).toBe(0);
  });
});
