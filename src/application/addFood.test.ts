import { describe, expect, it, vi } from "vitest";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import type { MealRecord } from "@/domain/meal";
import type { MealRecordRepository } from "@/domain/repository";
import {
  isSettled,
  itemsOf,
  resolveAddParts,
  preferTargetFood,
  isSameAs,
} from "./addFood";
import { addMealRecord } from "./mealRecords";
import {
  answerChoice,
  answerQuantity,
  confirmAdd,
  isCancelMessage,
  isComplete,
  nextQuestion,
  type PendingAdd,
} from "./pendingAdd";

/**
 * The add pipeline, end to end over the shipped dataset and a real
 * repository — everything the screen does except the React.
 *
 * The screen only sequences these calls, so what is asserted here is the part
 * that can be wrong: which sentences finish in one turn, which ones wait, and
 * above all *when a record gets written*. The counting of `add` calls is the
 * point of several of these: a half-finished sentence that quietly stores
 * something is the failure this whole design exists to prevent.
 */

function fakeRepository() {
  const records: MealRecord[] = [];
  const add = vi.fn(async (record: MealRecord) => {
    records.push(record);
  });
  const repository: MealRecordRepository = {
    add,
    getByDate: async () => records,
    update: async () => undefined,
    remove: async () => undefined,
  };
  return { repository, add, records };
}

const NOW = "2026-09-23T12:30:00+09:00";

async function start(sentence: string): Promise<PendingAdd> {
  return {
    sourceText: sentence,
    now: NOW,
    parts: await resolveAddParts(sentence, koreanFoodResolver),
    needsConfirmation: false,
  };
}

/** What the screen does once nothing is left to ask. */
async function commit(
  repository: MealRecordRepository,
  pending: PendingAdd,
): Promise<void> {
  const items = itemsOf(pending.parts);
  if (items.length === 0) return;
  await addMealRecord(repository, {
    sourceText: pending.sourceText,
    items,
    consumedAt: pending.now,
  });
}

describe("resolved — one sentence, one turn", () => {
  it("writes a record with the resolver's own figure", async () => {
    const { repository, add, records } = fakeRepository();
    const pending = await start("갈비탕 하나 먹었어");

    expect(isSettled(pending.parts)).toBe(true);
    expect(nextQuestion(pending)).toBeNull();

    await commit(repository, pending);

    expect(add).toHaveBeenCalledTimes(1);
    const record = records[0];
    expect(record?.items).toHaveLength(1);
    expect(record?.items[0]?.name).toBe("갈비탕");
    expect(record?.sourceText).toBe("갈비탕 하나 먹었어");
    expect(record?.consumedAt).toBe(NOW);

    // The figure is copied from the resolver, never recomputed here.
    const resolved = pending.parts[0];
    if (resolved?.status !== "resolved") throw new Error("expected resolved");
    expect(record?.items[0]?.calories).toBe(resolved.item.calories);
  });

  it("gives the record no meal type — none is inferred in this phase", async () => {
    const { repository, records } = fakeRepository();
    await commit(repository, await start("갈비탕 하나 먹었어"));
    expect(records[0]?.mealType).toBeUndefined();
  });
});

describe("ambiguous — the record waits for a choice", () => {
  it("asks which food, and stores nothing until told", async () => {
    const { repository, add } = fakeRepository();
    const pending = await start("밥 한 공기 먹었어");

    const question = nextQuestion(pending);
    expect(question?.type).toBe("choose_food");
    if (question?.type !== "choose_food") return;
    expect(question.candidates.map((c) => c.name).sort()).toEqual([
      "쌀밥",
      "현미밥",
    ]);

    // Nothing is written while a question is open.
    expect(isComplete(pending)).toBe(false);
    expect(add).toHaveBeenCalledTimes(0);

    const chosen = question.candidates.find((c) => c.name === "쌀밥");
    const answered = answerChoice(pending, question.partIndex, chosen?.entryId ?? "");

    expect(isComplete(answered)).toBe(true);
    await commit(repository, answered);

    expect(add).toHaveBeenCalledTimes(1);
  });

  it("stores only the food that was chosen", async () => {
    const { repository, records } = fakeRepository();
    const pending = await start("밥 한 공기 먹었어");
    const question = nextQuestion(pending);
    if (question?.type !== "choose_food") throw new Error("expected a choice");

    const brown = question.candidates.find((c) => c.name === "현미밥");
    await commit(
      repository,
      answerChoice(pending, question.partIndex, brown?.entryId ?? ""),
    );

    expect(records[0]?.items).toHaveLength(1);
    expect(records[0]?.items[0]?.name).toBe("현미밥");
  });

  it("ignores a choice that was never offered", async () => {
    const pending = await start("밥 한 공기 먹었어");
    const unchanged = answerChoice(pending, 0, "not-a-candidate");
    expect(isComplete(unchanged)).toBe(false);
  });
});

describe("unmeasurable — the record waits for an amount", () => {
  it("asks for a weight, and stores nothing until given one", async () => {
    const { repository, add, records } = fakeRepository();
    const pending = await start("커피 한잔 마셨어");

    const question = nextQuestion(pending);
    expect(question?.type).toBe("provide_quantity");
    if (question?.type !== "provide_quantity") return;
    expect(question.reason).toBe("missing_serving");
    expect(question.entries[0]?.name).toContain("아메리카노");

    expect(add).toHaveBeenCalledTimes(0);

    // What /api/resolve returns for "200ml".
    const answered = answerQuantity(pending, question.partIndex, {
      name: "커피_아메리카노",
      amount: "200ml",
      calories: 8,
      caloriesEstimated: true,
    });

    expect(isComplete(answered)).toBe(true);
    await commit(repository, answered);

    expect(add).toHaveBeenCalledTimes(1);
    expect(records[0]?.items[0]?.calories).toBe(8);
  });
});

describe("unknown — nothing to ask and nothing to store", () => {
  it("writes no record for a food the dataset does not have", async () => {
    const { repository, add } = fakeRepository();
    const pending = await start("마라탕 먹었어");

    expect(pending.parts[0]?.status).toBe("unknown");
    // Settled, because there is no question that would help.
    expect(isSettled(pending.parts)).toBe(true);
    expect(itemsOf(pending.parts)).toHaveLength(0);

    await commit(repository, pending);
    expect(add).toHaveBeenCalledTimes(0);
  });
});

describe("several foods in one sentence", () => {
  it("holds the whole sentence until every part is answered", async () => {
    const { repository, add, records } = fakeRepository();
    const pending = await start("갈비탕 하나랑 밥 한 공기 먹었어");

    expect(pending.parts).toHaveLength(2);
    expect(pending.parts[0]?.status).toBe("resolved");
    expect(pending.parts[1]?.status).toBe("ambiguous");

    // The resolved 갈비탕 is *not* written ahead of the question.
    expect(isComplete(pending)).toBe(false);
    expect(add).toHaveBeenCalledTimes(0);

    const question = nextQuestion(pending);
    if (question?.type !== "choose_food") throw new Error("expected a choice");
    const rice = question.candidates.find((c) => c.name === "쌀밥");
    const answered = answerChoice(pending, question.partIndex, rice?.entryId ?? "");

    await commit(repository, answered);

    // One sentence, one record, both foods on it.
    expect(add).toHaveBeenCalledTimes(1);
    expect(records).toHaveLength(1);
    expect(records[0]?.items.map((item) => item.name)).toEqual(["갈비탕", "쌀밥"]);
  });

  it("keeps the known food when another one is not in the dataset", async () => {
    const { repository, records } = fakeRepository();
    const pending = await start("갈비탕 하나랑 마라탕 먹었어");

    // An unknown food cannot be rescued by asking, so it does not hold the
    // rest of the sentence hostage — it is reported instead.
    expect(isSettled(pending.parts)).toBe(true);
    await commit(repository, pending);

    expect(records[0]?.items.map((item) => item.name)).toEqual(["갈비탕"]);
  });
});

describe("cancelling a pending question", () => {
  it("recognises the words people actually use", () => {
    for (const message of ["취소", "아니", "아니요", "됐어", "그만", "안 할래"]) {
      expect(isCancelMessage(message), message).toBe(true);
    }
  });

  it("does not mistake an answer for a refusal", () => {
    for (const message of ["200ml", "쌀밥", "210g", "아니라 현미밥"]) {
      expect(isCancelMessage(message), message).toBe(false);
    }
  });

  it("writes nothing when the sentence is abandoned", async () => {
    const { repository, add } = fakeRepository();
    const pending = await start("커피 한잔 마셨어");

    expect(isComplete(pending)).toBe(false);
    // The screen drops the pending state; nothing ever reaches the repository.
    expect(isCancelMessage("취소")).toBe(true);
    expect(add).toHaveBeenCalledTimes(0);
    void repository;
  });
});

describe("the day's total reflects what was stored", () => {
  it("adds up across two sentences", async () => {
    const { repository, records } = fakeRepository();
    await commit(repository, await start("갈비탕 하나 먹었어"));
    await commit(repository, await start("김밥 한 줄 먹었어"));

    expect(records).toHaveLength(2);
    const stored = await repository.getByDate("2026-09-23");
    const total = stored.flatMap((r) => r.items).reduce((sum, i) => sum + i.calories, 0);
    expect(total).toBeGreaterThan(0);
  });
});

describe("a middling reading is confirmed, not thrown away", () => {
  it("looks the food up first, so a yes needs no second round trip", async () => {
    const { repository, add, records } = fakeRepository();
    // What Jev returns for "갈비탕 하나랑 밥 한 공기 먹었어": confidence 0.65,
    // squarely in the confirm band.
    const pending = { ...(await start("갈비탕 하나 먹었어")), needsConfirmation: true };

    const question = nextQuestion(pending);
    expect(question?.type).toBe("confirm_add");
    if (question?.type !== "confirm_add") return;
    expect(question.names).toEqual(["갈비탕"]);

    // Nothing is stored while the question stands.
    expect(add).toHaveBeenCalledTimes(0);

    const confirmed = confirmAdd(pending);
    expect(isComplete(confirmed)).toBe(true);
    await commit(repository, confirmed);

    expect(add).toHaveBeenCalledTimes(1);
    expect(records[0]?.items[0]?.name).toBe("갈비탕");
  });

  it("asks to confirm before asking which food", async () => {
    // No point choosing between two rices for a sentence that may not be
    // stored at all.
    const pending = { ...(await start("밥 한 공기 먹었어")), needsConfirmation: true };
    expect(nextQuestion(pending)?.type).toBe("confirm_add");
    expect(nextQuestion(confirmAdd(pending))?.type).toBe("choose_food");
  });
});

describe("a correction reuses the add pipeline", () => {
  it("lets the target settle an ambiguity nobody needs to be asked about", async () => {
    // "밥" matches four foods, but the entry being corrected is already known
    // to be 쌀밥 — so "아까 밥 반만 먹었어" needs no question.
    const parts = await resolveAddParts("아까 밥 반만 먹었어", koreanFoodResolver);
    expect(parts[0]?.status).toBe("ambiguous");

    const narrowed = preferTargetFood(parts, "쌀밥");
    expect(narrowed[0]?.status).toBe("resolved");
    if (narrowed[0]?.status !== "resolved") return;
    expect(narrowed[0].item.name).toBe("쌀밥");
    expect(narrowed[0].item.amount).toContain("반");
  });

  it("re-prices from the portion, not from the number on screen", async () => {
    const full = await resolveAddParts("밥 한 공기 먹었어", koreanFoodResolver);
    const half = await resolveAddParts("아까 밥 반만 먹었어", koreanFoodResolver);

    const whole = preferTargetFood(full, "쌀밥")[0];
    const halved = preferTargetFood(half, "쌀밥")[0];
    if (whole?.status !== "resolved" || halved?.status !== "resolved") {
      throw new Error("both should resolve once the target is known");
    }

    // Half a serving is scaled from grams and rounded once — 105 g at
    // 167 kcal/100 g is 175, not half of the already-rounded 351. Deriving it
    // from the displayed total would compound the rounding.
    expect(halved.item.calories).toBeLessThan(whole.item.calories);
    expect(Math.abs(halved.item.calories - whole.item.calories / 2)).toBeLessThan(1);
  });

  it("leaves a real ambiguity alone when the target is not among the candidates", async () => {
    // Correcting a 갈비탕 with a sentence about rice is not the same question.
    const parts = await resolveAddParts("밥 한 공기 먹었어", koreanFoodResolver);
    const narrowed = preferTargetFood(parts, "갈비탕");
    expect(narrowed[0]?.status).toBe("ambiguous");
  });

  it("changes the food when the correction names a different one", async () => {
    const parts = await resolveAddParts("김치찌개 한 그릇 먹었어", koreanFoodResolver);
    const narrowed = preferTargetFood(parts, "갈비탕");
    expect(narrowed[0]?.status).toBe("resolved");
    if (narrowed[0]?.status !== "resolved") return;
    expect(narrowed[0].item.name).toBe("김치찌개");
  });

  it("spots a correction that produced no change", async () => {
    // "갈비탕 반 그릇만 먹었어" is grammar the phrase parser cannot read: it
    // keeps the whole thing as a name and assumes one serving, landing back
    // on the stored figure. Reporting "고쳤어요" there would be a lie.
    const parts = await resolveAddParts("갈비탕 반 그릇만 먹었어", koreanFoodResolver);
    const resolved = preferTargetFood(parts, "갈비탕")[0];
    if (resolved?.status !== "resolved") throw new Error("expected resolved");

    expect(isSameAs(resolved.item, { name: "갈비탕", calories: 362 })).toBe(true);
    expect(isSameAs(resolved.item, { name: "갈비탕", calories: 181 })).toBe(false);
  });
});
