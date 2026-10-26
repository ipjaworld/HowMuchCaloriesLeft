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
const revisionSchema = z.number().int().nonnegative();
const addChange = z.object({ operation: z.literal("add"), record: mealRecordSchema }).strict();
const updateChange = z
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
  })
  .strict();
const removeChange = z.object({ operation: z.literal("remove"), id: z.string() }).strict();
const goalChange = z.object({ operation: z.literal("goal"), goal: dailyGoalSchema }).strict();
const turnChange = z.object({ operation: z.literal("turn"), turn: accountTurnSchema }).strict();
/** One change inside a turn. Import is never part of a turn. */
export const accountChangeSchema = z.discriminatedUnion("operation", [
  addChange,
  updateChange,
  removeChange,
  goalChange,
  turnChange,
]);
/** Most changes one turn writes: a correction, its additions and the turn itself. */
export const MAX_BATCH_CHANGES = 100;
export const accountMutationSchema = z.discriminatedUnion("operation", [
  addChange.extend({ revision: revisionSchema }),
  updateChange.extend({ revision: revisionSchema }),
  removeChange.extend({ revision: revisionSchema }),
  goalChange.extend({ revision: revisionSchema }),
  turnChange.extend({ revision: revisionSchema }),
  z
    .object({
      operation: z.literal("batch"),
      changes: z.array(accountChangeSchema).min(1).max(MAX_BATCH_CHANGES),
      revision: revisionSchema,
    })
    .strict(),
  z
    .object({
      operation: z.literal("import"),
      data: accountDataSchema,
      consent: z.literal(true),
      revision: revisionSchema,
    })
    .strict(),
]);
