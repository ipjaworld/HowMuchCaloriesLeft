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
 * guessing a code.
 *
 * `name` is what the list shows, so it is written the way a person would say
 * it. MFDS separates a dish from its variant with an underscore
 * (`커피_아메리카노`), which is a database convention and not something to put
 * in front of a user; the raw form stays reachable as an alias.
 *
 * `counter` is the Korean counter the food is normally spoken in — 공기,
 * 그릇, 잔. It names a portion; it never sizes one. The grams behind it come
 * from the row's own stated weight, and a food whose row states no weight
 * simply ships without a portion, so the resolver answers `unmeasurable`
 * instead of scaling by an invented number. That is why 삼각김밥, 삶은 달걀
 * and 아메리카노 below carry no counter: MFDS gives their energy but not a
 * per-piece or per-cup weight, and this project does not fill that in.
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
    // MFDS states 200 g for this row, which is more than one convenience
    // store triangle weighs — so it gets no counter and "삼각김밥 하나"
    // resolves to unmeasurable rather than to a doubled figure.
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

  // ── 면류 ──────────────────────────────────────────────────────────
  {
    foodCode: "D103-148000000-0001",
    query: "라면",
    name: "라면",
    counter: "그릇",
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

  // ── 달걀 ──────────────────────────────────────────────────────────
  {
    // No per-egg weight anywhere in MFDS, so no counter: "계란 두 개" is
    // answered with unmeasurable, not with a guessed 50 g.
    foodCode: "D327-758010000-0001",
    query: "달걀_삶은것",
    name: "삶은 달걀",
    aliases: ["삶은계란", "삶은달걀", "계란", "달걀", "달걀_삶은것"],
  },

  // ── 음료 ──────────────────────────────────────────────────────────
  {
    // The brewed drink at 4 kcal/100 g. MFDS states no cup size, so a
    // "한 잔" cannot be priced and resolves to unmeasurable.
    foodCode: "D320-748080000-0001",
    query: "커피_아메리카노",
    name: "아메리카노",
    aliases: ["아아", "커피", "커피_아메리카노"],
  },
];
