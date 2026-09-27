import type { FoodEntry, Serving, ServingBasis } from "./types";

/**
 * How much one "개", "쪽" or "팩" weighs, for foods whose MFDS row does not
 * say.
 *
 * Why this file exists. After a few days of real use, "삶은 달걀 두 개" kept
 * answering "몇 g인가요?" — and nobody weighs an egg. MFDS publishes the
 * energy of 100 g of boiled egg but never the weight of one egg, so the app
 * knew the food and still could not count it.
 *
 * What this file is *not*. It holds no calorie figure and must never hold
 * one. A reference converts a human unit into grams; the energy per gram
 * still comes from the MFDS row the entry was built from. The two facts come
 * from two different sources, and each keeps its own provenance.
 *
 * Source priority — a portion is taken from the first that has it:
 *
 *   1. the MFDS row itself (Z10500 / NUTRI_AMOUNT_SERVING) — never
 *      overridden by anything here; `withServingReferences` skips a unit the
 *      row already publishes;
 *   2. a manufacturer's label — in MFDS these arrive as (1), on 가공식품 rows;
 *   3. a published household measure from a public or professional standard
 *      (`reference`);
 *   4. a documented typical size (`typical`), used only where (3) has nothing
 *      and the size comes from real data rather than from this file;
 *   5. the user's own grams — always available, and the only answer for
 *      anything not listed here.
 *
 * Every reference and typical portion is marked estimated, so the list shows
 * "~" and the stored item carries `portionNote` naming the source. One egg is
 * not every egg; the point is a figure a person can live with, labelled as
 * what it is.
 *
 * Adding a reference: find the measure *printed* in a source — a household
 * measure next to a gram weight, like "바나나 50 g (중 1/2개)" — and derive
 * the per-unit weight from it with ordinary arithmetic, writing both the
 * printed measure and the citation below. If no source prints one, the food
 * stays without a count and the app asks for grams. Do not fill the gap from
 * memory or from a model.
 */

/**
 * 대한당뇨병학회 식품교환표 (2010 개정, 3판). Household measures are printed
 * next to each exchange weight — read from the society's own exchange-list
 * pages (https://www.diabetes.or.kr/general/dietary/dietary_03.php, sub=1..6)
 * on 2026-09-27. The 2010 revision was a joint work of the Korean Diabetes
 * Association, the Korean Nutrition Society, the Korean Society of Community
 * Nutrition, the Korean Dietetic Association and the Korean Association of
 * Diabetes Dietetic Educators, and sized its exchanges against the MFDS
 * nutrient database — the same source this app's energy figures come from.
 *
 * The fruit page carries two tables. Only the one whose weights match the
 * 2010 revision (Tables 9-10 of the revision paper: 사과 80 g, 배 110 g,
 * 수박 150 g, 바나나 50 g — counts in parentheses) is used. The other matches
 * the pre-2010 amounts (귤 100 g, 배 100 g, 사과 100 g), and 귤·참외·백도
 * appear with a count *only* there — so they carry no count here and ask for
 * grams. Citing "2010" for a figure from the older table would be wrong.
 */
const EXCHANGE_LISTS = "대한당뇨병학회 식품교환표(2010)";

/**
 * 주달래, 「개정된 식품교환표를 이용한 식사계획 활용법」, Korean Clinical
 * Diabetes J 11:209-214 (2010). The worked meal plan prints
 * "계란후라이 1개 (계란 50 g)" and "우유 1교환(1컵, 200 cc)".
 */
const EXCHANGE_GUIDE = "주달래, Korean Clin Diabetes J 2010";

/**
 * 주달래 외, 「2010 당뇨병환자를 위한 식품교환표 개정」, J Korean Diabetes
 * 12(4):228 (2011), Table 8 note: "시판되고 있는 일반우유, 우유 및 두유의
 * 함량이 180~200 mL". The source prints a *range*, not a carton size, so the
 * 팩 entries are `typical`, not `reference`: 200 mL is the top of the range,
 * picked so a carton is never counted smaller than the source allows, and the
 * note says it is a pick from a range.
 */
const EXCHANGE_REVISION = "주달래 외, J Korean Diabetes 2011";

/**
 * MFDS's own café-drink rows (D420-… 카페라떼, 카페모카, 아이스 카페라떼, all
 * 품목대표, 산출) state a 355 mL serving. Americano has no D420 row, so its
 * cup is borrowed from its neighbours as a *typical* size. At 4 kcal/100 g
 * the whole cup is ~14 kcal; the estimate cannot move a day's total much.
 */
const MFDS_CAFE_CUP = "식약처 식품영양성분DB 카페 음료 1회 제공량(355mL)";

export type ServingReference = {
  /** The MFDS food code of the entry this applies to. */
  foodId: string;
  unit: string;
  gramsPerUnit: number;
  kind: "reference" | "typical";
  /** The measure as printed, so the arithmetic can be checked by eye. */
  printed: string;
  citation: string;
  /** Set when the source measures a volume. */
  measure?: "mL";
};

function ref(
  foodId: string,
  units: string[],
  gramsPerUnit: number,
  printed: string,
  citation: string,
  options: { kind?: ServingReference["kind"]; measure?: "mL" } = {},
): ServingReference[] {
  const { kind = "reference", measure } = options;
  return units.map((unit) => ({
    foodId,
    unit,
    gramsPerUnit,
    kind,
    printed,
    citation,
    ...(measure === undefined ? {} : { measure }),
  }));
}

export const SERVING_REFERENCES: ServingReference[] = [
  // ── 달걀 ────────────────────────────────────────────────────────────
  // 50 g per egg. The exchange list's 55 g is an exchange amount, not a
  // stated egg; the guide states one egg as 50 g outright.
  ...ref("D327-758010000-0001", ["개", "알"], 50, "계란후라이 1개 (계란 50 g)", EXCHANGE_GUIDE),

  // ── 과일 ────────────────────────────────────────────────────────────
  ...ref("R108-037000001-0000", ["개"], 100, "바나나(생것) 50 g (중 1/2개)", EXCHANGE_LISTS),
  // The society's page also shows an older "사과(부사) 100 g (중 1/2개)",
  // i.e. 200 g. The 2010 revision's own figure is used; see the guide:
  // "사과 1교환(1/3개, 80 g)".
  ...ref("R108-050000001-0000", ["개"], 240, "사과(후지) 80 g (중 1/3개)", EXCHANGE_LISTS),
  ...ref("R108-069000001-0000", ["개"], 200, "오렌지 100 g (대 1/2개)", EXCHANGE_LISTS),
  ...ref("R108-038040001-0000", ["개"], 440, "배 110 g (대 1/4개)", EXCHANGE_LISTS),
  // 150 / 7 = 21.4, rounded to whole grams.
  ...ref("R108-019000001-0000", ["개", "알"], 21, "딸기 150 g (중 7개)", EXCHANGE_LISTS),
  ...ref("R108-061030001-0001", ["쪽", "조각"], 150, "수박 150 g (중 1쪽)", EXCHANGE_LISTS),

  // ── 감자 · 고구마 · 빵 ──────────────────────────────────────────────
  ...ref("R102-001140049-0000", ["개"], 140, "감자 140 g (중 1개)", EXCHANGE_LISTS),
  ...ref("R102-006000049-0000", ["개"], 140, "고구마 70 g (중 1/2개)", EXCHANGE_LISTS),
  ...ref("R121-016160300-0000", ["쪽", "장", "조각"], 35, "식빵 35 g (1쪽)", EXCHANGE_LISTS),

  // ── 우유 · 두유 ─────────────────────────────────────────────────────
  // 1컵 = 200 cc is printed as a cup, so it is a reference. A 팩 is a pick
  // from a printed range, so it is typical. Millilitres are read as grams,
  // as everywhere else in the app.
  ...ref("R113-009000000-0000", ["컵", "잔"], 200, "우유 200 cc (1컵)", EXCHANGE_LISTS, { measure: "mL" }),
  ...ref("R121-026090000-0000", ["컵", "잔"], 200, "우유 200 cc (1컵)", EXCHANGE_LISTS, { measure: "mL" }),
  ...ref("R121-029040200-0000", ["컵", "잔"], 200, "두유 200 cc (1컵)", EXCHANGE_LISTS, { measure: "mL" }),
  ...["R113-009000000-0000", "R121-026090000-0000", "R121-029040200-0000"].flatMap((foodId) =>
    ref(foodId, ["팩"], 200, "시판 우유·두유 180~200 mL 범위의 상단값", EXCHANGE_REVISION, {
      kind: "typical",
      measure: "mL",
    }),
  ),

  // ── 커피 ────────────────────────────────────────────────────────────
  // Borrowed from the café rows next to it; not a measure of an americano.
  ...ref(
    "D320-748080000-0001",
    ["잔", "컵"],
    355,
    "카페라떼·카페모카 행의 1회 제공량을 빌려 씀",
    MFDS_CAFE_CUP,
    { kind: "typical", measure: "mL" },
  ),
];

function toServing(reference: ServingReference): Serving {
  const basis: ServingBasis = {
    kind: reference.kind,
    note: reference.printed,
    citation: reference.citation,
    ...(reference.measure === undefined ? {} : { measure: reference.measure }),
  };
  return { unit: reference.unit, grams: reference.gramsPerUnit, basis };
}

/**
 * Adds reference portions to the MFDS entries they name.
 *
 * MFDS stays first: a unit the row already publishes is never replaced, and
 * the row's own portion stays at the front of `servings`, where it is the
 * default for a bare name. An entry with no MFDS portion at all gets the
 * first reference as its default, which is what lets a bare "바나나" count as
 * one banana.
 *
 * A reference whose food is not in the dataset is ignored rather than
 * thrown on — a seed can be dropped by a sync — and the test suite checks
 * that every reference still lands.
 */
export function withServingReferences(
  entries: FoodEntry[],
  references: ServingReference[] = SERVING_REFERENCES,
): FoodEntry[] {
  return entries.map((entry) => {
    const own = entry.servings ?? [];
    const added = references
      .filter((reference) => reference.foodId === entry.id)
      .filter((reference) => !own.some((serving) => serving.unit === reference.unit))
      .map(toServing);

    if (added.length === 0) return entry;
    return { ...entry, servings: [...own, ...added] };
  });
}
