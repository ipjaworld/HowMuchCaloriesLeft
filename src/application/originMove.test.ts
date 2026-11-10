import { describe, expect, it } from "vitest";
import { isLegacyHost } from "./legacyHost";
import {
  MAX_ENCODED_LENGTH,
  buildMoveLink,
  decodeMovePayload,
  encodeMovePayload,
  moveFragment,
  movePayloadIsEmpty,
  type MovePayload,
} from "./originMove";
import { applyMovePayload, markMoved, readLocalMovePayload, readMovedAt } from "@/infrastructure/localMove";
import { STORAGE_KEYS, createMemoryStorage } from "@/infrastructure/storage";

const NOW = new Date("2026-11-10T03:00:00.000Z");
const now = () => NOW;

function record(id: string, updatedAt: string, calories = 300) {
  return {
    id,
    consumedAt: "2026-11-10T02:00:00.000Z",
    sourceText: "김밥 한 줄",
    items: [{ id: `${id}-1`, name: "김밥", amount: "한 줄", calories, caloriesEstimated: false }],
    createdAt: "2026-11-10T02:00:00.000Z",
    updatedAt,
  };
}

function payload(overrides: Partial<MovePayload["data"]> = {}): MovePayload {
  return {
    v: 1,
    data: {
      records: [record("r1", "2026-11-10T02:00:00.000Z")],
      goals: [{ date: "2026-11-01", calorieTarget: 2000 }],
      turns: [
        {
          id: "t1",
          at: "2026-11-10T02:00:00.000Z",
          user: "김밥 한 줄 먹었어",
          reply: "김밥 한 줄 기록했어요.",
          outcome: "added",
          recordIds: ["r1"],
        },
      ],
      meta: { removedRecords: [], goalSetAt: { "2026-11-01": "2026-11-01T00:00:00.000Z" } },
      ...overrides,
    },
  } as MovePayload;
}

describe("isLegacyHost", () => {
  const env = { APP_ORIGIN: "https://calories.example.com", LEGACY_HOSTS: "old.example.app, Other.example.app" };

  it("matches a listed old host, whatever its case", () => {
    expect(isLegacyHost("old.example.app", env)).toBe(true);
    expect(isLegacyHost("OTHER.example.app", env)).toBe(true);
  });

  it("leaves the current address, unlisted hosts and previews alone", () => {
    expect(isLegacyHost("calories.example.com", env)).toBe(false);
    expect(isLegacyHost("preview-abc.example.app", env)).toBe(false);
    expect(isLegacyHost("localhost:3000", env)).toBe(false);
    expect(isLegacyHost(null, env)).toBe(false);
  });

  it("does nothing until both settings are there", () => {
    expect(isLegacyHost("old.example.app", { APP_ORIGIN: env.APP_ORIGIN })).toBe(false);
    expect(isLegacyHost("old.example.app", { LEGACY_HOSTS: env.LEGACY_HOSTS })).toBe(false);
    expect(isLegacyHost("old.example.app", { ...env, APP_ORIGIN: "not a url" })).toBe(false);
  });

  it("never turns the current address into an old one", () => {
    expect(
      isLegacyHost("calories.example.com", { APP_ORIGIN: env.APP_ORIGIN, LEGACY_HOSTS: "calories.example.com" }),
    ).toBe(false);
  });
});

describe("move payload encoding", () => {
  it("round-trips Korean text and every field", async () => {
    const original = payload();
    const encoded = await encodeMovePayload(original);
    expect(encoded).toMatch(/^g\.[A-Za-z0-9_-]+$/);
    expect(await decodeMovePayload(encoded)).toEqual(original);
  });

  it("reads the uncompressed form too", async () => {
    const original = payload();
    const plain = `j.${Buffer.from(JSON.stringify(original), "utf8").toString("base64url")}`;
    expect(await decodeMovePayload(plain)).toEqual(original);
  });

  it("rejects what this app did not write", async () => {
    const bad = (value: unknown) => `j.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
    expect(await decodeMovePayload("")).toBeNull();
    expect(await decodeMovePayload("g.not-gzip")).toBeNull();
    expect(await decodeMovePayload("x.abcd")).toBeNull();
    expect(await decodeMovePayload(bad({ ...payload(), v: 2 }))).toBeNull();
    expect(await decodeMovePayload(bad({ ...payload(), extra: true }))).toBeNull();
    const wrongCalories = payload();
    wrongCalories.data.records[0]!.items[0]!.calories = 1e12;
    expect(await decodeMovePayload(bad(wrongCalories))).toBeNull();
    expect(await decodeMovePayload(`j.${"A".repeat(MAX_ENCODED_LENGTH)}`)).toBeNull();
  });

  it("builds a link to /import on the new address, with the records after the #", async () => {
    const link = await buildMoveLink("https://calories.example.com", payload());
    expect(link).not.toBeNull();
    const url = new URL(link!.href);
    expect(url.origin + url.pathname).toBe("https://calories.example.com/import");
    expect(url.search).toBe("");
    expect(await decodeMovePayload(moveFragment(url.hash)!)).toEqual(payload());
    expect(link!.withoutConversation).toBe(false);
  });

  it("leaves the conversation behind before any meal when the link would be too long", async () => {
    // Incompressible text, so the size survives gzip.
    let state = 12345;
    const noise = () =>
      Array.from({ length: 9000 }, () => {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        return String.fromCharCode(0xac00 + ((state >>> 8) % 11172));
      }).join("");
    const turns = Array.from({ length: 120 }, (_, i) => ({
      id: `t${i}`,
      at: "2026-11-10T02:00:00.000Z",
      user: noise(),
      reply: "ok",
      outcome: "added" as const,
      recordIds: [],
    }));
    const link = await buildMoveLink("https://calories.example.com", payload({ turns }));
    expect(link?.withoutConversation).toBe(true);
    const arrived = await decodeMovePayload(moveFragment(new URL(link!.href).hash)!);
    expect(arrived?.data.turns).toEqual([]);
    expect(arrived?.data.records).toHaveLength(1);
  });

  it("finds the fragment only in its own form", () => {
    expect(moveFragment("#d=g.abc")).toBe("g.abc");
    expect(moveFragment("#d=")).toBeNull();
    expect(moveFragment("")).toBeNull();
    expect(moveFragment("#other=1")).toBeNull();
  });
});

describe("moving between two browsers' storage", () => {
  async function seeded(data: MovePayload) {
    const storage = createMemoryStorage();
    await applyMovePayload(data, { storage, now });
    return storage;
  }

  it("carries everything across and reads back the same", async () => {
    const oldStorage = await seeded(payload());
    const read = await readLocalMovePayload({ storage: oldStorage, now });
    expect(movePayloadIsEmpty(read)).toBe(false);

    const arrived = await decodeMovePayload(await encodeMovePayload(read));
    const newStorage = createMemoryStorage();
    const result = await applyMovePayload(arrived!, { storage: newStorage, now });
    expect(result).toEqual({ saved: true, conversationSaved: true });

    const after = await readLocalMovePayload({ storage: newStorage, now });
    expect(after.data).toEqual(read.data);
  });

  it("is idempotent: the same payload twice adds nothing", async () => {
    const storage = await seeded(payload());
    const once = storage.snapshot()[STORAGE_KEYS.mealRecords];
    await applyMovePayload(payload(), { storage, now });
    expect(storage.snapshot()[STORAGE_KEYS.mealRecords]).toBe(once);
  });

  it("keeps what is already here, takes later changes, honours deletions", async () => {
    const here = payload({
      records: [record("r1", "2026-11-10T02:30:00.000Z", 999), record("mine", "2026-11-10T01:00:00.000Z")],
      meta: { removedRecords: [{ id: "gone", removedAt: "2026-11-10T02:50:00.000Z" }], goalSetAt: {} },
    });
    const storage = await seeded(here);
    await applyMovePayload(
      payload({
        records: [
          record("r1", "2026-11-10T02:00:00.000Z", 300),
          record("gone", "2026-11-10T02:10:00.000Z"),
          record("new", "2026-11-10T02:40:00.000Z"),
        ],
      }),
      { storage, now },
    );
    const after = await readLocalMovePayload({ storage, now });
    expect(after.data.records.map((r) => r.id).sort()).toEqual(["mine", "new", "r1"]);
    expect(after.data.records.find((r) => r.id === "r1")?.items[0]?.calories).toBe(999);
  });

  it("never carries or writes calculator body facts", async () => {
    const storage = await seeded(payload());
    expect(Object.keys(storage.snapshot())).not.toContain(STORAGE_KEYS.dietProfile);
    expect(JSON.stringify(await readLocalMovePayload({ storage, now }))).not.toMatch(/weightKg|heightCm/);
  });

  it("reports failure and writes nothing else when meals cannot be saved", async () => {
    const storage = createMemoryStorage();
    const full = {
      ...storage,
      setItem(key: string, value: string) {
        if (key === STORAGE_KEYS.mealRecords) throw new Error("quota");
        storage.setItem(key, value);
      },
    };
    expect(await applyMovePayload(payload(), { storage: full, now })).toEqual({ saved: false, conversationSaved: false });
    expect(storage.snapshot()).toEqual({});
  });

  it("an untouched browser has nothing to move", async () => {
    expect(movePayloadIsEmpty(await readLocalMovePayload({ storage: createMemoryStorage(), now }))).toBe(true);
  });

  it("remembers that the old address handed its records over", () => {
    const storage = createMemoryStorage();
    expect(readMovedAt(storage)).toBeNull();
    markMoved(storage, NOW);
    expect(readMovedAt(storage)).toBe(NOW.toISOString());
  });
});
