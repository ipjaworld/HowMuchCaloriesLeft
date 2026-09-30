import { describe, expect, it } from "vitest";
import type { Judgment, RecentItem } from "@/ai/judgment/types";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { describeModified, describeQuestion } from "@/components/replyText";
import { resolveAddParts, type AddPart } from "./addFood";
import { decideCommand } from "./commands";
import { describePart } from "./foodCoverage";
import { resolveModifyParts } from "./mixedModify";
import {
  answerCalories,
  confirmAdd,
  nextQuestion,
  planModifyCommit,
  skipUnknown,
  type PendingAdd,
} from "./pendingAdd";

/**
 * One sentence can correct a logged entry and report a new food at once.
 * Phase 8B reproduced the loss 3/3: with 떡볶이 logged, "떡볶이랑 튀김
 * 먹었는데 떡볶이는 반만" is judged modify, and 튀김 vanished — first on the
 * server, where the correction was reduced to "떡볶이 반만", then again on
 * the client, where only the first settled item was stored.
 */

async function logged(name: string): Promise<RecentItem> {
  const [part] = await resolveAddParts(`${name} 먹었어`, koreanFoodResolver);
  if (part?.status !== "resolved") throw new Error(`${name} does not resolve`);
  return {
    id: `rec-${name}`,
    name: part.item.name,
    ...(part.item.amount === undefined ? {} : { amount: part.item.amount }),
    calories: part.item.calories,
    consumedAt: "2026-10-01T11:40:00+09:00",
  };
}

function pendingFor(
  message: string,
  target: RecentItem,
  parts: AddPart[],
  extraParts: AddPart[],
): PendingAdd {
  return {
    sourceText: message,
    now: "2026-10-01T12:30:00+09:00",
    parts: [...parts, ...extraParts],
    needsConfirmation: parts.length + extraParts.length > 1,
    target: { itemId: target.id, foodName: target.name, modifyParts: parts.length },
  };
}

describe("a correction that also reports another food", () => {
  const message = "떡볶이랑 튀김 먹었는데 떡볶이는 반만";

  it("keeps 튀김 beside the correction instead of dropping it", async () => {
    const target = await logged("떡볶이");
    const { parts, extraParts } = await resolveModifyParts(message, target, koreanFoodResolver);

    expect(parts.map(describePart)).toEqual(['resolved 떡볶이 (반) ← "떡볶이"']);
    expect(extraParts.map(describePart)).toEqual(['unknown ← "튀김"']);
  });

  it("names both foods in the confirmation, then asks for 튀김's calories", async () => {
    const target = await logged("떡볶이");
    const { parts, extraParts } = await resolveModifyParts(message, target, koreanFoodResolver);
    const pending = pendingFor(message, target, parts, extraParts);

    const confirm = nextQuestion(pending);
    expect(confirm).toMatchObject({ type: "confirm_add", mode: "modify", names: ["떡볶이"], addNames: ["튀김"] });
    if (confirm === null) throw new Error("expected a question");
    expect(describeQuestion(confirm).text).toBe("떡볶이를 고치고 튀김을 새로 기록할까요?");

    expect(nextQuestion(confirmAdd(pending))).toMatchObject({ type: "provide_calories", partIndex: 1, label: "튀김" });
  });

  it("writes 떡볶이 반 over the entry and adds 튀김 once its calories are given", async () => {
    const target = await logged("떡볶이");
    const { parts, extraParts } = await resolveModifyParts(message, target, koreanFoodResolver);
    const answered = answerCalories(confirmAdd(pendingFor(message, target, parts, extraParts)), 1, 300);

    expect(nextQuestion(answered)).toBeNull();
    const plan = planModifyCommit(answered);
    expect(plan.replacement).toMatchObject({ name: "떡볶이", amount: "반" });
    expect(plan.additions).toMatchObject([{ name: "튀김", calories: 300 }]);
  });

  it("still writes the correction, and says so, when 튀김 is left out", async () => {
    const target = await logged("떡볶이");
    const { parts, extraParts } = await resolveModifyParts(message, target, koreanFoodResolver);
    const skipped = skipUnknown(confirmAdd(pendingFor(message, target, parts, extraParts)), 1);

    const plan = planModifyCommit(skipped);
    expect(plan.replacement).toMatchObject({ name: "떡볶이" });
    expect(plan.additions).toEqual([]);
    expect(plan.skipped).toEqual(["튀김"]);
  });

  it("reports the addition alongside the change", () => {
    const summary = { consumedCalories: 900, calorieTarget: 1800, remainingCalories: 900 };
    const reply = describeModified(
      { name: "떡볶이", amount: "1인분", calories: 480 },
      { name: "떡볶이", amount: "반", calories: 240 },
      summary as Parameters<typeof describeModified>[2],
      [{ name: "튀김" }],
    );
    expect(reply.text).toContain("튀김도 기록했어요.");
  });
});

describe("corrections that name nothing else are unchanged", () => {
  it("아까 떡볶이 반만 먹었어 — a plain modify, nothing added", async () => {
    const target = await logged("떡볶이");
    const { parts, extraParts } = await resolveModifyParts("아까 떡볶이 반만 먹었어", target, koreanFoodResolver);

    expect(parts.map(describePart)).toEqual(['resolved 떡볶이 (반) ← "떡볶이"']);
    expect(extraParts).toEqual([]);
  });

  it("떡볶이 말고 샐러드 먹었어 — the other food is the replacement, not an addition", async () => {
    const target = await logged("떡볶이");
    const { parts, extraParts } = await resolveModifyParts("떡볶이 말고 샐러드 먹었어", target, koreanFoodResolver);

    // Which salad is asked, as before; 떡볶이 is neither stored nor re-added.
    expect(parts.map(describePart).join()).toContain("샐러드");
    expect(parts.map(describePart).join()).not.toContain("resolved");
    expect(extraParts).toEqual([]);
  });

  it("김밥을 라면으로 바꿔줘 — the new food is not also added", async () => {
    const target = await logged("김밥");
    const { extraParts } = await resolveModifyParts("김밥을 라면으로 바꿔줘", target, koreanFoodResolver);
    expect(extraParts).toEqual([]);
  });

  it("비빔밥 먹었는데 조금 남겼어 — about the entry alone", async () => {
    const target = await logged("비빔밥");
    const { extraParts } = await resolveModifyParts("비빔밥 먹었는데 조금 남겼어", target, koreanFoodResolver);
    expect(extraParts).toEqual([]);
  });

  it("a single correction still commits as a single replacement", async () => {
    const target = await logged("떡볶이");
    const { parts, extraParts } = await resolveModifyParts("아까 떡볶이 반만 먹었어", target, koreanFoodResolver);
    const plan = planModifyCommit(pendingFor("아까 떡볶이 반만 먹었어", target, parts, extraParts));
    expect(plan.replacement).toMatchObject({ name: "떡볶이", amount: "반" });
    expect(plan.additions).toEqual([]);
  });
});

describe("a new food with another already logged", () => {
  it("김밥 먹었어 — judged add, it stays an add", async () => {
    const judgment: Judgment = {
      intent: "add_food",
      intentConfidence: 0.99,
      actualConsumptionProbability: 0.98,
      clarificationProbability: 0.2,
      referenceTargetId: null,
      referenceConfidence: null,
      source: "jev",
    };
    const input = {
      message: "김밥 먹었어",
      now: "2026-10-01T12:30:00+09:00",
      dailyGoalCalories: 1800,
      recentItems: [await logged("떡볶이")],
    };
    expect(decideCommand(judgment, input)).toMatchObject({ type: "add_candidate", needsConfirmation: false });
    const parts = await resolveAddParts(input.message, koreanFoodResolver);
    expect(parts.map(describePart)).toEqual(['resolved 김밥 (1줄) ← "김밥"']);
  });
});

describe("planModifyCommit never discards a settled food", () => {
  it("a second item from the correction itself is added, not dropped", () => {
    const item = (name: string) => ({ name, calories: 100, calorieSource: "dataset" as const });
    const plan = planModifyCommit({
      sourceText: "x",
      now: "2026-10-01T12:30:00+09:00",
      needsConfirmation: false,
      target: { itemId: "t", foodName: "김밥" },
      parts: [
        { status: "resolved", phraseName: "라면", item: item("라면") },
        { status: "resolved", phraseName: "만두", item: item("만두") },
      ],
    } as PendingAdd);
    expect(plan.replacement).toMatchObject({ name: "라면" });
    expect(plan.additions).toMatchObject([{ name: "만두" }]);
  });
});
