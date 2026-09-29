import { readFileSync } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { INTENTS } from "@/ai/judgment/types";

/**
 * The local-router eval set (`evals/local-router.json`).
 *
 * Separate from the 60-case golden set because it asks a narrower question —
 * only the route — and so needs no noul or reference expectations. Expected
 * values are the *correct* route, not what any model says today.
 *
 * `goal_setting` is not an intent: the code rule `asksToChangeGoal` answers
 * those sentences before any judge's answer is read. They are here so that
 * rule is measured on the same sentences, and reported apart from the judges.
 */

export const LOCAL_ROUTER_EVAL_PATH = path.join(process.cwd(), "evals", "local-router.json");

export const EXPECTED_ROUTES = [...INTENTS, "goal_setting"] as const;
export type ExpectedRoute = (typeof EXPECTED_ROUTES)[number];

const recentItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  amount: z.string().min(1).optional(),
  calories: z.number().nonnegative(),
  consumedAt: z.string().min(1),
});

const contextSchema = z.object({
  id: z.string().min(1),
  now: z.string().min(1),
  dailyGoalCalories: z.number().int().positive(),
  recentItems: z.array(recentItemSchema),
});

const caseSchema = z.object({
  id: z.string().min(1),
  input: z.string().min(1),
  expectedIntent: z.enum(EXPECTED_ROUTES),
  /** Other readings whose app response is just as right. */
  acceptIntents: z.array(z.enum(INTENTS)).optional(),
  contextId: z.string().min(1),
  tags: z.array(z.string().min(1)),
  note: z.string().optional(),
});

export const localRouterEvalSchema = z
  .object({
    version: z.literal(1),
    description: z.string().optional(),
    contexts: z.array(contextSchema).min(1),
    cases: z.array(caseSchema).min(1),
  })
  .superRefine((data, ctx) => {
    const contextIds = new Set(data.contexts.map((c) => c.id));
    const caseIds = new Set<string>();
    for (const [index, testCase] of data.cases.entries()) {
      if (!contextIds.has(testCase.contextId)) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", index, "contextId"],
          message: `Unknown context "${testCase.contextId}".`,
        });
      }
      if (caseIds.has(testCase.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["cases", index, "id"],
          message: `Duplicate case id "${testCase.id}".`,
        });
      }
      caseIds.add(testCase.id);
    }
  });

export type LocalRouterEval = z.infer<typeof localRouterEvalSchema>;
export type LocalRouterCase = LocalRouterEval["cases"][number];
export type LocalRouterContext = LocalRouterEval["contexts"][number];

/** Node-only; never import from a component. */
export function loadLocalRouterEval(filePath: string = LOCAL_ROUTER_EVAL_PATH): LocalRouterEval {
  return localRouterEvalSchema.parse(JSON.parse(readFileSync(filePath, "utf8")));
}

export function evalContextFor(data: LocalRouterEval, testCase: LocalRouterCase): LocalRouterContext {
  const context = data.contexts.find((c) => c.id === testCase.contextId);
  if (context === undefined) throw new Error(`Context "${testCase.contextId}" is missing.`);
  return context;
}
