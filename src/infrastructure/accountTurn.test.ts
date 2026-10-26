import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyAccountData } from "@/domain/account";
import type { MealRecord } from "@/domain/meal";
import { applyAccountChange, mutateAccountData } from "@/application/accountMutation";
import { accountMutationSchema, MAX_BATCH_CHANGES } from "./accountSchemas";
import { AccountStorageError, AccountTurnError, createRemoteRepositories } from "./remoteRepositories";

afterEach(() => vi.unstubAllGlobals());

const NOW = new Date("2026-10-26T03:00:00Z");
function record(id: string, calories = 100): MealRecord {
  return {
    id,
    consumedAt: "2026-10-26T12:00:00+09:00",
    sourceText: `${id} 먹었어`,
    items: [{ id: `${id}-item`, name: id, calories, caloriesEstimated: false }],
    createdAt: "2026-10-26T03:00:00.000Z",
    updatedAt: "2026-10-26T03:00:00.000Z",
  };
}
const turn = {
  id: "turn-1",
  at: "2026-10-26T03:00:00.000Z",
  user: "김밥 먹었어",
  reply: "기록했어요",
  outcome: "added" as const,
  recordIds: ["a"],
};
function bodyOf(call: unknown[] | undefined) {
  return JSON.parse((call?.[1] as RequestInit).body as string);
}

describe("batch mutation", () => {
  it("applies the changes in order, as separate mutations would", () => {
    const changes = [
      { operation: "add" as const, record: record("a") },
      { operation: "update" as const, id: "a", input: { sourceText: "고쳤어" } },
      { operation: "add" as const, record: record("b") },
      { operation: "remove" as const, id: "b" },
      { operation: "turn" as const, turn },
    ];
    const batched = mutateAccountData(emptyAccountData(), { operation: "batch", changes, revision: 0 }, NOW);
    const sequential = changes.reduce((data, change) => applyAccountChange(data, change, NOW), emptyAccountData());
    expect(batched).toEqual(sequential);
    expect(batched.records.map((r) => [r.id, r.sourceText])).toEqual([["a", "고쳤어"]]);
    expect(batched.meta.removedRecords.map((r) => r.id)).toEqual(["b"]);
    expect(batched.turns.map((t) => t.id)).toEqual(["turn-1"]);
  });
  it("accepts turn changes only: no import, no nesting, bounded size", () => {
    const parse = (changes: unknown[]) => accountMutationSchema.safeParse({ operation: "batch", changes, revision: 0 }).success;
    expect(parse([{ operation: "remove", id: "a" }])).toBe(true);
    expect(parse([])).toBe(false);
    expect(parse([{ operation: "import", data: emptyAccountData(), consent: true }])).toBe(false);
    expect(parse([{ operation: "batch", changes: [{ operation: "remove", id: "a" }] }])).toBe(false);
    expect(parse([{ operation: "remove", id: "a", revision: 0 }])).toBe(false);
    expect(parse(Array.from({ length: MAX_BATCH_CHANGES + 1 }, () => ({ operation: "remove", id: "a" })))).toBe(false);
  });
});

describe("account turn buffer", () => {
  function server(...responses: Response[]) {
    const fetcher = vi.fn();
    fetcher.mockResolvedValueOnce(Response.json({ data: emptyAccountData(), revision: 4 }));
    for (const response of responses) fetcher.mockResolvedValueOnce(response);
    vi.stubGlobal("fetch", fetcher);
    return fetcher;
  }

  it("holds writes until commit, lets the turn read them, and saves them in one request", async () => {
    const saved = mutateAccountData(emptyAccountData(), { operation: "add", record: record("a"), revision: 4 }, NOW);
    const fetcher = server(Response.json({ data: saved, revision: 5 }));
    const repo = createRemoteRepositories("user");
    repo.beginTurn();
    await repo.meals.add(record("a"));
    await repo.meals.update("a", { sourceText: "고쳤어" });
    await repo.conversation.append(turn);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((await repo.meals.getAll()).map((r) => r.sourceText)).toEqual(["고쳤어"]);

    await repo.commitTurn();
    expect(fetcher).toHaveBeenCalledTimes(2);
    const body = bodyOf(fetcher.mock.calls[1]);
    expect(body.operation).toBe("batch");
    expect(body.revision).toBe(4);
    expect(body.changes.map((c: { operation: string }) => c.operation)).toEqual(["add", "update", "turn"]);
    expect((await repo.snapshot()).revision).toBe(5);
  });

  it("drops the whole turn on a refused save and reads the server again", async () => {
    const fetcher = server(
      Response.json({ error: "conflict" }, { status: 409 }),
      Response.json({ data: emptyAccountData(), revision: 6 }),
    );
    const repo = createRemoteRepositories("user");
    repo.beginTurn();
    await repo.meals.add(record("a"));
    await repo.conversation.append(turn);
    const error = await repo.commitTurn().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccountTurnError);
    expect(error).toBeInstanceOf(AccountStorageError);
    expect(error).toMatchObject({ status: 409, recordsChanged: true });
    expect((error as Error).message).toContain("이번 변경은 저장하지 않았어요");
    expect(await repo.meals.getAll()).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it("says all-or-nothing when the response is lost", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: emptyAccountData(), revision: 0 }))
      .mockRejectedValueOnce(new TypeError("offline"));
    vi.stubGlobal("fetch", fetcher);
    const repo = createRemoteRepositories("user");
    repo.beginTurn();
    await repo.meals.remove("a");
    const error = await repo.commitTurn().catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 503, recordsChanged: true });
    expect((error as Error).message).toContain("모두 저장됐거나 모두 저장되지 않았어요");
  });

  it("marks a turn that only carried its conversation entry", async () => {
    server(Response.json({ error: "failed" }, { status: 503 }));
    const repo = createRemoteRepositories("user");
    repo.beginTurn();
    await repo.conversation.append(turn);
    await expect(repo.commitTurn()).rejects.toMatchObject({ recordsChanged: false });
  });

  it("sends nothing for a turn without writes, and abandoning restores the server view", async () => {
    const fetcher = server(Response.json({ data: emptyAccountData(), revision: 4 }));
    const repo = createRemoteRepositories("user");
    repo.beginTurn();
    await repo.commitTurn();
    expect(fetcher).toHaveBeenCalledTimes(0);

    repo.beginTurn();
    await repo.meals.add(record("a"));
    repo.abandonTurn();
    expect(await repo.meals.getAll()).toEqual([]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls.every((call) => (call[1] as RequestInit).method !== "POST")).toBe(true);
  });

  it("writes immediately outside a turn, as before", async () => {
    const fetcher = server(Response.json({ data: emptyAccountData(), revision: 5 }));
    const repo = createRemoteRepositories("user");
    await repo.goals.set({ date: "2026-10-26", calorieTarget: 2000 });
    expect(bodyOf(fetcher.mock.calls[1])).toMatchObject({ operation: "goal", revision: 4 });
  });
});
