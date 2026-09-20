import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { INTENTS, MEAL_TYPES } from "./types";

/**
 * The Korean natural-language golden set.
 *
 * Jev is a young model and Korean is not its strongest language, so every
 * judgment change — a new model version, a reworded `instructions`, a new
 * criteria description — gets measured against these cases before it ships.
 * Phase 4 turns this into a regression run; Phase 1 only fixes the shape so
 * the cases can be collected now and stay stable later.
 *
 * Expected values here are the *correct* outcome, not whatever the model
 * currently says. A case the model fails is a known gap, not a broken fixture.
 */

export const GOLDEN_SET_PATH = path.join(
  process.cwd(),
  "fixtures",
  "korean-inputs.json",
);

/** A record already on the day's list, as the user's next sentence may refer to it. */
const recentItemSchema = z.object({
  id: z.string().min(1),
  mealType: z.enum(MEAL_TYPES),
  name: z.string().min(1),
  amount: z.string().min(1),
  calories: z.number().int().nonnegative(),
  consumedAt: z.string().min(1),
});

/**
 * The state a case is judged against. Shared across cases so the same day can
 * be reused, and so a context change shows up in every case that depends on it.
 */
const contextSchema = z.object({
  id: z.string().min(1),
  /** Fixed "now" — cases about 아까/어제 must not drift with the wall clock. */
  now: z.string().min(1),
  dailyGoalCalories: z.number().int().positive(),
  recentItems: z.array(recentItemSchema),
});

/** Groups cases for reporting. Orthogonal to `expected.intent` on purpose. */
export const GOLDEN_CATEGORIES = [
  "add",
  "modify",
  "delete",
  "question",
  "recommendation",
  "not_consumption",
  "ambiguous",
] as const;

const expectedSchema = z.object({
  intent: z.enum(INTENTS),
  /** Did the user actually eat or drink this? Guards against recording questions. */
  isActualConsumption: z.boolean(),
  /** Must we ask before changing stored data? */
  needsClarification: z.boolean(),
  /** Which existing item is meant; null when none applies or it is undecidable. */
  referenceTargetId: z.string().nullable(),
});

const caseSchema = z.object({
  id: z.string().min(1),
  category: z.enum(GOLDEN_CATEGORIES),
  input: z.string().min(1),
  contextId: z.string().min(1),
  expected: expectedSchema,
  /** Why this case is expected to resolve the way it does, when non-obvious. */
  note: z.string().optional(),
});

export const goldenSetSchema = z
  .object({
    version: z.literal(1),
    contexts: z.array(contextSchema).min(1),
    cases: z.array(caseSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const contextIds = new Set(data.contexts.map((c) => c.id));

    for (const [index, testCase] of data.cases.entries()) {
      const context = data.contexts.find((c) => c.id === testCase.contextId);

      if (!contextIds.has(testCase.contextId)) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", index, "contextId"],
          message: `Unknown context "${testCase.contextId}".`,
        });
        continue;
      }

      const targetId = testCase.expected.referenceTargetId;
      if (
        targetId !== null &&
        !context?.recentItems.some((item) => item.id === targetId)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", index, "expected", "referenceTargetId"],
          message: `"${targetId}" is not an item of context "${testCase.contextId}".`,
        });
      }
    }
  });

export type GoldenSet = z.infer<typeof goldenSetSchema>;
export type GoldenCase = GoldenSet["cases"][number];
export type GoldenContext = GoldenSet["contexts"][number];
export type GoldenCategory = (typeof GOLDEN_CATEGORIES)[number];

/** Validates raw JSON. Keeps parsing testable without touching the filesystem. */
export function parseGoldenSet(raw: unknown): GoldenSet {
  return goldenSetSchema.parse(raw);
}

/** Reads and validates the fixture. Node-only; never import from a component. */
export function loadGoldenSet(filePath: string = GOLDEN_SET_PATH): GoldenSet {
  return parseGoldenSet(JSON.parse(readFileSync(filePath, "utf8")));
}

/** Resolves a case's context. Throws only if validation was bypassed. */
export function contextFor(
  goldenSet: GoldenSet,
  testCase: GoldenCase,
): GoldenContext {
  const context = goldenSet.contexts.find((c) => c.id === testCase.contextId);
  if (context === undefined) {
    throw new Error(`Context "${testCase.contextId}" is missing.`);
  }
  return context;
}
