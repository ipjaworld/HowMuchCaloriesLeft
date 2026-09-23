import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { createMfdsClient } from "@/ai/nutrition/mfds/client";
import { selectRow, toFoodEntry, type ImportIssue } from "@/ai/nutrition/mfds/importer";
import { FOOD_SEEDS } from "@/ai/nutrition/mfds/seeds";
import { foodDatasetSchema } from "@/ai/nutrition/dataset";
import type { FoodEntry } from "@/ai/nutrition/types";

/**
 * Rebuilds `data/korean-foods.json` from the MFDS open API.
 *
 *   pnpm sync:mfds
 *
 * Driven by vitest purely as a runner, the same trick `eval:jev` uses: it
 * already resolves TypeScript and the `@/` alias, so the script needs no
 * build step of its own. It is not a test and `pnpm test` never picks it up.
 *
 * Offline tooling, not part of the running app: the app reads the file this
 * writes. That is the whole loading strategy, and it is a deliberate choice
 * over querying MFDS per request —
 *
 *   - the database is 331,212 rows, far too many to ship, and its name
 *     search is a substring match that happily returns 커피번 for "커피", so
 *     picking a row at request time would mean picking wrong ones;
 *   - a dev key allows 10,000 calls a day and each one costs ~300 ms, against
 *     0 ms for a local lookup;
 *   - the existing `localDatasetResolver` and its tests already consume this
 *     exact shape, so the deterministic path stays deterministic and
 *     testable with no network in the test suite.
 *
 * Nothing here invents a number. A seed that cannot be resolved to exactly
 * one row, or whose row fails the energy check, is reported and skipped — a
 * missing food is a correct `unknown`, a wrong food is a silent lie.
 */

const OUT_PATH = "data/korean-foods.json";

function requireKey(): string {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // The key may still come from the real environment.
  }

  const key = process.env["MFDS_FOOD_NUTRITION_API_KEY"]?.trim();
  if (key === undefined || key === "") {
    console.error(
      [
        "",
        "MFDS_FOOD_NUTRITION_API_KEY 가 없어 데이터셋을 갱신할 수 없습니다.",
        "",
        "  https://www.data.go.kr/data/15127578/openapi.do 에서 활용신청 후",
        "  .env.local 에 키를 넣고 다시 실행하세요.",
        "",
        "  앱은 이미 커밋된 data/korean-foods.json 으로 동작하므로,",
        "  데이터를 새로 받을 때만 필요합니다.",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
  return key;
}

async function main(): Promise<void> {
  const apiKey = requireKey();
  const endpoint = process.env["MFDS_FOOD_NUTRITION_ENDPOINT"]?.trim();
  const client = createMfdsClient({
    apiKey,
    ...(endpoint === undefined || endpoint === "" ? {} : { endpoint }),
  });

  const entries: FoodEntry[] = [];
  const issues: ImportIssue[] = [];
  const unresolved: string[] = [];

  for (const seed of FOOD_SEEDS) {
    const rows = await client.searchByName(seed.query);
    const { row, matched } = selectRow(rows, { foodCode: seed.foodCode });

    if (row === null) {
      unresolved.push(
        `${seed.query} (${seed.foodCode}) — 검색 ${rows.length}건 중 일치 ${matched}건`,
      );
      continue;
    }

    const { entry, issue } = toFoodEntry(row, seed);
    if (issue !== null) issues.push(issue);
    if (entry !== null) entries.push(entry);

    process.stdout.write(
      entry === null
        ? `  ✗ ${seed.query}\n`
        : `  ✓ ${entry.name.padEnd(22)} ${String(entry.caloriesPer100g).padStart(7)} kcal/100g` +
            `${entry.servings === undefined ? "" : `  1${entry.servings[0]?.unit ?? ""}=${entry.servings[0]?.grams ?? 0}g`}\n`,
    );
  }

  const dataset = {
    version: 1 as const,
    source: {
      name: "식품의약품안전처 식품영양성분DB (data.go.kr 15127578)",
      retrievedAt: new Date().toISOString().slice(0, 10),
      license: "이용허락범위 제한 없음 (출처 표시)",
    },
    entries,
  };

  // Validated on the way out as well as on the way in: a shape the app would
  // reject should never reach the repository in the first place.
  const parsed = foodDatasetSchema.safeParse(dataset);
  if (!parsed.success) {
    console.error("생성된 데이터셋이 스키마를 통과하지 못했습니다.");
    console.error(parsed.error.message);
    process.exit(1);
  }

  writeFileSync(OUT_PATH, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");

  console.log(`\n${entries.length}/${FOOD_SEEDS.length}개 항목을 ${OUT_PATH} 에 기록했습니다.`);
  const withServings = entries.filter((entry) => entry.servings !== undefined).length;
  console.log(
    `  1인분 정보 있음 ${withServings}건 · 없음 ${entries.length - withServings}건 (없으면 수량 질문은 unmeasurable)`,
  );

  if (unresolved.length > 0) {
    console.log(`\n행을 특정하지 못한 seed ${unresolved.length}건:`);
    for (const line of unresolved) console.log(`  - ${line}`);
  }
  if (issues.length > 0) {
    console.log(`\n버려진 행 ${issues.length}건:`);
    for (const issue of issues) {
      console.log(`  - ${issue.name} (${issue.foodCode}): ${issue.reason}${issue.detail === undefined ? "" : ` — ${issue.detail}`}`);
    }
  }
}

// Timeout comes from vitest.sync.mts; this makes one network call per seed.
it("sync MFDS dataset", async () => {
  await main();
});
