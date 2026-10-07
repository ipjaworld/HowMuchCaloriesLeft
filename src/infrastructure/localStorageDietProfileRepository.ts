import { z } from "zod";
import {
  type DietProfile,
  type DietProfileRepository,
} from "@/domain/dietProfile";
import {
  STORAGE_KEYS,
  getBrowserStorage,
  readJson,
  writeJson,
  type KeyValueStorage,
} from "./storage";
import { dietProfileSchema } from "./profileSchema";
export { dietProfileSchema } from "./profileSchema";

/**
 * Body facts, stored in this browser and nowhere else.
 *
 * The privacy promise the calculator makes on screen — "이 기기에만 저장되며
 * 서버에 전송되지 않습니다" — is kept structurally: this module is the only one
 * that reads the profile, and it is only ever imported by the client screen.
 * Nothing on the server side imports it, `/api/chat`'s request schema has no
 * field that could carry it, and there is no analytics anywhere in the app.
 * `privacy.test.ts` pins all three.
 *
 * Stored shape:
 *
 *   hmcl.v1.dietProfile  { version: 1, profile: DietProfile }
 *   hmcl.v1.onboarding   { version: 1, promptSeenAt: string }
 *
 * Kept apart from the goal list on purpose. A profile is optional — someone
 * who types their own target never has one — and a goal must not depend on
 * it: clearing the profile leaves the goal exactly where it was.
 */

const PROFILE_VERSION = 1;
const ONBOARDING_VERSION = 1;

/**
 * An envelope of another version is treated as absent, not migrated. There is
 * only one version so far, and guessing what a future one meant is worse than
 * asking the person again — the calculator is thirty seconds.
 */
const profileEnvelopeSchema = z.object({
  version: z.literal(PROFILE_VERSION),
  profile: dietProfileSchema,
});

const onboardingEnvelopeSchema = z.object({
  version: z.literal(ONBOARDING_VERSION),
  promptSeenAt: z.string().min(1),
});

type Options = {
  storage?: KeyValueStorage;
  now?: () => Date;
};

export function createLocalStorageDietProfileRepository({
  storage = getBrowserStorage(),
  now = () => new Date(),
}: Options = {}): DietProfileRepository {
  return {
    async get() {
      const parsed = profileEnvelopeSchema.safeParse(
        readJson(storage, STORAGE_KEYS.dietProfile),
      );
      return parsed.success ? parsed.data.profile : null;
    },

    async set(profile: DietProfile) {
      // Validated on the way in too: a value this repository would refuse to
      // read back must not be written in the first place.
      const checked = dietProfileSchema.parse(profile);
      writeJson(storage, STORAGE_KEYS.dietProfile, {
        version: PROFILE_VERSION,
        profile: checked,
      });
    },

    async clear() {
      try {
        storage.removeItem(STORAGE_KEYS.dietProfile);
      } catch {
        // Unwritable storage has nothing to clear.
      }
    },

    async hasSeenPrompt() {
      return onboardingEnvelopeSchema.safeParse(
        readJson(storage, STORAGE_KEYS.onboarding),
      ).success;
    },

    async markPromptSeen() {
      writeJson(storage, STORAGE_KEYS.onboarding, {
        version: ONBOARDING_VERSION,
        promptSeenAt: now().toISOString(),
      });
    },
  };
}
