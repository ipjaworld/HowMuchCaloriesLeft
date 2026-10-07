import { retainedTurns, type ConversationTurn } from "@/domain/conversation";
import { dateKeyOf } from "@/domain/date";

export function conversationDays(turns: ConversationTurn[], today: string) {
  const groups = new Map<string, ConversationTurn[]>();
  for (const turn of retainedTurns(turns, today)) {
    const day = dateKeyOf(turn.at)!;
    const group = groups.get(day) ?? [];
    group.push(turn);
    groups.set(day, group);
  }
  return [...groups].sort(([a], [b]) => b.localeCompare(a));
}

// Persisted prose is a transcript, never a resumable question or undo command.
export function latestExchange(turns: ConversationTurn[], today: string) {
  return retainedTurns(turns, today).at(-1) ?? null;
}
