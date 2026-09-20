import { dateKeyOf } from "@/domain/date";
import type { MealRecord } from "@/domain/meal";
import type { MealRecordRepository } from "@/domain/repository";
import { mealRecordSchema, parseValidEntries } from "./schemas";
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
};

/**
 * Stored shape: `{ version: 1, records: MealRecord[] }` under
 * `hmcl.v1.mealRecords`. Everything lives in one key — at one day's worth of
 * meals, splitting per date would cost more than it saves.
 */
export function createLocalStorageMealRecordRepository({
  storage = getBrowserStorage(),
  now = () => new Date(),
}: Options = {}): MealRecordRepository {
  function readAll(): MealRecord[] {
    return parseValidEntries(
      readJson(storage, STORAGE_KEYS.mealRecords),
      "records",
      mealRecordSchema,
    );
  }

  function writeAll(records: MealRecord[]): void {
    writeJson(storage, STORAGE_KEYS.mealRecords, {
      version: STORAGE_VERSION,
      records,
    });
  }

  return {
    async getByDate(date) {
      return readAll()
        .filter((record) => dateKeyOf(record.consumedAt) === date)
        .sort((a, b) => a.consumedAt.localeCompare(b.consumedAt));
    },

    async add(record) {
      writeAll([...readAll(), record]);
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
      writeAll(readAll().filter((record) => record.id !== id));
    },
  };
}
