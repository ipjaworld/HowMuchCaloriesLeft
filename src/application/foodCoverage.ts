import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { parseAmountOnly } from "@/ai/nutrition/quantity";
import type { NutritionResolver } from "@/ai/nutrition/types";
import { resolveAddParts, type AddPart } from "./addFood";

/**
 * The food-input coverage corpus, and how one run of the add pipeline is
 * judged against it.
 *
 * `fixtures/korean-inputs.json` measures Jev: which intent a sentence carries.
 * This corpus measures what happens *after* that — given a sentence already
 * routed to add, what the deterministic pipeline (`resolveAddParts`) would
 * record, ask about, or drop. No model runs here and no network is touched.
 *
 * Expected values are the *correct* product behaviour, never what the code
 * currently does. "감자탕 먹었어" expects `unknown`, because the dataset has
 * no 감자탕; the code's 감자 is a failure to be counted, not a fixture to
 * match. A case the pipeline fails is a known gap, recorded in the baseline.
 */

export const FOOD_COVERAGE_PATH = path.join(
  process.cwd(),
  "fixtures",
  "food-input-coverage.json",
);

export const FOOD_COVERAGE_BASELINE_PATH = path.join(
  process.cwd(),
  "fixtures",
  "food-input-coverage.baseline.json",
);

/** Groups cases for reporting. A case has exactly one. */
export const COVERAGE_CATEGORIES = [
  "clean",
  "narrative",
  "multi_food",
  "compound_trap",
  "homograph_negative",
  "homograph_positive",
  "polarity",
  "quantity",
  "unknown",
  "unknown_mixed",
  /**
   * Sentences whose difficulty is not food parsing at all — "어제 먹은 거
   * 추가해줘" needs a record date the app does not have yet. Kept so the
   * sentence is not forgotten, and left out of every accuracy figure.
   */
  "unsupported_date",
] as const;

/** Categories that are recorded but never counted toward food-parsing accuracy. */
export const EXCLUDED_CATEGORIES: ReadonlySet<CoverageCategory> = new Set(["unsupported_date"]);

export type CoverageCategory = (typeof COVERAGE_CATEGORIES)[number];

const amountSchema = z.object({
  value: z.number().positive(),
  /** Only when the user named one: "한 줄" → 줄. "하나" and "반만" name none. */
  unit: z.string().min(1).optional(),
});

/**
 * One food the user actually ate, and what the app should do with it.
 *
 * `said` is the user's own word for it, used to find the part of the result
 * that is about this food. `entry` and `candidates` are dataset names.
 *
 *   resolved      record it — the dataset has this exact food and a portion
 *   ambiguous     ask which — the word really does cover several entries
 *   unmeasurable  ask how much — known food, no published portion
 *   unknown       ask for calories — the dataset does not have this food,
 *                 and pricing it as a food it merely contains is wrong
 */
const expectedFoodSchema = z.discriminatedUnion("status", [
  z.object({
    said: z.string().min(1),
    status: z.literal("resolved"),
    entry: z.string().min(1),
    amount: amountSchema.optional(),
  }),
  z.object({
    said: z.string().min(1),
    status: z.literal("ambiguous"),
    /** Every one of these must be offered. Extra offers are tolerated. */
    candidates: z.array(z.string().min(1)).min(2),
  }),
  z.object({
    said: z.string().min(1),
    status: z.literal("unmeasurable"),
    entry: z.string().min(1),
  }),
  z.object({
    said: z.string().min(1),
    status: z.literal("unknown"),
  }),
]);

export type ExpectedFood = z.infer<typeof expectedFoodSchema>;

const coverageCaseSchema = z
  .object({
    id: z.string().min(1),
    input: z.string().min(1),
    category: z.enum(COVERAGE_CATEGORIES),
    /** Why this case exists — the trap it sets or the behaviour it pins. */
    why: z.string().min(1),
    tags: z.array(z.string().min(1)).optional(),
    /**
     * False when the sentence reports no eating at all ("빵 터졌네",
     * "치킨 먹고 싶었는데 안 먹었어"). Nothing may be recorded or asked.
     */
    consumed: z.boolean(),
    /** What was eaten. Exhaustive: a recorded food not listed here is a false positive. */
    foods: z.array(expectedFoodSchema),
    /**
     * Dataset entries the sentence mentions but the user did not eat — 사과
     * in "친구한테 사과하고". Recording one is a false positive even when
     * it lands on a part that is also about a food that was eaten.
     */
    notEaten: z.array(z.string().min(1)).optional(),
  })
  .refine((c) => (c.consumed ? c.foods.length > 0 : c.foods.length === 0), {
    message: "a consumed case lists what was eaten; a non-consumed case lists nothing",
  });

export type CoverageCase = z.infer<typeof coverageCaseSchema>;

const corpusSchema = z.object({
  version: z.literal(1),
  cases: z.array(coverageCaseSchema).min(1),
});

export function loadCoverageCorpus(filePath = FOOD_COVERAGE_PATH): CoverageCase[] {
  const parsed = corpusSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
  const ids = new Set<string>();
  for (const c of parsed.cases) {
    if (ids.has(c.id)) throw new Error(`duplicate coverage case id: ${c.id}`);
    ids.add(c.id);
  }
  return parsed.cases;
}

/**
 * What happened to one expected food.
 *
 *   ok           the right thing
 *   wrong_food   recorded as a different food, without asking
 *   wrong_amount recorded as the right food, in the wrong amount
 *   over_asked   the right food was among the ones asked about, when the
 *                sentence already settled it
 *   wrong_ask    asked the user to choose among foods it is not
 *   missed       reported unknown when the dataset does have it, or asked
 *                about in a way that cannot settle it
 *   dropped      no part of the result is about it at all
 */
export type FoodOutcome =
  | "ok"
  | "wrong_food"
  | "wrong_amount"
  | "over_asked"
  | "wrong_ask"
  | "missed"
  | "dropped";

/**
 * One verdict per case, worst first. The first three are *silent*: the app
 * writes a number to the day without asking, and the number is wrong.
 *
 *   false_positive      recorded something that was not eaten
 *   wrong_food          recorded an eaten food as another food
 *   wrong_amount        recorded the right food in the wrong amount
 *   silent_drop         an eaten food vanished — no record, no question —
 *                       while the rest of the sentence was handled, so the
 *                       user has no reason to notice. As bad as a wrong
 *                       record: the day's total is wrong either way.
 *   nothing_found       a report of eating produced nothing at all. A
 *                       failure, but a visible one: the app says it found
 *                       nothing, and the user can say it again.
 *   partial_multi_food  two or more foods, not all of them handled right
 *   false_negative      an eaten food is neither recorded nor properly asked
 *                       about (dropped, or unknown though the dataset has it)
 *   wrong_ask           asks the user to pick among foods that are not it
 *   spurious_ask        everything eaten is handled, but it also asks about
 *                       a non-food ("퇴근 대략 몇 kcal였나요?")
 *   correct_*           the whole sentence handled as the product intends
 */
export const COVERAGE_VERDICTS = [
  "false_positive",
  "wrong_food",
  "wrong_amount",
  "silent_drop",
  "nothing_found",
  "partial_multi_food",
  "false_negative",
  "wrong_ask",
  "spurious_ask",
  "correct_resolved",
  "correct_ask",
  "correct_unknown",
  "correct_not_consumed",
] as const;

export type CoverageVerdict = (typeof COVERAGE_VERDICTS)[number];

export const SILENT_WRONG_VERDICTS: ReadonlySet<CoverageVerdict> = new Set([
  "false_positive",
  "wrong_food",
  "wrong_amount",
]);

/** A food lost without a word. Counted beside silent wrong, never inside a milder bucket. */
export const SILENT_DROP_VERDICTS: ReadonlySet<CoverageVerdict> = new Set(["silent_drop"]);

export function isCorrect(verdict: CoverageVerdict): boolean {
  return verdict.startsWith("correct_");
}

export type CaseResult = {
  testCase: CoverageCase;
  verdict: CoverageVerdict;
  foods: { expected: ExpectedFood; outcome: FoodOutcome }[];
  /** The pipeline's parts, flattened to one line each for the report. */
  actual: string[];
  /**
   * Every part that is not a record is a question to the user. `valid` is
   * one the product wants asked — a food eaten that the data cannot settle,
   * asked about in the right terms. `unnecessary` is everything else: a
   * question about a non-food, about a food not eaten, about a known food
   * the sentence already settled, or offering the wrong foods.
   */
  asks: { valid: number; unnecessary: number };
};

function squash(text: string): string {
  return text.replace(/\s+/g, "");
}

/** Dataset names a part points at, whatever its status. */
function namesOf(part: AddPart): string[] {
  switch (part.status) {
    case "resolved":
      return [part.item.name];
    case "ambiguous":
      return part.candidates.map((candidate) => candidate.name);
    case "unmeasurable":
      return part.entries.map((entry) => entry.name);
    case "unknown":
    case "skipped":
      return [];
  }
}

/** One line per part: `resolved 김밥 (한 줄) ← "김밥"`. No calorie figures, so a re-sync does not churn it. */
export function describePart(part: AddPart): string {
  const said = `← "${part.phraseName}"`;
  switch (part.status) {
    case "resolved":
      return `resolved ${part.item.name}${part.item.amount === undefined ? "" : ` (${part.item.amount})`} ${said}`;
    case "ambiguous":
      return `ambiguous ${namesOf(part).join("|")} ${said}`;
    case "unmeasurable":
      return `unmeasurable ${namesOf(part).join("|")} [${part.reason}] ${said}`;
    case "unknown":
    case "skipped":
      return `${part.status} ${said}`;
  }
}

function amountMatches(
  expected: z.infer<typeof amountSchema> | undefined,
  stored: string | undefined,
): boolean {
  if (expected === undefined) return true;
  if (stored === undefined) return false;
  // The production amount reader, so "한 줄" and "1줄" compare equal.
  const read = parseAmountOnly(stored);
  if (read === null) return false;
  if (Math.abs(read.value - expected.value) > 1e-9) return false;
  return expected.unit === undefined || read.unit === expected.unit;
}

/** How one part fares as the answer for one expected food. */
function judgePart(expected: ExpectedFood, part: AddPart): FoodOutcome {
  const names = namesOf(part);

  switch (expected.status) {
    case "resolved":
      if (part.status === "resolved") {
        if (part.item.name !== expected.entry) return "wrong_food";
        return amountMatches(expected.amount, part.item.amount) ? "ok" : "wrong_amount";
      }
      if (part.status === "ambiguous" || part.status === "unmeasurable") {
        return names.includes(expected.entry) ? "over_asked" : "wrong_ask";
      }
      return "missed";

    case "ambiguous":
      if (part.status === "ambiguous") {
        return expected.candidates.every((name) => names.includes(name)) ? "ok" : "wrong_ask";
      }
      // Picking one of several without asking is still a silent guess.
      if (part.status === "resolved") return "wrong_food";
      if (part.status === "unmeasurable") return "wrong_ask";
      return "missed";

    case "unmeasurable":
      if (part.status === "unmeasurable") {
        return names.includes(expected.entry) ? "ok" : "wrong_ask";
      }
      if (part.status === "resolved") {
        return part.item.name === expected.entry ? "wrong_amount" : "wrong_food";
      }
      if (part.status === "ambiguous") {
        return names.includes(expected.entry) ? "over_asked" : "wrong_ask";
      }
      return "missed";

    case "unknown":
      if (part.status === "unknown" || part.status === "skipped") return "ok";
      // Priced as a food it only contains: 감자탕 → 감자.
      if (part.status === "resolved") return "wrong_food";
      return "wrong_ask";
  }
}

/** Worst first, so a food answered by two parts reports the worse unless one is right. */
const OUTCOME_SEVERITY: FoodOutcome[] = [
  "wrong_food",
  "wrong_amount",
  "wrong_ask",
  "over_asked",
  "missed",
  "ok",
];

function judgeFood(expected: ExpectedFood, linked: AddPart[]): FoodOutcome {
  if (linked.length === 0) return "dropped";
  // The same food recorded twice — "떡볶이랑 튀김 먹었는데 떡볶이는 반만"
  // storing 1인분 and 반 — overcounts even when one of the two is right.
  if (
    expected.status === "resolved" &&
    linked.filter((part) => part.status === "resolved" && part.item.name === expected.entry)
      .length > 1
  ) {
    return "wrong_amount";
  }
  const outcomes = linked.map((part) => judgePart(expected, part));
  if (outcomes.includes("ok")) return "ok";
  return OUTCOME_SEVERITY.find((outcome) => outcomes.includes(outcome)) ?? "missed";
}

/**
 * Whether a part is about the food the user called `said`.
 *
 * Usually the part's phrase contains the word: "기분이 안좋아서 떡볶이를"
 * is about 떡볶이. The other direction covers a phrase the splitter cut
 * short — "떡볶이랑 순대" splits on 이랑 and leaves "떡볶", which is still
 * the 떡볶이 part. Two syllables at least, so a stray "배" is not about 배추.
 */
export function isAbout(part: AddPart, said: string): boolean {
  const phrase = squash(part.phraseName);
  const word = squash(said);
  return phrase.includes(word) || (phrase.length >= 2 && word.includes(phrase));
}

/**
 * Judges one pipeline result against its case.
 *
 * A part belongs to an expected food when the part's phrase contains the
 * user's word for it — the pipeline keeps the user's wording on every part,
 * so this needs no knowledge of how the sentence was split. A part that
 * belongs to no expected food is something the app made up: recorded, it is
 * a false positive; asked about, a spurious question.
 */
export function evaluateCase(testCase: CoverageCase, parts: AddPart[]): CaseResult {
  const actual = parts.map(describePart);
  const notEaten = new Set(testCase.notEaten ?? []);

  // Entries some expected food is meant to become. A part landing on one of
  // them is that food's answer, not a pricing of whatever else its phrase
  // happens to mention: in "포케 먹고 아메리카노" the one part is the
  // 아메리카노 — 포케 was dropped, not priced as coffee.
  const answers = new Set(
    testCase.foods.flatMap((food) =>
      food.status === "ambiguous"
        ? food.candidates
        : food.status === "unknown"
          ? []
          : [food.entry],
    ),
  );

  const foods = testCase.foods.map((expected) => {
    const linked = parts.filter((part) => isAbout(part, expected.said));
    const relevant =
      expected.status === "unknown"
        ? linked.filter((part) => !namesOf(part).some((name) => answers.has(name)) || part.status === "unknown")
        : linked;
    return { expected, outcome: judgeFood(expected, relevant) };
  });

  const unlinked = parts.filter(
    (part) => !testCase.foods.some((food) => isAbout(part, food.said)),
  );

  const recordsUneaten =
    parts.some((part) => part.status === "resolved" && notEaten.has(part.item.name)) ||
    unlinked.some((part) => part.status === "resolved");

  const verdict = ((): CoverageVerdict => {
    if (recordsUneaten) return "false_positive";
    const has = (outcome: FoodOutcome) => foods.some((food) => food.outcome === outcome);
    if (has("wrong_food")) return "wrong_food";
    if (has("wrong_amount")) return "wrong_amount";
    if (has("dropped")) return parts.length === 0 ? "nothing_found" : "silent_drop";

    const allOk = foods.every((food) => food.outcome === "ok");
    if (foods.length >= 2 && !allOk) return "partial_multi_food";
    if (has("missed") || has("over_asked")) return "false_negative";
    if (has("wrong_ask")) return "wrong_ask";
    if (unlinked.length > 0) return "spurious_ask";

    if (!testCase.consumed) return "correct_not_consumed";
    const statuses = testCase.foods.map((food) => food.status);
    if (statuses.includes("unknown")) return "correct_unknown";
    if (statuses.every((status) => status === "resolved")) return "correct_resolved";
    return "correct_ask";
  })();

  let valid = 0;
  let unnecessary = 0;
  for (const part of parts) {
    if (part.status === "resolved" || part.status === "skipped") continue;
    const answers = testCase.foods.some(
      (food) =>
        food.status !== "resolved" && isAbout(part, food.said) && judgePart(food, part) === "ok",
    );
    if (answers) valid += 1;
    else unnecessary += 1;
  }

  return { testCase, verdict, foods, actual, asks: { valid, unnecessary } };
}

/**
 * Runs every case through the production add pipeline, exactly as the chat
 * route does once a sentence has been judged an add: `resolveAddParts` over
 * the given resolver. Nothing is reimplemented here.
 *
 * What this does *not* cover is the step before — Jev's intent and
 * consumption judgment. A case tagged `jev_may_guard` may be stopped there
 * in production; its result here is what the pipeline would do if it were not.
 */
export async function runCoverage(
  cases: CoverageCase[],
  resolver: NutritionResolver,
): Promise<{ result: CaseResult; parts: AddPart[] }[]> {
  return Promise.all(
    cases.map(async (testCase) => {
      const parts = await resolveAddParts(testCase.input, resolver);
      return { result: evaluateCase(testCase, parts), parts };
    }),
  );
}

export type CoverageSummary = {
  total: number;
  correct: number;
  accuracy: number;
  byVerdict: Record<CoverageVerdict, number>;
  /** false_positive + wrong_food + wrong_amount. */
  silentWrong: number;
  /** Eaten foods lost without a word, while the rest was handled. */
  silentDrop: number;
  /** Cases in an excluded category, left out of every figure above. */
  excluded: number;
  byCategory: Record<CoverageCategory, { total: number; correct: number }>;
  /** Cases with two or more expected foods, and how many were handled whole. */
  multiFood: { total: number; correct: number };
  /** Questions across every case, split by whether the product wants them asked. */
  asks: { valid: number; unnecessary: number };
};

export function summarize(all: CaseResult[]): CoverageSummary {
  const results = all.filter((result) => !EXCLUDED_CATEGORIES.has(result.testCase.category));
  const byVerdict = Object.fromEntries(
    COVERAGE_VERDICTS.map((verdict) => [verdict, 0]),
  ) as Record<CoverageVerdict, number>;
  const byCategory = Object.fromEntries(
    COVERAGE_CATEGORIES.map((category) => [category, { total: 0, correct: 0 }]),
  ) as Record<CoverageCategory, { total: number; correct: number }>;
  const multiFood = { total: 0, correct: 0 };
  const asks = { valid: 0, unnecessary: 0 };

  let correct = 0;
  let silentWrong = 0;
  let silentDrop = 0;
  for (const result of results) {
    if (SILENT_DROP_VERDICTS.has(result.verdict)) silentDrop += 1;
    const ok = isCorrect(result.verdict);
    byVerdict[result.verdict] += 1;
    byCategory[result.testCase.category].total += 1;
    if (ok) {
      correct += 1;
      byCategory[result.testCase.category].correct += 1;
    }
    if (SILENT_WRONG_VERDICTS.has(result.verdict)) silentWrong += 1;
    asks.valid += result.asks.valid;
    asks.unnecessary += result.asks.unnecessary;
    if (result.testCase.foods.length >= 2) {
      multiFood.total += 1;
      if (ok) multiFood.correct += 1;
    }
  }

  return {
    total: results.length,
    correct,
    accuracy: results.length === 0 ? 0 : correct / results.length,
    byVerdict,
    silentWrong,
    silentDrop,
    excluded: all.length - results.length,
    byCategory,
    multiFood,
    asks,
  };
}

/** What the baseline file pins per case: the verdict, and the parts behind it for a readable diff. */
export type BaselineEntry = { id: string; verdict: CoverageVerdict; actual: string[] };

const baselineSchema = z.object({
  version: z.literal(1),
  note: z.string(),
  cases: z.array(
    z.object({
      id: z.string().min(1),
      verdict: z.enum(COVERAGE_VERDICTS),
      actual: z.array(z.string()),
    }),
  ),
});

export function loadCoverageBaseline(filePath = FOOD_COVERAGE_BASELINE_PATH): BaselineEntry[] {
  return baselineSchema.parse(JSON.parse(readFileSync(filePath, "utf8"))).cases;
}

export function toBaseline(results: CaseResult[]): BaselineEntry[] {
  return results.map((result) => ({
    id: result.testCase.id,
    verdict: result.verdict,
    actual: result.actual,
  }));
}
