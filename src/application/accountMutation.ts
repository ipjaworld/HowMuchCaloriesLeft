import type { z } from "zod";
import type { AccountData } from "@/domain/account";
import { retainedTurns } from "@/domain/conversation";
import { todayKey } from "@/domain/date";
import type { accountMutationSchema } from "@/infrastructure/accountSchemas";
import { mergeAccountData } from "./accountMerge";
export type AccountMutation = z.infer<typeof accountMutationSchema>;
export function mutateAccountData(
  current: AccountData,
  mutation: AccountMutation,
  now: Date,
): AccountData {
  if (mutation.operation === "import")
    return mergeAccountData(current, mutation.data, todayKey(now));
  const next = structuredClone(current),
    at = now.toISOString();
  switch (mutation.operation) {
    case "add": {
      const removed = current.meta.removedRecords.find(r => r.id === mutation.record.id);
      const restoredAt = removed ? new Date(Math.max(now.getTime(), Date.parse(removed.removedAt) + 1)).toISOString() : at;
      const record = { ...mutation.record, updatedAt: restoredAt };
      next.records = [
        ...next.records.filter((r) => r.id !== record.id),
        record,
      ];
      next.meta.removedRecords = next.meta.removedRecords.filter(
        (r) => r.id !== record.id,
      );
      break;
    }
    case "update":
      next.records = next.records.map((r) =>
        r.id === mutation.id ? { ...r, ...mutation.input, updatedAt: at } : r,
      );
      break;
    case "remove":
      next.records = next.records.filter((r) => r.id !== mutation.id);
      next.meta.removedRecords = [
        ...next.meta.removedRecords.filter((r) => r.id !== mutation.id),
        { id: mutation.id, removedAt: at },
      ];
      break;
    case "goal":
      next.goals = [
        ...next.goals.filter((g) => g.date !== mutation.goal.date),
        mutation.goal,
      ];
      next.meta.goalSetAt[mutation.goal.date] = at;
      break;
    case "turn":
      next.turns = [
        ...next.turns.filter((t) => t.id !== mutation.turn.id),
        mutation.turn,
      ];
      break;
  }
  next.turns = retainedTurns(next.turns, todayKey(now));
  return next;
}
