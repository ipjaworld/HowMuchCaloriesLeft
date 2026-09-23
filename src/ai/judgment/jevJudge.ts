import { TypeSafeClient, type Questions } from "@typesafe-ai/sdk";
import { z } from "zod";
import {
  NO_REFERENCE,
  actualConsumptionQuestion,
  buildReferenceCandidates,
  buildState,
  clarificationQuestion,
  intentQuestion,
  referenceQuestion,
} from "./questions";
import {
  INTENTS,
  isReferencingIntent,
  type Judge,
  type Judgment,
  type JudgmentInput,
} from "./types";

/**
 * The Jev boundary. Nothing above this file imports `@typesafe-ai/sdk`.
 *
 * All four questions go out in one request — Jev answers them together, so
 * the branch-specific reference question is asked speculatively and simply
 * ignored when the intent turns out not to need it. One round trip.
 */

/** The raw answers are validated before anything is read off them. */
const choiceAnswerSchema = z.object({
  choice: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

const noulAnswerSchema = z.object({
  noul: z.number().min(0).max(1),
});

const intentAnswerSchema = choiceAnswerSchema.extend({
  choice: z.enum(INTENTS),
});

/**
 * What one Jev call cost, for the golden-set report. Kept out of `Judgment`
 * on purpose: the application decides nothing from these numbers, and the
 * type above this boundary should not grow a field only an eval reads.
 */
export type JevCallTelemetry = {
  /** The model that actually answered, e.g. `jev-1.13.0` for `jev-latest`. */
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** Wall clock around the single `systemOne` call. */
  latencyMs: number;
  /** How many reference candidates were offered, which drives input size. */
  candidateCount: number;
};

export type JevJudgeOptions = {
  client?: TypeSafeClient;
  apiKey?: string;
  model?: string;
  /** Called once per judgement. Only the eval passes this. */
  onCall?: (telemetry: JevCallTelemetry) => void;
};

export function createJevJudge({
  client,
  apiKey,
  model,
  onCall,
}: JevJudgeOptions = {}): Judge {
  // The SDK refuses to run in a browser unless explicitly allowed, which is
  // the behaviour we want: this only ever constructs on the server.
  const typeSafe =
    client ??
    new TypeSafeClient({
      ...(apiKey === undefined ? {} : { apiKey }),
      ...(model === undefined ? {} : { defaultModel: model }),
    });

  return {
    async judge(input: JudgmentInput): Promise<Judgment> {
      const candidates = buildReferenceCandidates(input.recentItems);
      const state = buildState(input, candidates);

      // Built as a plain record rather than a conditional object literal:
      // the reference question is only present when there is something to
      // refer to, and a union of two shapes is not assignable to `Questions`.
      const questions: Questions = {
        intent: intentQuestion,
        actual_consumption: actualConsumptionQuestion,
        clarification: clarificationQuestion,
      };
      if (candidates.length > 0) {
        questions["reference"] = referenceQuestion(candidates);
      }

      const startedAt = Date.now();
      const result = await typeSafe.systemOne({ state, questions });
      onCall?.({
        model: result.model,
        inputTokens: result.usage.input_tokens,
        outputTokens: result.usage.output_tokens,
        latencyMs: Date.now() - startedAt,
        candidateCount: candidates.length,
      });

      const answers = result.answers as Record<string, unknown>;

      const intent = intentAnswerSchema.parse(answers["intent"]);
      const actualConsumption = noulAnswerSchema.parse(
        answers["actual_consumption"],
      );
      const clarification = noulAnswerSchema.parse(answers["clarification"]);

      let referenceTargetId: string | null = null;
      let referenceConfidence: number | null = null;

      if (candidates.length > 0 && isReferencingIntent(intent.choice)) {
        const reference = choiceAnswerSchema.parse(answers["reference"]);
        referenceConfidence = reference.confidence;

        if (reference.choice !== NO_REFERENCE) {
          // The label came from our own list, so this always resolves —
          // unless the model returned something we never offered.
          referenceTargetId =
            candidates.find((c) => c.label === reference.choice)?.item.id ?? null;
        }
      }

      return {
        intent: intent.choice,
        intentConfidence: intent.confidence,
        actualConsumptionProbability: actualConsumption.noul,
        clarificationProbability: clarification.noul,
        referenceTargetId,
        referenceConfidence,
        source: "jev",
      };
    },
  };
}
