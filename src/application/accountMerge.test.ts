import { describe, expect, it } from "vitest";
import { emptyAccountData } from "@/domain/account";
import { mergeAccountData } from "./accountMerge";
import { mutateAccountData } from "./accountMutation";
const early = "2026-10-06T00:00:00Z",
  late = "2026-10-07T00:00:00Z";
const meal = (id = "one", at = early) => ({
  id,
  sourceText: "커피",
  consumedAt: early,
  createdAt: early,
  updatedAt: at,
  items: [{ id: "food", name: "커피", calories: 9, caloriesEstimated: false }],
});
describe("account migration", () => {
  it("an explicit restore wins even when the clock has not advanced", () => {
    const deleted = emptyAccountData();
    deleted.meta.removedRecords = [{ id: "one", removedAt: early }];
    const restored = mutateAccountData(deleted, { operation: "add", record: meal(), revision: 0 }, new Date(early));
    expect(mergeAccountData(deleted, restored, "2026-10-07").records).toHaveLength(1);
  });
  it("merges independent devices and is idempotent", () => {
    const s = emptyAccountData(),
      l = emptyAccountData();
    s.records = [meal("a")];
    l.records = [meal("b")];
    const once = mergeAccountData(s, l, "2026-10-07");
    expect(once.records).toHaveLength(2);
    expect(mergeAccountData(once, l, "2026-10-07")).toEqual(once);
  });
  it("uses the newer edit and preserves server ties", () => {
    const s = emptyAccountData(),
      l = emptyAccountData();
    s.records = [meal()];
    l.records = [{ ...meal("one", late), sourceText: "수정" }];
    expect(mergeAccountData(s, l, "2026-10-07").records[0]?.sourceText).toBe(
      "수정",
    );
    s.records = [{ ...meal("one", late), sourceText: "서버" }];
    expect(mergeAccountData(s, l, "2026-10-07").records[0]?.sourceText).toBe(
      "서버",
    );
  });
  it("deletion wins ties and stale devices cannot resurrect deleted records", () => {
    const s = emptyAccountData(),
      l = emptyAccountData();
    s.meta.removedRecords = [{ id: "one", removedAt: late }];
    l.records = [meal("one", late)];
    expect(mergeAccountData(s, l, "2026-10-07").records).toEqual([]);
  });
  it("a later explicit restore wins over the deletion marker", () => {
    const s = emptyAccountData(),
      l = emptyAccountData();
    s.meta.removedRecords = [{ id: "one", removedAt: early }];
    l.records = [meal("one", late)];
    const result = mergeAccountData(s, l, "2026-10-07");
    expect(result.records).toHaveLength(1);
    expect(result.meta.removedRecords).toEqual([]);
  });
  it("old undated goals never override a server goal", () => {
    const s = emptyAccountData(),
      l = emptyAccountData();
    s.goals = [{ date: "2026-10-07", calorieTarget: 2000 }];
    l.goals = [{ date: "2026-10-07", calorieTarget: 1800 }];
    expect(mergeAccountData(s, l, "2026-10-07").goals).toEqual(s.goals);
    l.meta.goalSetAt["2026-10-07"] = late;
    expect(mergeAccountData(s, l, "2026-10-07").goals).toEqual(l.goals);
  });
  it("prunes only conversations and keeps immutable server duplicate turns", () => {
    const s = emptyAccountData(),
      l = emptyAccountData();
    s.records = [meal()];
    const turn = {
      id: "t",
      at: late,
      user: "입력",
      reply: "서버",
      outcome: "answered" as const,
      recordIds: [],
    };
    s.turns = [turn];
    l.turns = [
      { ...turn, reply: "기기" },
      { ...turn, id: "expired", at: "2026-09-07T12:00:00+09:00" },
    ];
    const result = mergeAccountData(s, l, "2026-10-07");
    expect(result.turns).toEqual([turn]);
    expect(result.records).toEqual(s.records);
  });
  it("updates restore timestamps and clears markers", () => {
    const s = emptyAccountData();
    s.meta.removedRecords = [{ id: "one", removedAt: early }];
    const result = mutateAccountData(
      s,
      { operation: "add", record: meal(), revision: 0 },
      new Date(late),
    );
    expect(result.records[0]?.updatedAt).toBe(new Date(late).toISOString());
    expect(result.meta.removedRecords).toEqual([]);
    expect(s.records).toEqual([]);
  });
});
