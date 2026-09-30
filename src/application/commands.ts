import {
  NOUL_THRESHOLDS,
  REFERENCE_CONFIDENCE_FLOOR,
  classifyIntentConfidence,
  isProbable,
} from "@/ai/judgment/confidence";
import type { AddPart } from "./addFood";
import { parseAmountOnly } from "@/ai/nutrition/quantity";
import { splitCorrection } from "./correction";
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
  | { type: "answer"; kind: "status" | "recommendation" | "goal_setting" }
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
      /**
       * Other foods the same sentence reports eating, to be added beside the
       * correction: 튀김 in "떡볶이랑 튀김 먹었는데 떡볶이는 반만" when 떡볶이
       * is already logged. A sentence can correct one entry and report a new
       * one at once, and treating it as only one of the two loses the other
       * without a word. Filled in by the route with `parts`.
       */
      extraParts?: AddPart[];
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
/**
 * Entries a correction could equally be about: "사과 두 개였어" with two 사과
 * logged today. Asked about rather than guessed, because a correction on the
 * wrong one changes a number the user already checked.
 *
 * Only the old side of the sentence counts — in "떠먹는 요거트 말고 그릭
 * 요거트" the 그릭 요거트 entry is the replacement, not a candidate — and a
 * name must appear whole in it, so 요거트 alone does not pull in every
 * yoghurt. Identical entries are not a choice worth asking about.
 */
function contestedModifyTargets(input: JudgmentInput, judgedId: string | null): RecentItem[] {
  const judged = input.recentItems.find((item) => item.id === judgedId);
  const { previous } = splitCorrection(input.message, judged?.name ?? null);
  const said = (previous ?? input.message).replace(/\s+/g, "");

  const named = input.recentItems.filter((item) => said.includes(item.name.replace(/\s+/g, "")));
  const distinct = new Set(named.map((item) => `${item.name}|${item.amount ?? ""}|${item.calories}`));
  return distinct.size > 1 ? named : [];
}

/**
 * "2개 먹었다니까?" names no food, only a new amount. Said as a correction, it
 * is about the entry just logged — the one whose amount the user is looking
 * at. Only for a sentence that is nothing but an amount; anything naming a
 * food goes through the ordinary reference rules.
 */
function amountOnlyTarget(input: JudgmentInput): string | null {
  const { next } = splitCorrection(input.message, null);
  if (parseAmountOnly(next) === null) return null;
  const newest = input.recentItems
    .slice()
    .sort((a, b) => b.consumedAt.localeCompare(a.consumedAt))[0];
  return newest?.id ?? null;
}

function contestedDeleteTargets(input: JudgmentInput): RecentItem[] {
  const matches = findReferenceMatches(input.message, input.recentItems);
  if (matches.length <= 1) return [];

  const distinct = new Set(matches.map((item) => `${item.name}|${item.calories}`));
  return distinct.size > 1 ? matches : [];
}

/**
 * "목표 1800으로 바꿔줘" — a request to change the goal, which the chat does
 * not do.
 *
 * The goal has its own control right under the number, and a sentence is a
 * poor way to set it: "오늘 1800만 먹을래" could be a new goal or a resolve
 * for today, and misreading it would quietly change the one figure the app
 * exists to show. So the chat points at the control instead, and that
 * decision is a fixed rule rather than a judgment — it needs 목표 plus a
 * word for changing it, and nothing about eating.
 */
export function asksToChangeGoal(message: string): boolean {
  if (!message.includes("목표")) return false;
  if (/(먹|마셨|마심)/.test(message)) return false;
  return /(바꿔|바꾸|바꿀|변경|수정|설정|정해|정할|올려|올릴|낮춰|낮출|내려|내릴|줄여|줄일|늘려|늘릴|[으]?로 해|[으]?로 할)/.test(
    message,
  );
}

/**
 * An entry the user picked in answer to "어떤 기록을 수정할까요?". It is
 * final: the sentence is re-sent with it, and nothing may ask the same
 * question again — that is how "2개 먹었다니까?" once looped forever, the
 * judge failing to find a target in a sentence that names no food, every
 * time it was re-sent.
 */
export type ChosenTarget = {
  targetId: string;
  intent: "modify_food" | "delete_food";
};

export function decideCommand(
  judgment: Judgment,
  input: JudgmentInput,
  chosen?: ChosenTarget,
): Command {
  if (asksToChangeGoal(input.message)) {
    return { type: "answer", kind: "goal_setting" };
  }

  // The user's pick settles both the intent and the target. What is left is
  // only what to change it to, which the lookup answers.
  if (chosen !== undefined && input.recentItems.some((item) => item.id === chosen.targetId)) {
    return chosen.intent === "delete_food"
      ? { type: "delete_candidate", targetId: chosen.targetId }
      : {
          type: "modify_candidate",
          targetId: chosen.targetId,
          sourceText: input.message,
          needsConfirmation: false,
          parts: [],
        };
  }

  const decision = classifyIntentConfidence(
    judgment.intent,
    judgment.intentConfidence,
  );

  if (decision === "clarify") {
    // Two entries of the same food make the judge unsure a sentence is a
    // correction at all — "아까 사과 두 개였어" with two 사과 logged read as
    // modify at 0.45-0.69. The ambiguity it is reacting to is the one worth
    // asking about, and picking a record answers both questions at once.
    if (judgment.intent === "modify_food") {
      const contested = contestedModifyTargets(input, usableTarget(judgment, input));
      if (contested.length > 0) {
        return {
          type: "clarify",
          reason: "unknown_target",
          intent: "modify_food",
          candidates: toCandidates(contested),
        };
      }
    }
    // "2개 먹었다니까?" is nothing but an amount. The judge cannot place it
    // (measured: modify 0.32, ask_status 0.36), but the only reading that
    // makes sense is a correction of the entry just logged — so propose that
    // and let the user say yes, instead of "무슨 말씀인지 모르겠어요".
    const newest = amountOnlyTarget(input);
    if (newest !== null) {
      return {
        type: "modify_candidate",
        targetId: newest,
        sourceText: input.message,
        needsConfirmation: true,
        parts: [],
      };
    }
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

      const judgedTarget = usableTarget(judgment, input);
      // A bare amount pointed at the newest entry is a reasonable reading,
      // not a certain one: it is confirmed ("바나나를 고칠까요?") rather than
      // asked about from scratch.
      const fromAmount =
        judgedTarget === null && judgment.intent === "modify_food"
          ? amountOnlyTarget(input)
          : null;
      const targetId = judgedTarget ?? fromAmount;

      if (judgment.intent === "modify_food") {
        const contested = contestedModifyTargets(input, targetId);
        if (contested.length > 0) {
          return {
            type: "clarify",
            reason: "unknown_target",
            intent: "modify_food",
            candidates: toCandidates(contested),
          };
        }
      }

      // Still consulted here, where there is no resolver to ask instead:
      // which existing entry is meant is not something the dataset knows.
      const mustAsk = isProbable(
        judgment.clarificationProbability,
        NOUL_THRESHOLDS.clarificationNeeded,
      );

      if (targetId === null || (mustAsk && fromAmount === null)) {
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
            needsConfirmation: decision === "confirm" || fromAmount !== null,
            parts: [],
          }
        : { type: "delete_candidate", targetId };
    }
  }
}
