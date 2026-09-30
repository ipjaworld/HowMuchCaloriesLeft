import { writeFileSync } from "node:fs";
import { it } from "vitest";
import { findByName } from "@/ai/nutrition/dataset";
import { KOREAN_FOODS, koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import {
  COVERAGE_CATEGORIES,
  COVERAGE_VERDICTS,
  FOOD_COVERAGE_BASELINE_PATH,
  SILENT_DROP_VERDICTS,
  SILENT_WRONG_VERDICTS,
  isCorrect,
  loadCoverageCorpus,
  runCoverage,
  summarize,
  toBaseline,
} from "@/application/foodCoverage";

/**
 * Food-input coverage report. Not a test: it prints what the production add
 * pipeline does with `fixtures/food-input-coverage.json`, and never fails.
 *
 *   pnpm eval:food-coverage                          print the report
 *   FOOD_COVERAGE_UPDATE=1 pnpm eval:food-coverage   also rewrite the baseline
 *
 * Offline and deterministic: the bundled dataset only, no Jev, no network.
 *
 * The baseline file is what `foodCoverage.test.ts` holds `pnpm test` to, so a
 * change in behaviour — better or worse — fails the suite until someone
 * rewrites it on purpose and the diff shows exactly which cases moved.
 */

/**
 * A food found *inside* a longer phrase scores `EMBEDDED_SCORE` (0.65) in
 * `dataset.ts`; every whole-phrase rule scores 0.665 or more. So a best
 * score at or below this means the match came from "the user's words
 * contain a dataset name" — once a looser rule that priced 감자탕 as 감자,
 * now the word-boundary embedded match. Counted so it stays watched.
 */
const EMBEDDED_MAX_SCORE = 0.65;

function percent(hits: number, total: number): string {
  if (total === 0) return "   n/a";
  return `${((hits / total) * 100).toFixed(1).padStart(5)}%`;
}

async function main(): Promise<void> {
  const cases = loadCoverageCorpus();
  const runs = await runCoverage(cases, koreanFoodResolver);
  const results = runs.map((run) => run.result);
  const summary = summarize(results);

  const line = "─".repeat(72);
  console.log(`\n${line}\n음식 입력 coverage — 현재 production 파이프라인 (resolveAddParts)\n${line}`);
  console.log(
    `데이터셋 ${KOREAN_FOODS.length}개 · case ${results.length}건 (날짜 기능 등 범위 밖 ${summary.excluded}건은 분모에서 제외) · Jev 미사용`,
  );

  // Two readings of the same run. "parser only" counts every case. The
  // production-oriented one drops the whole-sentence non-reports tagged
  // jev_may_guard ("빵 터졌네"), which Jev's consumption judgment may stop
  // before this pipeline runs — "may", because that is not measured here.
  // Both are printed so neither can quietly stand in for the other.
  const production = summarize(
    results.filter((result) => !(result.testCase.tags ?? []).includes("jev_may_guard")),
  );
  const row = (label: string, a: string, b: string) =>
    console.log(`  ${label.padEnd(26)} ${a.padStart(16)}   ${b.padStart(16)}`);
  const ratio = (hits: number, total: number) => `${hits}/${total} ${percent(hits, total)}`;

  console.log("");
  row("", "parser only", "Jev guard 가정");
  row("정확", ratio(summary.correct, summary.total), ratio(production.correct, production.total));
  row("! 조용한 오기록 (silent wrong)", String(summary.silentWrong), String(production.silentWrong));
  row("! 조용한 누락 (silent drop)", String(summary.silentDrop), String(production.silentDrop));
  row("· 아무것도 못 찾음", String(summary.byVerdict.nothing_found), String(production.byVerdict.nothing_found));
  row("필요한 질문", String(summary.asks.valid), String(production.asks.valid));
  row("불필요한 질문", String(summary.asks.unnecessary), String(production.asks.unnecessary));
  row(
    "multi-food 완전 일치",
    ratio(summary.multiFood.correct, summary.multiFood.total),
    ratio(production.multiFood.correct, production.multiFood.total),
  );

  // Tagged batches, so a set tuned against is never read as a blind one.
  for (const tag of ["b2_round1", "b2_blind", "b2_review"]) {
    const tagged = summarize(results.filter((result) => (result.testCase.tags ?? []).includes(tag)));
    if (tagged.total === 0) continue;
    console.log(
      `  [${tag}] ${ratio(tagged.correct, tagged.total)} · silent wrong ${tagged.silentWrong} · silent drop ${tagged.silentDrop} · 불필요한 질문 ${tagged.asks.unnecessary}`,
    );
  }

  console.log("\nverdict");
  for (const verdict of COVERAGE_VERDICTS) {
    const count = summary.byVerdict[verdict];
    if (count === 0) continue;
    const mark = isCorrect(verdict) ? " " : SILENT_WRONG_VERDICTS.has(verdict) || SILENT_DROP_VERDICTS.has(verdict) ? "!" : "·";
    console.log(`  ${mark} ${verdict.padEnd(22)} ${String(count).padStart(3)}`);
  }

  console.log("\ncategory                 정확 / 전체");
  for (const category of COVERAGE_CATEGORIES) {
    const { total, correct } = summary.byCategory[category];
    console.log(`  ${category.padEnd(22)} ${String(correct).padStart(3)} / ${String(total).padEnd(3)} ${percent(correct, total)}`);
  }

  // How often the embedded match was the rule that recorded a food, and
  // whether what it recorded was right.
  let reverseRight = 0;
  let reverseWrong = 0;
  const reverseWrongCases: string[] = [];
  for (const { result, parts } of runs) {
    const notEaten = new Set(result.testCase.notEaten ?? []);
    for (const part of parts) {
      if (part.status !== "resolved") continue;
      const found = findByName(KOREAN_FOODS, part.phraseName);
      if (found.kind === "none" || found.score > EMBEDDED_MAX_SCORE) continue;

      const squashed = part.phraseName.replace(/\s+/g, "");
      const right =
        !notEaten.has(part.item.name) &&
        result.testCase.foods.some(
          (food) =>
            food.status === "resolved" &&
            food.entry === part.item.name &&
            squashed.includes(food.said.replace(/\s+/g, "")),
        );
      if (right) reverseRight += 1;
      else {
        reverseWrong += 1;
        reverseWrongCases.push(`${result.testCase.id} "${result.testCase.input}" → ${part.item.name}`);
      }
    }
  }
  console.log(
    `\n0.65 구절 내 포함 매칭으로 기록된 음식 ${reverseRight + reverseWrong}건: 맞음 ${reverseRight} · 틀림 ${reverseWrong}`,
  );
  for (const entry of reverseWrongCases) console.log(`  ! ${entry}`);

  console.log(`\n${line}\n실패 case\n${line}`);
  for (const result of results) {
    if (isCorrect(result.verdict)) continue;
    const mark = SILENT_WRONG_VERDICTS.has(result.verdict) || SILENT_DROP_VERDICTS.has(result.verdict) ? "!" : "·";
    console.log(`${mark} [${result.verdict}] ${result.testCase.id}  "${result.testCase.input}"`);
    const expected = result.testCase.consumed
      ? result.foods.map(({ expected: food, outcome }) => {
          const target =
            food.status === "resolved" || food.status === "unmeasurable"
              ? ` ${food.entry}`
              : food.status === "ambiguous"
                ? ` ${food.candidates.join("|")}`
                : "";
          return `${food.said}→${food.status}${target} (${outcome})`;
        }).join(", ")
      : "먹지 않음 — 기록도 질문도 없어야 함";
    console.log(`    기대: ${expected}`);
    console.log(`    실제: ${result.actual.length === 0 ? "(없음)" : result.actual.join(" ; ")}`);
  }

  if (process.env["FOOD_COVERAGE_UPDATE"] === "1") {
    const baseline = {
      version: 1 as const,
      note:
        "현재 production 파이프라인의 case별 verdict. 기대값이 아니라 현재 상태다. " +
        "FOOD_COVERAGE_UPDATE=1 pnpm eval:food-coverage 로만 갱신한다.",
      cases: toBaseline(results),
    };
    writeFileSync(FOOD_COVERAGE_BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
    console.log(`\nbaseline을 갱신했습니다: ${FOOD_COVERAGE_BASELINE_PATH}`);
  }
}

it("food input coverage report", async () => {
  await main();
});
