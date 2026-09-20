import { choice, noul, type ChoiceCriteria } from "@typesafe-ai/sdk";
import { INTENTS, type Intent, type JudgmentInput, type RecentItem } from "./types";

/**
 * Every Jev question, in one place.
 *
 * Language split, per the model card: English is Jev's strongest language and
 * CJK is explicitly documented as lower accuracy — so `instructions` and
 * `criteria` are written in English, while the user's Korean goes into
 * `state` verbatim. Translating the user's sentence would throw away exactly
 * the wording a correction depends on.
 *
 * Question ids are not sent to the model, so each question has to carry its
 * full meaning in its own text.
 */

/** The escape label for the reference question. */
export const NO_REFERENCE = "none";

/** How many recent entries are offered as reference candidates. */
export const MAX_REFERENCE_CANDIDATES = 12;

const INTENT_CRITERIA: Record<Intent, string> = {
  add_food:
    "The user is reporting food or drink they have already consumed, and a new entry should be created for it.",
  modify_food:
    "The user is correcting an entry that already exists in `recent_entries` — a different amount, a different food, a different day or meal. They are not reporting something new.",
  delete_food:
    "The user wants an existing entry taken back or removed, including saying they did not actually have it after all.",
  ask_status:
    "The user is asking about their own intake today: how much they have eaten, how much is left, or what is already logged.",
  ask_recommendation:
    "The user is asking what they should eat next, or whether eating a particular thing is a good idea.",
  other:
    "None of the above. General curiosity about a food, small talk, or anything that neither reads nor changes today's log.",
};

/**
 * `state` as Jev sees it. Named fields rather than one blob, so a question
 * can point at `message` or `recent_entries` and mean something precise.
 */
export function buildState(input: JudgmentInput, candidates: ReferenceCandidate[]) {
  return {
    message: input.message,
    current_time: input.now,
    daily_goal_calories: input.dailyGoalCalories,
    recent_entries: candidates.map((candidate) => ({
      label: candidate.label,
      food: candidate.item.name,
      amount: candidate.item.amount ?? null,
      meal: candidate.item.mealType ?? null,
      eaten_at: candidate.item.consumedAt,
      calories: candidate.item.calories,
    })),
  };
}

export const intentQuestion = choice(
  "What is the user trying to do with their food log in `message`? Judge the action they intend, not the topic they mention.",
  INTENT_CRITERIA,
);

export const actualConsumptionQuestion = noul(
  "Is the user stating that they themselves actually ate or drank something? Judge `message`.",
  {
    true: "A report of something consumed, including a correction to how much of it was consumed.",
    false:
      "A question about a food, a plan or intention to eat later, a request to cancel an entry, or anything the user did not actually consume.",
  },
);

export const clarificationQuestion = noul(
  "Before changing the stored log, is confirmation from the user needed? Judge whether `message` and `recent_entries` together settle it.",
  {
    true: "The food, the amount, or which existing entry is meant cannot be determined from what is given.",
    false: "What to record or change is clear enough to act on without asking.",
  },
);

export type ReferenceCandidate = {
  /** Short stable label the model selects. Mapped back to the real id in code. */
  label: string;
  item: RecentItem;
};

/**
 * Candidates are built in code and offered as labels; the model selects one
 * rather than writing an id, so the value that comes back is always one we
 * put in. Opaque uuids would tell the model nothing, so the label is a short
 * index and the meaning lives in its description.
 */
export function buildReferenceCandidates(
  recentItems: RecentItem[],
): ReferenceCandidate[] {
  return recentItems
    .slice()
    .sort((a, b) => b.consumedAt.localeCompare(a.consumedAt))
    .slice(0, MAX_REFERENCE_CANDIDATES)
    .map((item, index) => ({ label: `entry_${index + 1}`, item }));
}

export function referenceQuestion(candidates: ReferenceCandidate[]) {
  const criteria: ChoiceCriteria = {};

  for (const candidate of candidates) {
    criteria[candidate.label] = {
      food: candidate.item.name,
      amount: candidate.item.amount ?? null,
      meal: candidate.item.mealType ?? null,
      eaten_at: candidate.item.consumedAt,
    };
  }

  criteria[NO_REFERENCE] =
    "The message does not refer to any of these entries, or which one it refers to cannot be told apart from the others.";

  return choice(
    "Which existing entry from `recent_entries` is the user talking about in `message`? Prefer the entry whose food and amount the message actually names.",
    criteria,
  );
}

/** Kept exported so a question change is visible in the golden-set report. */
export const QUESTION_IDS = ["intent", "actual_consumption", "clarification", "reference"] as const;

export { INTENTS };
