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
 * every 소주/맥주 row fails it and is dropped). Fried chicken and 우동 were
 * absent until the v1 expansion at the bottom of this file, which explains
 * how each came in — 치킨 in 인분 only, so "치킨 한 마리" still asks rather
 * than quietly becoming 300 g.
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
    // Their own rows, so "참치김밥" is priced as itself rather than staying
    // unknown beside the plain 김밥 row above.
    foodCode: "D101-007450000-0001",
    query: "김밥_참치",
    name: "참치김밥",
    aliases: ["참치 김밥", "김밥_참치"],
    counter: "줄",
  },
  {
    foodCode: "D101-007490000-0001",
    query: "김밥_치즈",
    name: "치즈김밥",
    aliases: ["치즈 김밥", "김밥_치즈"],
    counter: "줄",
  },
  {
    // Counted in 인분 because that is what the row states; "유부초밥 5개" is
    // a different unit and asks, the same as 만두.
    foodCode: "D101-042410000-0001",
    query: "초밥_유부초밥",
    name: "유부초밥",
    aliases: ["초밥_유부초밥"],
    counter: "인분",
  },
  {
    foodCode: "D101-010240000-0001",
    query: "덮밥_불고기",
    name: "불고기덮밥",
    aliases: ["불고기 덮밥", "덮밥_불고기"],
    counter: "그릇",
  },
  {
    // Its own row, so "잡채밥" is not the 잡채 side dish with rice guessed
    // on top.
    foodCode: "D101-033000000-0001",
    query: "잡채밥",
    name: "잡채밥",
    counter: "그릇",
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
    // The row states 530 g, which is MFDS's portion and not any particular
    // restaurant's bowl — it stays an approximate 그릇 like the other soups.
    foodCode: "D106-260000000-0001",
    query: "감자탕",
    name: "감자탕",
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
    variance: "high",
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
    variance: "high",
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

  // ── 반찬 · 전 ──────────────────────────────────────────────────────
  {
    foodCode: "D110-492000000-0001",
    query: "잡채",
    name: "잡채",
    counter: "인분",
  },
  {
    // Not aliased to a bare "파전": that is its own row (D309-441000000-0001)
    // at a different figure, so a bare "파전" stays unknown rather than
    // quietly becoming the seafood one.
    foodCode: "D109-441110000-0001",
    query: "파전_해물",
    name: "해물파전",
    aliases: ["해물 파전", "파전_해물"],
    counter: "인분",
  },
  {
    // The row states 200 g and does not say whether that is one 장 or a
    // plate, so it is counted in 인분 and "감자전 한 장" asks.
    foodCode: "D109-408000000-0001",
    query: "감자전",
    name: "감자전",
    counter: "인분",
  },
  {
    foodCode: "D115-665000000-0001",
    query: "깍두기",
    name: "깍두기",
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
    // The seasoned dish. 백순대 is a separate row (D310-483240000-0001) at a
    // different figure and no stated portion, so it is not aliased here and
    // stays unknown.
    foodCode: "D310-483000000-0004",
    query: "순대볶음",
    name: "순대볶음",
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
    aliases: ["삶은 닭가슴살", "닭찌찌살", "닭가슴", "닭고기, 가슴, 삶은것"],
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

  // ── 다이어트 · 운동 식단 ──────────────────────────────────────────
  // Chosen 2026-09-27 from what diet and fitness content keeps putting on
  // the plate — that only decided *which* foods; every figure is still the
  // MFDS row's. Where a food is eaten in a particular state, the row is
  // that state: steamed 단호박, blanched 브로콜리, roasted almonds.
  //
  // Most are raw 원재료성 rows with no portion, so they ask for grams. The
  // two salads are 음식 rows with a stated 1인분 and include dressing, which
  // is what makes them 135-145 kcal/100 g rather than a bare-leaf figure.
  {
    foodCode: "R101-001000000-0000",
    query: "귀리, 오트밀",
    // Dry oats, which is how a portion is weighed out.
    name: "오트밀",
    aliases: ["귀리, 오트밀"],
  },
  {
    // Here so "오트밀크" matches a drink by name, instead of containing
    // "오트밀" and being priced as dry oats at 382 kcal/100 g.
    foodCode: "R121-029010000-0000",
    query: "귀리 음료",
    name: "오트밀크",
    aliases: ["귀리 음료", "귀리우유", "오트 음료"],
  },
  {
    foodCode: "R121-029140000-0000",
    query: "아몬드 음료",
    name: "아몬드밀크",
    aliases: ["아몬드 음료", "아몬드우유"],
  },
  {
    foodCode: "R121-029140000-0001",
    query: "아몬드 음료, 무가당",
    name: "무가당 아몬드밀크",
    aliases: ["언스위트 아몬드밀크", "무가당 아몬드우유", "아몬드 음료, 무가당"],
  },
  {
    foodCode: "R106-198040049-0000",
    query: "호박, 단호박, 찐것",
    name: "단호박",
    aliases: ["찐 단호박", "호박, 단호박, 찐것"],
  },
  {
    foodCode: "R121-043020300-0000",
    query: "두부",
    name: "두부",
    aliases: ["생두부"],
  },
  {
    // Raw: 연어 is eaten as sashimi, poke and salad. The bare "연어" row
    // (R211-201090100-0000, 273 kcal/100 g) is not the fish as served.
    foodCode: "R211-201093901-0000",
    query: "연어, 생것",
    name: "연어",
    aliases: ["생연어", "연어회", "연어, 생것"],
  },
  {
    foodCode: "R211-201093916-0000",
    query: "연어, 훈제",
    name: "훈제연어",
    aliases: ["연어, 훈제"],
  },
  {
    // Roasted: packaged almonds are sold roasted.
    foodCode: "R105-020000058-0000",
    query: "아몬드, 볶은것",
    name: "아몬드",
    aliases: ["아몬드, 볶은것"],
  },
  {
    foodCode: "R105-035000002-0000",
    query: "호두, 말린것",
    name: "호두",
    aliases: ["호두, 말린것"],
  },
  {
    foodCode: "R108-047000001-0000",
    query: "블루베리, 생것",
    name: "블루베리",
    aliases: ["블루베리, 생것"],
  },
  {
    foodCode: "R108-064000001-0000",
    query: "아보카도, 생것",
    name: "아보카도",
    aliases: ["아보카도, 생것"],
  },
  {
    foodCode: "R106-092000047-0000",
    query: "브로콜리, 데친것",
    name: "브로콜리",
    aliases: ["데친 브로콜리", "브로콜리, 데친것"],
  },
  {
    foodCode: "R106-129000001-0000",
    query: "양배추, 생것",
    name: "양배추",
    aliases: ["양배추, 생것"],
  },
  {
    foodCode: "R106-148010001-0000",
    query: "오이, 다다기, 생것",
    name: "오이",
    aliases: ["오이, 다다기, 생것"],
  },
  {
    foodCode: "R102-009020001-0000",
    query: "곤약(구약나물), 판형, 생것",
    name: "곤약",
    aliases: ["곤약(구약나물), 판형, 생것"],
  },
  {
    foodCode: "R102-009010001-0000",
    query: "곤약(구약나물), 국수형, 생것",
    name: "곤약면",
    aliases: ["곤약국수", "곤약(구약나물), 국수형, 생것"],
  },
  {
    foodCode: "D114-640080000-0001",
    query: "샐러드_닭가슴살",
    name: "닭가슴살 샐러드",
    aliases: ["샐러드_닭가슴살"],
    counter: "그릇",
    variance: "high",
  },
  {
    foodCode: "D114-640320000-0001",
    query: "샐러드_채소",
    name: "채소 샐러드",
    // Not aliased to a bare "샐러드": "참치 샐러드" contains it, and would
    // quietly be priced as this one. A bare "샐러드" asks which.
    aliases: ["야채 샐러드", "그린 샐러드", "샐러드_채소"],
    counter: "그릇",
    variance: "high",
  },
  {
    // A tub of powder, which is what "프로틴 한 스쿱" is measured from. Not
    // aliased to 쉐이크: a shake is powder plus water or milk, and "쉐이크
    // 300ml" priced as 300 g of powder would be a silent 1,200 kcal.
    foodCode: "R121-005010006-0000",
    query: "단백질 보충제, 가루",
    name: "단백질 보충제",
    aliases: [
      "프로틴 파우더",
      "프로틴 가루",
      "단백질 파우더",
      "단백질 가루",
      "보충제",
      "단백질 보충제, 가루",
    ],
  },
  {
    // Ready-to-drink protein drinks, sold in cartons.
    foodCode: "R121-029030000-0000",
    query: "단백질 음료",
    name: "단백질 음료",
    aliases: ["프로틴 음료", "프로틴 드링크"],
  },
  {
    // The 가공식품 품목대표 row for the whole category, not one brand's
    // label: products run 47-227 kcal/100 g, from 0 % fat to honey-sweetened.
    foodCode: "P119-004040200-F001-005",
    query: "그릭요거트",
    name: "그릭요거트",
    aliases: ["플레인 그릭요거트", "무가당 그릭요거트", "그릭 요구르트"],
  },
  {
    foodCode: "D327-758015600-0001",
    query: "달걀_삶은것_흰자",
    name: "달걀흰자",
    aliases: ["계란흰자", "삶은 달걀 흰자", "삶은 계란 흰자", "달걀_삶은것_흰자"],
  },
  {
    // Oil-packed skipjack, which is what 살코기참치 is.
    foodCode: "R211-059013929-0000",
    query: "다랑어, 가다랑어, 통조림, 유지",
    name: "참치캔",
    aliases: ["참치 통조림", "캔참치", "살코기참치", "다랑어, 가다랑어, 통조림, 유지"],
  },
  {
    // MFDS has no raw 원재료성 row for chicken tenderloin; this is a plain,
    // unseasoned product row named exactly that, at a figure in line with
    // the breast row above.
    foodCode: "P117-501050100-4893",
    query: "닭안심",
    name: "닭안심",
    aliases: ["닭안심살", "닭 안심"],
  },
  {
    // 한우 1등급, the middle grade — 우둔 runs 104-191 kcal/100 g across
    // grades, and the list cannot know which one was bought.
    foodCode: "R109-027066201-0000",
    query: "소고기, 한우(1등급), 우둔, 생것",
    name: "소고기 우둔살",
    aliases: ["우둔살", "우둔", "소고기, 한우(1등급), 우둔, 생것"],
  },

  // ════════════════════════════════════════════════════════════════════
  // v1 커버리지 확장 (2026-10-01)
  //
  // The policy changed here. Until now a food whose portion or make-up was
  // not settled was left out; from here on, a food whose *identity* is clear
  // is recorded at its MFDS row and — when what goes into it varies a lot —
  // marked `variance: "high"`, which makes the app say so instead of asking.
  // The flag is a classification, not a number: every figure is still the
  // pinned row's.
  //
  // How rows were chosen, where a dish has several 품목대표 rows:
  //   - a D1xx "분석" row with a stated portion first, as before;
  //   - where two rows for the same dish disagree badly, the one whose
  //     figure is plausible for the dish as served, with the reason noted;
  //   - a generic name (피자, 초밥, 스테이크) is given to one row only when
  //     that row is MFDS's own general or assorted one, and it is marked
  //     high-variance. A generic word is never an alias of a specific dish.
  // ════════════════════════════════════════════════════════════════════

  // ── 고편차 외식 ───────────────────────────────────────────────────
  {
    // The only 품목대표 row. It states no portion; the 그릇 comes from
    // `servingReferences.ts` as a typical size.
    foodCode: "D306-278000000-0002",
    query: "마라탕",
    name: "마라탕",
    variance: "high",
  },
  {
    foodCode: "D106-287180000-0001",
    query: "샤브샤브_소고기",
    name: "샤브샤브",
    aliases: ["샤브샤브_소고기"],
    counter: "인분",
    variance: "high",
  },
  {
    // No stated portion; typical size borrowed in `servingReferences.ts`.
    foodCode: "D306-303180000-0001",
    query: "훠궈_소고기",
    name: "훠궈",
    aliases: ["훠궈_소고기"],
    variance: "high",
  },
  {
    // The row's 300 g is MFDS's portion, not a 마리. Counted in 인분, so
    // "치킨 한 마리" asks instead of becoming 300 g.
    foodCode: "D312-549000000-0001",
    query: "닭튀김",
    name: "치킨",
    aliases: ["후라이드치킨", "프라이드치킨", "후라이드"],
    counter: "인분",
    variance: "high",
  },
  {
    foodCode: "D312-549160000-0001",
    query: "닭튀김_양념",
    name: "양념치킨",
    counter: "인분",
    variance: "high",
  },
  {
    // The only 피자 품목대표 row with a portion. 200 g is MFDS's portion —
    // about two slices of a large pie — and a 조각 or 판 asks.
    foodCode: "D102-120350000-0001",
    query: "피자_콤비네이션피자",
    name: "피자",
    aliases: ["콤비네이션피자", "피자_콤비네이션피자"],
    counter: "인분",
    variance: "high",
  },
  {
    // The row states 1,500 g: the whole dish as served for a table, not a
    // portion. So no counter; one 인분 is borrowed as a typical size.
    foodCode: "D307-318140000-0001",
    query: "닭찜_안동찜닭",
    name: "찜닭",
    aliases: ["안동찜닭", "닭찜_안동찜닭"],
    variance: "high",
  },
  {
    foodCode: "D111-514000000-0001",
    query: "닭볶음탕",
    name: "닭볶음탕",
    aliases: ["닭도리탕"],
    counter: "인분",
  },
  {
    foodCode: "D306-264180000-0001",
    query: "곱창전골_소고기",
    name: "곱창전골",
    aliases: ["곱창전골_소고기"],
    counter: "인분",
    variance: "high",
  },
  {
    foodCode: "D108-359120000-0001",
    query: "곱창구이_소고기",
    name: "곱창",
    aliases: ["소곱창", "곱창구이", "소곱창구이", "곱창구이_소고기"],
    counter: "인분",
    variance: "high",
  },
  {
    foodCode: "D110-455160000-0001",
    query: "곱창볶음_돼지고기",
    name: "곱창볶음",
    aliases: ["돼지곱창볶음", "야채곱창", "곱창볶음_돼지고기"],
    counter: "인분",
  },
  {
    // Of the two 갈비찜_소고기 rows, D107 states 85 kcal/100 g — too lean
    // for braised short rib — so the D307 row (198) is the one pinned.
    foodCode: "D307-306130000-0001",
    query: "갈비찜_소고기",
    name: "갈비찜",
    aliases: ["소갈비찜", "갈비찜_소고기"],
    counter: "인분",
    variance: "high",
  },
  {
    foodCode: "D107-324000000-0001",
    query: "돼지갈비찜",
    name: "돼지갈비찜",
    counter: "인분",
  },
  {
    foodCode: "D107-338000000-0001",
    query: "아귀찜",
    name: "아귀찜",
    aliases: ["아구찜"],
    counter: "인분",
    variance: "high",
  },
  {
    foodCode: "D307-348000000-0003",
    query: "해물찜",
    name: "해물찜",
    counter: "인분",
    variance: "high",
  },

  // ── 국 · 탕 · 찌개 · 전골 (추가) ──────────────────────────────────
  {
    foodCode: "D105-203000000-0001",
    query: "곰탕",
    name: "곰탕",
    counter: "그릇",
  },
  {
    foodCode: "D105-213000000-0001",
    query: "닭곰탕",
    name: "닭곰탕",
    counter: "그릇",
  },
  {
    foodCode: "D106-293000000-0001",
    query: "알탕",
    name: "알탕",
    counter: "그릇",
  },
  {
    foodCode: "D306-300000000-0002",
    query: "해물탕",
    name: "해물탕",
    counter: "그릇",
  },
  {
    foodCode: "D103-160000000-0001",
    query: "수제비",
    name: "수제비",
    counter: "그릇",
  },
  {
    foodCode: "D106-297000000-0001",
    query: "청국장찌개",
    name: "청국장찌개",
    aliases: ["청국장"],
    counter: "그릇",
  },
  {
    foodCode: "D106-273000000-0001",
    query: "동태찌개",
    name: "동태찌개",
    counter: "그릇",
  },
  {
    foodCode: "D106-299000000-0001",
    query: "콩비지찌개",
    name: "콩비지찌개",
    aliases: ["비지찌개"],
    counter: "그릇",
  },
  {
    foodCode: "D106-282000000-0001",
    query: "버섯전골",
    name: "버섯전골",
    counter: "인분",
  },
  {
    foodCode: "D306-276000000-0001",
    query: "두부전골",
    name: "두부전골",
    counter: "인분",
  },
  {
    foodCode: "D106-289000000-0001",
    query: "소고기전골",
    name: "소고기전골",
    counter: "인분",
  },

  // ── 볶음 · 구이 · 조림 (추가) ─────────────────────────────────────
  {
    foodCode: "D110-488000000-0001",
    query: "오징어볶음",
    name: "오징어볶음",
    counter: "인분",
  },
  {
    foodCode: "D110-457000000-0001",
    query: "낙지볶음",
    name: "낙지볶음",
    counter: "인분",
  },
  {
    foodCode: "D310-493000000-0001",
    query: "주꾸미볶음",
    name: "주꾸미볶음",
    aliases: ["쭈꾸미볶음"],
    counter: "인분",
  },
  {
    foodCode: "D108-376000000-0001",
    query: "떡갈비",
    name: "떡갈비",
    counter: "인분",
  },
  {
    foodCode: "D127-762000000-0001",
    query: "육회",
    name: "육회",
    counter: "인분",
  },
  {
    foodCode: "D308-396160000-0001",
    query: "장어구이_양념",
    name: "장어구이",
    aliases: ["양념장어구이", "장어구이_양념"],
    counter: "인분",
  },
  {
    foodCode: "D111-517000000-0001",
    query: "두부조림",
    name: "두부조림",
    counter: "인분",
  },
  {
    foodCode: "D108-404000000-0001",
    query: "함박스테이크",
    name: "함박스테이크",
    aliases: ["햄버그스테이크", "함박"],
    counter: "인분",
  },
  {
    // 등심 388 kcal and 안심 366 kcal a portion: close enough that the
    // 등심 row stands for a bare "스테이크", marked as varying by cut.
    foodCode: "D108-387140000-0001",
    query: "스테이크_소등심",
    name: "스테이크",
    aliases: ["등심스테이크", "스테이크_소등심"],
    counter: "인분",
    variance: "high",
  },
  {
    foodCode: "D108-387150000-0001",
    query: "스테이크_소안심",
    name: "안심스테이크",
    aliases: ["스테이크_소안심"],
    counter: "인분",
  },
  {
    foodCode: "D312-550140000-0001",
    query: "돈가스_치즈",
    name: "치즈돈가스",
    aliases: ["치즈돈까스", "돈가스_치즈"],
    counter: "인분",
  },

  // ── 밥 · 죽 (추가) ────────────────────────────────────────────────
  {
    foodCode: "D101-018430000-0001",
    query: "비빔밥_육회",
    name: "육회비빔밥",
        counter: "그릇",
  },
  {
    foodCode: "D101-047000000-0001",
    query: "콩나물밥",
    name: "콩나물밥",
    counter: "그릇",
  },
  {
    foodCode: "D301-051000000-0001",
    query: "회덮밥",
    name: "회덮밥",
    counter: "그릇",
  },
  {
    foodCode: "D101-017260000-0001",
    query: "볶음밥_새우",
    name: "새우볶음밥",
    aliases: ["볶음밥_새우"],
    counter: "그릇",
  },
  {
    foodCode: "D101-017030000-0001",
    query: "볶음밥_계란",
    name: "계란볶음밥",
    aliases: ["달걀볶음밥", "볶음밥_계란"],
    counter: "그릇",
  },
  {
    foodCode: "D101-017280000-0001",
    query: "볶음밥_소고기",
    name: "소고기볶음밥",
    aliases: ["볶음밥_소고기"],
    counter: "그릇",
  },
  {
    foodCode: "D101-017450000-0001",
    query: "볶음밥_참치",
    name: "참치볶음밥",
    aliases: ["볶음밥_참치"],
    counter: "그릇",
  },
  {
    foodCode: "D101-010080000-0001",
    query: "덮밥_낙지",
    name: "낙지덮밥",
    aliases: ["덮밥_낙지"],
    counter: "그릇",
  },
  {
    foodCode: "D101-010390000-0001",
    query: "덮밥_오징어",
    name: "오징어덮밥",
    aliases: ["덮밥_오징어"],
    counter: "그릇",
  },
  {
    foodCode: "D301-010440000-0001",
    query: "덮밥_장어",
    name: "장어덮밥",
    aliases: ["덮밥_장어"],
    counter: "그릇",
  },
  {
    foodCode: "D301-010450000-0001",
    query: "덮밥_참치",
    name: "참치덮밥",
    aliases: ["덮밥_참치"],
    counter: "그릇",
  },
  {
    foodCode: "D101-010110000-0001",
    query: "덮밥_닭고기",
    name: "닭고기덮밥",
    aliases: ["덮밥_닭고기"],
    counter: "그릇",
  },
  {
    // MFDS's assorted row, so it can stand for a bare "초밥"; what is on the
    // plate varies. 380 g is the row's portion, and "초밥 10개" asks.
    foodCode: "D101-042200000-0001",
    query: "초밥_모듬",
    name: "초밥",
    aliases: ["모둠초밥", "모듬초밥", "스시", "초밥_모듬"],
    counter: "인분",
    variance: "high",
  },
  {
    foodCode: "D104-191000000-0001",
    query: "전복죽",
    name: "전복죽",
    counter: "그릇",
  },
  {
    foodCode: "D104-197000000-0001",
    query: "호박죽",
    name: "호박죽",
    counter: "그릇",
  },
  {
    foodCode: "D104-195000000-0001",
    query: "팥죽",
    name: "팥죽",
    counter: "그릇",
  },
  {
    foodCode: "D104-181000000-0001",
    query: "닭죽",
    name: "닭죽",
    counter: "그릇",
  },

  // ── 면 (추가) ─────────────────────────────────────────────────────
  {
    // The D303 row (60 kcal/100 g, 700 g). Its D103 twin states 158 kcal
    // over 800 g — over 1,200 kcal a bowl — and was rejected earlier for
    // that; this one is in line with the other noodle soups.
    foodCode: "D303-164400000-0001",
    query: "우동_일식",
    name: "우동",
    aliases: ["우동_일식"],
    counter: "그릇",
  },
  {
    foodCode: "D103-165000000-0001",
    query: "우동볶음",
    name: "볶음우동",
    aliases: ["우동볶음", "야끼우동"],
    counter: "그릇",
  },
  {
    foodCode: "D103-175000000-0001",
    query: "콩국수",
    name: "콩국수",
    counter: "그릇",
  },
  {
    // The four 라멘 rows run 72-98 kcal/100 g (소유, 시오, 미소, 돈코츠) and
    // none states a bowl. 시오 (84) sits nearest the middle and stands for a
    // bare "라멘"; the bowl is a typical size from `servingReferences.ts`.
    foodCode: "D303-147340000-0001",
    query: "라멘_시오라멘",
    name: "라멘",
    aliases: ["일본라멘", "시오라멘", "라멘_시오라멘"],
    variance: "high",
  },
  {
    foodCode: "D303-147110000-0001",
    query: "라멘_돈코츠라멘",
    name: "돈코츠라멘",
    aliases: ["돈코츠", "라멘_돈코츠라멘"],
    variance: "high",
  },
  {
    foodCode: "D303-147210000-0001",
    query: "라멘_미소라멘",
    name: "미소라멘",
    aliases: ["라멘_미소라멘"],
    variance: "high",
  },
  {
    foodCode: "D303-147330000-0001",
    query: "라멘_소유라멘",
    name: "소유라멘",
    aliases: ["쇼유라멘", "라멘_소유라멘"],
    variance: "high",
  },
  {
    foodCode: "D303-161370000-0001",
    query: "스파게티_오일소스",
    name: "오일 스파게티",
    aliases: ["오일파스타", "오일 파스타", "알리오올리오", "알리오 올리오", "스파게티_오일소스"],
    counter: "접시",
  },

  // ── 샐러드 · 빵 · 간식 (추가) ─────────────────────────────────────
  {
    foodCode: "D114-640020000-0001",
    query: "샐러드_감자",
    name: "감자 샐러드",
    aliases: ["감자샐러드", "샐러드_감자"],
    counter: "그릇",
  },
  {
    foodCode: "D114-640310000-0001",
    query: "샐러드_참치",
    name: "참치 샐러드",
    aliases: ["참치샐러드", "샐러드_참치"],
    counter: "그릇",
    variance: "high",
  },
  {
    foodCode: "D114-640070000-0001",
    query: "샐러드_단호박",
    name: "단호박 샐러드",
    aliases: ["단호박샐러드", "샐러드_단호박"],
    counter: "그릇",
  },
  {
    // A 가공식품 품목대표 row, analysed, with a 70 g label serving: one
    // hot dog on a stick.
    foodCode: "P101-416000400-0001",
    query: "핫도그",
    name: "핫도그",
    counter: "개",
  },
  {
    foodCode: "D302-134000000-0001",
    query: "약과",
    name: "약과",
    counter: "개",
  },
  {
    foodCode: "D102-097000000-0001",
    query: "소보로빵",
    name: "소보로빵",
    aliases: ["소보로", "곰보빵"],
    counter: "개",
  },
  {
    foodCode: "D102-088000000-0001",
    query: "모닝빵",
    name: "모닝빵",
    counter: "개",
  },
  {
    foodCode: "P101-420000400-0309",
    query: "단팥빵",
    name: "단팥빵",
    aliases: ["팥빵"],
    counter: "개",
  },
  {
    foodCode: "D102-106000000-0001",
    query: "츄러스",
    name: "츄러스",
    aliases: ["추러스", "츄로스"],
    counter: "개",
  },

  // ── 김밥 · 국밥 · 국 (추가) ───────────────────────────────────────
  {
    foodCode: "D101-007070000-0001",
    query: "김밥_김치",
    name: "김치김밥",
    aliases: ["김밥_김치"],
    counter: "줄",
  },
  {
    foodCode: "D101-007280000-0001",
    query: "김밥_소고기",
    name: "소고기김밥",
    aliases: ["김밥_소고기"],
    counter: "줄",
  },
  {
    foodCode: "D101-007120000-0001",
    query: "김밥_돈가스",
    name: "돈가스김밥",
    aliases: ["돈까스김밥", "김밥_돈가스"],
    counter: "줄",
  },
  {
    foodCode: "D101-007480000-0001",
    query: "김밥_채소",
    name: "야채김밥",
    aliases: ["채소김밥", "김밥_채소"],
    counter: "줄",
  },
  {
    foodCode: "D101-004500000-0001",
    query: "국밥_콩나물",
    name: "콩나물국밥",
    aliases: ["국밥_콩나물"],
    counter: "그릇",
  },
  {
    foodCode: "D301-004280000-0001",
    query: "국밥_소고기",
    name: "소고기국밥",
    aliases: ["국밥_소고기"],
    counter: "그릇",
  },
  {
    // The row states 1,200 g for the bowl, the largest of the 국밥 rows, so
    // it is marked as varying rather than taken as every 돼지국밥.
    foodCode: "D301-004140000-0001",
    query: "국밥_돼지고기",
    name: "돼지국밥",
    aliases: ["국밥_돼지고기"],
    counter: "그릇",
    variance: "high",
  },
  {
    foodCode: "D301-004060000-0001",
    query: "국밥_굴",
    name: "굴국밥",
    aliases: ["국밥_굴"],
    counter: "그릇",
  },
  {
    foodCode: "D303-151000000-0001",
    query: "만두국",
    name: "만두국",
    aliases: ["만둣국"],
    counter: "그릇",
  },
  {
    foodCode: "D103-146000000-0001",
    query: "떡만두국",
    name: "떡만두국",
    aliases: ["떡만둣국"],
    counter: "그릇",
  },
  {
    foodCode: "D105-226000000-0001",
    query: "북어국",
    name: "북어국",
    aliases: ["북엇국"],
    counter: "그릇",
  },
  {
    foodCode: "D101-018130000-0001",
    query: "비빔밥_돌솥",
    name: "돌솥비빔밥",
    aliases: ["비빔밥_돌솥"],
    counter: "그릇",
  },
  {
    foodCode: "D106-266250000-0001",
    query: "김치찌개_참치",
    name: "참치김치찌개",
    aliases: ["참치찌개", "김치찌개_참치"],
    counter: "그릇",
  },
  {
    foodCode: "D108-354120000-0001",
    query: "갈비구이_소고기",
    name: "소갈비구이",
    aliases: ["소갈비", "갈비구이_소고기"],
    counter: "인분",
    variance: "high",
  },

  // ── 반찬 (추가) ───────────────────────────────────────────────────
  {
    foodCode: "D110-472000000-0001",
    query: "멸치볶음",
    name: "멸치볶음",
    counter: "인분",
  },
  {
    foodCode: "D111-536000000-0001",
    query: "콩조림(콩자반)",
    name: "콩자반",
    aliases: ["콩조림", "콩조림(콩자반)"],
    counter: "인분",
  },
  {
    foodCode: "D113-586000000-0001",
    query: "시금치나물",
    name: "시금치나물",
    aliases: ["시금치무침"],
    counter: "인분",
  },
  {
    foodCode: "D113-597000000-0001",
    query: "콩나물무침",
    name: "콩나물무침",
    counter: "인분",
  },

  {
    foodCode: "D110-486000000-0001",
    query: "어묵볶음",
    name: "어묵볶음",
    counter: "인분",
  },
  {
    foodCode: "D111-508000000-0001",
    query: "감자조림",
    name: "감자조림",
    counter: "인분",
  },

  // ── 과일 · 견과 · 주스 (추가) ─────────────────────────────────────
  // Raw rows with no portion, like the fruit above: the food is known and a
  // bare name asks for grams instead of for the calories.
  {
    foodCode: "R108-028000001-0000",
    query: "망고, 생것",
    name: "망고",
    aliases: ["망고, 생것"],
  },
  {
    foodCode: "R108-092000001-0000",
    query: "파인애플, 생것",
    name: "파인애플",
    aliases: ["파인애플, 생것"],
  },
  {
    foodCode: "R108-034020001-0000",
    query: "멜론, 머스크, 생것",
    name: "멜론",
    aliases: ["머스크멜론", "멜론, 머스크, 생것"],
  },
  {
    foodCode: "R108-111000001-0000",
    query: "체리, 생것",
    name: "체리",
    aliases: ["체리, 생것"],
  },
  {
    foodCode: "R108-084000001-0000",
    query: "자몽, 생것",
    name: "자몽",
    aliases: ["자몽, 생것"],
  },
  {
    foodCode: "R108-001010001-0000",
    query: "감, 단감, 생것",
    name: "단감",
    aliases: ["감, 단감, 생것"],
  },
  {
    foodCode: "R108-082000001-0000",
    query: "자두, 생것",
    name: "자두",
    aliases: ["자두, 생것"],
  },
  {
    foodCode: "R105-007000058-0000",
    query: "땅콩, 볶은것",
    name: "땅콩",
    aliases: ["볶은 땅콩", "땅콩, 볶은것"],
  },
  {
    foodCode: "R121-034060000-0000",
    query: "오렌지 주스",
    name: "오렌지주스",
    aliases: ["오렌지 주스"],
  },
  {
    foodCode: "R121-034040000-0000",
    query: "사과 주스",
    name: "사과주스",
    aliases: ["사과 주스"],
  },
  {
    foodCode: "R121-034110000-0000",
    query: "포도 주스",
    name: "포도주스",
    aliases: ["포도 주스"],
  },
  {
    // No D420 café row of its own; the cup is the typical café size in
    // `servingReferences.ts`, as for 아메리카노.
    foodCode: "D320-748130000-0001",
    query: "커피_카푸치노",
    name: "카푸치노",
    aliases: ["커피_카푸치노"],
  },

  // ── 중식 · 만두 · 기타 외식 (추가) ────────────────────────────────
  {
    // A 가공식품 품목대표 row; its 50 g label serving is a catering unit, not
    // a plate, so no counter. One 인분 is borrowed in `servingReferences.ts`.
    foodCode: "P117-100050200-F054-001",
    query: "탕수육",
    name: "탕수육",
    variance: "high",
  },
  {
    foodCode: "D110-470000000-0001",
    query: "마파두부",
    name: "마파두부",
    counter: "인분",
  },
  {
    foodCode: "D110-490000000-0001",
    query: "유산슬",
    name: "유산슬",
    counter: "인분",
  },
  {
    foodCode: "D114-642000000-0001",
    query: "양장피",
    name: "양장피",
    counter: "인분",
  },
  {
    foodCode: "D101-037000000-0001",
    query: "짬뽕밥",
    name: "짬뽕밥",
    counter: "그릇",
  },
  {
    foodCode: "D301-034000000-0001",
    query: "잡탕밥",
    name: "잡탕밥",
    counter: "그릇",
  },
  {
    foodCode: "D103-150190000-0001",
    query: "만두_물만두",
    name: "물만두",
    aliases: ["만두_물만두"],
    counter: "인분",
  },
  {
    foodCode: "D103-150060000-0001",
    query: "만두_김치만두",
    name: "김치만두",
    aliases: ["만두_김치만두"],
    counter: "인분",
  },
  {
    foodCode: "D103-167000000-0001",
    query: "월남쌈",
    name: "월남쌈",
    counter: "인분",
  },
  {
    foodCode: "D308-406000000-0001",
    query: "훈제오리",
    name: "훈제오리",
    counter: "인분",
  },
  {
    foodCode: "D110-461000000-0001",
    query: "닭발볶음",
    name: "닭발",
    aliases: ["닭발볶음", "매운닭발"],
    counter: "인분",
  },
  {
    foodCode: "D105-237000000-0001",
    query: "어묵국(어묵탕)",
    name: "어묵탕",
    aliases: ["어묵국", "오뎅탕", "어묵국(어묵탕)"],
    counter: "그릇",
  },
  {
    foodCode: "D109-426000000-0001",
    query: "부추전",
    name: "부추전",
    counter: "인분",
  },
  {
    foodCode: "D309-445000000-0001",
    query: "호박전",
    name: "호박전",
    counter: "인분",
  },
  {
    foodCode: "D309-437070000-0001",
    query: "완자전_소고기(동그랑땡/육원전)",
    name: "동그랑땡",
    aliases: ["완자전", "육원전", "완자전_소고기(동그랑땡/육원전)"],
    counter: "인분",
  },
  {
    foodCode: "D101-016000000-0001",
    query: "보리밥",
    name: "보리밥",
    counter: "공기",
  },
  {
    // The plain cabbage kimchi the dataset lacked: a bare "김치" used to
    // match only the dishes that start with it. A raw row with no portion;
    // one 인분 is borrowed from the 깍두기 row in `servingReferences.ts`.
    foodCode: "R121-006060000-0000",
    query: "김치, 배추 김치",
    name: "배추김치",
    aliases: ["김치", "김치, 배추 김치"],
  },
  {
    // Three analysed 도넛 rows state 346, 424 and 465 kcal/100 g; the middle
    // one is pinned and marked as varying.
    foodCode: "P101-401000400-1752",
    query: "도넛",
    name: "도넛",
    aliases: ["도너츠", "도나쓰"],
    counter: "개",
    variance: "high",
  },
  {
    foodCode: "D102-087000000-0001",
    query: "머핀",
    name: "머핀",
    counter: "개",
  },
  {
    foodCode: "D102-095000000-0001",
    query: "베이글",
    name: "베이글",
    counter: "개",
  },
  {
    foodCode: "D102-109000000-0001",
    query: "카스텔라",
    name: "카스텔라",
    aliases: ["카스테라"],
    counter: "조각",
  },
];
