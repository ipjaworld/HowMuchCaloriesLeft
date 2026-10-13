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
 *   5. the app's own working size (`assumed`) — no source at all, written
 *      here as a plain guess and labelled as one everywhere it surfaces;
 *   6. the user's own grams — always available, and the correction for any
 *      of the above.
 *
 * Every reference and typical portion is marked estimated, so the list shows
 * "~" and the stored item carries `portionNote` naming the source. One egg is
 * not every egg; the point is a figure a person can live with, labelled as
 * what it is.
 *
 * Adding a reference: find the measure *printed* in a source — a household
 * measure next to a gram weight, like "바나나 50 g (중 1/2개)" — and derive
 * the per-unit weight from it with ordinary arithmetic, writing both the
 * printed measure and the citation below.
 *
 * If no source prints one, the food used to stay without a count and the app
 * asked for grams. Real use showed what that costs: "샤인머스캣 5알" answered
 * with "g이나 ml로 알려주세요" is a reason to stop using the app. Since
 * 2026-10-13 the app records first and reports after, so a food people count
 * may carry an `assumed` size instead. That kind is never dressed up as a
 * source: its citation says there is none, the reply states the size it
 * took, and the user corrects it in a word. Prefer (3) or (4) whenever one
 * exists; `assumed` is the last resort before a flat 100 g.
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

/**
 * The older of the two fruit tables on the society's exchange-list page
 * (pre-2010 amounts: 귤 100 g, 배 100 g, 사과 100 g). It is still printed
 * there next to a count, so it is a real household measure, only not the
 * 2010 revision's, which is why it is cited apart. Used only for fruits the
 * 2010 table gives no count for (귤·참외·복숭아); read 2026-10-13.
 */
const EXCHANGE_LISTS_OLD = "대한당뇨병학회 식품교환표(구판 표)";

/**
 * No source. The app's own working size for a food people count, so that
 * "방울토마토 10개" is recorded instead of asked about. Each is a rounded
 * ordinary size, and the reply says what it took.
 *
 * Cross-checked by web search on 2026-10-13 against what could be found —
 * retail labels, Korean nutrition-tracking databases, USDA serving weights,
 * Japanese prefectural trial reports for grapes — and the range found is
 * kept in each printed note. None of those is a published household
 * measure of the kind `reference` requires, so the kind stays `assumed`.
 * Unconfirmed by search: 두부 1모, 단호박, 곤약, 연어회 1점, 아보카도 과육,
 * 체리·블루베리 1줌.
 */
const APP_ASSUMPTION = "앱 추정값(출처 없음)";

export type ServingReference = {
  /** The MFDS food code of the entry this applies to. */
  foodId: string;
  unit: string;
  gramsPerUnit: number;
  kind: "reference" | "typical" | "assumed";
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

/** An `assumed` size: the printed text is the assumption itself. */
function assumed(
  foodId: string,
  units: string[],
  gramsPerUnit: number,
  printed: string,
  options: { measure?: "mL" } = {},
): ServingReference[] {
  return ref(foodId, units, gramsPerUnit, printed, APP_ASSUMPTION, { kind: "assumed", ...options });
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
  // ── 3차 확장 (2026-10-03) ──────────────────────────────────────────
  // 고구마튀김: the same food's calculated row
  ...ref("D312-539000000-0001", ["인분"], 166.5, "고구마튀김 산출 행(D412-539000000-0001)의 1회 제공량 166.5 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 인절미빙수: the bowl 팥빙수 borrows
  ...ref("D319-709043900-0001", ["그릇"], 300, "팥빙수 행(D419-716000000-0001)의 1회 제공량 300 g을 빌려 씀", MFDS_ROW_PORTION, { kind: "typical" }),
  // 녹차
  ...ref("R115-007000000-0000", ["잔", "컵"], 355, "카페라떼·카페모카 행의 1회 제공량을 빌려 씀", MFDS_CAFE_CUP, { kind: "typical", measure: "mL" }),
  // 아이스크림
  ...ref("P102-005010100-F001-009", ["개"], 80, "아이스크림바 행(P102-101010100-0053)의 1회 제공량 80 mL를 빌려 씀", MFDS_ROW_PORTION, { kind: "typical", measure: "mL" }),

  // ── 4차 (2026-10-13): 선기록 후보고 ─────────────────────────────────
  // Every food below used to answer a count with "g으로 알려주세요". Printed
  // measures first; the rest are `assumed`, and the reply says so. The order
  // of units matters: the first is what a bare name is counted as, so a
  // small thing eaten by the handful (아몬드, 블루베리) defaults to 줌, not 알.

  // Printed measures.
  ...ref("R121-032010100-0000", ["개", "알"], 50, "계란후라이 1개 (계란 50 g)", EXCHANGE_GUIDE),
  ...ref("R108-001010001-0000", ["개"], 150, "단감 50 g (중 1/3개)", EXCHANGE_LISTS),
  ...ref("R108-006000005-0000", ["개"], 30, "곶감 15 g (소 1/2개)", EXCHANGE_LISTS),
  ...ref("R108-010020001-0000", ["개"], 100, "귤 100 g (대 1개)", EXCHANGE_LISTS_OLD),
  ...ref("R108-086004101-0000", ["개"], 200, "참외 100 g (대 1/2개)", EXCHANGE_LISTS_OLD),
  ...ref("R108-043020001-0000", ["개"], 200, "복숭아(백도) 100 g (대 1/2개)", EXCHANGE_LISTS_OLD),

  // 과일
  ...assumed("R108-098097301-0000", ["송이"], 600, "샤인머스캣 1송이 약 600 g으로 가정 (농식품부 권장 600~650 g)"),
  ...assumed("R108-098097301-0000", ["알", "개"], 13, "샤인머스캣 1알 약 13 g으로 가정 (일본 현 시험장 자료 12~14 g)"),
  ...assumed("R108-098070001-0000", ["송이"], 350, "포도 1송이 약 350 g으로 가정 (캠벨얼리 시험 자료 320~340 g)"),
  ...assumed("R108-098070001-0000", ["알", "개"], 6, "포도 1알 약 6 g으로 가정 (캠벨얼리 시험 자료 5.8 g)"),
  ...assumed("R108-090020001-0000", ["개"], 90, "키위 1개 약 90 g으로 가정 (영양DB 그린키위 93 g)"),
  ...assumed("R108-064000001-0000", ["개"], 150, "아보카도 1개(먹는 부분) 약 150 g으로 가정"),
  ...assumed("R108-028000001-0000", ["개"], 300, "망고 1개(먹는 부분) 약 300 g으로 가정 (USDA 336 g, 작은 수입종 감안)"),
  ...assumed("R108-084000001-0000", ["개"], 250, "자몽 1개(먹는 부분) 약 250 g으로 가정 (시판 1개 약 320 g)"),
  ...assumed("R108-082000001-0000", ["개"], 70, "자두 1개 약 70 g으로 가정 (영양DB 60~70 g)"),
  ...assumed("R108-001040001-0000", ["개"], 100, "홍시 1개 약 100 g으로 가정 (영양DB, 대봉은 더 큼)"),
  ...assumed("R108-010010001-0000", ["개"], 250, "한라봉 1개(먹는 부분) 약 250 g으로 가정 (과중 250~400 g 논문)"),
  ...assumed("R108-092000001-0000", ["조각"], 85, "파인애플 1조각 약 85 g으로 가정 (USDA 1조각 84 g)"),
  ...assumed("R108-034020001-0000", ["조각"], 150, "멜론 1조각 약 150 g으로 가정 (교환표 구판의 1/10개 150 g 참고)"),
  ...assumed("R108-111000001-0000", ["줌"], 100, "체리 1줌 약 100 g으로 가정"),
  ...assumed("R108-111000001-0000", ["개", "알"], 8, "체리 1알 약 8 g으로 가정 (중간 크기 6~10 g)"),
  ...assumed("R108-047000001-0000", ["줌"], 50, "블루베리 1줌 약 50 g으로 가정"),
  ...assumed("R108-047000001-0000", ["컵"], 145, "블루베리 1컵 약 145 g으로 가정 (영양DB 140~148 g)"),

  // 채소
  ...assumed("R106-186000001-0000", ["개"], 150, "토마토 1개 약 150 g으로 가정 (영양DB 중간 크기 123 g)"),
  ...assumed("R106-186010001-0001", ["개", "알"], 17, "방울토마토 1개 약 17 g으로 가정 (영양DB 17 g)"),
  ...assumed("R106-148010001-0000", ["개"], 200, "오이 1개 약 200 g으로 가정 (영양DB 중간 크기)"),
  ...assumed("R106-198040049-0000", ["조각"], 100, "단호박 1조각 약 100 g으로 가정"),
  ...assumed("R106-198040049-0000", ["개"], 700, "단호박 1개(먹는 부분) 약 700 g으로 가정"),
  ...assumed("R101-030070049-0000", ["개"], 100, "옥수수 1개(속대 제외) 약 100 g으로 가정 (USDA 중간 크기 약 90 g)"),
  ...assumed("R102-009020001-0000", ["개", "팩"], 200, "곤약 1팩 약 200 g으로 가정"),
  ...assumed("R102-009010001-0000", ["팩", "봉지"], 180, "곤약면 1팩 약 180 g으로 가정 (시판 150~180 g)"),

  // 견과
  ...assumed("R105-020000058-0000", ["줌"], 25, "아몬드 1줌 약 25 g으로 가정"),
  ...assumed("R105-020000058-0000", ["개", "알"], 1.2, "아몬드 1알 약 1.2 g으로 가정 (28 g에 약 23알)"),
  ...assumed("R105-035000002-0000", ["줌"], 25, "호두 1줌 약 25 g으로 가정"),
  ...assumed("R105-035000002-0000", ["개", "알"], 4, "호두 1알 약 4 g으로 가정 (영양DB 열량 역산)"),
  ...assumed("R105-007000058-0000", ["줌"], 25, "땅콩 1줌 약 25 g으로 가정"),
  ...assumed("R105-007000058-0000", ["개", "알"], 0.85, "땅콩 1알 약 0.85 g으로 가정 (영양DB 28 g에 33알)"),
  ...assumed("P116-001030200-F003-003", ["봉지", "봉", "개"], 20, "견과류 1봉 약 20 g으로 가정 (하루견과 20 g)"),
  ...assumed("P116-001030200-F003-003", ["줌"], 25, "견과류 1줌 약 25 g으로 가정"),

  // 단백질 · 고기
  ...assumed("R109-008000446-0000", ["개", "팩"], 100, "닭가슴살 1개(1팩) 약 100 g으로 가정 (시판 100 g 팩)"),
  ...assumed("R109-008000417-0000", ["개", "팩"], 100, "훈제 닭가슴살 1개(1팩) 약 100 g으로 가정"),
  ...assumed("P117-501050100-4893", ["팩"], 100, "닭안심 1팩 약 100 g으로 가정"),
  ...assumed("D327-758015600-0001", ["개", "알"], 30, "달걀흰자 1개 약 30 g으로 가정 (영양DB 30~33 g)"),
  ...assumed("R211-059013929-0000", ["캔", "개"], 100, "참치캔 1캔 약 100 g으로 가정 (기본 라인업 100 g)"),
  ...assumed("R121-043020300-0000", ["인분"], 100, "두부 1인분 약 100 g으로 가정 (1/3모)"),
  ...assumed("R121-043020300-0000", ["모", "팩"], 300, "두부 1모 약 300 g으로 가정"),
  ...assumed("R121-043020500-0000", ["봉지", "팩"], 350, "순두부 1봉지 약 350 g으로 가정 (시판 350~400 g)"),
  ...assumed("R211-201093901-0000", ["인분"], 150, "연어 1인분 약 150 g으로 가정"),
  ...assumed("R211-201093901-0000", ["조각"], 15, "연어 1조각(회) 약 15 g으로 가정"),
  ...assumed("R211-201093916-0000", ["인분"], 50, "훈제연어 1인분 약 50 g으로 가정"),
  ...assumed("R211-201093916-0000", ["조각", "장"], 10, "훈제연어 1장 약 10 g으로 가정 (초밥용 6 g, 슬라이스 10~20 g)"),
  ...assumed("R121-005010006-0000", ["스쿱", "스푼"], 30, "단백질 보충제 1스쿱 약 30 g으로 가정 (시판 1회 30~38 g)"),
  ...[
    "R109-027066201-0000", // 소고기 우둔살
    "D308-400120000-0001", // 차돌박이
    "D308-378120000-0001", // 막창
    "D308-370120000-0001", // 대창
    "D308-373010000-0001", // 돼지갈비
    "R109-014008451-0000", // 목살
    "R109-014003501-0000", // 항정살
    "R109-014009446-0000", // 수육
  ].flatMap((foodId) => assumed(foodId, ["인분"], 150, "고기 1인분 약 150 g으로 가정 (식당 1인분 150~180 g)")),
  ...assumed("P117-300030000-0015", ["장", "줄"], 10, "베이컨 1장 약 10 g으로 가정 (시판 얇은 슬라이스 약 8.5 g)"),
  ...assumed("R121-021020000-0000", ["장", "개"], 35, "어묵 1장 약 35 g으로 가정 (사각어묵 32~40 g)"),

  // 유제품 · 음료
  ...assumed("R121-026061100-0000", ["개"], 85, "떠먹는 요거트 1개 약 85 g으로 가정 (시판 85 g 컵)"),
  ...assumed("P119-004040200-F001-005", ["개"], 100, "그릭요거트 1개 약 100 g으로 가정 (시판 80~100 g)"),
  ...assumed("R121-038100000-0000", ["스푼", "숟가락"], 15, "크림치즈 1스푼 약 15 g으로 가정 (1큰술 14.5 g)"),
  ...assumed("R121-026060100-0000", ["개", "병"], 150, "마시는 요구르트 1병 약 150 mL로 가정 (시판 145 mL)", { measure: "mL" }),
  ...assumed("R121-029030000-0000", ["병", "팩", "개"], 250, "단백질 음료 1병 약 250 mL로 가정 (시판 250 mL 팩)", { measure: "mL" }),
  ...["R121-045110000-0000", "R121-045080000-0000", "R121-045040000-0000"].flatMap((foodId) => [
    // 콜라 · 제로콜라 · 사이다
    ...assumed(foodId, ["캔"], 355, "탄산음료 1캔 355 mL로 가정 (250 mL 캔도 있음)", { measure: "mL" }),
    ...assumed(foodId, ["잔", "컵"], 200, "탄산음료 1잔 200 mL로 가정", { measure: "mL" }),
    ...assumed(foodId, ["병"], 500, "탄산음료 1병 500 mL로 가정", { measure: "mL" }),
  ]),
  ...["R121-029010000-0000", "R121-029140000-0000", "R121-029140000-0001"].flatMap((foodId) => [
    // 오트밀크 · 아몬드밀크 · 무가당 아몬드밀크
    ...assumed(foodId, ["잔", "컵"], 200, "식물성 음료 1잔 200 mL로 가정", { measure: "mL" }),
    ...assumed(foodId, ["팩"], 190, "식물성 음료 1팩 190 mL로 가정 (시판 190 mL 팩)", { measure: "mL" }),
  ]),

  // 치킨 · 피자: MFDS states an 인분, but people count a 마리 and a 조각. Without
  // these, "치킨 반 마리" and "한 마리" were both one 인분.
  ...["D312-549000000-0001", "D312-549160000-0001"].flatMap((foodId) =>
    assumed(foodId, ["마리"], 700, "치킨 1마리(먹는 부분) 약 700 g으로 가정 (소비자원 평균 879 g, 뼈 포함)"),
  ),
  ...[
    "D102-120350000-0001", // 피자
    "D302-120180000-0001", // 불고기피자
    "D302-120340000-0001", // 치즈피자
    "D302-120410000-0001", // 페퍼로니피자
    "D302-120420000-0001", // 포테이토피자
  ].flatMap((foodId) => [
    ...assumed(foodId, ["조각"], 100, "피자 1조각(1/8판) 약 100 g으로 가정 (30 cm 피자 1/8 약 95~100 g)"),
    ...assumed(foodId, ["판"], 800, "피자 1판 약 800 g으로 가정 (1/8판 100 g 기준)"),
  ]),

  // 곡류 · 간식
  ...assumed("R101-001000000-0000", ["인분", "그릇"], 40, "오트밀 1인분(마른 것) 약 40 g으로 가정 (시판 1회 32~50 g)"),
  ...assumed("R101-001000000-0000", ["스푼", "숟가락"], 10, "오트밀 1스푼 약 10 g으로 가정"),
  ...assumed("D101-019460000-0001", ["개"], 110, "삼각김밥 1개 약 110 g으로 가정 (편의점 102~110 g)"),
  ...assumed("P103-103020500-0051", ["개"], 39, "초코파이 1개 약 39 g으로 가정 (2015년 증량 후 39 g)"),
  ...assumed("P101-104000100-0008", ["봉지", "봉"], 66, "감자칩 1봉지 약 66 g으로 가정 (포카칩 66 g)"),
  ...assumed("P101-101000100-0142", ["봉지", "봉"], 80, "팝콘 1봉지 약 80 g으로 가정 (전자레인지용 80 g)"),
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
