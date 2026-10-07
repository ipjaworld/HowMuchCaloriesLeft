import { retainedTurns } from "@/domain/conversation";
import type { AccountData } from "@/domain/account";
import type { MealRecord } from "@/domain/meal";

/** Pure, deterministic and idempotent. Ties keep the server; deletion wins ties. */
export function mergeAccountData(
  server: AccountData,
  local: AccountData,
  today: string,
): AccountData {
  const records = new Map<string, MealRecord>(
    server.records.map((r) => [r.id, r]),
  );
  const removed = new Map<string, string>();
  for (const m of [
    ...server.meta.removedRecords,
    ...local.meta.removedRecords,
  ]) {
    if (
      !removed.has(m.id) ||
      Date.parse(m.removedAt) > Date.parse(removed.get(m.id)!)
    )
      removed.set(m.id, m.removedAt);
  }
  for (const r of local.records) {
    const previous = records.get(r.id);
    if (!previous || Date.parse(r.updatedAt) > Date.parse(previous.updatedAt))
      records.set(r.id, r);
  }
  for (const [id, at] of removed) {
    const record = records.get(id);
    if (record && Date.parse(record.updatedAt) > Date.parse(at))
      removed.delete(id);
    else records.delete(id);
  }
  const goals = new Map(server.goals.map((g) => [g.date, g]));
  const goalSetAt = { ...server.meta.goalSetAt };
  for (const g of local.goals) {
    const localAt = local.meta.goalSetAt[g.date];
    const serverAt = goalSetAt[g.date];
    if (
      !goals.has(g.date) ||
      (localAt && (!serverAt || Date.parse(localAt) > Date.parse(serverAt)))
    ) {
      goals.set(g.date, g);
      if (localAt) goalSetAt[g.date] = localAt;
    }
  }
  // A turn is immutable. Preserve the server's copy for duplicate IDs.
  const turns = new Map(local.turns.map((t) => [t.id, t]));
  for (const t of server.turns) turns.set(t.id, t);
  return {
    records: [...records.values()].sort((a, b) => a.id.localeCompare(b.id)),
    goals: [...goals.values()].sort((a, b) => a.date.localeCompare(b.date)),
    turns: retainedTurns([...turns.values()], today),
    meta: {
      removedRecords: [...removed]
        .map(([id, removedAt]) => ({ id, removedAt }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      goalSetAt,
    },
  };
}
