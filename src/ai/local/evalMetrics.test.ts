import { describe, expect, it } from "vitest";
import { agreement, calibration, isCorrect, percentile, summarize, type EvalRun } from "./evalMetrics";

function run(overrides: Partial<EvalRun>): EvalRun {
  return {
    judge: "local",
    dataset: "local-router",
    caseId: "c",
    input: "x",
    expected: "add_food",
    accept: [],
    tags: [],
    predicted: "add_food",
    confidence: 0.9,
    latencyMs: 100,
    failure: null,
    correct: true,
    wouldUse: true,
    fallbackReason: null,
    consumed: true,
    foods: [],
    ...overrides,
  };
}

describe("isCorrect", () => {
  it("takes the expected intent or an accepted alternative, and nothing else", () => {
    expect(isCorrect("ask_status", "ask_status")).toBe(true);
    expect(isCorrect("ask_recommendation", "ask_status", ["ask_recommendation"])).toBe(true);
    expect(isCorrect("other", "ask_status", ["ask_recommendation"])).toBe(false);
    expect(isCorrect(null, "ask_status")).toBe(false);
    expect(isCorrect("unknown", "ask_status")).toBe(false);
  });
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    const values = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(19);
    expect(percentile(values, 50)).toBe(10);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 95)).toBeNull();
  });
});

describe("summarize", () => {
  it("counts failures by kind and leaves them out of latency", () => {
    const summary = summarize([
      run({ caseId: "a", latencyMs: 100 }),
      run({ caseId: "b", latencyMs: 300, correct: false, predicted: "other", wouldUse: true }),
      run({ caseId: "c", latencyMs: 5000, failure: "timeout", predicted: null, correct: false, wouldUse: false }),
      run({ caseId: "d", latencyMs: 2, failure: "parse", predicted: null, correct: false, wouldUse: false }),
      run({ caseId: "e", latencyMs: 2, failure: "schema", predicted: null, correct: false, wouldUse: false }),
      run({ caseId: "f", latencyMs: 200, predicted: "unknown", correct: false, wouldUse: false }),
    ]);

    expect(summary).toMatchObject({
      total: 6,
      correct: 1,
      avgLatencyMs: 200,
      p95LatencyMs: 300,
      parseFailures: 2,
      timeouts: 1,
      unknown: 1,
      wouldUse: 2,
      wouldUseCorrect: 1,
    });
  });

  it("reports no active-mode figures for the other judges", () => {
    const summary = summarize([run({ judge: "jev", wouldUse: null })]);
    expect(summary.wouldUse).toBeNull();
    expect(summary.wouldUseCorrect).toBeNull();
  });
});

describe("calibration", () => {
  it("buckets by confidence, with 0.9 and 1.0 in the top bucket and failures in none", () => {
    const table = calibration([
      run({ confidence: 1 }),
      run({ confidence: 0.9, correct: false }),
      run({ confidence: 0.85 }),
      run({ confidence: 0.7 }),
      run({ confidence: 0.2, correct: false }),
      run({ confidence: null, predicted: null, correct: false }),
    ]);
    expect(table).toEqual([
      { label: ">= 0.9", count: 2, correct: 1 },
      { label: "0.8-0.9", count: 1, correct: 1 },
      { label: "0.7-0.8", count: 1, correct: 1 },
      { label: "< 0.7", count: 1, correct: 0 },
    ]);
  });
});

describe("agreement", () => {
  it("compares only cases both judges answered", () => {
    const local = [
      run({ caseId: "a", predicted: "add_food" }),
      run({ caseId: "b", predicted: "other" }),
      run({ caseId: "c", predicted: null }),
    ];
    const jev = [
      run({ judge: "jev", caseId: "a", predicted: "add_food" }),
      run({ judge: "jev", caseId: "b", predicted: "ask_status" }),
      run({ judge: "jev", caseId: "c", predicted: "other" }),
    ];
    expect(agreement(local, jev)).toEqual({ same: 1, compared: 2 });
  });
});
