import { afterEach, describe, expect, it, vi } from "vitest";
import { signConsent, validConsent } from "./accountConsent";
import {
  createRemoteRepositories,
  AccountStorageError,
} from "./remoteRepositories";
import { emptyAccountData } from "@/domain/account";
afterEach(() => vi.unstubAllGlobals());
describe("account security boundaries", () => {
  it("rejects altered, expired, future and differently signed consent", () => {
    const value = signConsent("secret", 1000000);
    expect(validConsent(value, "secret", 1000001)).toBe(true);
    expect(validConsent(value, "other", 1000001)).toBe(false);
    expect(validConsent(value, "secret", 999999)).toBe(false);
    expect(validConsent(value, "secret", 2000000)).toBe(false);
    expect(validConsent(value + "0", "secret", 1000001)).toBe(false);
  });
  it("deduplicates initial reads and keeps data away from localStorage", async () => {
    const storage = { setItem: vi.fn() };
    vi.stubGlobal("window", { localStorage: storage });
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ data: emptyAccountData(), revision: 0 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const repo = createRemoteRepositories("a");
    await Promise.all([
      repo.meals.getAll(),
      repo.goals.getAll(),
      repo.conversation.getAll(),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[0]?.[1].headers).toEqual({ "x-account-id": "a" });
  });
  it.each([401, 409, 503])(
    "keeps cached data unchanged on failed write %s",
    async (status) => {
      const data = emptyAccountData();
      const fetcher = vi
        .fn()
        .mockResolvedValueOnce(Response.json({ data, revision: 3 }))
        .mockResolvedValueOnce(Response.json({ error: "failed" }, { status }));
      vi.stubGlobal("fetch", fetcher);
      const repo = createRemoteRepositories("a");
      await expect(
        repo.goals.set({ date: "2026-10-07", calorieTarget: 2000 }),
      ).rejects.toBeInstanceOf(AccountStorageError);
      expect((await repo.snapshot()).data).toEqual(data);
      expect(JSON.parse(fetcher.mock.calls[1]?.[1].body).revision).toBe(3);
    },
  );
  it("does not enqueue offline changes", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ data: emptyAccountData(), revision: 0 }),
        )
        .mockRejectedValueOnce(new TypeError("offline")),
    );
    const repo = createRemoteRepositories("a");
    await expect(repo.meals.remove("one")).rejects.toMatchObject({
      status: 503,
    });
    expect((await repo.snapshot()).data.meta.removedRecords).toEqual([]);
  });
});
