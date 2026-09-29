import type { Intent } from "@/ai/judgment/types";
import type { LocalLlmFailure } from "./client";
import type { LocalIntent } from "./router";
import type { FallbackReason } from "./routing";

/**
 * Scoring for `pnpm eval:local-router`. Pure, so the numbers the report
 * prints are the numbers the tests pin.
 */

export type JudgeName = "local" | "mock" | "jev";

/** One judge's answer to one case. */
export type EvalRun = {
  judge: JudgeName;
  dataset: string;
  caseId: string;
  input: string;
  expected: Intent;
  accept: Intent[];
  tags: string[];
  /** Null when the judge gave no answer at all (local failures only). */
  predicted: LocalIntent | null;
  confidence: number | null;
  latencyMs: number;
  failure: LocalLlmFailure | null;
  correct: boolean;
  /**
   * Local only: would `active` mode have used this answer instead of calling
   * the judge? Null for the other judges, which are always used.
   */
  wouldUse: boolean | null;
  fallbackReason: FallbackReason | null;
  /** Local only, and only for its add_food answers. */
  consumed: boolean | null;
  foods: { name: string; quantity: number | null; unit: string | null }[] | null;
};

export function isCorrect(
  predicted: string | null,
  expected: Intent,
  accept: readonly Intent[] = [],
): boolean {
  if (predicted === null) return false;
  return predicted === expected || (accept as readonly string[]).includes(predicted);
}

/** Nearest-rank percentile. `values` need not be sorted. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1] ?? null;
}

export type EvalSummary = {
  judge: JudgeName;
  dataset: string;
  total: number;
  correct: number;
  accuracy: number;
  avgLatencyMs: number | null;
  p95LatencyMs: number | null;
  /** Not JSON, or JSON of the wrong shape. */
  parseFailures: number;
  timeouts: number;
  connectionFailures: number;
  httpFailures: number;
  unknown: number;
  /** Local only: answers `active` would have used — each one a skipped judge call. */
  wouldUse: number | null;
  /** Local only: of those, how many were right. The number that makes `active` safe or not. */
  wouldUseCorrect: number | null;
};

export function summarize(runs: EvalRun[]): EvalSummary {
  const first = runs[0];
  const latencies = runs.filter((r) => r.failure === null).map((r) => r.latencyMs);
  const correct = runs.filter((r) => r.correct).length;
  const local = first?.judge === "local";
  const used = runs.filter((r) => r.wouldUse === true);

  return {
    judge: first?.judge ?? "local",
    dataset: first?.dataset ?? "",
    total: runs.length,
    correct,
    accuracy: runs.length === 0 ? 0 : correct / runs.length,
    avgLatencyMs:
      latencies.length === 0
        ? null
        : Math.round(latencies.reduce((sum, ms) => sum + ms, 0) / latencies.length),
    p95LatencyMs: percentile(latencies, 95),
    parseFailures: runs.filter((r) => r.failure === "parse" || r.failure === "schema").length,
    timeouts: runs.filter((r) => r.failure === "timeout").length,
    connectionFailures: runs.filter((r) => r.failure === "connection").length,
    httpFailures: runs.filter((r) => r.failure === "http").length,
    unknown: runs.filter((r) => r.predicted === "unknown").length,
    wouldUse: local ? used.length : null,
    wouldUseCorrect: local ? used.filter((r) => r.correct).length : null,
  };
}

/** Upper bound exclusive, except the top bucket which includes 1.0. */
export const CONFIDENCE_BUCKETS = [
  { label: ">= 0.9", low: 0.9, high: Infinity },
  { label: "0.8-0.9", low: 0.8, high: 0.9 },
  { label: "0.7-0.8", low: 0.7, high: 0.8 },
  { label: "< 0.7", low: -Infinity, high: 0.7 },
] as const;

/**
 * How well a judge's confidence tracks being right. A self-reported
 * confidence means nothing until this table says so — it is what a threshold
 * like `LOCAL_LLM_MIN_CONFIDENCE` has to be read against.
 */
export function calibration(runs: EvalRun[]): { label: string; count: number; correct: number }[] {
  return CONFIDENCE_BUCKETS.map(({ label, low, high }) => {
    const inBucket = runs.filter(
      (run) => run.confidence !== null && run.confidence >= low && run.confidence < high,
    );
    return { label, count: inBucket.length, correct: inBucket.filter((run) => run.correct).length };
  });
}

/** Of the cases both judges answered, how often they named the same intent. */
export function agreement(a: EvalRun[], b: EvalRun[]): { same: number; compared: number } {
  const byId = new Map(b.map((run) => [run.caseId, run]));
  let same = 0;
  let compared = 0;
  for (const run of a) {
    const other = byId.get(run.caseId);
    if (run.predicted === null || other?.predicted == null) continue;
    compared += 1;
    if (run.predicted === other.predicted) same += 1;
  }
  return { same, compared };
}
