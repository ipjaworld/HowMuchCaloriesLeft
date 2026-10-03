import { cleanFoodLabel } from "@/ai/nutrition/statedCalories";
import { GENERIC_REPRESENTATIVE_IDS } from "@/ai/nutrition/modifierPolicy";
import type { NutritionResolver } from "@/ai/nutrition/types";
import { resolveAddParts, type AddPart } from "./addFood";

/**
 * Scoring for `fixtures/food-modifier-cases.json` — words in front of a food
 * name. Kept apart from the food-input corpus: the question here is not
 * "was the food found" but "did a modifier change which food, or how much the
 * user is asked", and the two denominators must not mix.
 *
 * Accuracy and question burden are counted separately, so neither can be
 * bought with the other: asking about everything scores zero wrong and many
 * unnecessary; recording everything does the reverse.
 */

export type ModifierExpect =
  | { status: "resolved"; entry: string; amount?: string }
  /** Not recorded: no part is the food, and nothing is recorded under it. */
  | { status: "nothing"; food?: string }
  | { status: "unmeasurable"; entry: string }
  | { status: "ambiguous"; candidates: string[] }
  | { status: "unknown"; label: string; amount?: string };

export type ModifierCase = {
  id: string;
  group: string;
  input: string;
  expect: ModifierExpect;
  pairOf?: string;
  why?: string;
  /**
   * An existing limit outside the code under test: `expect` stays the
   * product goal, `accepted` is the current behaviour, which must be safe.
   */
  limit?: { reason: string; accepted: ModifierExpect };
};

export type Outcome =
  | { kind: "exact"; entry: string; amount?: string }
  | { kind: "representative"; entry: string; amount?: string }
  | { kind: "choose"; candidates: string[] }
  | { kind: "amount"; entries: string[] }
  | { kind: "kcal"; label: string | null; amount?: string }
  | { kind: "dropped" };

export type ScoredCase = {
  case: ModifierCase;
  outcome: Outcome;
  correct: boolean;
  /** Recorded without asking, but not as the expected food. */
  wrongAuto: boolean;
  /** A question where none was expected, or a heavier one than needed (kcal where an amount or a choice would do). */
  unnecessary: boolean;
  /** A question that was expected. */
  needed: boolean;
  /** Reads differently from the input it is paired with. */
  inconsistent: boolean;
  /** Not the goal, but the accepted current behaviour of a known limit. */
  withinLimit: boolean;
  /** Questions about other phrases of the same sentence (story words read as food). */
  extraQuestions: number;
  /** Every phrase name, for the "nothing" check. */
  phrases: string[];
};

const squash = (text: string) => text.replace(/\s+/g, "");

/** The food a case is about: the part that ends the sentence (story phrases before it are not scored). */
function scoredPart(parts: AddPart[]): AddPart | undefined {
  return parts.at(-1);
}

function outcomeOf(part: AddPart | undefined, representativeNames: ReadonlySet<string>): Outcome {
  if (part === undefined) return { kind: "dropped" };
  switch (part.status) {
    case "resolved":
      // Recorded under a generic representative for words that are not its
      // own name — "생크림 케이크" → 케이크 — is counted apart from an exact hit.
      return {
        kind:
          representativeNames.has(part.item.name) && squash(part.phraseName) !== squash(part.item.name)
            ? "representative"
            : "exact",
        entry: part.item.name,
        ...(part.item.amount === undefined ? {} : { amount: part.item.amount }),
      };
    case "ambiguous":
      return { kind: "choose", candidates: part.candidates.map((candidate) => candidate.name).sort() };
    case "unmeasurable":
      return { kind: "amount", entries: part.entries.map((entry) => entry.name) };
    case "unknown":
      return {
        kind: "kcal",
        label: cleanFoodLabel(part.phraseName),
        ...(part.amount === undefined ? {} : { amount: part.amount }),
      };
    case "skipped":
      return { kind: "dropped" };
  }
}

function signature(outcome: Outcome): string {
  switch (outcome.kind) {
    case "exact":
    case "representative":
      return `resolved:${outcome.entry}`;
    case "choose":
      return `choose:${outcome.candidates.join("|")}`;
    case "amount":
      return `amount:${outcome.entries.join("|")}`;
    case "kcal":
      return "kcal";
    case "dropped":
      return "dropped";
  }
}

const QUESTION_WEIGHT: Record<Outcome["kind"], number> = {
  exact: 0,
  representative: 0,
  amount: 1,
  choose: 1,
  kcal: 2,
  dropped: 0,
};

function expectedWeight(expect: ModifierExpect): number {
  return expect.status === "resolved" || expect.status === "nothing" ? 0 : expect.status === "unknown" ? 2 : 1;
}

function matches(expect: ModifierExpect, outcome: Outcome, phrases: string[]): boolean {
  switch (expect.status) {
    case "nothing":
      return (
        (outcome.kind === "dropped" || outcome.kind === "kcal") &&
        (expect.food === undefined || !phrases.some((phrase) => squash(phrase).includes(squash(expect.food ?? ""))))
      );
    case "resolved":
      return (
        (outcome.kind === "exact" || outcome.kind === "representative") &&
        outcome.entry === expect.entry &&
        (expect.amount === undefined || outcome.amount === expect.amount)
      );
    case "unmeasurable":
      return outcome.kind === "amount" && outcome.entries.includes(expect.entry);
    case "ambiguous":
      return outcome.kind === "choose" && outcome.candidates.join("|") === [...expect.candidates].sort().join("|");
    case "unknown":
      return (
        outcome.kind === "kcal" &&
        (expect.label === "" || (outcome.label !== null && squash(outcome.label).includes(squash(expect.label)))) &&
        (expect.amount === undefined || outcome.amount === expect.amount)
      );
  }
}

export async function scoreModifierCases(
  cases: ModifierCase[],
  resolver: NutritionResolver,
  representativeNames: ReadonlySet<string>,
): Promise<ScoredCase[]> {
  const outcomes = new Map<string, Outcome>();
  const others = new Map<string, { extraQuestions: number; phrases: string[] }>();
  for (const item of cases) {
    const parts = await resolveAddParts(item.input, resolver);
    outcomes.set(item.id, outcomeOf(scoredPart(parts), representativeNames));
    others.set(item.id, {
      extraQuestions: parts.slice(0, -1).filter((part) => part.status !== "resolved" && part.status !== "skipped").length,
      phrases: parts.map((part) => part.phraseName),
    });
  }

  return cases.map((item) => {
    const outcome = outcomes.get(item.id) ?? { kind: "dropped" };
    const { extraQuestions, phrases } = others.get(item.id) ?? { extraQuestions: 0, phrases: [] };
    const correct = matches(item.expect, outcome, phrases);
    const withinLimit = !correct && item.limit !== undefined && matches(item.limit.accepted, outcome, phrases);
    const asked = QUESTION_WEIGHT[outcome.kind] > 0;
    const resolved = outcome.kind === "exact" || outcome.kind === "representative";
    const pair = item.pairOf === undefined ? undefined : outcomes.get(item.pairOf);
    return {
      case: item,
      outcome,
      correct,
      wrongAuto: resolved && !correct,
      unnecessary: asked && QUESTION_WEIGHT[outcome.kind] > expectedWeight(item.expect),
      needed: asked && QUESTION_WEIGHT[outcome.kind] <= expectedWeight(item.expect) && expectedWeight(item.expect) > 0,
      inconsistent: pair !== undefined && signature(pair) !== signature(outcome),
      withinLimit,
      extraQuestions,
      phrases,
    };
  });
}

export type ModifierSummary = {
  total: number;
  correct: number;
  exact: number;
  representative: number;
  choose: number;
  amount: number;
  kcal: number;
  needed: number;
  unnecessary: number;
  wrongAuto: number;
  dropped: number;
  inconsistent: number;
  withinLimit: number;
  extraQuestions: number;
};

export function summarize(scored: ScoredCase[]): ModifierSummary {
  const count = (test: (item: ScoredCase) => boolean) => scored.filter(test).length;
  return {
    total: scored.length,
    correct: count((item) => item.correct),
    exact: count((item) => item.outcome.kind === "exact"),
    representative: count((item) => item.outcome.kind === "representative"),
    choose: count((item) => item.outcome.kind === "choose"),
    amount: count((item) => item.outcome.kind === "amount"),
    kcal: count((item) => item.outcome.kind === "kcal"),
    needed: count((item) => item.needed),
    unnecessary: count((item) => item.unnecessary),
    wrongAuto: count((item) => item.wrongAuto),
    dropped: count((item) => item.outcome.kind === "dropped"),
    inconsistent: count((item) => item.inconsistent),
    withinLimit: count((item) => item.withinLimit),
    extraQuestions: scored.reduce((sum, item) => sum + item.extraQuestions, 0),
  };
}

/** The names of the approved generic representatives, for telling a representative record from an exact one. */
export function representativeNamesFrom(entries: { id: string; name: string }[]): ReadonlySet<string> {
  return new Set(entries.filter((entry) => GENERIC_REPRESENTATIVE_IDS.has(entry.id)).map((entry) => entry.name));
}
