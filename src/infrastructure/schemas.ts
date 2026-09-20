import { z } from "zod";
import { isDateKey } from "@/domain/date";
import { isValidCalorieValue, isValidDailyGoal } from "@/domain/limits";
import { MEAL_TYPES } from "@/domain/meal";

/**
 * Schemas for what comes *back out* of storage.
 *
 * These mirror the domain types but are stricter than TypeScript can be at
 * runtime: a stored calorie value of `null`, `"320"` or `1e9` all have to be
 * caught here rather than being handed to the maths.
 */

const isoDateTime = z
  .string()
  .refine((value) => !Number.isNaN(new Date(value).getTime()), {
    message: "not a parseable datetime",
  });

export const foodItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  amount: z.string().min(1).optional(),
  calories: z.number().refine(isValidCalorieValue, {
    message: "calorie value is not a usable number",
  }),
  caloriesEstimated: z.boolean(),
});

export const mealRecordSchema = z.object({
  id: z.string().min(1),
  consumedAt: isoDateTime,
  mealType: z.enum(MEAL_TYPES).optional(),
  sourceText: z.string(),
  items: z.array(foodItemSchema),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

export const dailyGoalSchema = z.object({
  date: z.string().refine(isDateKey, { message: "not a YYYY-MM-DD date key" }),
  calorieTarget: z.number().refine(isValidDailyGoal, {
    message: "daily goal outside the accepted range",
  }),
});

/**
 * The envelope is read loosely: as long as the payload is an array, each entry
 * is judged on its own. One corrupt record loses that record, not the day.
 */
export function parseValidEntries<T>(
  payload: unknown,
  key: string,
  schema: z.ZodType<T>,
): T[] {
  if (typeof payload !== "object" || payload === null) return [];

  const entries = (payload as Record<string, unknown>)[key];
  if (!Array.isArray(entries)) return [];

  const valid: T[] = [];
  for (const entry of entries) {
    const result = schema.safeParse(entry);
    if (result.success) valid.push(result.data);
  }
  return valid;
}
