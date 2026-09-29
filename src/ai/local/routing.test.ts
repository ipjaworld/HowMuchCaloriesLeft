import { describe, expect, it, vi } from "vitest";
import type { Judge, Judgment, JudgmentInput } from "@/ai/judgment/types";
import type { LocalLlmResult } from "./client";
import type { LocalRoute, LocalRouter } from "./router";
import {
  acceptLocal,
  createRoutedJudge,
  effectiveLocalMode,
  withLocalRouter,
  type LocalRouterEnv,
} from "./routing";

const input: JudgmentInput = {
  message: "아침에 계란 두 개 먹었어",
  now: "2026-09-20T09:00:00+09:00",
  dailyGoalCalories: 2000,
  recentItems: [],
};

const JEV: Judgment = {
  intent: "add_food",
  intentConfidence: 0.97,
  actualConsumptionProbability: 0.95,
  clarificationProbability: 0.2,
  referenceTargetId: null,
  referenceConfidence: null,
  source: "jev",
};

function legacyJudge(judgment: Judgment = JEV) {
  const judge = vi.fn(async () => judgment);
  return { judge } satisfies Judge;
}

function route(overrides: Partial<LocalRoute> = {}): LocalLlmResult<LocalRoute> {
  return {
    ok: true,
    latencyMs: 300,
    data: {
      intent: "add_food",
      confidence: 0.93,
      consumed: true,
      entities: { foods: [{ name: "계란", quantity: 2, unit: "개" }] },
      ...overrides,
    },
  };
}

function localRouter(result: LocalLlmResult<LocalRoute>): LocalRouter & { route: ReturnType<typeof vi.fn> } {
  return { model: "test-model", route: vi.fn(async () => result) };
}

const failure = (reason: "connection" | "timeout" | "parse" | "schema"): LocalLlmResult<LocalRoute> => ({
  ok: false,
  reason,
  detail: "",
  latencyMs: reason === "timeout" ? 5000 : 3,
});

describe("acceptLocal", () => {
  it("turns a confident, non-referencing answer into a local judgment", () => {
    const acceptance = acceptLocal(route(), 0.85);
    expect(acceptance).toEqual({
      ok: true,
      judgment: {
        intent: "add_food",
        intentConfidence: 0.93,
        actualConsumptionProbability: 1,
        clarificationProbability: 0,
        referenceTargetId: null,
        referenceConfidence: null,
        source: "local",
      },
    });
  });

  it("carries 'not consumed' through, so the add guard can still drop a question", () => {
    const acceptance = acceptLocal(route({ consumed: false }), 0.85);
    expect(acceptance.ok && acceptance.judgment.actualConsumptionProbability).toBe(0);
  });

  it.each(["connection", "timeout", "parse", "schema"] as const)(
    "falls back on a %s failure",
    (reason) => {
      expect(acceptLocal(failure(reason), 0.85)).toEqual({ ok: false, reason });
    },
  );

  it("falls back below the threshold, and accepts at it", () => {
    expect(acceptLocal(route({ confidence: 0.84 }), 0.85)).toEqual({
      ok: false,
      reason: "low_confidence",
    });
    expect(acceptLocal(route({ confidence: 0.85 }), 0.85).ok).toBe(true);
  });

  it("falls back on unknown, however confident", () => {
    expect(acceptLocal(route({ intent: "unknown", confidence: 0.99 }), 0.85)).toEqual({
      ok: false,
      reason: "unknown_intent",
    });
  });

  it.each(["modify_food", "delete_food"] as const)(
    "always leaves %s to the judge, because it needs a reference target",
    (intent) => {
      expect(acceptLocal(route({ intent, confidence: 0.99 }), 0.85)).toEqual({
        ok: false,
        reason: "referencing_intent",
      });
    },
  );

  it.each(["ask_status", "ask_recommendation", "other"] as const)(
    "lets the read-only %s through",
    (intent) => {
      expect(acceptLocal(route({ intent, consumed: false }), 0.85).ok).toBe(true);
    },
  );
});

describe("effectiveLocalMode", () => {
  it("is forced off in production", () => {
    expect(effectiveLocalMode({ mode: "active", nodeEnv: "production", model: "m" })).toBe("off");
  });

  it("is off without a model", () => {
    expect(effectiveLocalMode({ mode: "shadow", nodeEnv: "development", model: undefined })).toBe(
      "off",
    );
  });

  it("follows the setting in development", () => {
    expect(effectiveLocalMode({ mode: "active", nodeEnv: "development", model: "m" })).toBe(
      "active",
    );
  });
});

describe("withLocalRouter", () => {
  const env: LocalRouterEnv = {
    NODE_ENV: "development",
    LOCAL_LLM_MODE: "off",
    LOCAL_LLM_BASE_URL: "http://localhost:11434",
    LOCAL_LLM_MODEL: "m",
    LOCAL_LLM_TIMEOUT_MS: 5000,
    LOCAL_LLM_MIN_CONFIDENCE: 0.85,
  };

  it("hands back the very same judge when off", () => {
    const legacy = legacyJudge();
    expect(withLocalRouter(legacy, env)).toBe(legacy);
  });

  it("hands back the very same judge in production, even when set to active", () => {
    const legacy = legacyJudge();
    expect(withLocalRouter(legacy, { ...env, NODE_ENV: "production", LOCAL_LLM_MODE: "active" })).toBe(
      legacy,
    );
  });

  it("wraps the judge when a mode is on", () => {
    const legacy = legacyJudge();
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(withLocalRouter(legacy, { ...env, LOCAL_LLM_MODE: "shadow" })).not.toBe(legacy);
  });
});

describe("shadow mode", () => {
  it("returns the judge's answer and only logs the local one", async () => {
    const legacy = legacyJudge();
    const local = localRouter(route({ intent: "ask_status" }));
    const lines: string[] = [];
    const judge = createRoutedJudge({
      mode: "shadow",
      legacy,
      local,
      minConfidence: 0.85,
      log: (line) => lines.push(line),
    });

    expect(await judge.judge(input)).toBe(JEV);
    expect(legacy.judge).toHaveBeenCalledTimes(1);
    expect(local.route).toHaveBeenCalledWith(input);
    expect(lines[0]).toContain("mode=shadow");
    expect(lines[0]).toContain("legacy=add_food(jev 0.97)");
    expect(lines[0]).toContain("local=ask_status(0.93) matched=false");
    expect(lines[0]).toContain("latency=300ms");
  });

  it("does not let a local failure touch the response", async () => {
    const lines: string[] = [];
    const judge = createRoutedJudge({
      mode: "shadow",
      legacy: legacyJudge(),
      local: localRouter(failure("timeout")),
      minConfidence: 0.85,
      log: (line) => lines.push(line),
    });

    expect(await judge.judge(input)).toBe(JEV);
    expect(lines[0]).toContain("local=fail(timeout)");
  });

  it("does not leave the user's sentence in the log", async () => {
    const lines: string[] = [];
    const judge = createRoutedJudge({
      mode: "shadow",
      legacy: legacyJudge(),
      local: localRouter(route()),
      minConfidence: 0.85,
      log: (line) => lines.push(line),
    });
    await judge.judge(input);
    expect(lines.join("\n")).not.toContain("계란");
  });
});

describe("active mode", () => {
  it("uses the local answer and skips the judge when it passes", async () => {
    const legacy = legacyJudge();
    const lines: string[] = [];
    const judge = createRoutedJudge({
      mode: "active",
      legacy,
      local: localRouter(route()),
      minConfidence: 0.85,
      log: (line) => lines.push(line),
    });

    const judgment = await judge.judge(input);

    expect(judgment.source).toBe("local");
    expect(legacy.judge).not.toHaveBeenCalled();
    expect(lines[0]).toContain("fallback=false used=1/1");
  });

  it.each([
    ["connection", failure("connection")],
    ["timeout", failure("timeout")],
    ["parse", failure("parse")],
    ["low_confidence", route({ confidence: 0.5 })],
    ["referencing_intent", route({ intent: "delete_food" })],
  ] as const)("falls back to the judge on %s", async (reason, result) => {
    const legacy = legacyJudge();
    const lines: string[] = [];
    const judge = createRoutedJudge({
      mode: "active",
      legacy,
      local: localRouter(result),
      minConfidence: 0.85,
      log: (line) => lines.push(line),
    });

    expect(await judge.judge(input)).toBe(JEV);
    expect(legacy.judge).toHaveBeenCalledTimes(1);
    expect(lines[0]).toContain(`fallback=true reason=${reason}`);
  });

  it("falls back even if the local router throws", async () => {
    const legacy = legacyJudge();
    const judge = createRoutedJudge({
      mode: "active",
      legacy,
      local: { model: "m", route: async () => Promise.reject(new Error("bug")) },
      minConfidence: 0.85,
      log: () => {},
    });
    expect(await judge.judge(input)).toBe(JEV);
  });

  it("counts how many requests the local answer settled", async () => {
    const lines: string[] = [];
    const local = localRouter(route());
    const judge = createRoutedJudge({
      mode: "active",
      legacy: legacyJudge(),
      local,
      minConfidence: 0.85,
      log: (line) => lines.push(line),
    });
    await judge.judge(input);
    local.route.mockResolvedValueOnce(failure("timeout"));
    await judge.judge(input);
    expect(lines[1]).toContain("used=1/2");
  });
});
