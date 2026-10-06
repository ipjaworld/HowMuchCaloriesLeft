import { describe, expect, it } from "vitest";
import type { Judge, Judgment } from "@/ai/judgment/types";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { runChat } from "./chatPipeline";

/**
 * What `runChat` adds on top of the judge: an add the parser had to cut apart
 * at a bare space is shown before it is stored, however sure the judge was.
 */

const sure: Judgment = {
  intent: "add_food",
  intentConfidence: 0.99,
  actualConsumptionProbability: 0.98,
  clarificationProbability: 0.1,
  referenceTargetId: null,
  referenceConfidence: null,
  source: "jev",
};
const judge: Judge = { judge: () => Promise.resolve(sure) };

async function add(message: string) {
  const { command } = await runChat(
    { message, now: "2026-10-06T12:30:00+09:00", dailyGoalCalories: 1800, recentItems: [] },
    undefined,
    { judge, resolver: koreanFoodResolver, candidateJudge: null },
  );
  if (command.type !== "add") throw new Error(`expected add: ${command.type}`);
  return command;
}

describe("foods listed with only a space between them", () => {
  it("confirms both before storing either (2026-10-06 feedback)", async () => {
    const command = await add("제육 김치 먹었어");
    expect(command.needsConfirmation).toBe(true);
    expect(command.parts.map((part) => [part.status, part.phraseName, part.listed])).toEqual([
      ["resolved", "제육", true],
      ["resolved", "김치", true],
    ]);
  });

  it("keeps the food a counter used to drop silently", async () => {
    const command = await add("라면 김밥 두 줄 먹었어");
    expect(command.parts.map((part) => (part.status === "resolved" ? part.item.amount : part.status))).toEqual([
      "1그릇",
      "두 줄",
    ]);
  });

  it("does not ask about foods joined by a word, a comma or a +", async () => {
    for (const message of ["제육이랑 김치 먹었어", "제육, 김치 먹었어", "제육 + 김치 먹었어"]) {
      const command = await add(message);
      expect(command.needsConfirmation, message).toBe(false);
      expect(command.parts, message).toHaveLength(2);
    }
  });
});
