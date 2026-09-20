import {
  NOUL_THRESHOLDS,
  REFERENCE_CONFIDENCE_FLOOR,
  classifyIntentConfidence,
  isProbable,
} from "@/ai/judgment/confidence";
import type { Intent, Judgment, JudgmentInput, RecentItem } from "@/ai/judgment/types";

/**
 * What the server tells the browser to do. It never does it itself.
 *
 * Phase 4 stops at *candidates*: there is no NutritionResolver yet, so
 * "갈비탕 먹었어" cannot become a FoodItem with a calorie figure. The command
 * says which entry the sentence is about and what it wants done, and Phase 5
 * fills in the food data that turns `add_candidate` into a real record.
 */

export type ClarifyReason =
  /** add_food, but which food or how much cannot be told. */
  | "unclear_food"
  /** modify/delete, but which existing entry is meant cannot be told. */
  | "unknown_target"
  /** The intent itself was not read confidently enough to act on. */
  | "low_confidence"
  /** Confident enough to propose, not confident enough to just do it. */
  | "confirm_action";

export type ClarifyCandidate = {
  id: string;
  name: string;
  amount?: string;
};

export type Command =
  | { type: "answer"; kind: "status" | "recommendation" }
  | { type: "add_candidate"; sourceText: string }
  | { type: "modify_candidate"; targetId: string; sourceText: string }
  | { type: "delete_candidate"; targetId: string }
  | {
      type: "clarify";
      reason: ClarifyReason;
      /** What the clarification is about, so a "yes" means something. */
      intent: Intent;
      candidates?: ClarifyCandidate[];
    }
  | { type: "ignore"; reason: "not_consumption" | "off_topic" };

/** How many entries a clarifying question may offer to choose between. */
const MAX_CLARIFY_CANDIDATES = 4;

function toCandidates(recentItems: RecentItem[]): ClarifyCandidate[] {
  return recentItems
    .slice()
    .sort((a, b) => b.consumedAt.localeCompare(a.consumedAt))
    .slice(0, MAX_CLARIFY_CANDIDATES)
    .map((item) => ({
      id: item.id,
      name: item.name,
      ...(item.amount === undefined ? {} : { amount: item.amount }),
    }));
}

/**
 * A reference is only usable when the model both picked one and was
 * reasonably sure. `referenceConfidence` is null for judges that do not
 * report one, which is treated as usable — the mock resolves by name in code.
 */
function usableTarget(judgment: Judgment): string | null {
  if (judgment.referenceTargetId === null) return null;
  if (judgment.referenceConfidence === null) return judgment.referenceTargetId;
  return judgment.referenceConfidence >= REFERENCE_CONFIDENCE_FLOOR
    ? judgment.referenceTargetId
    : null;
}

export function decideCommand(
  judgment: Judgment,
  input: JudgmentInput,
): Command {
  const decision = classifyIntentConfidence(
    judgment.intent,
    judgment.intentConfidence,
  );

  if (decision === "clarify") {
    return { type: "clarify", reason: "low_confidence", intent: judgment.intent };
  }

  const mustAsk = isProbable(
    judgment.clarificationProbability,
    NOUL_THRESHOLDS.clarificationNeeded,
  );

  switch (judgment.intent) {
    case "ask_status":
      return { type: "answer", kind: "status" };

    case "ask_recommendation":
      return { type: "answer", kind: "recommendation" };

    case "other":
      return { type: "ignore", reason: "off_topic" };

    case "add_food": {
      // The guard that keeps "갈비탕 칼로리 높아?" out of the log.
      if (
        !isProbable(
          judgment.actualConsumptionProbability,
          NOUL_THRESHOLDS.actualConsumption,
        )
      ) {
        return { type: "ignore", reason: "not_consumption" };
      }
      if (mustAsk) {
        return { type: "clarify", reason: "unclear_food", intent: "add_food" };
      }
      if (decision === "confirm") {
        return { type: "clarify", reason: "confirm_action", intent: "add_food" };
      }
      return { type: "add_candidate", sourceText: input.message };
    }

    case "modify_food":
    case "delete_food": {
      const targetId = usableTarget(judgment);

      if (targetId === null || mustAsk) {
        return {
          type: "clarify",
          reason: "unknown_target",
          intent: judgment.intent,
          candidates: toCandidates(input.recentItems),
        };
      }

      if (decision === "confirm") {
        return {
          type: "clarify",
          reason: "confirm_action",
          intent: judgment.intent,
          candidates: toCandidates(input.recentItems).filter(
            (candidate) => candidate.id === targetId,
          ),
        };
      }

      return judgment.intent === "modify_food"
        ? { type: "modify_candidate", targetId, sourceText: input.message }
        : { type: "delete_candidate", targetId };
    }
  }
}
