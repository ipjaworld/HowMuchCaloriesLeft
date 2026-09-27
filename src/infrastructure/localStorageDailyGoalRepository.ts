import { compareDateKeys } from "@/domain/date";
import { effectiveGoal } from "@/domain/history";
import type { DailyGoal } from "@/domain/meal";
import type { DailyGoalRepository } from "@/domain/repository";
import { dailyGoalSchema, parseValidEntries } from "./schemas";
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
};

/**
 * Stored shape: `{ version: 1, goals: DailyGoal[] }` under
 * `hmcl.v1.dailyGoals`, one entry per date the user actually changed the
 * number on. `get` carries the most recent one forward, so a goal set once
 * keeps applying until it is changed.
 */
export function createLocalStorageDailyGoalRepository({
  storage = getBrowserStorage(),
}: Options = {}): DailyGoalRepository {
  function readAll(): DailyGoal[] {
    return parseValidEntries(
      readJson(storage, STORAGE_KEYS.dailyGoals),
      "goals",
      dailyGoalSchema,
    );
  }

  return {
    async get(date) {
      return effectiveGoal(readAll(), date);
    },

    async getExact(date) {
      return readAll().find((goal) => goal.date === date) ?? null;
    },

    async getAll() {
      return readAll();
    },

    async set(goal) {
      const goals = readAll().filter((existing) => existing.date !== goal.date);
      goals.push(goal);
      goals.sort((a, b) => compareDateKeys(a.date, b.date));

      writeJson(storage, STORAGE_KEYS.dailyGoals, {
        version: STORAGE_VERSION,
        goals,
      });
    },
  };
}
