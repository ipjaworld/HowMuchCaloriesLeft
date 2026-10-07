import { addDays, dateKeyOf } from "./date";

export const CONVERSATION_OUTCOMES = [
  "added", "modified", "removed", "restored", "asked", "cancelled",
  "nothing_added", "answered", "failed",
] as const;

export type ConversationTurn = {
  id: string;
  at: string;
  user: string | null;
  reply: string;
  outcome: (typeof CONVERSATION_OUTCOMES)[number];
  recordIds: string[];
};

export function isConversationDate(date: string, today: string): boolean {
  return date >= addDays(today, -29) && date <= today;
}

export function retainedTurns(turns: ConversationTurn[], today: string): ConversationTurn[] {
  return turns.filter((turn) => {
    const date = dateKeyOf(turn.at);
    return date !== null && isConversationDate(date, today);
  }).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

export type ConversationRead = {
  turns: ConversationTurn[];
  saved: boolean;
  /** Turns removed to make room, excluding ordinary 30-day expiry. */
  dropped: number;
};

export interface ConversationRepository {
  getAll(): Promise<ConversationRead>;
  append(turn: ConversationTurn): Promise<ConversationRead>;
}
