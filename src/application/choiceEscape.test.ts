import { describe, expect, it } from "vitest";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { describeQuestion } from "@/components/replyText";
import { itemsOf, resolveAddParts } from "./addFood";
import {
  answerCalories,
  answerChoice,
  answerNoneOfChoices,
  isComplete,
  nextQuestion,
  planModifyCommit,
  skipUnknown,
  type PendingAdd,
} from "./pendingAdd";

/**
 * The way out of "어떤 ○○인가요?" when the food is none of those offered.
 *
 * The choice only ever lists foods the dataset has, so before this a person
 * who ate a 밥 the dataset lacks had to pick a wrong one or retype the whole
 * sentence. "다른 음식이에요" turns that one food into the existing "how many
 * kcal?" question; "취소" drops the sentence, as typing 취소 always did.
 */

async function pendingFor(sentence: string): Promise<PendingAdd> {
  return {
    sourceText: sentence,
    now: "2026-10-03T12:00:00+09:00",
    parts: await resolveAddParts(sentence, koreanFoodResolver),
    needsConfirmation: false,
  };
}

describe("an add whose food is not among the choices", () => {
  it("offers the way out beside the foods", async () => {
    const pending = await pendingFor("밥 한 공기 먹었어");
    const question = nextQuestion(pending);
    expect(question?.type).toBe("choose_food");
    if (question === null) throw new Error("expected a question");
    const labels = (describeQuestion(question) as { options: { label: string }[] }).options.map((o) => o.label);
    expect(labels.slice(-2)).toEqual(["다른 음식이에요", "취소"]);
  });

  it("asks the calories of that one food, keeps the other, and stores both once", async () => {
    const pending = await pendingFor("밥 한 공기랑 라면 먹었어");
    const choose = nextQuestion(pending);
    if (choose?.type !== "choose_food") throw new Error("expected a food choice");

    const other = answerNoneOfChoices(pending, choose.partIndex);
    const ask = nextQuestion(other);
    expect(ask).toMatchObject({ type: "provide_calories", partIndex: choose.partIndex, othersResolved: true });

    const done = answerCalories(other, choose.partIndex, 350);
    expect(isComplete(done)).toBe(true);
    const items = itemsOf(done.parts);
    expect(items.map((item) => item.name).sort()).toEqual(["라면", "밥"]);
    const stated = items.find((item) => item.calorieSource === "user");
    expect(stated).toMatchObject({ name: "밥", calories: 350, amount: "한 공기" });
  });

  it("not knowing the calories either leaves that food out, not the others", async () => {
    const pending = await pendingFor("밥 한 공기랑 라면 먹었어");
    const choose = nextQuestion(pending);
    if (choose?.type !== "choose_food") throw new Error("expected a food choice");
    const skipped = skipUnknown(answerNoneOfChoices(pending, choose.partIndex), choose.partIndex);
    expect(isComplete(skipped)).toBe(true);
    expect(itemsOf(skipped.parts).map((item) => item.name)).toEqual(["라면"]);
  });

  it("does not loop: a second 'other' on the same food changes nothing", async () => {
    const pending = await pendingFor("밥 한 공기 먹었어");
    const choose = nextQuestion(pending);
    if (choose?.type !== "choose_food") throw new Error("expected a food choice");
    const once = answerNoneOfChoices(pending, choose.partIndex);
    expect(answerNoneOfChoices(once, choose.partIndex)).toBe(once);
    // And a stale pick after it is ignored, not applied over the answer.
    expect(answerChoice(once, choose.partIndex, "anything")).toBe(once);
  });
});

describe("a correction whose replacement is not among the choices", () => {
  it("still corrects the same entry with the stated figure, and adds nothing", async () => {
    const parts = await resolveAddParts("밥 한 공기", koreanFoodResolver);
    const pending: PendingAdd = {
      sourceText: "아까 거 밥 한 공기였어",
      now: "2026-10-03T12:00:00+09:00",
      parts,
      needsConfirmation: false,
      target: { itemId: "rec-ramen", foodName: "라면", modifyParts: parts.length },
    };
    const choose = nextQuestion(pending);
    expect(choose).toMatchObject({ type: "choose_food", mode: "modify" });
    if (choose?.type !== "choose_food") throw new Error("expected a food choice");

    const done = answerCalories(answerNoneOfChoices(pending, choose.partIndex), choose.partIndex, 300);
    const { replacement, additions } = planModifyCommit(done);
    expect(replacement).toMatchObject({ calories: 300, calorieSource: "user" });
    expect(additions).toEqual([]);
    expect(done.target?.itemId).toBe("rec-ramen");
  });
});

describe("떡볶이랑 튀김, 떡볶이는 반만 — the production smoke sentence", () => {
  it("asks which 튀김, and '다른 음식이에요' still ends in one 튀김 at the stated figure", async () => {
    const pending = await pendingFor("떡볶이랑 튀김 먹었는데 떡볶이는 반만 먹었어");
    const choose = nextQuestion(pending);
    expect(choose).toMatchObject({ type: "choose_food", phraseName: "튀김" });
    if (choose?.type !== "choose_food") throw new Error("expected a food choice");
    expect(choose.candidates.map((candidate) => candidate.name).sort()).toEqual(["감자튀김", "고구마튀김"]);

    const done = answerCalories(answerNoneOfChoices(pending, choose.partIndex), choose.partIndex, 300);
    const items = itemsOf(done.parts);
    expect(items.map((item) => item.name)).toEqual(["떡볶이", "튀김"]);
    expect(items.filter((item) => item.name === "튀김")).toHaveLength(1);
    expect(items.find((item) => item.name === "튀김")?.calories).toBe(300);
    // No amount was said for 튀김, so none is invented (the browser run first
    // showed "튀김 1인분 300" — the candidates' assumed serving).
    expect(items.find((item) => item.name === "튀김")?.amount).toBeUndefined();
  });
});
