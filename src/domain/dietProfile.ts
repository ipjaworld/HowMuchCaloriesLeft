import { isValidDailyGoal } from "./limits";

/**
 * Estimating a daily calorie target from a few facts about the person.
 *
 * Why this exists. The app's one promise is "how much more can I eat today",
 * and that needs a target. The first version asked for the number outright,
 * and in real use the people who most need the app — someone starting a diet
 * — are exactly the people who do not know it. They stopped at the first
 * screen. This module gives them a reasonable starting number; the manual
 * field stays, and anything typed there wins.
 *
 * What it is not. Every number here is an *estimate* from a population
 * equation, not a measurement of this person's metabolism, and the UI says
 * "예상 유지 칼로리" for that reason. It is also not advice: the app picks no
 * mode for anyone, and it does not *suggest* a loss target under the
 * automatic-suggestion floor below.
 *
 * Pure functions, no storage, no AI. The same split as the rest of the app:
 * code calculates.
 *
 * ─ The equation ────────────────────────────────────────────────────────────
 *
 * Mifflin-St Jeor (Mifflin et al., Am J Clin Nutr 1990;51:241-247):
 *
 *   BMR = 10 × weight(kg) + 6.25 × height(cm) − 5 × age(y) + s
 *         s = +5 for men, −161 for women
 *
 * Chosen because the Academy of Nutrition and Dietetics' evidence review
 * (Frankenfield et al., J Am Diet Assoc 2005;105:775-789) found it the most
 * likely of the common equations to land within 10% of measured resting
 * energy in both non-obese and obese adults — Harris-Benedict overestimates
 * more often, and the newer ones need body-composition inputs a person does
 * not have. It is also the structure the product asked for: BMR, then an
 * activity multiplier, then maintenance.
 *
 * The 2020 Korean DRI (보건복지부·한국영양학회) uses the IOM 2005 EER equations
 * instead, which fold activity into a physical-activity coefficient rather
 * than a multiplier. Considered and not used: their PA categories are defined
 * by measured activity ratios a person cannot self-report, and they do not
 * split into BMR × multiplier, which is what makes the result explainable in
 * one line.
 *
 * ─ Activity multipliers ────────────────────────────────────────────────────
 *
 * 1.2 / 1.375 / 1.55 / 1.725 — the conventional factors applied to a
 * predictive BMR. They are conventions, not measurements, which is one more
 * reason the result is only ever called an estimate. The fifth conventional
 * level (1.9, athletes and heavy labour) is left out: it is rare among the
 * people this app is for, and the easiest one to pick wishfully.
 *
 * ─ Modes ───────────────────────────────────────────────────────────────────
 *
 * Maintenance, −300 and −700 kcal a day. Fixed deficits rather than a
 * percentage so the modes read the same for everyone and can be explained in
 * a sentence. 700 sits inside the 500–1,000 kcal/day deficit the NHLBI expert
 * panel describes for weight loss; 300 is a gentler step below it.
 *
 * ─ The automatic-suggestion floor ──────────────────────────────────────────
 *
 * What it is: a conservative guardrail on what the app *proposes by itself*.
 * What it is not: a safety limit, a risk threshold, or a minimum anyone must
 * eat. It says nothing about any particular person, and neither the code
 * nor the UI may present it that way — the UI only says the app does not
 * suggest targets under it.
 *
 * Two numbers, two unrelated jobs:
 *
 *   - `MIN_DAILY_GOAL_CALORIES` (500) in `limits.ts` is a typo guard on the
 *     goal field. It is not a health threshold either.
 *   - `SUGGESTED_TARGET_FLOOR` is where the value comes from for suggestions:
 *     the NHLBI Clinical Guidelines on Overweight and Obesity (1998) describe
 *     low-calorie diets as supplying 1,000–1,200 kcal/day for women and
 *     1,200–1,600 kcal/day for men. The *top* of each range is used, which
 *     makes the guardrail conservative — the app stops suggesting earlier
 *     than any reading of that range would.
 *
 * Only a *loss* mode is gated, and only from one-tap adoption; the UI says
 * the app does not suggest it, without judging it. `fast_loss` is not a
 * risky mode — for most people it is offered like the others. Maintenance is
 * never gated; it is not a deficit. The person can type any number into the
 * manual field within the technical bounds — the guardrail governs what the
 * app suggests, not what a person may choose.
 */

export const SEXES = ["female", "male"] as const;
export type Sex = (typeof SEXES)[number];

export const ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "active"] as const;
export type ActivityLevel = (typeof ACTIVITY_LEVELS)[number];

export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
};

export const GOAL_MODES = ["maintenance", "moderate_loss", "fast_loss"] as const;
export type GoalMode = (typeof GOAL_MODES)[number];

/** kcal below estimated maintenance, per mode. */
export const GOAL_DEFICITS: Record<GoalMode, number> = {
  maintenance: 0,
  moderate_loss: 300,
  fast_loss: 700,
};

/**
 * The lowest loss target the app will *suggest* on its own — a conservative
 * suggestion guardrail, not a safety limit. See the header for the source.
 */
export const SUGGESTED_TARGET_FLOOR: Record<Sex, number> = {
  female: 1200,
  male: 1600,
};

/**
 * Input bounds. Technical, like `limits.ts`: they catch a typo ("7O kg",
 * "1700 cm") and keep the equation inside the adult range it was fitted on.
 * Under 19 is refused because Mifflin-St Jeor was not built for growing
 * bodies, and a teenager's target is not this app's call.
 */
export const PROFILE_BOUNDS = {
  weightKg: { min: 30, max: 250 },
  heightCm: { min: 120, max: 230 },
  age: { min: 19, max: 100 },
} as const;

/** The facts the equation needs. Nothing derived is stored alongside them. */
export type BodyFacts = {
  weightKg: number;
  heightCm: number;
  age: number;
  sex: Sex;
  activityLevel: ActivityLevel;
};

export type ProfileField = keyof typeof PROFILE_BOUNDS;

/** Which numeric fields are out of range — empty when all are usable. */
export function invalidFields(facts: Pick<BodyFacts, ProfileField>): ProfileField[] {
  return (Object.keys(PROFILE_BOUNDS) as ProfileField[]).filter((field) => {
    const value = facts[field];
    const { min, max } = PROFILE_BOUNDS[field];
    return !Number.isFinite(value) || value < min || value > max;
  });
}

/** Mifflin-St Jeor, unrounded. */
export function basalMetabolicRate({ weightKg, heightCm, age, sex }: BodyFacts): number {
  const offset = sex === "male" ? 5 : -161;
  return 10 * weightKg + 6.25 * heightCm - 5 * age + offset;
}

/**
 * Estimated maintenance, rounded to the nearest 10 kcal. The equation's own
 * error is roughly ±10%, so a figure like 1,987 claims a precision it does
 * not have; 1,990 does not.
 */
export function estimatedMaintenance(facts: BodyFacts): number {
  const raw = basalMetabolicRate(facts) * ACTIVITY_MULTIPLIERS[facts.activityLevel];
  return Math.round(raw / 10) * 10;
}

export type ModeOption = {
  mode: GoalMode;
  target: number;
  /** Under the automatic-suggestion floor: shown, not offered for one-tap adoption. */
  belowFloor: boolean;
  /**
   * Outside what the goal field accepts at all (`limits.ts`). Only reachable
   * at the very edge of the input bounds, but a suggestion the goal field
   * would then reject is a dead end, so it is flagged rather than offered.
   */
  outOfRange: boolean;
};

export type CaloriePlan = {
  maintenance: number;
  floor: number;
  options: ModeOption[];
};

/**
 * Everything the calculator screen shows, from the facts alone. Returns null
 * when a field is out of range, so a half-typed form never shows a number.
 */
export function planFor(facts: BodyFacts): CaloriePlan | null {
  if (invalidFields(facts).length > 0) return null;

  const maintenance = estimatedMaintenance(facts);
  const floor = SUGGESTED_TARGET_FLOOR[facts.sex];

  return {
    maintenance,
    floor,
    options: GOAL_MODES.map((mode) => {
      const deficit = GOAL_DEFICITS[mode];
      const target = maintenance - deficit;
      // Only a deficit can be "too low to suggest". Eating at one's own
      // estimated maintenance is not a diet, whatever the number.
      return {
        mode,
        target,
        belowFloor: deficit > 0 && target < floor,
        outOfRange: !isValidDailyGoal(target),
      };
    }),
  };
}

/** Whether an option can be adopted with one tap. */
export function isAdoptable(option: ModeOption): boolean {
  return !option.belowFloor && !option.outOfRange;
}

/** The option for one mode. Always present — `planFor` lists every mode. */
export function optionFor(plan: CaloriePlan, mode: GoalMode): ModeOption {
  const found = plan.options.find((option) => option.mode === mode);
  if (found === undefined) throw new Error(`no option for ${mode}`);
  return found;
}

/**
 * What is stored: the facts, the chosen mode, and when. Maintenance and the
 * target are *not* stored — they are derived, like a record's total, and a
 * stored copy could only ever drift from the facts it came from. The target
 * the app actually uses lives in `DailyGoal`, same as a hand-typed one.
 */
export type DietProfile = BodyFacts & {
  goalMode: GoalMode;
  /** ISO datetime of the last save. */
  updatedAt: string;
};

/**
 * The calculator's inputs, kept on this device only. Deliberately *not* behind
 * the same "could move to a server later" promise as the meal and goal
 * repositories: body facts are the one thing this app has promised never to
 * send anywhere.
 */
export interface DietProfileRepository {
  get(): Promise<DietProfile | null>;
  set(profile: DietProfile): Promise<void>;
  clear(): Promise<void>;
  /** True once the first-visit calculator prompt has been answered either way. */
  hasSeenPrompt(): Promise<boolean>;
  markPromptSeen(): Promise<void>;
}
