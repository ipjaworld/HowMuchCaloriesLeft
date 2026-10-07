/**
 * The only module in the app that knows `localStorage` exists.
 *
 * Everything here is defensive on purpose: stored JSON is data the app wrote
 * on some earlier day, possibly under an older schema, possibly edited by
 * hand. A bad value must never take the screen down.
 */

export type KeyValueStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

/** Reads and writes go nowhere when there is no browser (SSR, prerender). */
const nullStorage: KeyValueStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
};

/**
 * Private-mode Safari and blocked site data make even *touching*
 * `localStorage` throw, so access is probed rather than assumed.
 */
export function getBrowserStorage(): KeyValueStorage {
  try {
    if (typeof window === "undefined") return nullStorage;
    // Do not probe with a write: a full quota must still allow reads and
    // conversation compaction to reclaim its own space.
    return window.localStorage;
  } catch {
    // A blocked browser must not pretend that writes persisted (SSR still
    // uses nullStorage above). Reads can continue to fall back to empty.
    return {
      getItem: () => null,
      setItem: () => { throw new Error("Storage unavailable"); },
      removeItem: () => { throw new Error("Storage unavailable"); },
    };
  }
}

/** Parsed JSON, or null for a missing key, unreadable storage or bad JSON. */
export function readJson(storage: KeyValueStorage, key: string): unknown {
  let raw: string | null;
  try {
    raw = storage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Returns false when the write failed — a full quota, for instance. */
export function writeJson(
  storage: KeyValueStorage,
  key: string,
  value: unknown,
): boolean {
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const STORAGE_KEYS = {
  conversation: "hmcl.v1.conversation",
  syncMeta: "hmcl.v1.syncMeta",
  mealRecords: "hmcl.v1.mealRecords",
  dailyGoals: "hmcl.v1.dailyGoals",
  /** Body facts for the calorie calculator. Never leaves this browser. */
  dietProfile: "hmcl.v1.dietProfile",
  /** Whether the first-visit calculator prompt has been answered. */
  onboarding: "hmcl.v1.onboarding",
} as const;

export const STORAGE_VERSION = 1;

/**
 * A `KeyValueStorage` backed by a Map. Used by the tests so they can exercise
 * the real repositories without jsdom, and usable as a non-persistent
 * fallback anywhere a browser store is unavailable.
 */
export function createMemoryStorage(
  initial: Record<string, string> = {},
): KeyValueStorage & { snapshot(): Record<string, string> } {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
    snapshot: () => Object.fromEntries(map),
  };
}
