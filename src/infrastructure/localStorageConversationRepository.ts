import { z } from "zod";
import { CONVERSATION_OUTCOMES, retainedTurns, type ConversationRepository, type ConversationTurn, type ConversationRead } from "@/domain/conversation";
import { todayKey } from "@/domain/date";
import { parseValidEntries } from "./schemas";
import { getBrowserStorage, readJson, STORAGE_KEYS, writeJson, type KeyValueStorage } from "./storage";

const turnSchema = z.object({
  id: z.string().min(1),
  at: z.iso.datetime({ offset: true }),
  user: z.string().nullable(),
  reply: z.string(),
  outcome: z.enum(CONVERSATION_OUTCOMES),
  recordIds: z.array(z.string().min(1)),
});

export function createLocalStorageConversationRepository({
  storage = getBrowserStorage(), now = () => new Date(),
}: { storage?: KeyValueStorage; now?: () => Date } = {}): ConversationRepository {
  function read(): ConversationTurn[] {
    const raw = readJson(storage, STORAGE_KEYS.conversation);
    if (typeof raw !== "object" || raw === null || !("version" in raw) || raw.version !== 1) return [];
    return parseValidEntries(raw, "turns", turnSchema);
  }

  function write(turns: ConversationTurn[]): ConversationRead {
    const remaining = turns.slice();
    let dropped = 0;
    // Keep the newest turn if it fits. Never reclaim meals, goals or metadata.
    while (true) {
      if (writeJson(storage, STORAGE_KEYS.conversation, { version: 1, turns: remaining })) {
        return { turns: remaining, saved: remaining.length > 0 || turns.length === 0, dropped };
      }
      // No write succeeded: the existing value is still on disk. A failed
      // cleanup must not hide the retained turns that were readable there.
      if (remaining.length === 0) return { turns, saved: false, dropped: 0 };
      remaining.shift();
      dropped += 1;
    }
  }

  return {
    async getAll() {
      const all = read();
      const turns = retainedTurns(all, todayKey(now()));
      return turns.length === all.length ? { turns, saved: true, dropped: 0 } : write(turns);
    },
    async append(turn) {
      const checked = turnSchema.parse(turn);
      return write(retainedTurns([...read().filter((entry) => entry.id !== checked.id), checked], todayKey(now())));
    },
  };
}
