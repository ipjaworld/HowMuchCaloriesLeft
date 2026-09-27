import {
  isAdoptable,
  optionFor,
  planFor,
  type BodyFacts,
  type DietProfile,
  type DietProfileRepository,
  type GoalMode,
} from "@/domain/dietProfile";
import type { DailyGoal } from "@/domain/meal";
import type { DailyGoalRepository } from "@/domain/repository";
import { setDailyGoal } from "./dailyGoal";

/**
 * The calculator's two use cases: whether to offer it, and what adopting a
 * calculated target does.
 *
 * Adopting writes an ordinary `DailyGoal` through the same `setDailyGoal` the
 * manual field uses. After that, nothing in the app can tell a calculated
 * target from a typed one — and a typed one set later simply wins, because
 * it is the newer `DailyGoal`. The calculator is a way *into* the goal, not a
 * second kind of goal.
 */

/**
 * The first-visit prompt appears only for someone who has neither a goal nor
 * a profile and has never answered it. Anyone already using the app with a
 * typed goal is not interrupted — and answering it once, either way, is final;
 * the calculator stays one tap away in the goal control.
 */
export function shouldOfferCalculator(state: {
  hasGoal: boolean;
  hasProfile: boolean;
  promptSeen: boolean;
}): boolean {
  return !state.hasGoal && !state.hasProfile && !state.promptSeen;
}

export type AdoptResult =
  | { ok: true; goal: DailyGoal; profile: DietProfile }
  | { ok: false; reason: "invalid_facts" | "not_adoptable" | "goal_rejected" };

/**
 * Recomputes the target from the facts rather than taking the number the
 * screen showed. The screen is a view of this calculation, not an input to
 * it: a stale or tampered figure cannot become the goal, and a mode below the
 * suggestion floor is refused here as well as greyed out there.
 *
 * The goal is written first and the profile second, so a rejected goal leaves
 * no profile behind that claims a target was set.
 */
export async function adoptCalculatedGoal(
  repositories: { goals: DailyGoalRepository; profile: DietProfileRepository },
  input: { date: string; facts: BodyFacts; goalMode: GoalMode; now: Date },
): Promise<AdoptResult> {
  const plan = planFor(input.facts);
  if (plan === null) return { ok: false, reason: "invalid_facts" };

  const option = optionFor(plan, input.goalMode);
  if (!isAdoptable(option)) return { ok: false, reason: "not_adoptable" };

  const result = await setDailyGoal(repositories.goals, input.date, option.target);
  if (!result.ok) return { ok: false, reason: "goal_rejected" };

  const profile: DietProfile = {
    ...input.facts,
    goalMode: input.goalMode,
    updatedAt: input.now.toISOString(),
  };
  await repositories.profile.set(profile);
  await repositories.profile.markPromptSeen();

  return { ok: true, goal: result.goal, profile };
}
