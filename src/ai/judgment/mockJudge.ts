import type { Judge, Judgment, JudgmentInput } from "./types";
import type { Intent } from "./types";
import {
  VERB_RE,
  foodLikeTokens,
  resolveReferenceByName,
} from "./referenceHeuristic";

/**
 * The judge used when there is no `TYPESAFE_API_KEY`.
 *
 * Deterministic on purpose — the same sentence always gives the same answer,
 * so the UI, the route and the tests are all workable without a key. It is a
 * handful of Korean surface patterns, not an NLP engine, and it is not meant
 * to grow into one: when it disagrees with Jev, Jev is the one being
 * measured.
 *
 * The reference-target rule it uses now lives in `referenceHeuristic.ts`,
 * because Phase 4.5 promoted it: it is no longer only the mock's rule, it is
 * also what `decideCommand` falls back to when Jev reports a reference it is
 * not confident in.
 */

/** Order matters: the first pattern that matches decides the intent. */
const DELETE_RE = /취소|지워|지울|삭제|안\s*먹었|안\s*마셨|잘못\s*(입력|넣)/;
const STATUS_RE =
  /얼마나?\s*(남|더\s*먹)|남았|남음|몇\s*칼로리\s*(먹|남)|목표까지|오늘.*뭐\s*먹었|지금.*먹었|먹은\s*거.*(칼로리|얼마)/;
const KNOWLEDGE_RE =
  /칼로리\s*(높|낮)|살\s*.*(찌|쪄)|어때\s*\?|괜찮아|먹어야\s*(돼|될|하)|몇\s*칼로리야|내일|모레|생각중/;
const RECOMMENDATION_RE = /뭐\s*먹|추천|먹어도\s*(돼|될까)|먹을까|좋을까|뭐로/;
const MODIFY_RE = /아니고|아니라|말고|남겼|반만|절반|어제|수정|만\s*먹었|아까/;
const CONSUMED_RE = /먹었|마셨|먹음|마심|드셨/;

const QUANTITY_RE =
  /\d+\s*(개|잔|공기|그릇|조각|팩|장|ml|g|kg|인분)|한\s*(개|잔|공기|그릇|조각|팩|장)|하나|둘|두\s|세\s|세개|셋|네\s|다섯|반\s*(개|공기|잔)?/;

/** Words that name no particular food on their own. */
const VAGUE_TOKENS = new Set([
  "밥",
  "점심",
  "저녁",
  "아침",
  "간식",
  "야식",
  "그거",
  "거",
  "좀",
  "많이",
  "조금",
  "그",
]);

function classifyIntent(message: string): { intent: Intent; confident: boolean } {
  if (DELETE_RE.test(message)) return { intent: "delete_food", confident: true };
  if (STATUS_RE.test(message)) return { intent: "ask_status", confident: true };
  if (KNOWLEDGE_RE.test(message)) return { intent: "other", confident: true };
  if (RECOMMENDATION_RE.test(message)) {
    return { intent: "ask_recommendation", confident: true };
  }
  if (MODIFY_RE.test(message)) return { intent: "modify_food", confident: true };
  if (CONSUMED_RE.test(message)) return { intent: "add_food", confident: true };

  // Nothing matched. A bare noun phrase is probably a meal being reported; a
  // question is probably not about the log at all.
  if (message.includes("?")) return { intent: "other", confident: false };
  return { intent: "add_food", confident: false };
}

function needsClarificationFor(
  intent: Intent,
  message: string,
  referenceTargetId: string | null,
): boolean {
  if (intent === "modify_food" || intent === "delete_food") {
    return referenceTargetId === null;
  }

  if (intent !== "add_food") return false;

  const tokens = foodLikeTokens(message);
  if (tokens.length === 0) return true;
  if (tokens.every((token) => VAGUE_TOKENS.has(token))) return true;

  // A lone word with no amount and no verb could as easily be a question.
  const hasVerb = VERB_RE.test(message);
  const hasQuantity = QUANTITY_RE.test(message);
  return tokens.length === 1 && !hasVerb && !hasQuantity;
}

export function createMockJudge(): Judge {
  return {
    async judge(input: JudgmentInput): Promise<Judgment> {
      const message = input.message.trim();
      const { intent, confident } = classifyIntent(message);

      const referencing = intent === "modify_food" || intent === "delete_food";
      const referenceTargetId = referencing
        ? resolveReferenceByName(message, input.recentItems)
        : null;

      const clarify = needsClarificationFor(intent, message, referenceTargetId);
      const consuming = intent === "add_food" || intent === "modify_food";

      return {
        intent,
        intentConfidence: confident ? 0.95 : 0.55,
        actualConsumptionProbability: consuming ? 0.9 : 0.1,
        clarificationProbability: clarify ? 0.9 : 0.1,
        referenceTargetId,
        referenceConfidence: referencing
          ? referenceTargetId === null
            ? 0.3
            : 0.9
          : null,
        source: "mock",
      };
    },
  };
}
