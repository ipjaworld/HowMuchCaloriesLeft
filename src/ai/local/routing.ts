import type { Judge, Judgment, JudgmentInput } from "@/ai/judgment/types";
import { createLocalLlmClient, type LocalLlmFailure, type LocalLlmResult } from "./client";
import { createLocalRouter, type LocalRoute, type LocalRouter } from "./router";

/**
 * Where the local router meets the existing judge.
 *
 *   off     the existing judge, untouched — `withLocalRouter` returns it as is
 *   shadow  the existing judge decides; the local router is asked the same
 *           thing alongside and only the comparison is logged
 *   active  the local answer is used when it passes every check below,
 *           otherwise the existing judge answers as it always has
 *
 * The local router is never trusted on its own say-so: any failure, any doubt,
 * and any intent that has to point at an existing record goes to the judge.
 */

export type LocalMode = "off" | "shadow" | "active";

export type FallbackReason =
  | LocalLlmFailure
  | "unknown_intent"
  | "low_confidence"
  /** modify/delete need a reference target, which stays the judge's question. */
  | "referencing_intent";

export type Acceptance =
  | { ok: true; judgment: Judgment }
  | { ok: false; reason: FallbackReason };

/**
 * Whether a local answer may stand in for a judgment, and the judgment it
 * stands in as.
 *
 * Only what the local router actually answered is filled in. Nothing reads a
 * reference or the clarification noul for the intents let through here, so
 * those are empty rather than invented; `consumed` becomes 1 or 0 because the
 * one consumer, the add guard, only asks which side of 0.5 it is on.
 */
export function acceptLocal(result: LocalLlmResult<LocalRoute>, minConfidence: number): Acceptance {
  if (!result.ok) return { ok: false, reason: result.reason };

  const { intent, confidence, consumed } = result.data;
  if (intent === "unknown") return { ok: false, reason: "unknown_intent" };
  if (confidence < minConfidence) return { ok: false, reason: "low_confidence" };
  if (intent === "modify_food" || intent === "delete_food") {
    return { ok: false, reason: "referencing_intent" };
  }

  return {
    ok: true,
    judgment: {
      intent,
      intentConfidence: confidence,
      actualConsumptionProbability: consumed ? 1 : 0,
      clarificationProbability: 0,
      referenceTargetId: null,
      referenceConfidence: null,
      source: "local",
    },
  };
}

/** Production never runs the experiment, whatever the environment says. */
export function effectiveLocalMode(options: {
  mode: LocalMode;
  nodeEnv: string;
  model: string | undefined;
}): LocalMode {
  if (options.nodeEnv === "production") return "off";
  if (options.model === undefined) return "off";
  return options.mode;
}

export type RoutedJudgeOptions = {
  mode: "shadow" | "active";
  legacy: Judge;
  local: LocalRouter;
  minConfidence: number;
  /** One line per request. console.info unless a test wants the lines. */
  log?: (line: string) => void;
};

export function createRoutedJudge({
  mode,
  legacy,
  local,
  minConfidence,
  log = (line) => console.info(line),
}: RoutedJudgeOptions): Judge {
  // Per server process. Enough to read a rate off a dev session; nothing is
  // stored.
  let requests = 0;
  let usedLocal = 0;
  let compared = 0;
  let agreed = 0;

  // The client already turns every failure into a value; this is only so a
  // bug in it can never cost the user their request.
  const askLocal = (input: JudgmentInput): Promise<LocalLlmResult<LocalRoute>> =>
    local.route(input).catch((error: unknown) => ({
      ok: false as const,
      reason: "connection" as const,
      detail: String(error),
      latencyMs: 0,
    }));

  if (mode === "shadow") {
    return {
      async judge(input) {
        // Side by side, and the response waits for both. Accepted for now:
        // the point is the comparison, and this only runs in development.
        const [judgment, result] = await Promise.all([legacy.judge(input), askLocal(input)]);
        const acceptance = acceptLocal(result, minConfidence);

        let localPart: string;
        if (result.ok) {
          compared += 1;
          const matched = result.data.intent === judgment.intent;
          if (matched) agreed += 1;
          localPart = `local=${result.data.intent}(${result.data.confidence.toFixed(2)}) matched=${matched}`;
        } else {
          localPart = `local=fail(${result.reason})`;
        }

        log(
          `[LocalRouter] mode=shadow legacy=${judgment.intent}(${judgment.source} ${judgment.intentConfidence.toFixed(2)}) ` +
            `${localPart} latency=${result.latencyMs}ms ` +
            `wouldUse=${acceptance.ok}${acceptance.ok ? "" : ` reason=${acceptance.reason}`} ` +
            `agree=${agreed}/${compared}`,
        );
        return judgment;
      },
    };
  }

  return {
    async judge(input) {
      requests += 1;
      const result = await askLocal(input);
      const acceptance = acceptLocal(result, minConfidence);

      if (acceptance.ok) {
        usedLocal += 1;
        log(
          `[LocalRouter] mode=active intent=${acceptance.judgment.intent} ` +
            `confidence=${acceptance.judgment.intentConfidence.toFixed(2)} latency=${result.latencyMs}ms ` +
            `fallback=false used=${usedLocal}/${requests}`,
        );
        return acceptance.judgment;
      }

      const intentPart = result.ok
        ? `intent=${result.data.intent} confidence=${result.data.confidence.toFixed(2)} `
        : "";
      log(
        `[LocalRouter] mode=active ${intentPart}latency=${result.latencyMs}ms ` +
          `fallback=true reason=${acceptance.reason} used=${usedLocal}/${requests}`,
      );
      return legacy.judge(input);
    },
  };
}

export type LocalRouterEnv = {
  NODE_ENV: string;
  LOCAL_LLM_MODE: LocalMode;
  LOCAL_LLM_BASE_URL: string;
  LOCAL_LLM_MODEL?: string | undefined;
  LOCAL_LLM_TIMEOUT_MS: number;
  LOCAL_LLM_MIN_CONFIDENCE: number;
};

/**
 * The route's one entry point. With the experiment off this hands back the
 * very judge it was given, so `off` is the old code path, not a copy of it.
 */
export function withLocalRouter(legacy: Judge, env: LocalRouterEnv): Judge {
  const mode = effectiveLocalMode({
    mode: env.LOCAL_LLM_MODE,
    nodeEnv: env.NODE_ENV,
    model: env.LOCAL_LLM_MODEL,
  });

  if (mode === "off" || env.LOCAL_LLM_MODEL === undefined) {
    if (env.LOCAL_LLM_MODE !== "off" && env.NODE_ENV !== "production") {
      console.warn(`[LocalRouter] LOCAL_LLM_MODE=${env.LOCAL_LLM_MODE} but LOCAL_LLM_MODEL is unset — staying off.`);
    }
    return legacy;
  }

  const local = createLocalRouter(
    createLocalLlmClient({
      baseUrl: env.LOCAL_LLM_BASE_URL,
      model: env.LOCAL_LLM_MODEL,
      timeoutMs: env.LOCAL_LLM_TIMEOUT_MS,
    }),
  );
  console.info(`[LocalRouter] mode=${mode} model=${local.model} minConfidence=${env.LOCAL_LLM_MIN_CONFIDENCE}`);
  return createRoutedJudge({ mode, legacy, local, minConfidence: env.LOCAL_LLM_MIN_CONFIDENCE });
}
