import {
  invalidFields,
  type ActivityLevel,
  type BodyFacts,
  type DietProfile,
  type GoalMode,
  type ProfileField,
  type Sex,
} from "@/domain/dietProfile";

/**
 * The calculator form's fields, and the conversion from what was typed to the
 * facts the equation takes. Kept out of the dialog so the one mistake that
 * matters here — a height landing in the weight — can be tested without a
 * browser.
 */

/**
 * The order the fields appear in, and the first one takes focus.
 *
 * 키 before 몸무게 because that is the order Korean forms and health apps
 * ask in, and people type from habit without reading the label. A tester
 * typed their height into the weight box, and nothing caught it: 184 is a
 * valid weight (30–250 kg). The order is the only guard that works on
 * someone who is not reading.
 */
export const PROFILE_FIELD_ORDER: readonly ProfileField[] = ["heightCm", "weightKg", "age"];

export const FIELD_LABELS: Record<ProfileField, { label: string; unit: string }> = {
  heightCm: { label: "키", unit: "cm" },
  weightKg: { label: "몸무게", unit: "kg" },
  age: { label: "나이", unit: "세" },
};

export type Draft = Record<ProfileField, string> & {
  sex: Sex | null;
  activityLevel: ActivityLevel | null;
  goalMode: GoalMode | null;
};

export function draftFrom(profile: DietProfile | null): Draft {
  if (profile === null) {
    return { heightCm: "", weightKg: "", age: "", sex: null, activityLevel: null, goalMode: null };
  }
  return {
    heightCm: String(profile.heightCm),
    weightKg: String(profile.weightKg),
    age: String(profile.age),
    sex: profile.sex,
    activityLevel: profile.activityLevel,
    goalMode: profile.goalMode,
  };
}

/** The facts, once every field holds a usable value. Fields map by name, never by position. */
export function factsFrom(draft: Draft): BodyFacts | null {
  if (draft.sex === null || draft.activityLevel === null) return null;
  if (draft.weightKg === "" || draft.heightCm === "" || draft.age === "") return null;
  const facts: BodyFacts = {
    weightKg: Number(draft.weightKg),
    heightCm: Number(draft.heightCm),
    age: Number(draft.age),
    sex: draft.sex,
    activityLevel: draft.activityLevel,
  };
  if (!Number.isInteger(facts.age)) return null;
  return invalidFields(facts).length === 0 ? facts : null;
}

/** What a keystroke leaves in a field: digits, plus one decimal point for weight. */
export function cleanFieldInput(field: ProfileField, value: string): string {
  const cleaned =
    field === "weightKg"
      ? value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")
      : value.replace(/\D/g, "");
  return cleaned.slice(0, 5);
}
