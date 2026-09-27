import type { SeedSpec } from "./importer";

/**
 * Which foods the shipped dataset covers, and how to find each one in MFDS.
 *
 * **There is not a single nutrition figure in this file, and there must never
 * be one.** A seed says *which row to read* and *what people call it*; every
 * calorie and every gram comes from the row the sync script fetches.
 *
 * Why food codes rather than names. `FOOD_NM_KR` search is a substring match
 * over 331,212 rows, and an exact name match is still not enough to be safe:
 *
 *   - "아메리카노" matches a 200 kcal/100 g instant coffee *powder*, not the
 *     4 kcal/100 g brewed drink;
 *   - "바나나" matches a 454 kcal/100 g banana-flavoured *snack*;
 *   - "갈비탕" has six legitimate 품목대표 rows ranging 33-89 kcal/100 g.
 *
 * So each seed pins the exact `FOOD_CD` that was checked by hand against the
 * live API. Adding a food means looking its row up and reading it, not
 * guessing a code — `pnpm candidates:mfds <이름>` prints the rows worth
 * reading, and a person picks one.
 *
 * `name` is what the list shows, so it is written the way a person would say
 * it. MFDS separates a dish from its variant with an underscore
 * (`커피_아메리카노`) and a raw ingredient from its state with commas
 * (`바나나, 생것`), which are database conventions and not something to put
 * in front of a user; the raw form stays reachable as an alias.
 *
 * `query` is what the sync searches for to retrieve the row, so it is the
 * row's exact `FOOD_NM_KR` wherever that is short enough to be specific —
 * a broad query pages through thousands of rows before reaching a raw
 * ingredient.
 *
 * `counter` is the Korean counter the food is normally spoken in — 공기,
 * 그릇, 잔. It names a portion; it never sizes one. The grams behind it come
 * from the row's own stated weight, and a food whose row states no weight
 * ships without an MFDS portion. Raw ingredients (the R… codes: fruit, milk,
 * eggs) never state one, which is why none of them has a counter here.
 *
 * Their counts — "바나나 1개", "우유 1팩" — come from `servingReferences.ts`
 * instead: a published household measure with a citation, marked estimated.
 * Keeping them out of this file keeps the rule simple: nothing here is a
 * number, and nothing in the dataset file is anything but MFDS.
 *
 * How the list was chosen (2026-09-27, after a few days of real use): the
 * categories a dieter actually logs — rice, soups and stews, noodles, 분식,
 * convenience food, eggs, chicken breast, meat, fruit, dairy, bread, café
 * drinks — each with the few dishes that cover most days. Within a dish the
 * D1xx "분석" 품목대표 row is preferred: analysed rather than calculated,
 * 100 g basis, and usually a stated bowl weight. A row whose figure looked
 * implausible for the dish was left out rather than pinned — 우동_일식
 * (D103-164400000-0001) states 158 kcal/100 g over an 800 g bowl, over
 * 1,200 kcal, against 60 kcal/100 g for its D303 twin.
 *
 * Deliberately absent: alcohol (the energy check has no alcohol column, so
 * every 소주/맥주 row fails it and is dropped), and fried chicken (the row's
 * 300 g portion is not a 마리, and "치킨 한 마리" must not quietly become
 * 300 g).
 */

export type FoodSeed = SeedSpec & {
  /** The exact MFDS row. Verified by hand against the live API. */
  foodCode: string;
  /** What to search for to retrieve it. */
  query: string;
};

export const FOOD_SEEDS: FoodSeed[] = [
  // ── 밥류 ──────────────────────────────────────────────────────────
  {
    // A packaged 즉석밥 row, chosen because it states a 210 g label serving.
    // Its 167 kcal/100 g lands within 1 kcal of the 쌀밥 품목대표 row
    // (D301-022000000-0001, 166), which has no portion of its own.
    foodCode: "P123-201020300-6012",
    query: "쌀밥",
    name: "쌀밥",
    aliases: ["흰쌀밥", "공기밥", "백미밥"],
    counter: "공기",
  },
  {
    foodCode: "D101-050000000-0001",
    query: "현미밥",
    name: "현미밥",
    counter: "공기",
  },
  {
    foodCode: "D101-032000000-0001",
    query: "잡곡밥",
    name: "잡곡밥",
    counter: "공기",
  },
  {
    foodCode: "D101-007000000-0001",
    query: "김밥",
    name: "김밥",
    counter: "줄",
  },
  {
    foodCode: "D101-018000000-0001",
    query: "비빔밥",
    name: "비빔밥",
    counter: "그릇",
  },
  {
    foodCode: "D101-017000000-0001",
    query: "볶음밥",
    name: "볶음밥",
    counter: "그릇",
  },
  {
    foodCode: "D101-017070000-0001",
    query: "볶음밥_김치",
    name: "김치볶음밥",
    aliases: ["볶음밥_김치"],
    counter: "그릇",
  },
  {
    foodCode: "D101-044000000-0001",
    query: "카레라이스",
    name: "카레라이스",
    aliases: ["카레"],
    counter: "그릇",
  },
  {
    foodCode: "D101-010150000-0001",
    query: "덮밥_돼지고기(제육)",
    name: "제육덮밥",
    aliases: ["덮밥_돼지고기(제육)"],
    counter: "그릇",
  },
  {
    foodCode: "D101-028000000-0001",
    query: "오므라이스",
    name: "오므라이스",
    counter: "접시",
  },
  {
    // MFDS states 200 g for this row, which is more than one convenience
    // store triangle weighs — so it gets no counter and "삼각김밥 하나"
    // resolves to unmeasurable rather than to a doubled figure. No public
    // source prints a per-piece weight either; the label on the wrapper does.
    foodCode: "D101-019460000-0001",
    query: "삼각김밥_참치마요네즈",
    name: "삼각김밥 (참치마요)",
    aliases: ["삼각김밥", "참치마요삼각김밥", "삼각김밥_참치마요네즈"],
  },

  // ── 국 · 탕 · 찌개 ────────────────────────────────────────────────
  {
    foodCode: "D105-199000000-0001",
    query: "갈비탕",
    name: "갈비탕",
    counter: "그릇",
  },
  {
    foodCode: "D106-266100000-0001",
    query: "김치찌개_돼지고기",
    name: "김치찌개",
    aliases: ["돼지고기김치찌개", "김치찌개_돼지고기"],
    counter: "그릇",
  },
  {
    foodCode: "D106-275000000-0001",
    query: "된장찌개",
    name: "된장찌개",
    counter: "그릇",
  },
  {
    foodCode: "D106-291030000-0001",
    query: "순두부찌개_김치",
    name: "순두부찌개",
    aliases: ["김치순두부찌개", "순두부찌개_김치"],
    counter: "그릇",
  },
  {
    foodCode: "D106-284000000-0001",
    query: "부대찌개",
    name: "부대찌개",
    counter: "그릇",
  },
  {
    foodCode: "D105-223000000-0001",
    query: "미역국",
    name: "미역국",
    counter: "그릇",
  },
  {
    foodCode: "D105-231000000-0001",
    query: "설렁탕",
    name: "설렁탕",
    counter: "그릇",
  },
  {
    foodCode: "D105-245000000-0001",
    query: "육개장",
    name: "육개장",
    counter: "그릇",
  },
  {
    foodCode: "D105-228000000-0001",
    query: "삼계탕",
    name: "삼계탕",
    counter: "그릇",
  },
  {
    foodCode: "D103-145000000-0001",
    query: "떡국",
    name: "떡국",
    counter: "그릇",
  },
  {
    foodCode: "D101-004310000-0001",
    query: "국밥_순대국밥",
    name: "순대국밥",
    aliases: ["순대국", "국밥_순대국밥"],
    counter: "그릇",
  },
  {
    foodCode: "D105-253000000-0001",
    query: "콩나물국",
    name: "콩나물국",
    counter: "그릇",
  },

  // ── 면류 ──────────────────────────────────────────────────────────
  {
    foodCode: "D103-148000000-0001",
    query: "라면",
    name: "라면",
    counter: "그릇",
  },
  {
    foodCode: "D103-168000000-0001",
    query: "자장면",
    name: "짜장면",
    aliases: ["자장면"],
    counter: "그릇",
  },
  {
    foodCode: "D103-172000000-0001",
    query: "짬뽕",
    name: "짬뽕",
    counter: "그릇",
  },
  {
    foodCode: "D103-174000000-0001",
    query: "칼국수",
    name: "칼국수",
    counter: "그릇",
  },
  {
    foodCode: "D103-144180000-0001",
    query: "냉면_물냉면",
    name: "물냉면",
    aliases: ["냉면_물냉면"],
    counter: "그릇",
  },
  {
    foodCode: "D103-144280000-0001",
    query: "냉면_비빔냉면",
    name: "비빔냉면",
    aliases: ["냉면_비빔냉면"],
    counter: "그릇",
  },
  {
    foodCode: "D103-142410000-0001",
    query: "국수_잔치국수",
    name: "잔치국수",
    aliases: ["국수_잔치국수"],
    counter: "그릇",
  },
  {
    foodCode: "D103-142270000-0001",
    query: "국수_비빔국수",
    name: "비빔국수",
    aliases: ["국수_비빔국수"],
    counter: "그릇",
  },
  {
    foodCode: "D103-173000000-0001",
    query: "쫄면",
    name: "쫄면",
    counter: "그릇",
  },
  {
    foodCode: "D303-162000000-0001",
    query: "쌀국수",
    name: "쌀국수",
    counter: "그릇",
  },
  {
    foodCode: "D303-161490000-0001",
    query: "스파게티_토마토소스",
    name: "토마토 스파게티",
    aliases: ["토마토파스타", "토마토 파스타", "스파게티_토마토소스"],
    counter: "접시",
  },
  {
    foodCode: "D303-161480000-0001",
    query: "스파게티_크림소스",
    name: "크림 스파게티",
    aliases: ["크림파스타", "크림 파스타", "스파게티_크림소스"],
    counter: "접시",
  },

  // ── 육류 ──────────────────────────────────────────────────────────
  {
    foodCode: "D110-465000000-0001",
    query: "돼지고기볶음(제육볶음)",
    name: "제육볶음",
    aliases: ["돼지고기볶음", "제육"],
    counter: "인분",
  },
  {
    foodCode: "D108-386000000-0001",
    query: "소불고기",
    name: "소불고기",
    aliases: ["불고기"],
    counter: "인분",
  },
  {
    foodCode: "D108-382000000-0001",
    query: "삼겹살구이",
    name: "삼겹살구이",
    aliases: ["삼겹살"],
    counter: "인분",
  },
  {
    foodCode: "D110-462000000-0001",
    query: "닭볶음(닭갈비)",
    name: "닭갈비",
    aliases: ["닭볶음", "닭볶음(닭갈비)"],
    counter: "인분",
  },
  {
    foodCode: "D312-550080000-0001",
    query: "돈가스_돼지등심",
    name: "돈가스",
    aliases: ["돈까스", "돈가스_돼지등심"],
    counter: "인분",
  },
  {
    foodCode: "D107-344000000-0001",
    query: "족발",
    name: "족발",
    counter: "인분",
  },

  // ── 분식 ──────────────────────────────────────────────────────────
  {
    foodCode: "D110-467000000-0001",
    query: "떡볶이",
    name: "떡볶이",
    counter: "인분",
  },
  {
    foodCode: "D110-468000000-0001",
    query: "라볶이",
    name: "라볶이",
    counter: "인분",
  },
  {
    foodCode: "D107-337000000-0001",
    query: "순대",
    name: "순대",
    counter: "인분",
  },
  {
    // Counted in 인분 because that is what the row states. "만두 5개" is a
    // different unit and asks rather than becoming five 인분.
    foodCode: "D103-150010000-0001",
    query: "만두_고기만두",
    name: "고기만두",
    aliases: ["만두_고기만두"],
    counter: "인분",
  },
  {
    foodCode: "D103-150030000-0001",
    query: "만두_군만두",
    name: "군만두",
    aliases: ["만두_군만두"],
    counter: "인분",
  },

  // ── 달걀 · 닭가슴살 ────────────────────────────────────────────────
  {
    // No per-egg weight anywhere in MFDS, so no counter. The count comes from
    // `servingReferences.ts` (1개 = 50 g, published), marked estimated.
    foodCode: "D327-758010000-0001",
    query: "달걀_삶은것",
    name: "삶은 달걀",
    aliases: ["삶은계란", "삶은달걀", "계란", "달걀", "달걀_삶은것"],
  },
  {
    // A fried egg's weight is not the egg's (oil in, water out) and nothing
    // publishes it, so no count: it asks for grams.
    foodCode: "R121-032010100-0000",
    query: "달걀, 부침(달걀프라이)",
    name: "달걀프라이",
    aliases: ["계란후라이", "계란프라이", "달걀후라이", "달걀, 부침(달걀프라이)"],
  },
  {
    // Plain boiled breast. A "1팩" has no published weight — packs run from
    // 100 g to 150 g and more — so it asks for the grams on the pack.
    foodCode: "R109-008000446-0000",
    query: "닭고기, 가슴, 삶은것",
    name: "닭가슴살",
    aliases: ["삶은 닭가슴살", "닭고기, 가슴, 삶은것"],
  },

  // ── 과일 ──────────────────────────────────────────────────────────
  // Raw 원재료성 rows: energy per 100 g of the edible part, no portion. The
  // counts come from the exchange lists in `servingReferences.ts`.
  {
    // Not "바나나" by name — that exact name is a 454 kcal/100 g snack.
    foodCode: "R108-037000001-0000",
    query: "바나나, 생것",
    name: "바나나",
    aliases: ["바나나, 생것"],
  },
  {
    foodCode: "R108-050000001-0000",
    query: "사과, 생것",
    name: "사과",
    aliases: ["사과, 생것"],
  },
  {
    foodCode: "R108-010020001-0000",
    query: "귤, 온주밀감, 생것",
    name: "귤",
    aliases: ["감귤", "밀감", "귤, 온주밀감, 생것"],
  },
  {
    foodCode: "R108-069000001-0000",
    query: "오렌지, 생것",
    name: "오렌지",
    aliases: ["오렌지, 생것"],
  },
  {
    foodCode: "R108-038040001-0000",
    query: "배, 신고, 생것",
    name: "배",
    aliases: ["배, 신고, 생것"],
  },
  {
    foodCode: "R108-019000001-0000",
    query: "딸기, 생것",
    name: "딸기",
    aliases: ["딸기, 생것"],
  },
  {
    foodCode: "R108-098070001-0000",
    query: "포도, 캠벨얼리, 생것",
    name: "포도",
    aliases: ["캠벨포도", "포도, 캠벨얼리, 생것"],
  },
  {
    foodCode: "R108-061030001-0001",
    query: "수박, 적육질, 생것",
    name: "수박",
    aliases: ["수박, 적육질, 생것"],
  },
  {
    foodCode: "R108-086004101-0000",
    query: "참외, 생것, 씨 제거",
    name: "참외",
    aliases: ["참외, 생것, 씨 제거"],
  },
  {
    foodCode: "R108-043020001-0000",
    query: "복숭아, 백도, 생것",
    name: "복숭아",
    aliases: ["백도", "복숭아, 백도, 생것"],
  },
  {
    foodCode: "R108-090020001-0000",
    query: "키위, 그린, 생것",
    name: "키위",
    aliases: ["참다래", "키위, 그린, 생것"],
  },
  {
    foodCode: "R106-186000001-0000",
    query: "토마토, 생것",
    name: "토마토",
    aliases: ["토마토, 생것"],
  },
  {
    foodCode: "R106-186010001-0001",
    query: "토마토, 방울토마토, 생것",
    name: "방울토마토",
    aliases: ["토마토, 방울토마토, 생것"],
  },

  // ── 감자 · 고구마 · 옥수수 ────────────────────────────────────────
  {
    foodCode: "R102-006000049-0000",
    query: "고구마, 찐것",
    name: "고구마",
    aliases: ["찐고구마", "찐 고구마", "고구마, 찐것"],
  },
  {
    foodCode: "R102-001140049-0000",
    query: "감자, 수미, 찐것",
    name: "감자",
    aliases: ["찐감자", "찐 감자", "감자, 수미, 찐것"],
  },
  {
    foodCode: "R101-030070049-0000",
    query: "옥수수, 찰옥수수, 찐것",
    name: "옥수수",
    aliases: ["찐옥수수", "찰옥수수", "옥수수, 찰옥수수, 찐것"],
  },

  // ── 우유 · 두유 · 요거트 ──────────────────────────────────────────
  {
    // Page 28 of a "우유" search — the reason the client pages up to 40.
    foodCode: "R113-009000000-0000",
    query: "우유",
    name: "우유",
    aliases: ["흰우유"],
  },
  {
    foodCode: "R121-026090000-0000",
    query: "우유, 저지방우유",
    name: "저지방우유",
    aliases: ["저지방 우유", "우유, 저지방우유"],
  },
  {
    foodCode: "R121-029040200-0000",
    query: "두유, 대두",
    name: "두유",
    aliases: ["두유, 대두"],
  },
  {
    // Cup sizes vary too much across brands for any published count, so
    // "요거트 1개" asks for the grams on the lid.
    foodCode: "R121-026061100-0000",
    query: "요구르트, 호상, 플레인",
    name: "떠먹는 요거트",
    aliases: ["요거트", "플레인요거트", "플레인 요거트", "요구르트, 호상, 플레인"],
  },
  {
    foodCode: "R121-026060100-0000",
    query: "요구르트, 액상",
    name: "마시는 요구르트",
    aliases: ["액상 요구르트", "요구르트, 액상"],
  },

  // ── 빵 · 편의점 ──────────────────────────────────────────────────
  {
    foodCode: "R121-016160300-0000",
    query: "빵, 식빵, 쇼트닝 첨가",
    name: "식빵",
    aliases: ["빵, 식빵, 쇼트닝 첨가"],
  },
  {
    foodCode: "D102-096431100-0001",
    query: "샌드위치_햄_달걀",
    name: "햄에그 샌드위치",
    aliases: ["햄달걀샌드위치", "햄계란샌드위치", "샌드위치_햄_달걀"],
    counter: "개",
  },
  {
    foodCode: "D102-096280000-0001",
    query: "샌드위치_참치",
    name: "참치 샌드위치",
    aliases: ["참치샌드위치", "샌드위치_참치"],
    counter: "개",
  },
  {
    foodCode: "D102-096060000-0001",
    query: "샌드위치_닭가슴살",
    name: "닭가슴살 샌드위치",
    aliases: ["닭가슴살샌드위치", "샌드위치_닭가슴살"],
    counter: "개",
  },
  {
    foodCode: "D102-123000000-0001",
    query: "햄버거",
    name: "햄버거",
    aliases: ["버거"],
    counter: "개",
  },
  {
    foodCode: "D102-123170000-0001",
    query: "햄버거_불고기버거",
    name: "불고기버거",
    aliases: ["햄버거_불고기버거"],
    counter: "개",
  },

  // ── 음료 ──────────────────────────────────────────────────────────
  {
    // The brewed drink at 4 kcal/100 g. MFDS states no cup size for it; the
    // 355 mL cup comes from MFDS's own café rows, as a typical size.
    foodCode: "D320-748080000-0001",
    query: "커피_아메리카노",
    name: "아메리카노",
    aliases: ["아아", "커피", "커피_아메리카노"],
  },
  // The D420 café rows are measured per 100 mL and state a 355 mL cup. They
  // are the first 100 mL-basis rows in the dataset; the importer records the
  // 1 g/mL reading in `source`.
  {
    foodCode: "D420-762000000-0001",
    query: "카페라떼",
    name: "카페라떼",
    aliases: ["라떼", "카페 라떼"],
    counter: "잔",
  },
  {
    foodCode: "D420-759000000-0001",
    query: "아이스 카페라떼",
    name: "아이스 카페라떼",
    aliases: ["아이스라떼", "아이스 라떼"],
    counter: "잔",
  },
  {
    foodCode: "D420-763000000-0001",
    query: "카페모카",
    name: "카페모카",
    aliases: ["모카"],
    counter: "잔",
  },
  {
    // A can is 250 or 355 mL depending on brand, so no count: it asks.
    foodCode: "R121-045110000-0000",
    query: "탄산 음료, 콜라",
    name: "콜라",
    aliases: ["탄산 음료, 콜라"],
  },
  {
    foodCode: "R121-045080000-0000",
    query: "탄산 음료, 저칼로리콜라",
    name: "제로콜라",
    aliases: ["제로 콜라", "다이어트 콜라", "저칼로리콜라", "탄산 음료, 저칼로리콜라"],
  },
  {
    foodCode: "R121-045040000-0000",
    query: "탄산 음료, 사이다",
    name: "사이다",
    aliases: ["탄산 음료, 사이다"],
  },
];
