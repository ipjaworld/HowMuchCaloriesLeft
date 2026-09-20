import { it } from "vitest";
import { createJevJudge } from "@/ai/judgment/jevJudge";
import { createMockJudge } from "@/ai/judgment/mockJudge";
import { NOUL_THRESHOLDS } from "@/ai/judgment/confidence";
import { contextFor, loadGoldenSet, type GoldenCase } from "@/ai/judgment/goldenSet";
import type { Judge, Judgment } from "@/ai/judgment/types";

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

function pickJudge(): { judge: Judge; name: string } | null {
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

  return { judge: createJevJudge({ apiKey }), name: "jev (TypeSafe API)" };
}

// Timeout comes from vitest.eval.mts; 60 network calls need more than 5s.
it("golden set accuracy", async () => {
    const selected = pickJudge();

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

  report(outcomes, selected.name);
});
