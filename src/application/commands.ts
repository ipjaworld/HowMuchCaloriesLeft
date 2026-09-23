import {
  NOUL_THRESHOLDS,
  REFERENCE_CONFIDENCE_FLOOR,
  classifyIntentConfidence,
  isProbable,
} from "@/ai/judgment/confidence";
import type { AddPart } from "./addFood";
import {
  findReferenceMatches,
  resolveReferenceByName,
} from "@/ai/judgment/referenceHeuristic";
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
  /**
   * modify/delete, but which existing entry is meant cannot be told.
   *
   * There is deliberately no "unclear food" reason. That question belongs to
   * the NutritionResolver, which answers it from data as `ambiguous`,
   * `unmeasurable` or `unknown` and says which food it is stuck on — so a
   * vaguer version of it, decided from a probability, would have no producer
   * and nothing useful to say.
   */
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
  | { type: "add_candidate"; sourceText: string; needsConfirmation: boolean }
  /**
   * `add_candidate` with the nutrition lookup done. `decideCommand` never
   * returns this — it judges intent and knows nothing about food — so the
   * route expands its `add_candidate` into this before replying. The split
   * keeps the confidence policy a pure function while the part that needs a
   * dataset stays async and out of it.
   */
  | {
      type: "add";
      sourceText: string;
      parts: AddPart[];
      /**
       * The intent was read confidently enough to look the food up, but not
       * confidently enough to store it unasked. The lookup still happens, so
       * a "yes" needs no second round trip — and the question can name what
       * would be added.
       */
      needsConfirmation: boolean;
    }
  | {
      type: "modify_candidate";
      targetId: string;
      sourceText: string;
      /** Read confidently enough to look up, not to apply unasked. */
      needsConfirmation: boolean;
      /**
       * The correction run through the same lookup an add uses. Empty until
       * the route fills it in, for the same reason `add` is filled in there:
       * `decideCommand` stays a pure function over the judgment.
       */
      parts: AddPart[];
    }
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
 * Which entry the sentence is about — strategy A, decided by the Phase 4.5
 * measurement: Jev picks, because it reads Korean synonyms a rule cannot
 * ("아까 커피 먹었다고 한 거 취소" -> the 아메리카노 entry, which the code
 * heuristic misses entirely).
 *
 * Jev is trusted only as far as it says it should be. Its confidence turned
 * out to be unusually well calibrated here — 19 correct answers all >= 0.74,
 * the one wrong answer at 0.29 — so below the floor its pick is discarded
 * and the deterministic rule answers instead. That rule's own strength is
 * the complementary one: deictic phrases that name no food at all ("방금 넣은
 * 거 취소해줘"). Only if both come up empty does the caller ask the user.
 *
 * `referenceConfidence` is null for judges that do not report one — the mock
 * already resolves in code, so its pick is taken as given.
 */
function usableTarget(judgment: Judgment, input: JudgmentInput): string | null {
  if (judgment.referenceConfidence === null) return judgment.referenceTargetId;

  if (
    judgment.referenceTargetId !== null &&
    judgment.referenceConfidence >= REFERENCE_CONFIDENCE_FLOOR
  ) {
    return judgment.referenceTargetId;
  }

  return resolveReferenceByName(input.message, input.recentItems);
}

/**
 * Logged items the message names that a delete must not choose between.
 *
 * Deleting is the one action the user may not notice, so it does not get to
 * break a tie. When the wording matches several entries that differ in what
 * they would remove, the answer is a question — whoever supplied the target,
 * the model or the rule.
 *
 * Matches that are indistinguishable (same food, same figure) are not
 * ambiguity in any way the user could act on: either choice removes the same
 * number from the same day, so asking would be friction for nothing.
 */
function contestedDeleteTargets(input: JudgmentInput): RecentItem[] {
  const matches = findReferenceMatches(input.message, input.recentItems);
  if (matches.length <= 1) return [];

  const distinct = new Set(matches.map((item) => `${item.name}|${item.calories}`));
  return distinct.size > 1 ? matches : [];
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
      // Deliberately does *not* consult `mustAsk`. Whether the food and the
      // amount are clear is a question the NutritionResolver answers from
      // data — resolved, ambiguous, unmeasurable or unknown — and Phase 4.5
      // measured this noul as the weakest of the four in Korean, firing on
      // plain reports like "점심에 갈비탕 먹음". Asking it here would add a
      // guess in front of an answer. The confidence check below stays,
      // because that is a different question: whether this is a food report
      // at all.
      // A middling reading still gets looked up. Turning it into a bare
      // "shall I?" would throw the sentence away and leave a yes with
      // nothing to act on; carrying the flag lets the lookup happen and the
      // confirmation be asked over the top of it.
      return {
        type: "add_candidate",
        sourceText: input.message,
        needsConfirmation: decision === "confirm",
      };
    }

    case "modify_food":
    case "delete_food": {
      if (judgment.intent === "delete_food") {
        const contested = contestedDeleteTargets(input);
        if (contested.length > 0) {
          return {
            type: "clarify",
            reason: "unknown_target",
            intent: "delete_food",
            candidates: toCandidates(contested),
          };
        }
      }

      const targetId = usableTarget(judgment, input);

      // Still consulted here, where there is no resolver to ask instead:
      // which existing entry is meant is not something the dataset knows.
      const mustAsk = isProbable(
        judgment.clarificationProbability,
        NOUL_THRESHOLDS.clarificationNeeded,
      );

      if (targetId === null || mustAsk) {
        return {
          type: "clarify",
          reason: "unknown_target",
          intent: judgment.intent,
          candidates: toCandidates(input.recentItems),
        };
      }

      // A delete asks first and carries nothing with it: there is nothing to
      // look up, and the question is the whole point of the confirmation.
      if (decision === "confirm" && judgment.intent === "delete_food") {
        return {
          type: "clarify",
          reason: "confirm_action",
          intent: "delete_food",
          candidates: toCandidates(input.recentItems).filter(
            (candidate) => candidate.id === targetId,
          ),
        };
      }

      // A modify carries its lookup through the confirmation, for the same
      // reason an add does: throwing the sentence away would leave a "yes"
      // with nothing to apply.
      return judgment.intent === "modify_food"
        ? {
            type: "modify_candidate",
            targetId,
            sourceText: input.message,
            needsConfirmation: decision === "confirm",
            parts: [],
          }
        : { type: "delete_candidate", targetId };
    }
  }
}
