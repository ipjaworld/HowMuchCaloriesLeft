import { TypeSafeClient, noul, type Questions } from "@typesafe-ai/sdk";
import { z } from "zod";

/**
 * Per-food judgment: of the phrases the parser could not settle, which
 * ones name something the user actually ate?
 *
 * The parser finds candidates; this only judges them. Jev picks nothing,
 * names nothing and prices nothing — it returns one probability per phrase
 * it was handed, and code decides what to do with it.
 *
 * Deliberately its own request, never folded into the intent request.
 * Phase 8 measured both: sharing one request put the candidates into the
 * state every question reads, and that lifted add confidence on sentences
 * that report no eating at all ("김밥 먹으려다가 그냥 굶었어" 0.22 → 0.66).
 * Two requests sent together cost one round trip of wall clock.
 */

export interface CandidateJudge {
  /** One probability per phrase, in order. Throws on any failure. */
  judgeEaten(message: string, phrases: string[]): Promise<number[]>;
}

export type CandidateCallTelemetry = {
  model: string;
  inputTokens: number;
  latencyMs: number;
  candidateCount: number;
};

/**
 * English instructions, Korean state — the split `questions.ts` uses. The
 * wording is the one Phase 8 measured; it was written once before the first
 * run and not tuned against the corpus.
 */
export function eatenQuestion(label: string) {
  return noul(
    `Look at the phrase in \`food_candidates.${label}\`, which was cut out of \`message\`. Does it name a food or drink that the user themselves actually ate or drank, according to \`message\`?`,
    {
      true: "The phrase names a food or drink, and the message reports that the user consumed it — all of it or only part of it.",
      false:
        "The phrase is not a food or drink (a person, place, time, activity, feeling or comment), or it is a food the user did not actually consume: only wanted, planned, resisted, replaced, asked about or mentioned.",
    },
  );
}

const noulAnswerSchema = z.object({ noul: z.number().min(0).max(1) });

export type CandidateJudgeOptions = {
  client?: TypeSafeClient;
  apiKey?: string;
  /**
   * Per attempt, and there is exactly one attempt: a late answer is worth
   * less than asking one question too many, so this never retries.
   */
  timeoutMs: number;
  onCall?: (telemetry: CandidateCallTelemetry) => void;
  beforeCall?: () => Promise<void>;
};

export type CandidateJudgeEnv = {
  FOOD_CANDIDATE_FILTER: "off" | "on";
  FOOD_CANDIDATE_TIMEOUT_MS: number;
  TYPESAFE_API_KEY?: string | undefined;
};

/**
 * The route's one entry point. Null — the filter does nothing — unless it
 * is switched on *and* there is a real key: the mock judge has nothing to
 * judge phrases with, and guessing would be worse than asking.
 */
export function candidateJudgeFor(env: CandidateJudgeEnv, beforeCall?: () => Promise<void>): CandidateJudge | null {
  if (env.FOOD_CANDIDATE_FILTER !== "on" || env.TYPESAFE_API_KEY === undefined) return null;
  return createJevCandidateJudge({
    apiKey: env.TYPESAFE_API_KEY,
    timeoutMs: env.FOOD_CANDIDATE_TIMEOUT_MS,
    beforeCall,
  });
}

export function createJevCandidateJudge({
  client,
  apiKey,
  timeoutMs,
  onCall,
  beforeCall,
}: CandidateJudgeOptions): CandidateJudge {
  const typeSafe = client ?? new TypeSafeClient({ ...(apiKey === undefined ? {} : { apiKey }) });

  return {
    async judgeEaten(message, phrases) {
      if (phrases.length === 0) return [];

      const labels = phrases.map((_, index) => `c${index + 1}`);
      const foodCandidates: Record<string, { phrase: string }> = {};
      const questions: Questions = {};
      for (const [index, label] of labels.entries()) {
        foodCandidates[label] = { phrase: phrases[index] ?? "" };
        questions[label] = eatenQuestion(label);
      }

      const startedAt = Date.now();
      await beforeCall?.();
      const result = await typeSafe.systemOne(
        { state: { message, food_candidates: foodCandidates }, questions },
        { timeout: timeoutMs, retry: { maxRetries: 0 } },
      );
      onCall?.({
        model: result.model,
        inputTokens: result.usage.input_tokens,
        latencyMs: Date.now() - startedAt,
        candidateCount: phrases.length,
      });

      const answers = result.answers as Record<string, unknown>;
      // A malformed answer throws here, and the caller falls back to asking.
      return labels.map((label) => noulAnswerSchema.parse(answers[label]).noul);
    },
  };
}
