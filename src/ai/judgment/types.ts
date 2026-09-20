/**
 * The judgment vocabulary shared by the Jev integration, the mock judge and
 * the Korean golden set. This is the single source of truth: Phase 4 builds
 * Jev's `choice` criteria from `INTENTS`, so a label can never drift between
 * the question, the fixture and the application switch.
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

/** Meal types live in the domain; the golden set reuses them rather than
 * keeping a second copy that could drift. */
export { MEAL_TYPES, type MealType } from "@/domain/meal";

/**
 * A judgment as the application consumes it, after schema validation and the
 * confidence policy have run. Probabilities stay in the AI layer.
 *
 * Note the asymmetry, which comes straight from the TypeSafe API: `choice`
 * answers carry a separate `confidence`, while `noul` answers are themselves a
 * probability and have no confidence field. The two are never mixed.
 */
export type Judgment = {
  intent: Intent;
  /** Confidence of the `intent` choice, 0-1. */
  intentConfidence: number;
  /** Noul probability that the user really ate or drank this, 0-1. */
  isActualConsumption: number;
  /** Noul probability that we must ask before touching the record, 0-1. */
  needsClarification: number;
  /** Which existing item the user means; null when none applies or none fits. */
  referenceTargetId: string | null;
  /** Confidence of the `referenceTarget` choice, 0-1. Null when not asked. */
  referenceTargetConfidence: number | null;
};
