import { describe, expect, it } from "vitest";
import { conversationDays, latestExchange } from "./conversationView";
import type { ConversationTurn } from "@/domain/conversation";

const turn = (id: string, at: string, user: string | null = id): ConversationTurn => ({
  id, at, user, reply: `reply-${id}`, outcome: "answered", recordIds: [],
});
describe("conversation page and home preview", () => {
  it("groups by Korean dates, newest day first and each conversation in chronological order", () => {
    const entries = [turn("late", "2026-10-07T03:00:00Z"), turn("yesterday", "2026-10-06T14:59:59Z"), turn("midnight", "2026-10-06T15:00:00Z")];
    expect(conversationDays(entries, "2026-10-07").map(([day, turns]) => [day, turns.map(t => t.id)]))
      .toEqual([["2026-10-07", ["midnight", "late"]], ["2026-10-06", ["yesterday"]]]);
    expect(entries.map(t => t.id)).toEqual(["late", "yesterday", "midnight"]);
  });
  it("does not revive expired, future or invalid conversations", () => {
    const entries = [turn("expired", "2026-09-07T12:00:00Z"), turn("first", "2026-09-08T00:00:00Z"), turn("future", "2026-10-08T00:00:00Z"), turn("invalid", "invalid")];
    expect(conversationDays(entries, "2026-10-07").flatMap(([, turns]) => turns.map(t => t.id))).toEqual(["first"]);
    expect(latestExchange(entries, "2026-10-07")?.id).toBe("first");
  });
  it("selects exactly the latest turn, keeping its original question and answer paired", () => {
    const latest = turn("new", "2026-10-07T04:00:00Z");
    expect(latestExchange([latest, turn("old", "2026-10-07T03:00:00Z")], "2026-10-07")).toEqual(latest);
  });
  it("does not attach a previous question to a later button action", () => {
    const action = turn("delete", "2026-10-07T04:00:00Z", null);
    expect(latestExchange([turn("question", "2026-10-07T03:00:00Z"), action], "2026-10-07")?.user).toBeNull();
  });
  it("returns an empty state when no retained conversation exists", () => {
    expect(latestExchange([], "2026-10-07")).toBeNull();
    expect(conversationDays([], "2026-10-07")).toEqual([]);
  });
});
