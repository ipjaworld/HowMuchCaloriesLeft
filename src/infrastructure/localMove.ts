import { mergeAccountData } from "@/application/accountMerge";
import type { MovePayload } from "@/application/originMove";
import { todayKey } from "@/domain/date";
import { createLocalStorageConversationRepository } from "./localStorageConversationRepository";
import { createLocalStorageDailyGoalRepository } from "./localStorageDailyGoalRepository";
import { createLocalStorageMealRecordRepository } from "./localStorageMealRecordRepository";
import { readSyncMeta } from "./localStorageSyncMetaRepository";
import {
  STORAGE_KEYS,
  STORAGE_VERSION,
  getBrowserStorage,
  readJson,
  writeJson,
  type KeyValueStorage,
} from "./storage";

type Options = { storage?: KeyValueStorage; now?: () => Date };

/** Everything this browser holds, read through the same checks the app uses. */
export async function readLocalMovePayload({
  storage = getBrowserStorage(),
  now = () => new Date(),
}: Options = {}): Promise<MovePayload> {
  const [records, goals, conversation] = await Promise.all([
    createLocalStorageMealRecordRepository({ storage, now }).getAll(),
    createLocalStorageDailyGoalRepository({ storage, now }).getAll(),
    createLocalStorageConversationRepository({ storage, now }).getAll(),
  ]);
  return {
    v: 1,
    data: { records, goals, turns: conversation.turns, meta: readSyncMeta(storage) },
  };
}

export type MoveResult = { saved: boolean; conversationSaved: boolean };

/**
 * Merges an arriving payload into this browser's records.
 *
 * The same merge the account uses, with what is already here in the server's
 * seat: the later change wins, ties keep what is here, deletions are honoured,
 * and applying the same payload twice changes nothing. Meals go first — if
 * they cannot be written, nothing else is.
 */
export async function applyMovePayload(
  incoming: MovePayload,
  { storage = getBrowserStorage(), now = () => new Date() }: Options = {},
): Promise<MoveResult> {
  const here = await readLocalMovePayload({ storage, now });
  const merged = mergeAccountData(here.data, incoming.data, todayKey(now()));

  if (!writeJson(storage, STORAGE_KEYS.mealRecords, { version: STORAGE_VERSION, records: merged.records })) {
    return { saved: false, conversationSaved: false };
  }
  const goalsSaved = writeJson(storage, STORAGE_KEYS.dailyGoals, { version: STORAGE_VERSION, goals: merged.goals });
  const metaSaved = writeJson(storage, STORAGE_KEYS.syncMeta, { version: 1, ...merged.meta });
  const conversationSaved = writeJson(storage, STORAGE_KEYS.conversation, { version: 1, turns: merged.turns });
  return { saved: goalsSaved && metaSaved, conversationSaved };
}

/** When this browser last handed its records to the new address, if it did. */
export function readMovedAt(storage: KeyValueStorage = getBrowserStorage()): string | null {
  const raw = readJson(storage, STORAGE_KEYS.originMove);
  if (typeof raw !== "object" || raw === null || !("movedAt" in raw)) return null;
  return typeof raw.movedAt === "string" && !Number.isNaN(Date.parse(raw.movedAt)) ? raw.movedAt : null;
}

export function markMoved(storage: KeyValueStorage = getBrowserStorage(), now: Date = new Date()): void {
  writeJson(storage, STORAGE_KEYS.originMove, { version: 1, movedAt: now.toISOString() });
}
