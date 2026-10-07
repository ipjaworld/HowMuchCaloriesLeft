import { describe, expect, it, vi } from "vitest";
import { removeFoodItem, restoreFoodItem } from "@/application/editFood";
import { setDailyGoal } from "@/application/dailyGoal";
import type { ConversationTurn } from "@/domain/conversation";
import type { MealRecord } from "@/domain/meal";
import { createLocalStorageConversationRepository } from "./localStorageConversationRepository";
import { createLocalStorageMealRecordRepository } from "./localStorageMealRecordRepository";
import { createLocalStorageDailyGoalRepository } from "./localStorageDailyGoalRepository";
import { createLocalStorageSyncMetaRepository } from "./localStorageSyncMetaRepository";
import { createLocalStorageDietProfileRepository } from "./localStorageDietProfileRepository";
import { createMemoryStorage, STORAGE_KEYS, type KeyValueStorage } from "./storage";

const now = () => new Date("2026-10-06T15:00:00Z"); // Oct 7, 00:00 KST
const at = now().toISOString();
const record: MealRecord = {
  id: "r1", consumedAt: at, createdAt: at, updatedAt: at, sourceText: "커피 9kcal",
  items: [{ id: "i1", name: "커피", amount: "1잔", calories: 9, caloriesEstimated: false }],
};
const turn = (id: string, time = at): ConversationTurn => ({
  id, at: time, user: "커피 9kcal", reply: "커피 1잔 9 kcal 기록했어요.", outcome: "added", recordIds: ["r1"],
});

describe("conversation storage", () => {
  it.each(["broken", "null", '{"version":2,"turns":[]}', '{"version":1,"turns":{}}'])("reads bad envelope %s as empty", async (raw) => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.conversation]: raw });
    expect((await createLocalStorageConversationRepository({ storage, now }).getAll()).turns).toEqual([]);
  });

  it("rejects an unknown version even with otherwise valid turns", async () => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.conversation]: JSON.stringify({ version: 2, turns: [turn("a")] }) });
    expect((await createLocalStorageConversationRepository({ storage, now }).getAll()).turns).toEqual([]);
  });

  it("drops only broken entries, including datetimes without an offset", async () => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.conversation]: JSON.stringify({ version: 1, turns: [turn("a"), { id: "bad" }, turn("bad-time", "2026-10-07T00:00:00"), { ...turn("bad-outcome"), outcome: "guess" }, turn("b")] }) });
    expect((await createLocalStorageConversationRepository({ storage, now }).getAll()).turns.map((t) => t.id)).toEqual(["a", "b"]);
  });

  it("retains exactly 30 KST dates and physically prunes on read, without touching meals", async () => {
    const storage = createMemoryStorage({
      [STORAGE_KEYS.conversation]: JSON.stringify({ version: 1, turns: [turn("expired", "2026-09-07T14:59:59Z"), turn("boundary", "2026-09-07T15:00:00Z"), turn("today"), turn("future", "2026-10-07T15:00:00Z")] }),
      [STORAGE_KEYS.mealRecords]: JSON.stringify({ version: 1, records: [record] }),
    });
    const repo = createLocalStorageConversationRepository({ storage, now });
    expect((await repo.getAll()).turns.map((t) => t.id)).toEqual(["boundary", "today"]);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.conversation)!).turns).toHaveLength(2);
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.mealRecords)!).records).toEqual([record]);
  });

  it("prunes on write and orders by instants rather than ISO string offsets", async () => {
    const storage = createMemoryStorage();
    let clock = new Date("2026-09-07T15:00:00Z");
    const repo = createLocalStorageConversationRepository({ storage, now: () => clock });
    await repo.append(turn("old", clock.toISOString()));
    clock = new Date("2026-10-08T00:00:00+09:00");
    await repo.append(turn("later", "2026-10-07T00:00:00Z"));
    await repo.append(turn("earlier", "2026-10-07T08:00:00+09:00"));
    expect((await repo.getAll()).turns.map((t) => t.id)).toEqual(["earlier", "later"]);
  });

  it("retries quota failures oldest first and reports the lost turns", async () => {
    const memory = createMemoryStorage();
    const attempts: string[][] = [];
    const storage: KeyValueStorage = { ...memory, setItem(key, value) {
      const ids = JSON.parse(value).turns.map((t: ConversationTurn) => t.id);
      attempts.push(ids);
      if (ids.length > 2) throw new DOMException("full", "QuotaExceededError");
      memory.setItem(key, value);
    } };
    const repo = createLocalStorageConversationRepository({ storage, now });
    await repo.append(turn("a", "2026-10-06T16:00:00Z"));
    await repo.append(turn("b", "2026-10-06T17:00:00Z"));
    const result = await repo.append(turn("c", "2026-10-06T18:00:00Z"));
    expect(result).toMatchObject({ saved: true, dropped: 1 });
    expect(attempts.slice(-2)).toEqual([["a", "b", "c"], ["b", "c"]]);
  });

  it("reports failure without failing an independently persisted meal", async () => {
    const memory = createMemoryStorage();
    const storage = { ...memory, setItem(key: string, value: string) {
      if (key === STORAGE_KEYS.conversation) throw new Error("blocked");
      memory.setItem(key, value);
    } };
    const meals = createLocalStorageMealRecordRepository({ storage, now });
    await meals.add(record);
    expect((await createLocalStorageConversationRepository({ storage, now }).append(turn("a"))).saved).toBe(false);
    expect(await meals.getAll()).toEqual([record]);
  });

  it("surfaces cleanup write failure while excluding expired turns from the view", async () => {
    const memory = createMemoryStorage({ [STORAGE_KEYS.conversation]: JSON.stringify({ version: 1, turns: [turn("old", "2026-09-01T00:00:00Z")] }) });
    const storage = { ...memory, setItem() { throw new Error("blocked"); } };
    expect(await createLocalStorageConversationRepository({ storage, now }).getAll()).toMatchObject({ saved: false, turns: [] });
  });

  it("keeps readable retained turns visible if every cleanup write fails", async () => {
    const memory = createMemoryStorage({ [STORAGE_KEYS.conversation]: JSON.stringify({ version: 1, turns: [turn("old", "2026-09-01T00:00:00Z"), turn("kept")] }) });
    const storage = { ...memory, setItem() { throw new Error("blocked"); } };
    const result = await createLocalStorageConversationRepository({ storage, now }).getAll();
    expect(result).toMatchObject({ saved: false, dropped: 0 });
    expect(result.turns.map((entry) => entry.id)).toEqual(["kept"]);
    expect(JSON.parse(memory.getItem(STORAGE_KEYS.conversation)!).turns).toHaveLength(2);
  });
});

describe("sync metadata and legacy schemas", () => {
  it("marks a removed record and clears its marker when undo restores the same id", async () => {
    const storage = createMemoryStorage();
    const meals = createLocalStorageMealRecordRepository({ storage, now });
    const meta = createLocalStorageSyncMetaRepository({ storage });
    await meals.add(record);
    const removed = await removeFoodItem(meals, await meals.getAll(), "i1");
    expect(await meta.get()).toEqual({ removedRecords: [{ id: "r1", removedAt: at }], goalSetAt: {} });
    expect(await meals.getAll()).toEqual([]);
    if (removed.status !== "removed") throw new Error("expected removal");
    await restoreFoodItem(meals, [], removed);
    expect(await meals.getAll()).toEqual([{ ...record, updatedAt: new Date(now().getTime() + 1).toISOString() }]);
    expect((await meta.get()).removedRecords).toEqual([]);
  });

  it("item deletion is an update, and unknown removal leaves no marker", async () => {
    const storage = createMemoryStorage();
    const meals = createLocalStorageMealRecordRepository({ storage, now });
    await meals.add({ ...record, items: [...record.items, { ...record.items[0]!, id: "i2" }] });
    await removeFoodItem(meals, await meals.getAll(), "i1");
    await meals.remove("missing");
    expect((await createLocalStorageSyncMetaRepository({ storage }).get()).removedRecords).toEqual([]);
    expect((await meals.getAll())[0]?.updatedAt).toBe(at);
  });

  it("keeps old goal timestamps unknown and writes the latest set time, not carry-forward time", async () => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.dailyGoals]: JSON.stringify({ version: 1, goals: [{ date: "2026-09-01", calorieTarget: 1800 }] }) });
    let clock = now();
    const goals = createLocalStorageDailyGoalRepository({ storage, now: () => clock });
    const meta = createLocalStorageSyncMetaRepository({ storage });
    expect((await meta.get()).goalSetAt).toEqual({});
    await goals.set({ date: "2026-10-07", calorieTarget: 1700 });
    clock = new Date("2026-10-07T02:00:00Z");
    await goals.set({ date: "2026-10-07", calorieTarget: 1900 });
    await goals.get("2026-10-08");
    expect((await meta.get()).goalSetAt).toEqual({ "2026-10-07": clock.toISOString() });
  });

  it.each(["broken", '{"version":2,"removedRecords":[{"id":"x","removedAt":"2026-10-07T00:00:00Z"}]}'])("reads invalid metadata %s as empty", async (raw) => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.syncMeta]: raw });
    expect(await createLocalStorageSyncMetaRepository({ storage }).get()).toEqual({ removedRecords: [], goalSetAt: {} });
  });

  it("salvages individual valid metadata entries", async () => {
    const storage = createMemoryStorage({ [STORAGE_KEYS.syncMeta]: JSON.stringify({ version: 1, removedRecords: [{ id: "a", removedAt: at }, { id: "b" }], goalSetAt: { "2026-10-07": at, "2026-02-30": at, "2026-10-06": "bad" } }) });
    expect(await createLocalStorageSyncMetaRepository({ storage }).get()).toEqual({ removedRecords: [{ id: "a", removedAt: at }], goalSetAt: { "2026-10-07": at } });
  });

  it("writes primary data first; metadata failure reports separately without rolling it back", async () => {
    const memory = createMemoryStorage();
    const order: string[] = [];
    const onMetadataFailure = vi.fn();
    const storage = { ...memory, setItem(key: string, value: string) {
      order.push(key);
      if (key === STORAGE_KEYS.syncMeta) throw new Error("full");
      memory.setItem(key, value);
    } };
    const meals = createLocalStorageMealRecordRepository({ storage, now, onMetadataFailure });
    await meals.add(record);
    order.length = 0;
    await meals.remove(record.id);
    expect(order).toEqual([STORAGE_KEYS.mealRecords, STORAGE_KEYS.syncMeta]);
    expect(await meals.getAll()).toEqual([]);
    const goals = createLocalStorageDailyGoalRepository({ storage, now, onMetadataFailure });
    order.length = 0;
    await goals.set({ date: "2026-10-07", calorieTarget: 1800 });
    expect(order).toEqual([STORAGE_KEYS.dailyGoals, STORAGE_KEYS.syncMeta]);
    expect((await goals.get("2026-10-07"))?.calorieTarget).toBe(1800);
    expect(onMetadataFailure).toHaveBeenCalledTimes(2);
  });

  it("does not write metadata when the primary write fails", async () => {
    const memory = createMemoryStorage({ [STORAGE_KEYS.mealRecords]: JSON.stringify({ version: 1, records: [record] }) });
    const writes: string[] = [];
    const storage = { ...memory, setItem(key: string) { writes.push(key); throw new Error("full"); } };
    await expect(createLocalStorageMealRecordRepository({ storage }).remove("r1")).rejects.toThrow();
    const result = await setDailyGoal(createLocalStorageDailyGoalRepository({ storage }), "2026-10-07", 1800);
    expect(result).toEqual({ ok: false, reason: "storage_failed" });
    expect(writes).toEqual([STORAGE_KEYS.mealRecords, STORAGE_KEYS.dailyGoals]);
  });

  it("keeps all four legacy envelopes and fields byte-for-byte compatible through CRUD", async () => {
    const storage = createMemoryStorage();
    const profiles = createLocalStorageDietProfileRepository({ storage, now });
    const profile = { weightKg: 62, heightCm: 164, age: 31, sex: "female" as const, activityLevel: "light" as const, goalMode: "moderate_loss" as const, updatedAt: at };
    await profiles.set(profile);
    await profiles.markPromptSeen();
    const meals = createLocalStorageMealRecordRepository({ storage, now });
    await meals.add(record);
    expect(storage.getItem(STORAGE_KEYS.mealRecords)).toBe(JSON.stringify({ version: 1, records: [record] }));
    await meals.update("r1", { sourceText: "커피였어" });
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.mealRecords)!)).toEqual({ version: 1, records: [{ ...record, sourceText: "커피였어" }] });
    await meals.remove("r1");
    await createLocalStorageDailyGoalRepository({ storage, now }).set({ date: "2026-10-07", calorieTarget: 1800 });
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.mealRecords)!)).toEqual({ version: 1, records: [] });
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.dailyGoals)!)).toEqual({ version: 1, goals: [{ date: "2026-10-07", calorieTarget: 1800 }] });
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.dietProfile)!)).toEqual({ version: 1, profile });
    expect(JSON.parse(storage.getItem(STORAGE_KEYS.onboarding)!)).toEqual({ version: 1, promptSeenAt: at });
  });
});
