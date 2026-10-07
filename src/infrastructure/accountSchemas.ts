import { z } from "zod";
import { CONVERSATION_OUTCOMES } from "@/domain/conversation";
import { isDateKey } from "@/domain/date";
import { dailyGoalSchema, mealRecordSchema } from "./schemas";

export const accountTurnSchema = z
  .object({
    id: z.string().min(1).max(100),
    at: z.iso.datetime({ offset: true }),
    user: z.string().max(10000).nullable(),
    reply: z.string().max(20000),
    outcome: z.enum(CONVERSATION_OUTCOMES),
    recordIds: z.array(z.string().min(1).max(100)).max(100),
  })
  .strict();
export const accountDataSchema = z
  .object({
    records: z.array(mealRecordSchema).max(20000),
    goals: z.array(dailyGoalSchema).max(10000),
    turns: z.array(accountTurnSchema).max(10000),
    meta: z
      .object({
        removedRecords: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100),
                removedAt: z.iso.datetime({ offset: true }),
              })
              .strict(),
          )
          .max(20000),
        goalSetAt: z.record(
          z.string().refine(isDateKey),
          z.iso.datetime({ offset: true }),
        ),
      })
      .strict(),
  })
  .strict();
export const accountMutationSchema = z.discriminatedUnion("operation", [
  z
    .object({
      operation: z.literal("add"),
      record: mealRecordSchema,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("update"),
      id: z.string(),
      input: mealRecordSchema
        .pick({
          consumedAt: true,
          mealType: true,
          sourceText: true,
          items: true,
        })
        .partial(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("remove"),
      id: z.string(),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("goal"),
      goal: dailyGoalSchema,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("turn"),
      turn: accountTurnSchema,
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      operation: z.literal("import"),
      data: accountDataSchema,
      consent: z.literal(true),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
]);
