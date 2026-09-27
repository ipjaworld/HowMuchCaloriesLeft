import { it } from "vitest";
import { createMfdsClient, type MfdsRow } from "@/ai/nutrition/mfds/client";
import {
  energyLooksRight,
  parseAmount,
  statedServingGrams,
} from "@/ai/nutrition/mfds/importer";
import { FOOD_SEEDS } from "@/ai/nutrition/mfds/seeds";

/**
 * Prints the MFDS rows worth reading before a food is added to `seeds.ts`.
 *
 *   MFDS_QUERY="순두부찌개" pnpm candidates:mfds
 *   MFDS_QUERY="바나나, 생것" pnpm candidates:mfds
 *
 * This is the automatable half of adding a food. It does the tedious part —
 * paging a substring search over 331,212 rows, dropping rows that fail the
 * energy check, ordering what is left so the likely row is near the top —
 * and then **stops**. It never writes a seed and never picks a row.
 *
 * Choosing is the human half, and it cannot be automated for the reason the
 * whole seed file exists: a name match is not a food match. "바나나" is an
 * exact name for a snack, "아메리카노" for a powder. Only reading the row —
 * its group, its class, its figure against what the dish is — settles it.
 *
 * Ordering, most to least likely to be the everyday food:
 *
 *   1. 음식 품목대표 on a 100 g basis with a stated portion (a bowl of soup)
 *   2. 원재료성 품목대표 (raw fruit, milk, eggs — never a portion)
 *   3. other 음식 rows (100 mL-basis café rows, calculated rows)
 *   4. 가공식품 (a brand's product; only for a food that *is* one product)
 *
 * Exact-name rows sort ahead within each tier. Rows already pinned in
 * `seeds.ts` are marked so the same food is not added twice.
 */

function tier(row: MfdsRow): number {
  const portion = statedServingGrams(row) !== null;
  if (row.DB_GRP_NM === "음식" && row.DB_CLASS_NM === "품목대표") {
    return row.SERVING_SIZE === "100g" && portion ? 1 : 3;
  }
  if (row.DB_GRP_NM === "원재료성" && row.DB_CLASS_NM === "품목대표") return 2;
  if (row.DB_GRP_NM === "음식") return 3;
  return 4;
}

async function main(): Promise<void> {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // The key may still come from the real environment.
  }

  const apiKey = process.env["MFDS_FOOD_NUTRITION_API_KEY"]?.trim();
  const query = process.env["MFDS_QUERY"]?.trim();
  if (apiKey === undefined || apiKey === "" || query === undefined || query === "") {
    console.error('\n사용법: MFDS_QUERY="음식이름" pnpm candidates:mfds  (MFDS_FOOD_NUTRITION_API_KEY 필요)\n');
    process.exit(1);
  }

  const client = createMfdsClient({ apiKey });
  const rows = await client.searchByName(query);
  const seeded = new Set(FOOD_SEEDS.map((seed) => seed.foodCode));

  const usable = rows.filter((row) => parseAmount(row.AMT_NUM1) !== null);
  const failing = usable.filter((row) => !energyLooksRight(row));
  const candidates = usable
    .filter((row) => energyLooksRight(row))
    .sort(
      (a, b) =>
        tier(a) - tier(b) ||
        Number(b.FOOD_NM_KR === query) - Number(a.FOOD_NM_KR === query) ||
        a.FOOD_CD.localeCompare(b.FOOD_CD),
    )
    .slice(0, 40);

  console.log(`\n"${query}" — 검색 ${rows.length}행, 에너지 검산 실패 ${failing.length}행 제외\n`);
  for (const row of candidates) {
    const portion = statedServingGrams(row);
    console.log(
      [
        seeded.has(row.FOOD_CD) ? "★" : " ",
        `T${tier(row)}`,
        row.FOOD_CD,
        row.FOOD_NM_KR,
        `${row.DB_GRP_NM ?? "?"}/${row.DB_CLASS_NM ?? "?"}`,
        `${row.AMT_NUM1} kcal/${row.SERVING_SIZE ?? "?"}`,
        portion === null ? "1인분 없음" : `1인분 ${portion}`,
        row.CRT_MTH_NM ?? "",
      ].join("  "),
    );
  }
  console.log(
    "\n★ = 이미 seeds.ts에 있음. 행을 직접 읽고 FOOD_CD를 seeds.ts에 적은 뒤 pnpm sync:mfds 를 실행하세요.\n" +
      "이 도구는 고르지 않습니다 — 이름이 같아도 다른 음식일 수 있습니다 (예: 바나나 → 과자).\n",
  );
}

it("list MFDS candidates", async () => {
  await main();
});
