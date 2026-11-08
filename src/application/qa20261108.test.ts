import { describe, expect, it } from "vitest";
import type { Judge, Judgment, JudgmentInput, RecentItem } from "@/ai/judgment/types";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { parseFoodPhrases } from "@/ai/nutrition/foodPhrases";
import { recordEstimates, resolveAddParts, type AddPart } from "./addFood";
import { runChat } from "./chatPipeline";
import { decideCommand, saysOnlyNotEaten } from "./commands";
import { readTalk } from "./smallTalk";
import { followUpMessage } from "./talkFollowUp";

/**
 * The five sentences of the 2026-11-08 production browser QA
 * (docs/product/live-browser-qa-2026-11-08.md), each as the code path that
 * failed it. Jev's own reading is not in these; they fix what the code did
 * with it.
 */

const RAMEN_TWICE: RecentItem[] = [
  { id: "r1", name: "라면", amount: "1그릇", calories: 451, consumedAt: "2026-11-08T08:10:00+09:00" },
  { id: "r2", name: "라면", amount: "반 그릇", calories: 226, consumedAt: "2026-11-08T12:10:00+09:00" },
];

function judgment(overrides: Partial<Judgment> = {}): Judgment {
  return {
    intent: "add_food",
    intentConfidence: 0.95,
    actualConsumptionProbability: 0.95,
    clarificationProbability: 0.1,
    referenceTargetId: null,
    referenceConfidence: null,
    source: "jev",
    ...overrides,
  };
}

function input(message: string, recentItems: RecentItem[] = []): JudgmentInput {
  return { message, now: "2026-11-08T18:00:00+09:00", dailyGoalCalories: 2540, recentItems };
}

async function recorded(message: string): Promise<AddPart[]> {
  return recordEstimates(await resolveAddParts(message, koreanFoodResolver));
}

function only(parts: AddPart[]) {
  expect(parts).toHaveLength(1);
  const [part] = parts;
  if (part?.status !== "resolved") throw new Error(`expected resolved: ${part?.status}`);
  return part;
}

describe("QA-01 · 반 봉지 is half, not one 그릇", () => {
  it("records half of one 그릇 when 봉지 has no size for 라면", async () => {
    const half = only(await recorded("라면 반 봉지 먹었어"));
    const bowl = only(await recorded("라면 반 그릇 먹었어"));
    const whole = only(await recorded("라면 한 봉지 먹었어"));
    expect(half.item).toMatchObject({ name: "라면", amount: "반 그릇", caloriesEstimated: true });
    expect(half.item.calories).toBe(bowl.item.calories);
    expect(half.item.calories).toBeLessThan(whole.item.calories);
    expect(half.portionGuess).toEqual({ kind: "portion", said: "반 봉지", portion: "1그릇", factor: 0.5 });
  });

  it("reads 1/2봉지 and 1/3봉지 the same way", async () => {
    expect(only(await recorded("라면 1/2봉지 먹었어")).item.amount).toBe("반 그릇");
    expect(only(await recorded("라면 1/3봉지 먹었어")).item.amount).toBe("1/3그릇");
  });

  it("still takes one portion for a count above one, as before", async () => {
    expect(only(await recorded("라면 한 봉지 먹었어")).item.amount).toBe("1그릇");
    expect(only(await recorded("만두 5개 먹었어")).item.amount).toBe("1인분");
  });
});

describe("QA-02 · the sentence to say after a food question", () => {
  it("names the food, and keeps it for a bare 먹었어 sent next", async () => {
    const talk = await readTalk("오늘 저녁 떡볶이 먹을까?", koreanFoodResolver);
    expect(talk).toMatchObject({ kind: "food_info", said: "떡볶이" });
    expect(talk).not.toHaveProperty("plan");
  });

  it.each([
    ["먹었어", "떡볶이 먹었어"],
    ["먹었어요", "떡볶이 먹었어요"],
    ["응 먹었어", "떡볶이 먹었어"],
    ["네, 결국 먹었어요!", "떡볶이 먹었어요"],
    ["먹음", "떡볶이 먹음"],
  ])("%s → %s", (message, sent) => {
    expect(followUpMessage(message, "떡볶이")).toBe(sent);
  });

  it.each(["김밥 먹었어", "안 먹었어", "먹을까?", "네", "먹을게"])("leaves %s as typed", (message) => {
    expect(followUpMessage(message, "떡볶이")).toBe(message);
  });

  it("does nothing without a food just answered", () => {
    expect(followUpMessage("먹었어", null)).toBe("먹었어");
  });
});

describe("QA-03 · not eaten is not a request to delete", () => {
  it.each([
    "오늘 아침 라면 먹으려다가 안 먹었어",
    "라면 먹으려다 말았어",
    "라면 안 먹었어",
    "라면 먹고 싶었는데 참았어",
  ])("%s changes nothing, even when the judge read delete", (message) => {
    expect(saysOnlyNotEaten(message)).toBe(true);
    for (const intent of ["delete_food", "modify_food"] as const) {
      expect(decideCommand(judgment({ intent, referenceTargetId: "r1", referenceConfidence: 0.9 }), input(message, RAMEN_TWICE))).toEqual({
        type: "ignore",
        reason: "not_consumption",
      });
    }
  });

  it.each(["라면 안 먹었는데 잘못 적었어", "라면 안 먹었으니까 지워줘", "아까 라면 먹었다고 했는데 사실 안 먹었어", "라면 기록 취소해줘"])(
    "%s may still change an entry",
    (message) => {
      expect(saysOnlyNotEaten(message)).toBe(false);
      expect(decideCommand(judgment({ intent: "delete_food" }), input(message, RAMEN_TWICE)).type).toBe("clarify");
    },
  );

  it("is answered as not eaten, not as a question about the food", async () => {
    expect(await readTalk("라면 먹으려고 했는데 안 먹었어", koreanFoodResolver)).toEqual({ kind: "uneaten" });
    // A question in the negative is not a report of not eating.
    expect((await readTalk("떡볶이 안 먹어도 돼?", koreanFoodResolver))?.kind).not.toBe("uneaten");
  });

  it("answers it, and says how to remove the entry if that was meant", async () => {
    const judge: Judge = { judge: () => Promise.resolve(judgment({ intent: "delete_food", referenceTargetId: "r1", referenceConfidence: 0.9 })) };
    const { command } = await runChat(input("오늘 아침 라면 먹으려다가 안 먹었어", RAMEN_TWICE), undefined, {
      judge,
      resolver: koreanFoodResolver,
      candidateJudge: null,
    });
    expect(command).toEqual({ type: "ignore", reason: "not_consumption", talk: { kind: "uneaten", logged: "라면" } });
  });
});

describe("QA-04 · cooked one 봉지, ate half", () => {
  it("reads the food and the share eaten", () => {
    expect(parseFoodPhrases("라면 한 봉지 끓였는데 반만 먹었어").map((p) => [p.name, p.quantity.text])).toEqual([["라면", "반 봉지"]]);
  });

  it("records half of one 그릇, like 반 봉지", async () => {
    expect(only(await recorded("라면 한 봉지 끓였는데 반만 먹었어")).item).toMatchObject({ name: "라면", amount: "반 그릇" });
  });

  it.each([
    ["라면 두 봉지 끓였는데 반만 먹었어", "라면", "1봉지"],
    ["라면 끓였는데 다 먹었어", "라면", ""],
    ["김밥 두 줄 샀는데 반만 먹었어", "김밥", "1줄"],
    ["김밥 한 줄 먹었는데 반만 먹은 거였어", "김밥", "반 줄"],
    ["김밥 한 줄 먹었는데 반 줄만 먹은 거였어", "김밥", "반 줄"],
  ])("%s → %s %s", (message, name, amount) => {
    expect(parseFoodPhrases(message).map((p) => [p.name, p.quantity.text])).toEqual([[name, amount]]);
  });

  it("subtracts what was left of what was cooked", () => {
    const [phrase] = parseFoodPhrases("라면 한 봉지 끓였는데 반은 남겼어");
    expect([phrase?.name, phrase?.quantity.value, phrase?.quantity.unit]).toEqual(["라면", 0.5, "봉지"]);
  });

  it("leaves a cooking verb that makes another food to the question it was", () => {
    expect(parseFoodPhrases("계란을 구워서 두 개 먹었어").map((p) => p.name)).toEqual(["계란을 구워서"]);
    // A story, not an amount after the verb: read as it was before.
    expect(parseFoodPhrases("라면 끓여서 계란 두 개 넣고 먹었어").map((p) => p.name)).toEqual(["라면 끓여서 계란 두 개 넣고"]);
  });
});

describe("QA-05 · a plan is answered as a plan", () => {
  it("reads 내일 … 먹을 거야 as a plan for another day, and the food without 내일", async () => {
    expect(await readTalk("내일 떡볶이 먹을 거야", koreanFoodResolver)).toMatchObject({ kind: "food_info", said: "떡볶이", plan: "later", foods: [{ name: "떡볶이" }] });
    expect(await readTalk("저녁에 떡볶이 먹을 거야", koreanFoodResolver)).toMatchObject({ kind: "food_info", plan: "today" });
  });

  it.each(["내일 떡볶이 먹을 거야", "떡볶이 먹을 예정이야", "떡볶이 먹을게", "저녁에 떡볶이 먹을 거야"])(
    "%s is not parsed as a meal",
    (message) => {
      expect(parseFoodPhrases(message)).toEqual([]);
    },
  );
});
