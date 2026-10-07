import { z } from "zod";
import { isDateKey } from "@/domain/date";
import type { SyncMeta, SyncMetaRepository } from "@/domain/syncMeta";
import { parseValidEntries } from "./schemas";
import { getBrowserStorage, readJson, STORAGE_KEYS, writeJson, type KeyValueStorage } from "./storage";

const timestamp = z.iso.datetime({ offset: true });
const removedSchema = z.object({ id: z.string().min(1), removedAt: timestamp });

export function readSyncMeta(storage: KeyValueStorage): SyncMeta {
  const raw = readJson(storage, STORAGE_KEYS.syncMeta);
  const empty: SyncMeta = { removedRecords: [], goalSetAt: {} };
  if (typeof raw !== "object" || raw === null || !("version" in raw) || raw.version !== 1) return empty;
  const removedRecords = parseValidEntries(raw, "removedRecords", removedSchema);
  const goals = "goalSetAt" in raw ? raw.goalSetAt : null;
  const goalSetAt: Record<string, string> = {};
  if (typeof goals === "object" && goals !== null) {
    for (const [date, at] of Object.entries(goals)) {
      if (isDateKey(date) && timestamp.safeParse(at).success) goalSetAt[date] = at;
    }
  }
  return { removedRecords, goalSetAt };
}

/** Called only after the primary write succeeded. Failure never rolls it back. */
export function writeSyncMeta(storage: KeyValueStorage, meta: SyncMeta, onFailure?: () => void): void {
  if (!writeJson(storage, STORAGE_KEYS.syncMeta, { version: 1, ...meta })) onFailure?.();
}

export function createLocalStorageSyncMetaRepository({ storage = getBrowserStorage() }: {
  storage?: KeyValueStorage;
} = {}): SyncMetaRepository {
  return { async get() { return readSyncMeta(storage); } };
}
