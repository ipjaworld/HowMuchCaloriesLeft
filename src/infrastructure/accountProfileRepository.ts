import type { DietProfile, DietProfileRepository } from "@/domain/dietProfile";
import { AccountStorageError } from "./remoteRepositories";
export type AccountProfile = {
  enabled: boolean;
  profile: DietProfile | null;
  revision: number;
  consentAt: string | null;
};
export function createAccountProfileRepository(
  local: DietProfileRepository,
  userId: string,
): DietProfileRepository {
  let state: AccountProfile | null = null;
  async function read() {
    if (!state) {
      const r = await fetch("/api/account/profile", {
        cache: "no-store",
        headers: { "x-account-id": userId },
      });
      if (!r.ok) throw new AccountStorageError(r.status);
      state = (await r.json()) as AccountProfile;
    }
    return state;
  }
  return {
    async get() {
      const p = await read();
      return p!.enabled ? p!.profile : local.get();
    },
    async set(profile) {
      const p = await read();
      if (!p!.enabled) return local.set(profile);
      const r = await fetch("/api/account/profile", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-account-id": userId },
        body: JSON.stringify({ profile, revision: p!.revision, consentAt: p!.consentAt }),
      });
      if (!r.ok) throw new AccountStorageError(r.status);
      state = (await r.json()) as AccountProfile;
    },
    async clear() {
      const p = await read();
      if (p!.enabled) {
        const r = await fetch("/api/account/profile", {
          method: "DELETE",
          headers: {
            "x-account-id": userId,
            "x-revision": String(p!.revision),
            "x-consent-at": p!.consentAt ?? "",
          },
        });
        if (!r.ok) throw new AccountStorageError(r.status);
        state = { enabled: false, profile: null, revision: 0, consentAt: null };
      }
      await local.clear();
    },
    hasSeenPrompt: () => local.hasSeenPrompt(),
    markPromptSeen: () => local.markPromptSeen(),
  };
}
