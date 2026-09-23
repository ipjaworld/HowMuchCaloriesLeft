import { it } from "vitest";
import { createJevJudge, type JevCallTelemetry } from "@/ai/judgment/jevJudge";
import { createMockJudge } from "@/ai/judgment/mockJudge";
import { INTENT_THRESHOLDS, NOUL_THRESHOLDS } from "@/ai/judgment/confidence";
import { contextFor, loadGoldenSet, type GoldenCase } from "@/ai/judgment/goldenSet";
import { INTENTS, type Judge, type Judgment } from "@/ai/judgment/types";

/**
 * Golden-set accuracy run. Not a test: it never fails the build, it prints a
 * report. Driven by vitest only because vitest is already here and already
 * resolves TypeScript and the `@/` alias.
 *
 *   pnpm eval:jev                 real Jev, needs TYPESAFE_API_KEY
 *   EVAL_JUDGE=mock pnpm eval:jev the rule-based fallback, as a baseline
 *
 * With no key it says so and stops cleanly, so CI never fails for the want
 * of a secret.
 */

const CONCURRENCY = 5;

type Outcome = {
  testCase: GoldenCase;
  judgment: Judgment;
  intentOk: boolean;
  consumptionOk: boolean;
  clarificationOk: boolean;
  /** Null when the case does not exercise reference resolution. */
  referenceOk: boolean | null;
};

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
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

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => worker()),
  );
  return results;
}

function evaluate(testCase: GoldenCase, judgment: Judgment): Outcome {
  const { expected } = testCase;
  const referencing =
    expected.intent === "modify_food" || expected.intent === "delete_food";

  return {
    testCase,
    judgment,
    intentOk: judgment.intent === expected.intent,
    consumptionOk:
      judgment.actualConsumptionProbability >=
        NOUL_THRESHOLDS.actualConsumption ===
      expected.isActualConsumption,
    clarificationOk:
      judgment.clarificationProbability >=
        NOUL_THRESHOLDS.clarificationNeeded ===
      expected.needsClarification,
    referenceOk: referencing
      ? judgment.referenceTargetId === expected.referenceTargetId
      : null,
  };
}

function percent(hits: number, total: number): string {
  if (total === 0) return "   n/a";
  return `${((hits / total) * 100).toFixed(1).padStart(5)}%`;
}

function report(outcomes: Outcome[], judgeName: string): void {
  const lines: string[] = [];
  const total = outcomes.length;

  lines.push("");
  lines.push(`판정자: ${judgeName}   케이스: ${total}건`);
  lines.push("=".repeat(64));

  const intentHits = outcomes.filter((o) => o.intentOk).length;
  const consumptionHits = outcomes.filter((o) => o.consumptionOk).length;
  const clarificationHits = outcomes.filter((o) => o.clarificationOk).length;
  const referenceCases = outcomes.filter((o) => o.referenceOk !== null);
  const referenceHits = referenceCases.filter((o) => o.referenceOk === true).length;

  lines.push("");
  lines.push("전체 정확도");
  lines.push(`  intent               ${percent(intentHits, total)}  (${intentHits}/${total})`);
  lines.push(
    `  actual_consumption   ${percent(consumptionHits, total)}  (${consumptionHits}/${total})`,
  );
  lines.push(
    `  needs_clarification  ${percent(clarificationHits, total)}  (${clarificationHits}/${total})`,
  );
  lines.push(
    `  reference_target     ${percent(referenceHits, referenceCases.length)}  (${referenceHits}/${referenceCases.length})`,
  );

  lines.push("");
  lines.push("카테고리별 intent 정확도");
  const categories = [...new Set(outcomes.map((o) => o.testCase.category))];
  for (const category of categories) {
    const inCategory = outcomes.filter((o) => o.testCase.category === category);
    const hits = inCategory.filter((o) => o.intentOk).length;
    lines.push(
      `  ${category.padEnd(18)} ${percent(hits, inCategory.length)}  (${hits}/${inCategory.length})`,
    );
  }

  lines.push("");
  lines.push("intent confidence 분포");
  const buckets = [
    [0.95, 1.01],
    [0.9, 0.95],
    [0.7, 0.9],
    [0.5, 0.7],
    [0, 0.5],
  ] as const;
  for (const [low, high] of buckets) {
    const inBucket = outcomes.filter(
      (o) => o.judgment.intentConfidence >= low && o.judgment.intentConfidence < high,
    );
    const hits = inBucket.filter((o) => o.intentOk).length;
    const label = `${low.toFixed(2)}–${high >= 1 ? "1.00" : high.toFixed(2)}`;
    lines.push(
      `  ${label.padEnd(18)} ${String(inBucket.length).padStart(3)}건  정확 ${percent(hits, inBucket.length)}`,
    );
  }

  const consumptionFalsePositives = outcomes.filter(
    (o) =>
      !o.consumptionOk && !o.testCase.expected.isActualConsumption,
  );
  const consumptionFalseNegatives = outcomes.filter(
    (o) => !o.consumptionOk && o.testCase.expected.isActualConsumption,
  );

  lines.push("");
  lines.push(
    `섭취 오탐 (기록되면 안 되는데 기록됨): ${consumptionFalsePositives.length}건`,
  );
  for (const outcome of consumptionFalsePositives) {
    lines.push(
      `  ✗ ${outcome.testCase.id}  "${outcome.testCase.input}"  p=${outcome.judgment.actualConsumptionProbability.toFixed(2)}`,
    );
  }

  lines.push("");
  lines.push(
    `섭취 미탐 (기록돼야 하는데 무시됨): ${consumptionFalseNegatives.length}건`,
  );
  for (const outcome of consumptionFalseNegatives) {
    lines.push(
      `  ✗ ${outcome.testCase.id}  "${outcome.testCase.input}"  p=${outcome.judgment.actualConsumptionProbability.toFixed(2)}`,
    );
  }

  const intentMisses = outcomes.filter((o) => !o.intentOk);
  lines.push("");
  lines.push(`intent 오분류: ${intentMisses.length}건`);
  for (const outcome of intentMisses) {
    lines.push(
      `  ✗ ${outcome.testCase.id.padEnd(9)} "${outcome.testCase.input}"`,
    );
    lines.push(
      `      기대 ${outcome.testCase.expected.intent}  →  실제 ${outcome.judgment.intent} (conf ${outcome.judgment.intentConfidence.toFixed(2)})`,
    );
  }

  const referenceMisses = referenceCases.filter((o) => o.referenceOk === false);
  lines.push("");
  lines.push(`reference_target 오분류: ${referenceMisses.length}건`);
  for (const outcome of referenceMisses) {
    lines.push(
      `  ✗ ${outcome.testCase.id.padEnd(9)} "${outcome.testCase.input}"`,
    );
    lines.push(
      `      기대 ${String(outcome.testCase.expected.referenceTargetId)}  →  실제 ${String(outcome.judgment.referenceTargetId)}`,
    );
  }

  const clarificationMisses = outcomes.filter((o) => !o.clarificationOk);
  lines.push("");
  lines.push(`needs_clarification 오분류: ${clarificationMisses.length}건`);
  for (const outcome of clarificationMisses) {
    lines.push(
      `  ✗ ${outcome.testCase.id.padEnd(9)} "${outcome.testCase.input}"  기대 ${String(outcome.testCase.expected.needsClarification)}  p=${outcome.judgment.clarificationProbability.toFixed(2)}`,
    );
  }

  lines.push("");
  lines.push("=".repeat(64));

  console.log(lines.join("\n"));
}


/** Cases called out in the handoff as the ones worth reading individually. */
const FOCUS_IDS = [
  "non-001", // 갈비탕 칼로리 높은 편이야?  — 비섭취 질문
  "non-004", // 제육 먹어도 될까?          — 추천
  "mod-001", // 아까 밥 반만 먹었어        — 수정 + reference
  "del-003", // 커피는 안 마셨음            — 삭제 + 커피↔아메리카노 동의어
  "del-002", // 아까 커피 먹었다고 한 거 취소 — 같은 동의어 경로
  "amb-004", // 그거 취소                  — 모호한 지시대명사
  "del-004", // 방금 넣은 거 취소해줘        — “방금” 최신 항목 지시
];

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[index] ?? 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Confidence broken out per predicted intent, because one pooled histogram
 * hides the thing the thresholds are actually set from: `delete_food` can sit
 * in a different band than `add_food` at the same overall accuracy.
 */
function reportPerIntentConfidence(outcomes: Outcome[]): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("예측 intent별 confidence 분포 (threshold 재조정 근거)");
  lines.push("  intent               건수  최소  중앙  최대   정확     auto/confirm");

  for (const intent of INTENTS) {
    const predicted = outcomes.filter((o) => o.judgment.intent === intent);
    if (predicted.length === 0) continue;

    const confidences = predicted
      .map((o) => o.judgment.intentConfidence)
      .sort((a, b) => a - b);
    const hits = predicted.filter((o) => o.intentOk).length;
    const thresholds = INTENT_THRESHOLDS[intent];

    lines.push(
      `  ${intent.padEnd(20)}${String(predicted.length).padStart(3)}  ` +
        `${quantile(confidences, 0).toFixed(2)}  ` +
        `${quantile(confidences, 0.5).toFixed(2)}  ` +
        `${quantile(confidences, 1).toFixed(2)}  ` +
        `${percent(hits, predicted.length)}    ` +
        `${thresholds.auto.toFixed(2)} / ${thresholds.confirm.toFixed(2)}`,
    );
  }

  // The number that decides the destructive threshold: among everything the
  // model called delete, how much confidence did the wrong ones carry?
  const wrongDeletes = outcomes.filter(
    (o) => o.judgment.intent === "delete_food" && !o.intentOk,
  );
  lines.push("");
  lines.push(
    `  delete_food 오탐 ${wrongDeletes.length}건` +
      (wrongDeletes.length === 0
        ? ""
        : ` — 최고 conf ${Math.max(
            ...wrongDeletes.map((o) => o.judgment.intentConfidence),
          ).toFixed(2)}`),
  );
  const missedDeletes = outcomes.filter(
    (o) => o.testCase.expected.intent === "delete_food" && !o.intentOk,
  );
  lines.push(`  delete_food 미탐 ${missedDeletes.length}건`);

  return lines;
}

function reportReferenceConfidence(outcomes: Outcome[]): string[] {
  const lines: string[] = [];
  const scored = outcomes.filter((o) => o.referenceOk !== null);

  lines.push("");
  lines.push("reference confidence");

  const correct = scored
    .filter((o) => o.referenceOk === true && o.judgment.referenceConfidence !== null)
    .map((o) => o.judgment.referenceConfidence ?? 0)
    .sort((a, b) => a - b);
  const wrong = scored
    .filter((o) => o.referenceOk === false && o.judgment.referenceConfidence !== null)
    .map((o) => o.judgment.referenceConfidence ?? 0)
    .sort((a, b) => a - b);

  if (correct.length === 0 && wrong.length === 0) {
    lines.push("  (reference 질문이 한 번도 실행되지 않음)");
    return lines;
  }

  lines.push(
    `  정답 ${String(correct.length).padStart(2)}건  최소 ${quantile(correct, 0).toFixed(2)}  중앙 ${quantile(correct, 0.5).toFixed(2)}  최대 ${quantile(correct, 1).toFixed(2)}`,
  );
  lines.push(
    `  오답 ${String(wrong.length).padStart(2)}건  최소 ${quantile(wrong, 0).toFixed(2)}  중앙 ${quantile(wrong, 0.5).toFixed(2)}  최대 ${quantile(wrong, 1).toFixed(2)}`,
  );
  lines.push(
    "  → 오답 최고 conf 가 정답 최소 conf 보다 높으면 임계값으로 갈라낼 수 없음",
  );

  return lines;
}

/**
 * Jev against the rule-based fallback on the same 60 cases. The mock's own
 * score is not evidence about Jev — its rules were written against this
 * fixture — but the *disagreements* are: they are exactly where swapping the
 * judge changes what the app does.
 */
function reportMockDiff(jev: Outcome[], mock: Outcome[]): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("mock 대비 차이");

  const byId = new Map(mock.map((o) => [o.testCase.id, o]));
  const jevOnly: Outcome[] = [];
  const mockOnly: Outcome[] = [];
  const bothWrong: Outcome[] = [];

  for (const outcome of jev) {
    const other = byId.get(outcome.testCase.id);
    if (other === undefined) continue;
    if (outcome.intentOk && !other.intentOk) jevOnly.push(outcome);
    else if (!outcome.intentOk && other.intentOk) mockOnly.push(outcome);
    else if (!outcome.intentOk && !other.intentOk) bothWrong.push(outcome);
  }

  const refJevOnly = jev.filter((o) => {
    const other = byId.get(o.testCase.id);
    return o.referenceOk === true && other?.referenceOk === false;
  });
  const refMockOnly = jev.filter((o) => {
    const other = byId.get(o.testCase.id);
    return o.referenceOk === false && other?.referenceOk === true;
  });

  const mockIntent = mock.filter((o) => o.intentOk).length;
  const mockRefCases = mock.filter((o) => o.referenceOk !== null);
  const mockRef = mockRefCases.filter((o) => o.referenceOk === true).length;
  const jevIntent = jev.filter((o) => o.intentOk).length;
  const jevRefCases = jev.filter((o) => o.referenceOk !== null);
  const jevRef = jevRefCases.filter((o) => o.referenceOk === true).length;

  lines.push(
    `  intent     jev ${percent(jevIntent, jev.length)}  vs  mock ${percent(mockIntent, mock.length)}`,
  );
  lines.push(
    `  reference  jev ${percent(jevRef, jevRefCases.length)}  vs  mock ${percent(mockRef, mockRefCases.length)}`,
  );
  lines.push(
    `  intent — jev만 맞음 ${jevOnly.length}건 / mock만 맞음 ${mockOnly.length}건 / 둘 다 틀림 ${bothWrong.length}건`,
  );
  for (const outcome of mockOnly) {
    lines.push(
      `    ↓ jev 퇴보  ${outcome.testCase.id.padEnd(9)} "${outcome.testCase.input}" → ${outcome.judgment.intent}`,
    );
  }
  for (const outcome of jevOnly) {
    lines.push(
      `    ↑ jev 개선  ${outcome.testCase.id.padEnd(9)} "${outcome.testCase.input}"`,
    );
  }
  lines.push(
    `  reference — jev만 맞음 ${refJevOnly.length}건 / mock만 맞음 ${refMockOnly.length}건`,
  );
  for (const outcome of refMockOnly) {
    lines.push(
      `    ↓ jev 퇴보  ${outcome.testCase.id.padEnd(9)} "${outcome.testCase.input}"`,
    );
  }
  for (const outcome of refJevOnly) {
    lines.push(
      `    ↑ jev 개선  ${outcome.testCase.id.padEnd(9)} "${outcome.testCase.input}"`,
    );
  }

  return lines;
}

function reportFocusCases(jev: Outcome[], mock: Outcome[]): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("중점 확인 케이스");
  const byId = new Map(mock.map((o) => [o.testCase.id, o]));

  for (const id of FOCUS_IDS) {
    const outcome = jev.find((o) => o.testCase.id === id);
    if (outcome === undefined) {
      lines.push(`  ? ${id} — 골든셋에 없음`);
      continue;
    }
    const input = outcome.testCase.input;
    const mark = outcome.intentOk ? "✓" : "✗";
    const other = byId.get(outcome.testCase.id);
    lines.push(`  ${mark} "${input}"  [${outcome.testCase.id}]`);
    lines.push(
      `      intent  기대 ${outcome.testCase.expected.intent}  →  jev ${outcome.judgment.intent} (conf ${outcome.judgment.intentConfidence.toFixed(2)})` +
        (other === undefined ? "" : `  ·  mock ${other.judgment.intent}`),
    );
    lines.push(
      `      consumption p=${outcome.judgment.actualConsumptionProbability.toFixed(2)} (기대 ${String(outcome.testCase.expected.isActualConsumption)})` +
        `  ·  clarification p=${outcome.judgment.clarificationProbability.toFixed(2)} (기대 ${String(outcome.testCase.expected.needsClarification)})`,
    );
    if (outcome.referenceOk !== null) {
      lines.push(
        `      reference 기대 ${String(outcome.testCase.expected.referenceTargetId)} → jev ${String(outcome.judgment.referenceTargetId)}` +
          ` (conf ${outcome.judgment.referenceConfidence?.toFixed(2) ?? "n/a"})` +
          (other === undefined
            ? ""
            : `  ·  mock ${String(other.judgment.referenceTargetId)}`),
      );
    }
  }

  return lines;
}

/** Published Jev input rate. Output tokens are free, so they carry no cost. */
const JEV_INPUT_USD_PER_MTOK = 0.042;

/**
 * Latency here is wall clock around each call while `CONCURRENCY` of them are
 * in flight, so read it as throughput under load, not a single-call floor.
 */
function reportTelemetry(telemetry: JevCallTelemetry[], wallMs: number): string[] {
  const lines: string[] = [];
  lines.push("");
  lines.push("latency / usage");

  if (telemetry.length === 0) {
    lines.push("  (수집된 호출 없음 — mock 실행)");
    return lines;
  }

  const latencies = telemetry.map((t) => t.latencyMs).sort((a, b) => a - b);
  const inputTokens = telemetry.reduce((sum, t) => sum + t.inputTokens, 0);
  const outputTokens = telemetry.reduce((sum, t) => sum + t.outputTokens, 0);
  const models = [...new Set(telemetry.map((t) => t.model))];
  const withReference = telemetry.filter((t) => t.candidateCount > 0);
  const withoutReference = telemetry.filter((t) => t.candidateCount === 0);

  lines.push(`  모델            ${models.join(", ")}`);
  lines.push(`  호출 수         ${telemetry.length}건 (동시성 ${CONCURRENCY})`);
  lines.push(
    `  latency         최소 ${quantile(latencies, 0)}ms  p50 ${quantile(latencies, 0.5)}ms  p90 ${quantile(latencies, 0.9)}ms  최대 ${quantile(latencies, 1)}ms`,
  );
  lines.push(
    `    reference 포함 ${withReference.length}건 평균 ${Math.round(mean(withReference.map((t) => t.latencyMs)))}ms` +
      `  ·  미포함 ${withoutReference.length}건 평균 ${Math.round(mean(withoutReference.map((t) => t.latencyMs)))}ms`,
  );
  lines.push(`  전체 벽시계     ${(wallMs / 1000).toFixed(1)}s`);
  lines.push(
    `  input tokens    ${inputTokens} (호출당 평균 ${Math.round(inputTokens / telemetry.length)})`,
  );
  lines.push(`  output tokens   ${outputTokens}`);
  lines.push(
    `  input 비용      $${((inputTokens / 1_000_000) * JEV_INPUT_USD_PER_MTOK).toFixed(6)}  (@ $${JEV_INPUT_USD_PER_MTOK}/1M, output 무료)`,
  );

  return lines;
}

function pickJudge(telemetry: JevCallTelemetry[]): {
  judge: Judge;
  name: string;
} | null {
  // Node reads .env.local itself; no dotenv dependency for one file.
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // No .env.local — the key may still come from the real environment.
  }

  const requested = process.env["EVAL_JUDGE"];

  if (requested === "mock") {
    return { judge: createMockJudge(), name: "mock (규칙 기반 fallback)" };
  }

  const apiKey = process.env["TYPESAFE_API_KEY"]?.trim();
  if (apiKey === undefined || apiKey === "") return null;

  return {
    judge: createJevJudge({
      apiKey,
      onCall: (call) => telemetry.push(call),
    }),
    name: "jev (TypeSafe API)",
  };
}

// Timeout comes from vitest.eval.mts; 60 network calls need more than 5s.
it("golden set accuracy", async () => {
    const telemetry: JevCallTelemetry[] = [];
    const selected = pickJudge(telemetry);

    if (selected === null) {
      console.log(
        [
          "",
          "TYPESAFE_API_KEY 가 없어 Jev 평가를 건너뜁니다.",
          "",
          "  실제 Jev로 측정하려면 .env.local 에 키를 넣고 다시 실행하세요.",
          "  규칙 기반 fallback의 기준선만 보려면:  EVAL_JUDGE=mock pnpm eval:jev",
          "",
        ].join("\n"),
      );
      return;
    }

    const goldenSet = loadGoldenSet();

    const startedAt = Date.now();
    const outcomes = await mapWithConcurrency(
      goldenSet.cases,
      CONCURRENCY,
      async (testCase) => {
        const context = contextFor(goldenSet, testCase);
        const judgment = await selected.judge.judge({
          message: testCase.input,
          now: context.now,
          dailyGoalCalories: context.dailyGoalCalories,
          recentItems: context.recentItems,
        });
        return evaluate(testCase, judgment);
      },
    );

    const wallMs = Date.now() - startedAt;

  report(outcomes, selected.name);

  // The rule-based fallback runs locally and costs nothing, so the diff is
  // always available alongside a real run.
  const mockJudge = createMockJudge();
  const mockOutcomes = await mapWithConcurrency(
    goldenSet.cases,
    1,
    async (testCase) => {
      const context = contextFor(goldenSet, testCase);
      return evaluate(
        testCase,
        await mockJudge.judge({
          message: testCase.input,
          now: context.now,
          dailyGoalCalories: context.dailyGoalCalories,
          recentItems: context.recentItems,
        }),
      );
    },
  );

  console.log(
    [
      ...reportPerIntentConfidence(outcomes),
      ...reportReferenceConfidence(outcomes),
      ...reportMockDiff(outcomes, mockOutcomes),
      ...reportFocusCases(outcomes, mockOutcomes),
      ...reportTelemetry(telemetry, wallMs),
      "",
      "=".repeat(64),
    ].join("\n"),
  );

  // `EVAL_DUMP=path pnpm eval:jev` writes every raw number to JSON, so
  // threshold questions can be re-asked of one run instead of billing a new
  // one each time. Off by default.
  const dumpPath = process.env["EVAL_DUMP"];
  if (dumpPath !== undefined && dumpPath !== "") {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      dumpPath,
      JSON.stringify(
        {
          judge: selected.name,
          model: telemetry[0]?.model ?? null,
          cases: outcomes.map((o) => ({
            id: o.testCase.id,
            category: o.testCase.category,
            input: o.testCase.input,
            expected: o.testCase.expected,
            jev: o.judgment,
            mock: mockOutcomes.find((m) => m.testCase.id === o.testCase.id)
              ?.judgment,
            intentOk: o.intentOk,
            consumptionOk: o.consumptionOk,
            clarificationOk: o.clarificationOk,
            referenceOk: o.referenceOk,
          })),
          telemetry,
        },
        null,
        2,
      ),
      "utf8",
    );
    console.log(`\nraw dump → ${dumpPath}`);
  }
});
