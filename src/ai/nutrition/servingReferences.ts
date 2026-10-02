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

/**
 * A portion taken from a *different* MFDS row than the one the energy comes
 * from: the same dish as a product, or the nearest dish that states one. The
 * borrowed row is named in each reference's `printed` text.
 */
const MFDS_ROW_PORTION = "식약처 식품영양성분DB 다른 행의 1회 제공량";

/**
 * MFDS's 과·채주스 품목대표 rows (P109-003030200-…, P109-302030100-…: 오렌지,
 * 사과, 포도, 자몽, 당근 and the rest) all state a 200 mL serving. The raw
 * juice rows the dataset pins state none, so a 잔 is borrowed from them as a
 * *typical* size — the glass, never the energy.
 */
const MFDS_JUICE_CUP = "식약처 식품영양성분DB 과·채주스 1회 제공량(200mL)";

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
  ...ref(
    "D320-748130000-0001",
    ["잔", "컵"],
    355,
    "카페라떼·카페모카 행의 1회 제공량을 빌려 씀",
    MFDS_CAFE_CUP,
    { kind: "typical", measure: "mL" },
  ),

  // ── 고편차 외식: 행에 1인분이 없는 음식 ─────────────────────────────
  // These rows are 품목대표 and analysed, but state no portion — and nobody
  // weighs a bowl of 마라탕. Each borrows the portion another MFDS row
  // states for the same dish or its nearest neighbour, as a *typical* size.
  // All of these foods are also marked `variance: "high"` in the seeds, so
  // the app says the figure is a representative one. Still no calorie figure
  // here: grams only.
  ...ref(
    "D306-278000000-0002",
    ["그릇", "인분"],
    873,
    "마라탕 간편조리세트 행(D306-278000000-0001)의 식품 중량 873 g을 빌려 씀",
    MFDS_ROW_PORTION,
    { kind: "typical" },
  ),
  ...ref(
    "D306-303180000-0001",
    ["인분"],
    600,
    "샤브샤브_소고기 행(D106-287180000-0001)의 1인분 600 g을 빌려 씀",
    MFDS_ROW_PORTION,
    { kind: "typical" },
  ),
  ...ref(
    "D307-318140000-0001",
    ["인분"],
    300,
    "닭볶음탕 행(D111-514000000-0001)의 1인분 300 g을 빌려 씀 — 이 행의 1,500 g은 한 상 분량",
    MFDS_ROW_PORTION,
    { kind: "typical" },
  ),
  ...[
    "D303-147340000-0001",
    "D303-147110000-0001",
    "D303-147210000-0001",
    "D303-147330000-0001",
  ].flatMap((foodId) =>
    ref(
      foodId,
      ["그릇"],
      700,
      "우동_일식 행(D303-164400000-0001)의 1그릇 700 g을 빌려 씀",
      MFDS_ROW_PORTION,
      { kind: "typical" },
    ),
  ),
  ...ref(
    "P117-100050200-F054-001",
    ["인분"],
    200,
    "탕수육_새우 행(D112-566120000-0001)의 1인분 200 g을 빌려 씀 — 이 행의 50 g은 급식 단위",
    MFDS_ROW_PORTION,
    { kind: "typical" },
  ),
  // 배추김치: a side dish at 38 kcal/100 g. The portion of the neighbouring
  // 깍두기 row is borrowed so a bare "김치" does not ask for grams; at this
  // energy the whole estimate is under 20 kcal.
  ...ref(
    "R121-006060000-0000",
    ["인분"],
    50,
    "깍두기 행(D115-665000000-0001)의 1인분 50 g을 빌려 씀",
    MFDS_ROW_PORTION,
    { kind: "typical" },
  ),

  // ── 주스 ────────────────────────────────────────────────────────────
  // The three juices pinned earlier asked for millilitres on a bare name.
  ...["R121-034060000-0000", "R121-034040000-0000", "R121-034110000-0000"].flatMap((foodId) =>
    ref(
      foodId,
      ["잔", "컵"],
      200,
      "과·채주스 품목대표 행(P109-003030200)의 1회 제공량 200 mL를 빌려 씀",
      MFDS_JUICE_CUP,
      { kind: "typical", measure: "mL" },
    ),
  ),

  // ── 군고구마 ────────────────────────────────────────────────────────
  // The same printed measure as the steamed 고구마 above: the exchange list
  // counts the sweet potato, not how it was cooked.
  ...ref("R102-006000050-0000", ["개"], 140, "고구마 70 g (중 1/2개)", EXCHANGE_LISTS),

  // ── 2차 확장 (2026-10-02): 다른 MFDS 행에서 빌린 1회 제공량 ────────────
  // Same rule as above: grams (or mL) only, each from the row named in the
  // text, each typical. A borrowed gram portion is allowed only on a food
  // the seeds mark high-variance, or on a side dish under 50 kcal/100 g
  // (the kimchi rows); the café cup and the juice glass are volumes.
  // 마카롱
  ...ref("D302-086000000-0001", ["개"], 30, "바닐라마카롱 행(P101-008000100-F003-001)의 1회 제공량 30 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 팥빙수
  ...ref("D319-709053900-0001", ["그릇"], 300, "팥빙수 행(D419-716000000-0001)의 1회 제공량 300 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 계란찜
  ...ref("D307-317040000-0001", ["인분"], 200, "달걀찜_우유 행(D107-317150000-0001)의 1회 제공량 200 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 밀면
  ...ref("D303-154200000-0001", ["그릇"], 700, "냉면_물냉면 행(D103-144180000-0001)의 1회 제공량 700 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 짜장라면
  ...ref("P108-004000400-0062", ["봉지"], 140, "볶음/비빔라면_매운맛 행(P108-009000400-0208)의 1회 제공량 140 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 차돌짬뽕
  ...ref("D303-172460000-0001", ["그릇"], 900, "짬뽕_삼선 행(D303-172310000-0001)의 1회 제공량 900 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 까르보나라
  ...ref("D303-161080000-0001", ["접시"], 400, "스파게티_크림소스 행(D303-161480000-0001)의 1회 제공량 400 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 로제 스파게티
  ...ref("D303-161150000-0001", ["접시"], 400, "스파게티_크림소스 행(D303-161480000-0001)의 1회 제공량 400 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 팟타이
  ...ref("D303-177000000-0002", ["접시", "그릇"], 300, "우동볶음 행(D103-165000000-0001)의 1회 제공량 300 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 분짜
  ...ref("D303-156000000-0001", ["그릇"], 500, "국수_비빔국수 행(D103-142270000-0001)의 1회 제공량 500 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 주먹밥
  ...ref("P123-026020200-F001-000", ["개"], 150, "주먹밥_멸치 행(D301-035190000-0001)의 1회 제공량 150 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 연어초밥
  ...ref("D301-042360000-0001", ["인분"], 300, "초밥_광어 행(D301-042050000-0001)의 1회 제공량 300 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 닭강정
  ...ref("P117-100080000-F013-000", ["인분"], 200, "닭튀김_양념 행(D312-549160000-0001)의 1회 제공량 200 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 깐풍기
  ...ref("P117-100050200-F010-001", ["인분"], 200, "라조기 행(D312-553000000-0001)의 1회 제공량 200 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 고등어조림
  ...ref("D111-509000000-0001", ["인분"], 250, "동태조림 행(D311-516000000-0001)의 1회 제공량 250 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 계란말이
  ...ref("D109-416000000-0001", ["인분"], 82.4, "달걀말이 행(D709-416000000-0001)의 1회 제공량 82.4 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 진미채볶음
  ...ref("D310-489000000-0001", ["인분"], 50, "오징어채조림 행(D111-530000000-0001)의 1회 제공량 50 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 열무김치
  ...ref("R121-006090000-0000", ["인분"], 50, "깍두기 행(D115-665000000-0001)의 1회 제공량 50 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 총각김치
  ...ref("R121-006140000-0000", ["인분"], 50, "깍두기 행(D115-665000000-0001)의 1회 제공량 50 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 파김치
  ...ref("R121-006150000-0000", ["인분"], 50, "깍두기 행(D115-665000000-0001)의 1회 제공량 50 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 오이소박이
  ...ref("R121-006110000-0000", ["인분"], 50, "깍두기 행(D115-665000000-0001)의 1회 제공량 50 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 치즈떡볶이
  ...ref("D310-467330000-0001", ["인분"], 180, "떡볶이 행(D110-467000000-0001)의 1회 제공량 180 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 컵라면
  ...ref("P108-003000300-F001-001", ["개"], 79, "육개장컵라면 행(P108-003000400-0216)의 1회 제공량 79 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 고구마 샐러드
  ...ref("D314-640030000-0001", ["그릇"], 150, "샐러드_감자 행(D114-640020000-0001)의 1회 제공량 150 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 카라멜마키아토
  ...ref("D320-748100000-0001", ["잔", "컵"], 355, "카페라떼·카페모카 행의 1회 제공량을 빌려 씀", MFDS_CAFE_CUP, { kind: "typical", measure: "mL" }),
  // 바닐라라떼
  ...ref("D320-723050000-0001", ["잔", "컵"], 355, "카페라떼·카페모카 행의 1회 제공량을 빌려 씀", MFDS_CAFE_CUP, { kind: "typical", measure: "mL" }),
  // 녹차라떼
  ...ref("D320-723010000-0001", ["잔", "컵"], 355, "카페라떼·카페모카 행의 1회 제공량을 빌려 씀", MFDS_CAFE_CUP, { kind: "typical", measure: "mL" }),
  // 핫초코
  ...ref("R121-042020200-0000", ["잔", "컵"], 355, "카페라떼·카페모카 행의 1회 제공량을 빌려 씀", MFDS_CAFE_CUP, { kind: "typical", measure: "mL" }),
  // 밀크티
  ...ref("D320-731060000-0001", ["잔", "컵"], 355, "카페라떼·카페모카 행의 1회 제공량을 빌려 씀", MFDS_CAFE_CUP, { kind: "typical", measure: "mL" }),
  // 흑당밀크티
  ...ref("D320-731190000-0001", ["잔", "컵"], 355, "카페라떼·카페모카 행의 1회 제공량을 빌려 씀", MFDS_CAFE_CUP, { kind: "typical", measure: "mL" }),
  // 밀크쉐이크
  ...ref("D319-708020000-0001", ["잔", "컵"], 355, "카페라떼·카페모카 행의 1회 제공량을 빌려 씀", MFDS_CAFE_CUP, { kind: "typical", measure: "mL" }),
  // 토마토주스
  ...ref("R106-186010024-0000", ["잔", "컵"], 200, "과·채주스 품목대표 행(P109-003030200)의 1회 제공량 200 mL를 빌려 씀", MFDS_JUICE_CUP, { kind: "typical", measure: "mL" }),
  // 아이스크림
  ...ref("P102-005010100-F001-009", ["개"], 80, "아이스크림바 행(P102-101010100-0053)의 1회 제공량 80 mL를 빌려 씀", MFDS_ROW_PORTION, { kind: "typical", measure: "mL" }),
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
