/** Meal types live in the domain; the golden set reuses them rather than
 * keeping a second copy that could drift. */
export { MEAL_TYPES, type MealType } from "@/domain/meal";

/**
 * The judgment vocabulary shared by the Jev integration, the mock judge and
 * the Korean golden set. This is the single source of truth: `questions.ts`
 * builds Jev's `choice` criteria from `INTENTS`, so a label can never drift
 * between the question, the fixture and the application switch.
 */

export const INTENTS = [
  "add_food",
  "modify_food",
  "delete_food",
  "ask_status",
  "ask_recommendation",
  /** Escape hatch. Jev always gets a no-match option. */
  "other",
] as const;

export type Intent = (typeof INTENTS)[number];

/** Intents that can refer to something already in the log. */
export function isReferencingIntent(intent: Intent): boolean {
  return intent === "modify_food" || intent === "delete_food";
}

/** One entry the user's next sentence might be talking about. */
export type RecentItem = {
  id: string;
  name: string;
  amount?: string;
  calories: number;
  mealType?: string;
  /** ISO datetime. */
  consumedAt: string;
};

/** Everything a judgment is made from. The client sends exactly this much. */
export type JudgmentInput = {
  message: string;
  /** ISO datetime, from the browser — the server has no clock of the user's. */
  now: string;
  dailyGoalCalories: number | null;
  recentItems: RecentItem[];
};

/**
 * A judgment as the application consumes it, after the raw API response has
 * been validated and mapped. Probabilities stay in this layer; nothing above
 * it sees a `SystemOneResult`.
 *
 * Note the asymmetry, which comes straight from the TypeSafe API and is
 * deliberately visible in these names: a `choice` answer carries a separate
 * `confidence`, while a `noul` answer *is* a probability and has no
 * confidence at all. Calling a noul value "confidence" would invite putting
 * the two through the same threshold check, which they do not share.
 */
export type Judgment = {
  intent: Intent;
  /** Confidence of the intent `choice`, 0-1. */
  intentConfidence: number;

  /** Noul probability that the user really ate or drank this, 0-1. */
  actualConsumptionProbability: number;
  /** Noul probability that we must ask before touching the log, 0-1. */
  clarificationProbability: number;

  /** Which existing item is meant; null when none applies or none fits. */
  referenceTargetId: string | null;
  /** Confidence of the reference `choice`, 0-1. Null when it was not asked. */
  referenceConfidence: number | null;

  /** Which implementation answered. Surfaced so QA can tell them apart. */
  source: "jev" | "mock";
};

/** The port. `/api/chat` depends on this, never on the SDK. */
export interface Judge {
  judge(input: JudgmentInput): Promise<Judgment>;
}
