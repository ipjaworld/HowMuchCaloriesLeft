import { writeFileSync } from "node:fs";
import { TypeSafeClient, type Questions } from "@typesafe-ai/sdk";
import { it } from "vitest";
import { createJevCandidateJudge, type CandidateCallTelemetry } from "@/ai/judgment/candidateJudge";
import { createJevJudge } from "@/ai/judgment/jevJudge";
import { INTENTS, type Judgment, type JudgmentInput, type RecentItem } from "@/ai/judgment/types";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { resolveAddParts, type AddPart } from "@/application/addFood";
import type { CandidateFilterReport } from "@/application/candidateFilter";
import { runChat } from "@/application/chatPipeline";
import type { Command } from "@/application/commands";
import {
  EXCLUDED_CATEGORIES,
  evaluateCase,
  isCorrect,
  loadCoverageCorpus,
  summarize,
  type CaseResult,
  type CoverageCase,
} from "@/application/foodCoverage";

/**
 * Phase 8 — how far Jev can be trusted with food-level judgments.
 *
 *   pnpm eval:food-judgment                  needs TYPESAFE_API_KEY
 *   EVAL_DUMP=path pnpm eval:food-judgment   also write every raw number to JSON
 *
 * 8A  The production path with the per-food filter on: every corpus sentence
 *     goes through `runChat` — the function `/api/chat` calls — with the real
 *     judge and the real candidate judge, two requests per sentence as in the
 *     app. "Without 8A" is read off the same run: the same production
 *     judgment, with the parser's parts unfiltered, which is exactly what
 *     the app does with the filter off.
 *
 * 8B  The same sentence under three logs — empty, same food already
 *     recorded, a different food recorded — to see how the add/modify
 *     judgment moves with context.
 */

const CONCURRENCY = 5;
/** Same published rate as `evalJev.eval.ts`. Output tokens are free. */
const JEV_INPUT_USD_PER_MTOK = 0.042;
/** The production default (`FOOD_CANDIDATE_TIMEOUT_MS`). */
const CANDIDATE_TIMEOUT_MS = 1500;
const NOW = "2026-10-01T12:30:00+09:00";
const DAILY_GOAL = 1800;
const REPEATS_8B = 3;

// ───────────────────────────── recording judge ─────────────────────────────

type RawCall = {
  answers: Record<string, unknown>;
  inputTokens: number;
  model: string;
  latencyMs: number;
};

/**
 * The production judge over a client that keeps the raw answers — which
 * `Judgment` does not carry, like the intent distribution — and the usage.
 */
function recordingJudge(real: TypeSafeClient, sink: (call: RawCall) => void) {
  const client = {
    async systemOne(request: { state: unknown; questions: Questions }) {
      const startedAt = Date.now();
      const result = await real.systemOne(request as Parameters<TypeSafeClient["systemOne"]>[0]);
      sink({
        answers: result.answers as Record<string, unknown>,
        inputTokens: result.usage.input_tokens,
        model: result.model,
        latencyMs: Date.now() - startedAt,
      });
      return result;
    },
  } as unknown as TypeSafeClient;
  return createJevJudge({ client });
}

function intentProbabilities(raw: RawCall): Record<string, number> {
  const answer = raw.answers["intent"] as { probabilities?: Record<string, number> } | undefined;
  return answer?.probabilities ?? {};
}

// ───────────────────────────── helpers ─────────────────────────────

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let cursor = 0;
  async function worker() {
    for (;;) {
      const index = cursor++;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await fn(item);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()));
  return results;
}

function quantile(values: number[], q: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0;
}

function pct(hits: number, total: number): string {
  return total === 0 ? "  n/a" : `${((hits / total) * 100).toFixed(1)}%`;
}

const usd = (tokens: number) => (tokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK;
const mean = (values: number[]) => values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);

function emptyInput(message: string, recentItems: RecentItem[] = []): JudgmentInput {
  return { message, now: NOW, dailyGoalCalories: DAILY_GOAL, recentItems };
}

// ───────────────────────────── 8A ─────────────────────────────

type CaseRun = {
  testCase: CoverageCase;
  command: Command;
  judgment: Judgment;
  report: CandidateFilterReport | undefined;
  /** What the app records and asks with the filter off, from the same judgment. */
  without: CaseResult;
  /** …and with it on. */
  withFilter: CaseResult;
  production: RawCall;
  candidate: CandidateCallTelemetry | null;
  /** Wall clock of the whole `runChat`, both requests included. */
  wallMs: number;
};

/** The parts the app would act on for this command; anything else records and asks nothing. */
function actedOn(command: Command): AddPart[] {
  return command.type === "add" ? command.parts : [];
}

async function run8A(real: TypeSafeClient, cases: CoverageCase[]): Promise<CaseRun[]> {
  return mapWithConcurrency(cases, CONCURRENCY, async (testCase) => {
    let production: RawCall | null = null;
    let candidate: CandidateCallTelemetry | null = null;
    const input = emptyInput(testCase.input);

    const startedAt = Date.now();
    const result = await runChat(input, undefined, {
      judge: recordingJudge(real, (call) => {
        production = call;
      }),
      resolver: koreanFoodResolver,
      candidateJudge: createJevCandidateJudge({
        client: real,
        timeoutMs: CANDIDATE_TIMEOUT_MS,
        onCall: (call) => {
          candidate = call;
        },
      }),
    });
    const wallMs = Date.now() - startedAt;
    if (production === null) throw new Error("no production call recorded");

    // Filter off: the same decision, with the parser's parts as they were.
    const unfiltered =
      result.command.type === "add" ? await resolveAddParts(testCase.input, koreanFoodResolver) : [];

    return {
      testCase,
      command: result.command,
      judgment: result.judgment,
      report: result.candidateFilter,
      without: evaluateCase(testCase, unfiltered),
      withFilter: evaluateCase(testCase, actedOn(result.command)),
      production,
      candidate,
      wallMs,
    };
  });
}

function row(name: string, results: CaseResult[]): string {
  const s = summarize(results);
  return `  ${name.padEnd(22)} ${`${s.correct}/${s.total}`.padStart(7)} ${pct(s.correct, s.total).padStart(6)}   wrong ${String(s.silentWrong).padStart(2)}  drop ${String(s.silentDrop).padStart(2)}  nothing ${String(s.byVerdict.nothing_found).padStart(2)}   필요 ${String(s.asks.valid).padStart(3)}  불필요 ${String(s.asks.unnecessary).padStart(3)}`;
}

function report8A(runs: CaseRun[]): string[] {
  const lines: string[] = [];
  const counted = runs.filter((run) => !EXCLUDED_CATEGORIES.has(run.testCase.category));

  lines.push("", "═".repeat(78), "8A — production 경로 (runChat), 후보 필터 off vs on", "═".repeat(78));
  lines.push(`case ${counted.length}건 (범위 밖 ${runs.length - counted.length}건 제외) · 두 열은 같은 production 판단을 공유`);
  lines.push("");
  lines.push(row("8A 없는 production", counted.map((run) => run.without)));
  lines.push(row("8A spike (필터 on)", counted.map((run) => run.withFilter)));

  lines.push("", "태그별");
  for (const tag of ["b2_round1", "b2_blind", "b2_review"]) {
    const tagged = counted.filter((run) => (run.testCase.tags ?? []).includes(tag));
    if (tagged.length === 0) continue;
    lines.push(`  [${tag}]`);
    lines.push(row("  8A 없음", tagged.map((run) => run.without)));
    lines.push(row("  8A spike", tagged.map((run) => run.withFilter)));
  }

  // Which way each case moved, so nothing gets worse unnoticed.
  const worse = counted.filter((run) => isCorrect(run.without.verdict) && !isCorrect(run.withFilter.verdict));
  const better = counted.filter((run) => !isCorrect(run.without.verdict) && isCorrect(run.withFilter.verdict));
  lines.push("", `필터로 나아진 case ${better.length}건 · 나빠진 case ${worse.length}건`);
  for (const run of worse) {
    lines.push(`  ! 나빠짐 ${run.testCase.id} "${run.testCase.input}" ${run.without.verdict} → ${run.withFilter.verdict}`);
  }

  const reports = counted.map((run) => run.report);
  const sent = reports.filter((r) => r?.status === "applied" || r?.status === "failed").length;
  const failed = reports.filter((r) => r?.status === "failed");
  const dropped = counted.flatMap((run) =>
    run.report?.status === "applied" ? run.report.dropped.map((phrase) => `${run.testCase.id} "${phrase}"`) : [],
  );
  lines.push("", "필터 동작");
  lines.push(`  add로 간 문장 ${reports.filter((r) => r !== undefined).length}건 · 후보 요청 발생 ${sent}건 (전체 문장의 ${pct(sent, counted.length)}) · 실패→fallback ${failed.length}건`);
  lines.push(`  질문에서 뺀 구절 ${dropped.length}개: ${dropped.join(", ")}`);
  for (const r of failed) if (r?.status === "failed") lines.push(`  · 실패: ${r.error}`);

  lines.push("", "남은 실패 — 8A spike");
  for (const run of counted) {
    const result = run.withFilter;
    if (isCorrect(result.verdict) && result.asks.unnecessary === 0) continue;
    lines.push(
      `  [${result.verdict}] 불필요 ${result.asks.unnecessary}  ${run.testCase.id} "${run.testCase.input}"  ⟶  ${result.actual.length === 0 ? `(없음: ${run.command.type})` : result.actual.join(" ; ")}`,
    );
  }

  // The same accounting the app would see: every sentence pays the intent
  // request; only those with something unsettled pay the second.
  const withCandidate = counted.filter((run) => run.candidate !== null);
  const prodLat = counted.map((run) => run.production.latencyMs);
  const candLat = withCandidate.map((run) => run.candidate?.latencyMs ?? 0);
  const wall = counted.map((run) => run.wallMs);
  const wallWith = withCandidate.map((run) => run.wallMs);
  const prodTok = counted.map((run) => run.production.inputTokens);
  const candTok = withCandidate.map((run) => run.candidate?.inputTokens ?? 0);
  const perSentence = mean(counted.map((run) => run.production.inputTokens + (run.candidate?.inputTokens ?? 0)));
  lines.push("", `비용 / latency (동시성 ${CONCURRENCY}, 모델 ${[...new Set(counted.map((r) => r.production.model))].join(", ")})`);
  lines.push(`  production 요청        p50 ${quantile(prodLat, 0.5)}ms  p90 ${quantile(prodLat, 0.9)}ms · input 평균 ${Math.round(mean(prodTok))} tok · $${usd(mean(prodTok)).toFixed(6)}`);
  lines.push(`  후보 요청 (${withCandidate.length}건)     p50 ${quantile(candLat, 0.5)}ms  p90 ${quantile(candLat, 0.9)}ms · input 평균 ${Math.round(mean(candTok))} tok · $${usd(mean(candTok)).toFixed(6)}`);
  lines.push(`  runChat 전체 (모든 문장) p50 ${quantile(wall, 0.5)}ms  p90 ${quantile(wall, 0.9)}ms`);
  lines.push(`  runChat (후보 요청 있음) p50 ${quantile(wallWith, 0.5)}ms  p90 ${quantile(wallWith, 0.9)}ms`);
  lines.push(`  문장당 평균 비용        ${Math.round(perSentence)} tok · $${usd(perSentence).toFixed(6)}  (production 단독 $${usd(mean(prodTok)).toFixed(6)})`);

  return lines;
}

// ───────────────────────────── 8B ─────────────────────────────

type Context = "none" | "same" | "other";

type Probe = {
  input: string;
  /** The food already logged in the "same" context. */
  sameFood: string;
  /** Expected intent per context; null where either reading is defensible. */
  expected: Record<Context, "add_food" | "modify_food" | null>;
  note: string;
};

const PROBES: Probe[] = [
  {
    input: "떡볶이 먹으려다 참고 샐러드 먹었어",
    sameFood: "떡볶이",
    expected: { none: "add_food", same: "add_food", other: "add_food" },
    note: "handoff: 같은 음식 기록 시 add 0.33~0.35",
  },
  {
    input: "떡볶이랑 튀김 먹었는데 떡볶이는 반만",
    sameFood: "떡볶이",
    expected: { none: "add_food", same: null, other: "add_food" },
    note: "modify로 가도 튀김은 extraParts로 남아야 함",
  },
  {
    input: "비빔밥 먹었는데 조금 남겼어",
    sameFood: "비빔밥",
    expected: { none: "add_food", same: null, other: "add_food" },
    note: "handoff: 같은 현상",
  },
  {
    input: "떡볶이 말고 샐러드 먹었어",
    sameFood: "떡볶이",
    expected: { none: "add_food", same: "modify_food", other: "add_food" },
    note: "대조: 기록이 있으면 정정이 맞는 문장",
  },
  {
    input: "아까 떡볶이 반만 먹었어",
    sameFood: "떡볶이",
    expected: { none: "add_food", same: "modify_food", other: "add_food" },
    note: "대조: 전형적인 정정",
  },
  {
    input: "떡볶이 먹었어",
    sameFood: "떡볶이",
    expected: { none: "add_food", same: "add_food", other: "add_food" },
    note: "대조: 단순 보고 (같은 음식 한 번 더)",
  },
];

/** A logged entry exactly as the app would have stored "<name> 먹었어". */
async function recentItemFor(name: string, id: string): Promise<RecentItem> {
  const [part] = await resolveAddParts(`${name} 먹었어`, koreanFoodResolver);
  if (part?.status !== "resolved") throw new Error(`${name} does not resolve on its own`);
  return {
    id,
    name: part.item.name,
    ...(part.item.amount === undefined ? {} : { amount: part.item.amount }),
    calories: part.item.calories,
    mealType: "lunch",
    consumedAt: "2026-10-01T11:40:00+09:00",
  };
}

async function contextItems(probe: Probe, context: Context): Promise<RecentItem[]> {
  if (context === "none") return [];
  if (context === "same") return [await recentItemFor(probe.sameFood, "rec-same")];
  return [await recentItemFor("김밥", "rec-other")];
}

type ProbeRun = {
  probe: Probe;
  context: Context;
  repeat: number;
  judgment: Judgment;
  probabilities: Record<string, number>;
  command: Command;
};

async function run8B(real: TypeSafeClient): Promise<ProbeRun[]> {
  const jobs: { probe: Probe; context: Context; repeat: number }[] = [];
  for (const probe of PROBES) {
    for (const context of ["none", "same", "other"] as const) {
      for (let repeat = 0; repeat < REPEATS_8B; repeat++) jobs.push({ probe, context, repeat });
    }
  }
  return mapWithConcurrency(jobs, CONCURRENCY, async ({ probe, context, repeat }) => {
    const input = emptyInput(probe.input, await contextItems(probe, context));
    let raw: RawCall | null = null;
    const result = await runChat(input, undefined, {
      judge: recordingJudge(real, (call) => {
        raw = call;
      }),
      resolver: koreanFoodResolver,
      candidateJudge: null,
    });
    if (raw === null) throw new Error("no call recorded");
    return {
      probe,
      context,
      repeat,
      judgment: result.judgment,
      probabilities: intentProbabilities(raw),
      command: result.command,
    };
  });
}

function describeCommand(command: Command): string {
  if (command.type === "modify_candidate") {
    const extra = command.extraParts?.length ?? 0;
    return `modify${command.needsConfirmation ? "?" : ""}${extra > 0 ? `+추가${extra}` : ""}`;
  }
  if (command.type === "add") return `add${command.needsConfirmation ? "?" : ""}`;
  if (command.type === "clarify") return `clarify:${command.reason}`;
  if (command.type === "ignore") return `ignore:${command.reason}`;
  return command.type;
}

function report8B(runs: ProbeRun[]): string[] {
  const lines: string[] = [];
  lines.push("", "═".repeat(78), `8B — 같은 문장, 기록 맥락만 바꿈 (각 ${REPEATS_8B}회, production runChat)`, "═".repeat(78));
  lines.push("  맥락: none=빈 기록 · same=같은 음식 기록됨 · other=다른 음식(김밥) 기록됨 · modify+추가N = 정정과 함께 새로 기록할 음식 N개");

  let scored = 0;
  let hits = 0;
  for (const probe of PROBES) {
    lines.push("", `"${probe.input}"  — ${probe.note}`);
    for (const context of ["none", "same", "other"] as const) {
      const cell = runs.filter((run) => run.probe === probe && run.context === context);
      const expected = probe.expected[context];
      const avg = (key: string) => cell.reduce((sum, run) => sum + (run.probabilities[key] ?? 0), 0) / cell.length;
      if (expected !== null) {
        scored += cell.length;
        hits += cell.filter((run) => run.judgment.intent === expected).length;
      }
      const mark = expected === null ? "~" : cell.every((run) => run.judgment.intent === expected) ? "✓" : "✗";
      lines.push(
        `  ${mark} ${context.padEnd(5)} P(add) ${avg("add_food").toFixed(2)}  P(modify) ${avg("modify_food").toFixed(2)}  P(other) ${avg("other").toFixed(2)}  ` +
          `→ ${cell.map((run) => describeCommand(run.command)).join(" / ")}  (기대 ${expected ?? "둘 다 가능"})`,
      );
    }
  }
  lines.push("", `기대가 정해진 칸의 intent(argmax) 정확도: ${pct(hits, scored)} (${hits}/${scored})`);
  lines.push(`INTENTS: ${INTENTS.join(", ")}`);
  return lines;
}

// ───────────────────────────── main ─────────────────────────────

it("phase 8 — Jev food-level judgment", async () => {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // The key may come from the real environment.
  }
  const apiKey = process.env["TYPESAFE_API_KEY"]?.trim();
  if (apiKey === undefined || apiKey === "") {
    console.log("\nTYPESAFE_API_KEY 가 없어 Phase 8 측정을 건너뜁니다.\n");
    return;
  }
  const real = new TypeSafeClient({ apiKey });

  const cases = loadCoverageCorpus();
  const startedAt = Date.now();
  const runs8A = await run8A(real, cases);
  const runs8B = await run8B(real);
  const wallMs = Date.now() - startedAt;

  const lines = [...report8A(runs8A), ...report8B(runs8B)];
  const candidateCalls = runs8A.filter((run) => run.candidate !== null).length;
  lines.push("", `전체 벽시계 ${(wallMs / 1000).toFixed(1)}s · 8A 호출 ${runs8A.length + candidateCalls}건 · 8B 호출 ${runs8B.length}건`);
  console.log(lines.join("\n"));


  const dumpPath = process.env["EVAL_DUMP"];
  if (dumpPath !== undefined && dumpPath !== "") {
    writeFileSync(
      dumpPath,
      JSON.stringify(
        {
          runs8A: runs8A.map((run) => ({
            id: run.testCase.id,
            input: run.testCase.input,
            tags: run.testCase.tags ?? [],
            command: run.command.type,
            judgment: run.judgment,
            report: run.report ?? null,
            without: { verdict: run.without.verdict, actual: run.without.actual, asks: run.without.asks },
            withFilter: { verdict: run.withFilter.verdict, actual: run.withFilter.actual, asks: run.withFilter.asks },
            production: { tokens: run.production.inputTokens, ms: run.production.latencyMs },
            candidate: run.candidate,
            wallMs: run.wallMs,
          })),
          runs8B: runs8B.map((run) => ({
            input: run.probe.input,
            context: run.context,
            repeat: run.repeat,
            judgment: run.judgment,
            probabilities: run.probabilities,
            command: describeCommand(run.command),
          })),
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`\nraw dump → ${dumpPath}`);
  }
});
