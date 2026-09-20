import type { Intent } from "./types";

/**
 * Every threshold in the app, in one file.
 *
 * Two kinds of number arrive from Jev and they are kept apart on purpose:
 *
 *   - a `choice` answer has a separate `confidence` — how peaked the
 *     distribution over the labels is;
 *   - a `noul` answer *is* a probability and has no confidence at all.
 *
 * They are not comparable, so they get different functions. Putting a noul
 * value through `classifyConfidence` would be reading "70% sure the answer is
 * yes" as "70% confident", which is a different claim.
 *
 * STATUS: **Jev integration implemented, real Korean accuracy not yet
 * validated.** There has been no `TYPESAFE_API_KEY`, so Jev has never
 * actually been called and every number below is a documented starting
 * point rather than a measurement.
 *
 * What settles them is `pnpm eval:jev` against the 60-case Korean golden
 * set. Until that has run, do not read these as tuned, and do not treat the
 * mock's scores as evidence about Jev — those rules were written against
 * the same fixture they are scored on.
 */

export type ConfidenceDecision = "auto" | "confirm" | "clarify";

export type ConfidenceThresholds = {
  /** At or above this, act without asking. */
  auto: number;
  /** At or above this but below `auto`, act only after the user confirms. */
  confirm: number;
};

/**
 * Risk-weighted per intent: reading the day's totals changes nothing, so it
 * can act on a weak signal, while deleting someone's record cannot.
 */
export const INTENT_THRESHOLDS: Record<Intent, ConfidenceThresholds> = {
  // Read-only. A wrong guess costs one unhelpful sentence.
  ask_status: { auto: 0.5, confirm: 0.3 },
  ask_recommendation: { auto: 0.5, confirm: 0.3 },
  other: { auto: 0.5, confirm: 0.3 },

  // Writes a new entry. Recoverable, but it moves the number on screen.
  add_food: { auto: 0.9, confirm: 0.5 },

  // Rewrites something the user already has.
  modify_food: { auto: 0.9, confirm: 0.5 },

  // Destructive, and the user may not notice it happened.
  delete_food: { auto: 0.95, confirm: 0.7 },
};

/** For `choice` answers only — intent and reference target. */
export function classifyConfidence(
  confidence: number,
  thresholds: ConfidenceThresholds,
): ConfidenceDecision {
  if (confidence >= thresholds.auto) return "auto";
  if (confidence >= thresholds.confirm) return "confirm";
  return "clarify";
}

export function classifyIntentConfidence(
  intent: Intent,
  confidence: number,
): ConfidenceDecision {
  return classifyConfidence(confidence, INTENT_THRESHOLDS[intent]);
}

/**
 * For `noul` answers only. A noul is already the probability of "yes", so the
 * question is simply whether it clears the bar — there is no three-way
 * auto/confirm/clarify split to make from it.
 */
export const NOUL_THRESHOLDS = {
  /**
   * Below this, the message is not treated as a report of something eaten —
   * this is what stops "갈비탕 칼로리 높아?" from becoming an entry.
   */
  actualConsumption: 0.5,
  /** At or above this, ask before touching stored data. */
  clarificationNeeded: 0.5,
} as const;

export function isProbable(probability: number, threshold: number): boolean {
  return probability >= threshold;
}

/** A reference target this weak is not worth acting on without asking. */
export const REFERENCE_CONFIDENCE_FLOOR = 0.5;
