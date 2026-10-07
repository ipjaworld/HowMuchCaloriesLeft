import type { ConversationTurn } from "@/domain/conversation";
import type { MealRecord } from "@/domain/meal";

/** Includes deletions and partial writes, without storing a second meal snapshot. */
export function changedRecordIds(before: MealRecord[], after: MealRecord[]): string[] {
  const previous = new Map(before.map((record) => [record.id, JSON.stringify(record)]));
  const current = new Map(after.map((record) => [record.id, JSON.stringify(record)]));
  return [...new Set([...previous.keys(), ...current.keys()])]
    .filter((id) => previous.get(id) !== current.get(id));
}

export function makeConversationTurn(
  input: Pick<ConversationTurn, "user" | "reply" | "outcome">,
  before: MealRecord[],
  after: MealRecord[],
  { now = () => new Date(), createId = () => crypto.randomUUID() }: {
    now?: () => Date; createId?: () => string;
  } = {},
): ConversationTurn {
  return { ...input, id: createId(), at: now().toISOString(), recordIds: changedRecordIds(before, after) };
}
