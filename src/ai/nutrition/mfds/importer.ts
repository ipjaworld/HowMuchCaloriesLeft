import type { FoodEntry, Serving } from "../types";
import type { MfdsRow } from "./client";

/**
 * Turns MFDS rows into `FoodEntry` values.
 *
 * The rule this file exists to protect: **a calorie figure is copied, never
 * derived from a guess.** Two specific ways that could go wrong here, and
 * what stops each:
 *
 * 1. *The wrong column.* Nutrients arrive as `AMT_NUM1`..`AMT_NUM157` with
 *    no names attached, so "AMT_NUM1 is energy" is an assumption. It is not
 *    taken on faith: `energyLooksRight` recomputes the figure from the
 *    protein, fat and carbohydrate columns via the Atwater factors and
 *    rejects the row if the two disagree. Across a 700-row sample spanning
 *    음식 / 가공식품 / 원재료성 the two agreed within 15% on 584 of the 602
 *    rows that carry all four values. If the column order ever shifts, the
 *    import fails loudly instead of quietly writing wrong numbers.
 *
 * 2. *An invented portion.* `servings` is only ever filled from a weight the
 *    row actually states. Where MFDS gives no portion — which is common — the
 *    entry ships without `servings`, and the resolver answers `unknown`
 *    rather than scaling by a made-up gram count.
 */

/** Energy per gram, for the identity check only. Never used to produce a value. */
const ATWATER = { protein: 4, fat: 9, carbohydrate: 4 } as const;

/**
 * How far `AMT_NUM1` may sit from the macro-derived figure. Generous on
 * purpose: MFDS mixes analysed, collected and label-declared rows, and a
 * declared label figure legitimately differs from the computed one. This is
 * a check that the column *means energy*, not an audit of the lab.
 */
const ENERGY_TOLERANCE = 0.25;

/**
 * Below this, rounding alone swamps the ratio. The check is skipped only when
 * *both* the stated and the derived figure are this small — a stated 8 kcal
 * against macros implying 400 is exactly the column-shift this guard is for,
 * so smallness on one side alone must not buy a pass.
 */
const ENERGY_CHECK_FLOOR_KCAL = 20;

export type ImportIssue = {
  foodCode: string;
  name: string;
  reason:
    | "no_energy"
    | "energy_failed_macro_check"
    | "unknown_basis"
    | "negative_energy";
  detail?: string;
};

export type ImportResult = {
  entry: FoodEntry | null;
  issue: ImportIssue | null;
};

/** "137.000" and "1,670.000" are both numbers; "" and null are not. */
export function parseAmount(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  const value = Number(trimmed.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/**
 * "670.000g" -> 670, "200ml" -> 200, "100g" -> 100. The unit is returned
 * alongside because a millilitre basis is not a gram basis.
 */
export function parseWeight(
  raw: string | null | undefined,
): { value: number; unit: "g" | "ml" } | null {
  if (raw === null || raw === undefined) return null;
  const match = raw.trim().match(/^([\d,]+(?:\.\d+)?)\s*(g|ml|mL|ML|㎖|㎎)?$/i);
  if (match === null) return null;

  const value = Number((match[1] ?? "").replace(/,/g, ""));
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = (match[2] ?? "g").toLowerCase();
  return { value, unit: unit === "g" ? "g" : "ml" };
}

/**
 * Checks `AMT_NUM1` against the macros. Returns true when the row does not
 * carry enough information to judge — an unprovable row is not a wrong one,
 * and the caller decides separately whether to keep it.
 */
export function energyLooksRight(row: MfdsRow): boolean {
  const energy = parseAmount(row.AMT_NUM1);
  if (energy === null) return false;

  const protein = parseAmount(row.AMT_NUM3);
  const fat = parseAmount(row.AMT_NUM4);
  const carbohydrate = parseAmount(row.AMT_NUM6);
  if (protein === null || fat === null || carbohydrate === null) return true;

  const derived =
    ATWATER.protein * protein +
    ATWATER.fat * fat +
    ATWATER.carbohydrate * carbohydrate;

  if (energy < ENERGY_CHECK_FLOOR_KCAL && derived < ENERGY_CHECK_FLOOR_KCAL) {
    return true;
  }

  // Compared against the larger of the two, so the ratio stays meaningful
  // when one side is near zero.
  const scale = Math.max(energy, derived);
  return Math.abs(derived - energy) / scale <= ENERGY_TOLERANCE;
}

/**
 * The portion the row states, if it states one.
 *
 * `Z10500` is the weight of the whole food as served (a 갈비탕 is 670 g), and
 * `NUTRI_AMOUNT_SERVING` is the label serving on a packaged product. Either
 * can come back equal to the 100 g / 100 mL measurement basis, which means
 * "no portion given" rather than "this food weighs 100 g" — so that case is
 * read as absent.
 */
export function statedServingGrams(row: MfdsRow): number | null {
  for (const raw of [row.NUTRI_AMOUNT_SERVING, row.Z10500]) {
    const parsed = parseWeight(raw);
    if (parsed === null) continue;
    if (parsed.value === 100) continue;
    return parsed.value;
  }
  return null;
}

export type SeedSpec = {
  /** Display name for the entry. Defaults to the row's own name. */
  name?: string;
  /** Other ways people say it. */
  aliases?: string[];
  /**
   * The Korean counter this food is normally counted in — 공기, 그릇, 잔.
   * Purely linguistic: it names the portion, it never sizes it. The grams
   * always come from the row.
   */
  counter?: string;
};

/**
 * One row -> one entry, or an issue explaining why not.
 *
 * `id` is the MFDS food code, so every figure in the shipped dataset can be
 * traced back to the exact row it came from.
 */
export function toFoodEntry(row: MfdsRow, seed: SeedSpec = {}): ImportResult {
  const name = seed.name ?? row.FOOD_NM_KR;
  const fail = (reason: ImportIssue["reason"], detail?: string): ImportResult => ({
    entry: null,
    issue: { foodCode: row.FOOD_CD, name, reason, ...(detail === undefined ? {} : { detail }) },
  });

  const energy = parseAmount(row.AMT_NUM1);
  if (energy === null) return fail("no_energy");
  if (energy < 0) return fail("negative_energy", String(energy));

  const basis = parseWeight(row.SERVING_SIZE);
  if (basis === null || basis.value !== 100) {
    return fail("unknown_basis", row.SERVING_SIZE ?? "(none)");
  }

  if (!energyLooksRight(row)) {
    const protein = parseAmount(row.AMT_NUM3) ?? 0;
    const fat = parseAmount(row.AMT_NUM4) ?? 0;
    const carbohydrate = parseAmount(row.AMT_NUM6) ?? 0;
    const derived =
      ATWATER.protein * protein + ATWATER.fat * fat + ATWATER.carbohydrate * carbohydrate;
    return fail(
      "energy_failed_macro_check",
      `stated ${energy} kcal, macros imply ${Math.round(derived)} kcal`,
    );
  }

  // A millilitre basis is recorded as such in `source` rather than silently
  // relabelled as grams. Water-like foods are close enough to 1 g/mL for the
  // app's purpose, and the provenance string keeps the conversion visible.
  const basisNote = basis.unit === "ml" ? " · 100mL 기준" : "";

  const servings: Serving[] = [];
  const statedGrams = statedServingGrams(row);
  if (statedGrams !== null && seed.counter !== undefined) {
    servings.push({ unit: seed.counter, grams: statedGrams });
  }

  const retrieved = row.UPDATE_DATE ?? row.RESEARCH_YMD ?? "";
  const method = row.CRT_MTH_NM ?? "";

  return {
    entry: {
      id: row.FOOD_CD,
      name,
      ...(seed.aliases !== undefined && seed.aliases.length > 0
        ? { aliases: seed.aliases }
        : {}),
      caloriesPer100g: energy,
      ...(servings.length > 0 ? { servings } : {}),
      source: `식약처 식품영양성분DB ${row.FOOD_CD}${
        method === "" ? "" : ` (${method})`
      }${retrieved === "" ? "" : ` ${retrieved}`}${basisNote}`,
    },
    issue: null,
  };
}

/**
 * Narrows a search result down to the row a seed meant.
 *
 * `FOOD_NM_KR` search is a substring match, so this filters to an exact name
 * — and to a food code when one is pinned, which is how a name with several
 * legitimate rows (갈비탕 has six) gets resolved without guessing.
 */
export function selectRow(
  rows: MfdsRow[],
  criteria: {
    foodCode?: string;
    exactName?: string;
    group?: string;
    foodClass?: string;
  },
): { row: MfdsRow | null; matched: number } {
  let candidates = rows;

  if (criteria.foodCode !== undefined) {
    candidates = candidates.filter((row) => row.FOOD_CD === criteria.foodCode);
    return { row: candidates[0] ?? null, matched: candidates.length };
  }

  if (criteria.exactName !== undefined) {
    candidates = candidates.filter((row) => row.FOOD_NM_KR === criteria.exactName);
  }
  if (criteria.group !== undefined) {
    candidates = candidates.filter((row) => row.DB_GRP_NM === criteria.group);
  }
  if (criteria.foodClass !== undefined) {
    candidates = candidates.filter((row) => row.DB_CLASS_NM === criteria.foodClass);
  }

  // The dataset is measured per 100 g, so a gram-basis row is preferred when
  // both exist for the same food.
  const gramBasis = candidates.filter((row) => row.SERVING_SIZE === "100g");
  if (gramBasis.length > 0) candidates = gramBasis;

  // More than one survivor is ambiguity, not a tie to break. The caller
  // reports it and the seed gets a food code.
  return {
    row: candidates.length === 1 ? (candidates[0] ?? null) : null,
    matched: candidates.length,
  };
}
