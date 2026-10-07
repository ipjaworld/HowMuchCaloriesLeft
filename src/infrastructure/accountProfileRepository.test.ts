import { afterEach, describe, expect, it, vi } from "vitest";
import { createAccountProfileRepository } from "./accountProfileRepository";
import type { DietProfileRepository, DietProfile } from "@/domain/dietProfile";
const profile: DietProfile = {
  weightKg: 60,
  heightCm: 170,
  age: 30,
  sex: "female",
  activityLevel: "light",
  goalMode: "maintenance",
  updatedAt: "2026-10-07T00:00:00Z",
};
const local = () =>
  ({
    get: vi.fn().mockResolvedValue(profile),
    set: vi.fn(),
    clear: vi.fn(),
    hasSeenPrompt: vi.fn().mockResolvedValue(true),
    markPromptSeen: vi.fn(),
  }) satisfies DietProfileRepository;
afterEach(() => vi.unstubAllGlobals());
describe("separate profile consent", () => {
  it("keeps calculator writes local when consent is absent", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        Response.json({ enabled: false, profile: null, revision: 0 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const storage = local(),
      repo = createAccountProfileRepository(storage, "a");
    expect(await repo.get()).toEqual(profile);
    await repo.set(profile);
    expect(storage.set).toHaveBeenCalledWith(profile);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]?.[1]).not.toHaveProperty("body");
  });
  it("uses only the opted-in account profile and keeps device original intact", async () => {
    const saved = { ...profile, weightKg: 70 };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ enabled: true, profile: saved, revision: 3 }),
      )
      .mockResolvedValueOnce(
        Response.json({ enabled: true, profile, revision: 4 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const storage = local(),
      repo = createAccountProfileRepository(storage, "a");
    expect(await repo.get()).toEqual(saved);
    await repo.set(profile);
    expect(storage.set).not.toHaveBeenCalled();
    expect(storage.get).not.toHaveBeenCalled();
    expect(fetcher.mock.calls[1]?.[0]).toBe("/api/account/profile");
    expect(JSON.parse(fetcher.mock.calls[1]?.[1].body)).toEqual({
      profile,
      revision: 3,
    });
  });
  it("does not silently write locally after consent is withdrawn on another device", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          Response.json({ enabled: true, profile, revision: 0 }),
        )
        .mockResolvedValueOnce(
          Response.json({ error: "consent_required" }, { status: 403 }),
        ),
    );
    const storage = local(),
      repo = createAccountProfileRepository(storage, "a");
    await expect(repo.set(profile)).rejects.toMatchObject({ status: 403 });
    expect(storage.set).not.toHaveBeenCalled();
  });
});
