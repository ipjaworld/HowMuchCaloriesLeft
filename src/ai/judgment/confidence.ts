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
 * STATUS: **measured.** `pnpm eval:jev` ran the 60-case Korean golden set
 * against `jev-1.13.0` on 2026-09-23. Headline: intent 93.3% (56/60),
 * actual_consumption 96.7% (58/60), reference_target 95.0% (19/20).
 *
 * Every number below is now either confirmed by that run or changed by it,
 * and the reasoning is recorded next to each one. Two caveats that matter
 * when re-reading them:
 *
 *   - It is one run of 60 cases. Per-intent sample sizes are single digits
 *     for `delete_food` and `other`, so these are operating points chosen
 *     from evidence, not converged estimates. Confidence drifted by up to
 *     ~0.03 between two runs of the same fixture, so a threshold tuned to
 *     0.01 would be fitting noise.
 *   - The golden set is also what the mock's rules were written against, so
 *     the mock's score is a regression baseline, never evidence about Jev.
 *     The two judges' *disagreements* are the informative part.
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
  // Read-only. A wrong guess costs one unhelpful sentence, so there is
  // nothing to confirm — an empty confirm band means anything under `auto`
  // goes straight to clarify, which is what the architecture doc always
  // described. (Before measurement these carried `confirm: 0.3`, which no
  // read-only branch in `decideCommand` ever consulted: the effective floor
  // was 0.3, not the documented 0.5. Measured: "많이 먹었어" came back
  // ask_status at 0.30 and was answered instead of asked about.)
  ask_status: { auto: 0.5, confirm: 0.5 },
  ask_recommendation: { auto: 0.5, confirm: 0.5 },
  other: { auto: 0.5, confirm: 0.5 },

  // Writes a new entry. Recoverable, but it moves the number on screen.
  // Measured: 18 add predictions, 0 wrong. Every unambiguous report sat at
  // >= 0.90; the only two below were "밥 먹었어" (0.49) and "좀 먹었음"
  // (0.81), which are exactly the ones that should be asked about. 0.9
  // splits them cleanly, so it stands.
  add_food: { auto: 0.9, confirm: 0.5 },

  // Rewrites something the user already has.
  // Measured: 11 modify predictions, 0 wrong, lowest 0.65. At 0.9 the two
  // flagship corrections — "아까 밥 반만 먹었어" (0.87) and "아까 밥은 절반
  // 정도 남겼어" (0.89) — needed a confirmation tap every time, which is the
  // app's primary demo path. Lowered to 0.85: it clears both and still sends
  // "그 김밥 반만 먹었어" (0.65) to confirm. A modify is visible and
  // reversible, so the cost of being wrong here is bounded.
  modify_food: { auto: 0.85, confirm: 0.5 },

  // Destructive, and the user may not notice it happened.
  // Measured: 9 delete predictions, 0 false positives, lowest 0.73. Zero FP
  // is not evidence that a lower bar is safe — it is evidence that nothing
  // has tested one. Deliberately left at 0.95, so "커피는 안 마셨음" (0.73)
  // and "갈비탕 잘못 입력했어 지워줘" (0.88) still ask first. One extra tap
  // is the cheaper error.
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
   *
   * Measured: 58/60. It holds up well at 0.5 — every knowledge question
   * scored <= 0.05 — and the two misses do not move it. "아침에 먹은 거
   * 칼로리 얼마야?" reads as consumption at 0.64, but it is judged
   * `ask_status`, which never writes, so the value is never consulted. The
   * bare noun "라면" lands at 0.45 and is dropped; lowering the bar to catch
   * it would let the 0.64 case through, so the bare-food-name gap is left
   * open and handled where it belongs — see `docs/architecture.md`.
   */
  actualConsumption: 0.5,
  /**
   * At or above this, ask before touching stored data.
   *
   * Raised 0.5 -> 0.85 on measurement. This noul is the weakest of the four
   * in Korean by a wide margin: at 0.5 it fired on 44 of 60 cases, marking
   * plain reports like "점심에 갈비탕 먹음" as needing clarification. The two
   * distributions overlap almost end to end — cases that genuinely need
   * asking run 0.34-0.94, cases that do not run 0.19-0.93 — so no threshold
   * separates them and this is an operating point, not a clean split.
   *
   * 0.85 is chosen to favour the cheaper error. Across the golden set it
   * cuts needless interruptions from 18 to 8 and roughly doubles the
   * messages acted on (12 -> 22) while still catching 7 of the 9 cases that
   * should be asked about. Pushing to 0.90 trades two more of those away to
   * save two interruptions, which is the wrong direction: silently acting on
   * an ambiguous sentence is worse than one extra question.
   *
   * Note what does *not* depend on this number. Read-only intents never
   * consult it. Bulk deletes ("점심 기록 지워줘") score low here — Jev is
   * right that they are unambiguous — and are caught instead by the
   * deterministic rule in `decideCommand`: a delete with no single target
   * always asks. Ambiguity and destructiveness are different questions, and
   * only the first one belongs in a noul.
   */
  clarificationNeeded: 0.85,
} as const;

export function isProbable(probability: number, threshold: number): boolean {
  return probability >= threshold;
}

/**
 * A reference target this weak is not worth acting on as given.
 *
 * Measured, and the cleanest result of the run: all 19 correct references
 * carried confidence >= 0.74, and the single miss carried 0.29. The floor
 * separates them perfectly with room on both sides, so 0.5 stands.
 *
 * Below the floor `decideCommand` does not give up — it asks the code
 * heuristic in `referenceHeuristic.ts`, which resolves exactly the deictic
 * phrasing Jev missed ("방금 넣은 거 취소해줘").
 */
export const REFERENCE_CONFIDENCE_FLOOR = 0.5;
