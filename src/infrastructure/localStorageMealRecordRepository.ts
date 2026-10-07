import { dateKeyOf } from "@/domain/date";
import type { MealRecord } from "@/domain/meal";
import type { MealRecordRepository } from "@/domain/repository";
import { mealRecordSchema, parseValidEntries } from "./schemas";
import { readSyncMeta, writeSyncMeta } from "./localStorageSyncMetaRepository";
import {
  STORAGE_KEYS,
  STORAGE_VERSION,
  getBrowserStorage,
  readJson,
  writeJson,
  type KeyValueStorage,
} from "./storage";

type Options = {
  storage?: KeyValueStorage;
  /** Injectable so tests can assert on `updatedAt` without racing the clock. */
  now?: () => Date;
  onMetadataFailure?: () => void;
};

/**
 * Stored shape: `{ version: 1, records: MealRecord[] }` under
 * `hmcl.v1.mealRecords`. Everything lives in one key — at one day's worth of
 * meals, splitting per date would cost more than it saves.
 */
export function createLocalStorageMealRecordRepository({
  storage = getBrowserStorage(),
  now = () => new Date(),
  onMetadataFailure,
}: Options = {}): MealRecordRepository {
  function readAll(): MealRecord[] {
    return parseValidEntries(
      readJson(storage, STORAGE_KEYS.mealRecords),
      "records",
      mealRecordSchema,
    );
  }

  function writeAll(records: MealRecord[]): void {
    const saved = writeJson(storage, STORAGE_KEYS.mealRecords, {
      version: STORAGE_VERSION,
      records,
    });
    if (!saved) throw new Error("Meal storage write failed");
  }

  return {
    async getByDate(date) {
      return readAll()
        .filter((record) => dateKeyOf(record.consumedAt) === date)
        .sort((a, b) => a.consumedAt.localeCompare(b.consumedAt));
    },

    async getAll() {
      return readAll();
    },

    async add(record) {
      const meta = readSyncMeta(storage);
      const restoring = meta.removedRecords.find((entry) => entry.id === record.id);
      const restoredAt = restoring ? new Date(Math.max(now().getTime(), Date.parse(restoring.removedAt) + 1)).toISOString() : record.updatedAt;
      writeAll([...readAll(), { ...record, updatedAt: restoredAt }]);
      if (restoring) {
        meta.removedRecords = meta.removedRecords.filter((entry) => entry.id !== record.id);
        writeSyncMeta(storage, meta, onMetadataFailure);
      }
    },

    async update(id, input) {
      const records = readAll();
      const index = records.findIndex((record) => record.id === id);
      const existing = records[index];
      if (existing === undefined) return;

      records[index] = { ...existing, ...input, updatedAt: now().toISOString() };
      writeAll(records);
    },

    async remove(id) {
      const records = readAll();
      if (!records.some((record) => record.id === id)) return;
      writeAll(records.filter((record) => record.id !== id));
      const meta = readSyncMeta(storage);
      meta.removedRecords = [...meta.removedRecords.filter((entry) => entry.id !== id), { id, removedAt: now().toISOString() }];
      writeSyncMeta(storage, meta, onMetadataFailure);
    },
  };
}
