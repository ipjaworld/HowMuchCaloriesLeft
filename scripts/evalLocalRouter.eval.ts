import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { it } from "vitest";
import { createJevJudge } from "@/ai/judgment/jevJudge";
import { createMockJudge } from "@/ai/judgment/mockJudge";
import { contextFor, loadGoldenSet } from "@/ai/judgment/goldenSet";
import type { Intent, Judge, JudgmentInput } from "@/ai/judgment/types";
import { createLocalLlmClient } from "@/ai/local/client";
import { evalContextFor, loadLocalRouterEval } from "@/ai/local/evalSet";
import {
  CONFIDENCE_BUCKETS,
  agreement,
  calibration,
  isCorrect,
  percentile,
  summarize,
  type EvalRun,
  type EvalSummary,
  type JudgeName,
} from "@/ai/local/evalMetrics";
import { createLocalRouter, type LocalRouter } from "@/ai/local/router";
import { acceptLocal } from "@/ai/local/routing";
import { asksToChangeGoal } from "@/application/commands";

/**
 * Local router accuracy run. Not a test: it prints a report and writes JSON,
 * and never fails the build. Same shape as `pnpm eval:jev`.
 *
 *   pnpm eval:local-router
 *   EVAL_JUDGES=local,mock pnpm eval:local-router       pick judges
 *   EVAL_SETS=local-router pnpm eval:local-router        pick datasets
 *   LOCAL_LLM_MODEL=qwen2.5:3b pnpm eval:local-router   compare models
 *
 * Everything runs one case at a time, so latency is the latency of one call,
 * not of a queue.
 */

/** The first request loads the model into memory; that is not routing latency. */
const WARMUP_TIMEOUT_MS = 120_000;

type Item = {
  dataset: string;
  id: string;
  input: JudgmentInput;
  expected: Intent | "goal_setting";
  accept: Intent[];
  tags: string[];
};

function loadItems(sets: string[]): Item[] {
  const items: Item[] = [];

  if (sets.includes("local-router")) {
    const data = loadLocalRouterEval();
    for (const testCase of data.cases) {
      const context = evalContextFor(data, testCase);
      items.push({
        dataset: "local-router",
        id: testCase.id,
        input: {
          message: testCase.input,
          now: context.now,
          dailyGoalCalories: context.dailyGoalCalories,
          recentItems: context.recentItems,
        },
        expected: testCase.expectedIntent,
        accept: testCase.acceptIntents ?? [],
        tags: testCase.tags,
      });
    }
  }

  if (sets.includes("golden")) {
    const golden = loadGoldenSet();
    for (const testCase of golden.cases) {
      const context = contextFor(golden, testCase);
      items.push({
        dataset: "golden",
        id: testCase.id,
        input: {
          message: testCase.input,
          now: context.now,
          dailyGoalCalories: context.dailyGoalCalories,
          recentItems: context.recentItems,
        },
        expected: testCase.expected.intent,
        accept: [],
        tags: [testCase.category],
      });
    }
  }

  return items;
}

async function runLocal(
  router: LocalRouter,
  item: Item & { expected: Intent },
  minConfidence: number,
): Promise<EvalRun> {
  const result = await router.route(item.input);
  const acceptance = acceptLocal(result, minConfidence);
  const predicted = result.ok ? result.data.intent : null;

  return {
    judge: "local",
    dataset: item.dataset,
    caseId: item.id,
    input: item.input.message,
    expected: item.expected,
    accept: item.accept,
    tags: item.tags,
    predicted,
    confidence: result.ok ? result.data.confidence : null,
    latencyMs: result.latencyMs,
    failure: result.ok ? null : result.reason,
    correct: isCorrect(predicted, item.expected, item.accept),
    wouldUse: acceptance.ok,
    fallbackReason: acceptance.ok ? null : acceptance.reason,
    consumed: result.ok && result.data.intent === "add_food" ? result.data.consumed : null,
    foods: result.ok ? result.data.entities.foods : null,
  };
}

async function runJudge(
  name: JudgeName,
  judge: Judge,
  item: Item & { expected: Intent },
): Promise<EvalRun> {
  const startedAt = Date.now();
  const judgment = await judge.judge(item.input);
  return {
    judge: name,
    dataset: item.dataset,
    caseId: item.id,
    input: item.input.message,
    expected: item.expected,
    accept: item.accept,
    tags: item.tags,
    predicted: judgment.intent,
    confidence: judgment.intentConfidence,
    latencyMs: Date.now() - startedAt,
    failure: null,
    correct: isCorrect(judgment.intent, item.expected, item.accept),
    wouldUse: null,
    fallbackReason: null,
    consumed: null,
    foods: null,
  };
}

function pct(hits: number, total: number): string {
  return total === 0 ? "   n/a" : `${((hits / total) * 100).toFixed(1).padStart(5)}%`;
}

function ms(value: number | null): string {
  return value === null ? "     -" : `${String(value).padStart(5)}ms`;
}

function summaryLines(summaries: EvalSummary[]): string[] {
  const lines = [
    "  judge  정확도              평균     p95      parse timeout conn http unknown  active 사용(=외부 호출 절감)  사용분 정확도",
  ];
  for (const s of summaries) {
    const used =
      s.wouldUse === null
        ? "-".padEnd(27)
        : `${String(s.wouldUse).padStart(3)}/${s.total} ${pct(s.wouldUse, s.total)}`.padEnd(27);
    const usedAccuracy =
      s.wouldUse === null || s.wouldUseCorrect === null
        ? "-"
        : `${s.wouldUseCorrect}/${s.wouldUse} ${pct(s.wouldUseCorrect, s.wouldUse)}`;
    lines.push(
      `  ${s.judge.padEnd(6)} ${String(s.correct).padStart(3)}/${String(s.total).padEnd(3)} ${pct(s.correct, s.total)}   ` +
        `${ms(s.avgLatencyMs)} ${ms(s.p95LatencyMs)}  ` +
        `${String(s.parseFailures).padStart(5)} ${String(s.timeouts).padStart(7)} ${String(s.connectionFailures).padStart(4)} ` +
        `${String(s.httpFailures).padStart(4)} ${String(s.unknown).padStart(7)}  ${used}  ${usedAccuracy}`,
    );
  }
  return lines;
}

function tagLines(runsByJudge: Map<JudgeName, EvalRun[]>): string[] {
  const judges = [...runsByJudge.keys()];
  const tags = [...new Set([...runsByJudge.values()].flat().flatMap((run) => run.tags))].sort();
  const lines = [`  ${"tag".padEnd(18)} ${judges.map((j) => j.padStart(16)).join("")}`];
  for (const tag of tags) {
    const cells = judges.map((judge) => {
      const inTag = (runsByJudge.get(judge) ?? []).filter((run) => run.tags.includes(tag));
      const hits = inTag.filter((run) => run.correct).length;
      return `${hits}/${inTag.length} ${pct(hits, inTag.length)}`.padStart(16);
    });
    lines.push(`  ${tag.padEnd(18)} ${cells.join("")}`);
  }
  return lines;
}

function missLines(runs: EvalRun[], others: Map<JudgeName, EvalRun[]>): string[] {
  const lines: string[] = [];
  for (const run of runs.filter((r) => !r.correct)) {
    const got = run.predicted === null ? `실패(${run.failure})` : `${run.predicted} ${run.confidence?.toFixed(2)}`;
    const used = run.wouldUse ? "  ← active가 사용했을 오답" : "";
    const peers = [...others.entries()]
      .filter(([judge]) => judge !== "local")
      .map(([judge, list]) => `${judge}=${list.find((r) => r.caseId === run.caseId)?.predicted ?? "-"}`)
      .join(" ");
    lines.push(`  ${run.caseId.padEnd(22)} 기대 ${run.expected.padEnd(18)} local ${got.padEnd(24)} ${peers}${used}`);
    lines.push(`  ${"".padEnd(22)} "${run.input}"`);
  }
  return lines.length === 0 ? ["  없음"] : lines;
}

function timestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
}

// Timeout comes from vitest.eval.mts.
it("local router accuracy", async () => {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local — settings may still come from the real environment.
  }
  // Imported only after .env.local is loaded: the schema reads process.env once.
  const { env } = await import("@/env");

  const judges = (process.env["EVAL_JUDGES"] ?? "local,mock,jev").split(",").map((s) => s.trim());
  const sets = (process.env["EVAL_SETS"] ?? "local-router,golden").split(",").map((s) => s.trim());
  const out: string[] = [""];

  // ── local ─────────────────────────────────────────────────────────────
  let router: LocalRouter | null = null;
  let warmupMs: number | null = null;
  if (judges.includes("local")) {
    const model = env.LOCAL_LLM_MODEL;
    if (model === undefined) {
      out.push("LOCAL_LLM_MODEL 이 없어 local 평가를 건너뜁니다. docs/local-llm.md 참고.");
    } else {
      const warm = createLocalRouter(
        createLocalLlmClient({ baseUrl: env.LOCAL_LLM_BASE_URL, model, timeoutMs: WARMUP_TIMEOUT_MS }),
      );
      const first = await warm.route({ message: "안녕", now: new Date().toISOString(), dailyGoalCalories: null, recentItems: [] });
      if (!first.ok && (first.reason === "connection" || first.reason === "http" || first.reason === "timeout")) {
        out.push(
          `local 모델(${model})에 닿지 못해 local 평가를 건너뜁니다: ${first.reason} ${first.detail}`,
          `  ollama serve 가 떠 있는지, ollama pull ${model} 을 했는지 확인하세요.`,
        );
      } else {
        warmupMs = first.latencyMs;
        router = createLocalRouter(
          createLocalLlmClient({
            baseUrl: env.LOCAL_LLM_BASE_URL,
            model,
            timeoutMs: env.LOCAL_LLM_TIMEOUT_MS,
          }),
        );
      }
    }
  }

  // ── the others ───────────────────────────────────────────────────────
  const others: { name: JudgeName; judge: Judge }[] = [];
  if (judges.includes("mock")) others.push({ name: "mock", judge: createMockJudge() });
  if (judges.includes("jev")) {
    const apiKey = env.TYPESAFE_API_KEY;
    if (apiKey === undefined) out.push("TYPESAFE_API_KEY 가 없어 jev 기준선은 건너뜁니다.");
    else others.push({ name: "jev", judge: createJevJudge({ apiKey }) });
  }

  if (router === null && others.length === 0) {
    console.log(out.join("\n"));
    return;
  }

  const items = loadItems(sets);
  const allRuns: EvalRun[] = [];
  const allSummaries: EvalSummary[] = [];
  const goalRule: { dataset: string; correct: number; total: number }[] = [];

  out.push(
    `모델: ${router?.model ?? "-"}   timeout: ${env.LOCAL_LLM_TIMEOUT_MS}ms   ` +
      `min confidence: ${env.LOCAL_LLM_MIN_CONFIDENCE}   warm-up: ${warmupMs === null ? "-" : `${warmupMs}ms`}`,
  );

  for (const dataset of sets) {
    const inSet = items.filter((item) => item.dataset === dataset);
    if (inSet.length === 0) continue;

    // Sentences the goal rule answers never reach a judge's decision, so they
    // are scored against the rule and kept out of every judge's accuracy.
    const ruleItems = inSet.filter((item) => item.expected === "goal_setting" || asksToChangeGoal(item.input.message));
    const judged = inSet.filter(
      (item): item is Item & { expected: Intent } => !ruleItems.includes(item),
    );
    goalRule.push({
      dataset,
      total: ruleItems.length,
      correct: ruleItems.filter(
        (item) => item.expected === "goal_setting" && asksToChangeGoal(item.input.message),
      ).length,
    });

    const runsByJudge = new Map<JudgeName, EvalRun[]>();
    if (router !== null) {
      const runs: EvalRun[] = [];
      for (const item of judged) runs.push(await runLocal(router, item, env.LOCAL_LLM_MIN_CONFIDENCE));
      runsByJudge.set("local", runs);
    }
    for (const { name, judge } of others) {
      const runs: EvalRun[] = [];
      for (const item of judged) runs.push(await runJudge(name, judge, item));
      runsByJudge.set(name, runs);
    }

    const summaries = [...runsByJudge.values()].map(summarize);
    allSummaries.push(...summaries);
    allRuns.push(...[...runsByJudge.values()].flat());

    out.push("");
    out.push(`[${dataset}] ${inSet.length}건 — 코드 규칙(goal_setting) ${ruleItems.length}건 제외, 판정 ${judged.length}건`);
    out.push("=".repeat(100));
    out.push(...summaryLines(summaries));
    const rule = goalRule.at(-1);
    if (rule !== undefined && rule.total > 0) {
      out.push(`  goal 규칙  ${rule.correct}/${rule.total}`);
    }

    const localRuns = runsByJudge.get("local");
    if (localRuns !== undefined) {
      for (const [name, runs] of runsByJudge) {
        if (name === "local") continue;
        const { same, compared } = agreement(localRuns, runs);
        out.push(`  local ↔ ${name} 일치  ${same}/${compared} ${pct(same, compared)}`);
      }
      const adds = localRuns.filter((run) => run.expected === "add_food" && run.predicted === "add_food");
      const consumed = adds.filter((run) => run.consumed === true).length;
      out.push(`  local add_food 중 consumed=true  ${consumed}/${adds.length}  (false면 앱이 기록하지 않음)`);

      // The model load is paid once, before this set; what is left is
      // whether the first few warm calls are still slower than the rest.
      const warm = localRuns.filter((run) => run.failure === null).map((run) => run.latencyMs);
      const head = warm.slice(0, 5);
      const tail = warm.slice(5);
      const avg = (values: number[]) =>
        values.length === 0 ? "-" : `${Math.round(values.reduce((s, v) => s + v, 0) / values.length)}ms`;
      out.push(
        `  local latency  warm-up(모델 로드) ${warmupMs ?? "-"}ms · 첫 5건 평균 ${avg(head)} · 이후 평균 ${avg(tail)} · p50 ${percentile(warm, 50) ?? "-"}ms`,
      );
    }

    out.push("");
    out.push("  confidence 구간별 정확도 (calibration)");
    out.push(`  ${"구간".padEnd(10)} ${[...runsByJudge.keys()].map((j) => j.padStart(18)).join("")}`);
    const tables = [...runsByJudge.values()].map(calibration);
    for (const [index, bucket] of CONFIDENCE_BUCKETS.entries()) {
      const cells = tables.map((table) => {
        const row = table[index];
        return row === undefined ? "".padStart(18) : `${row.correct}/${row.count} ${pct(row.correct, row.count)}`.padStart(18);
      });
      out.push(`  ${bucket.label.padEnd(10)} ${cells.join("")}`);
    }

    out.push("");
    out.push("  태그별 정확도");
    out.push(...tagLines(runsByJudge));

    if (localRuns !== undefined) {
      out.push("");
      out.push("  local 오답");
      out.push(...missLines(localRuns, runsByJudge));
    }
  }

  out.push("");
  console.log(out.join("\n"));

  const now = new Date();
  const dir = path.join(process.cwd(), "eval-results");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `local-router-${timestamp(now)}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      {
        ranAt: now.toISOString(),
        model: router?.model ?? null,
        timeoutMs: env.LOCAL_LLM_TIMEOUT_MS,
        minConfidence: env.LOCAL_LLM_MIN_CONFIDENCE,
        warmupMs,
        summaries: allSummaries,
        goalRule,
        runs: allRuns,
      },
      null,
      2,
    ),
    "utf8",
  );
  console.log(`결과 JSON → ${path.relative(process.cwd(), file)}`);
});
