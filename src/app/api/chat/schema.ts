import { z } from "zod";
import { INTENTS } from "@/ai/judgment/types";
import type { Judgment, JudgmentInput } from "@/ai/judgment/types";
import type { Command } from "@/application/commands";
import { isValidCalorieValue } from "@/domain/limits";
import { MEAL_TYPES } from "@/domain/meal";

/**
 * The wire contract for `/api/chat`.
 *
 * The browser owns the log, so it sends the judge everything it needs to
 * judge with — today's entries, the goal, the current time — and the server
 * keeps none of it.
 */

/** Long enough for a rambling meal description, short enough to bound cost. */
export const MAX_MESSAGE_LENGTH = 500;

/** Today's entries only; more context makes the reference choice worse, not better. */
export const MAX_RECENT_ITEMS = 50;

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "not a parseable datetime",
  });

export const recentItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  amount: z.string().min(1).optional(),
  calories: z.number().refine(isValidCalorieValue, {
    message: "calorie value is not a usable number",
  }),
  mealType: z.enum(MEAL_TYPES).optional(),
  consumedAt: isoDateTime,
});

export const chatRequestSchema = z.object({
  message: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
  /** From the browser: the server has no access to the user's clock or zone. */
  now: isoDateTime,
  dailyGoalCalories: z.number().int().positive().nullable(),
  recentItems: z.array(recentItemSchema).max(MAX_RECENT_ITEMS),
});

export type ChatRequest = z.infer<typeof chatRequestSchema>;

/** The judgment as the client sees it — the same shape, minus nothing. */
export const judgmentSchema = z.object({
  intent: z.enum(INTENTS),
  intentConfidence: z.number().min(0).max(1),
  actualConsumptionProbability: z.number().min(0).max(1),
  clarificationProbability: z.number().min(0).max(1),
  referenceTargetId: z.string().nullable(),
  referenceConfidence: z.number().min(0).max(1).nullable(),
  source: z.enum(["jev", "mock"]),
});

export type ChatResponse = {
  command: Command;
  judgment: Judgment;
};

export function toJudgmentInput(request: ChatRequest): JudgmentInput {
  return {
    message: request.message,
    now: request.now,
    dailyGoalCalories: request.dailyGoalCalories,
    recentItems: request.recentItems,
  };
}
