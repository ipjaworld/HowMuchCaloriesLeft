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
  isUnreadCorrectionOf,
  namesASubstitution,
} from "./addFood";
import { addMealRecord } from "./mealRecords";
import {
  answerCalories,
  answerChoice,
  answerQuantity,
  confirmAdd,
  isCancelMessage,
  isComplete,
  isSkipMessage,
  nextQuestion,
  skipUnknown,
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
    getAll: async () => records,
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
      "보리밥",
      "쌀밥",
      "잡곡밥",
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
    // A pack of chicken breast has no published weight, so it waits for one.
    const pending = await start("닭가슴살 1팩 먹었어");

    const question = nextQuestion(pending);
    expect(question?.type).toBe("provide_quantity");
    if (question?.type !== "provide_quantity") return;
    expect(question.reason).toBe("missing_serving");
    expect(question.entries[0]?.name).toBe("닭가슴살");

    expect(add).toHaveBeenCalledTimes(0);

    // What /api/resolve returns for "120g".
    const answered = answerQuantity(pending, question.partIndex, {
      name: "닭가슴살",
      amount: "120g",
      calories: 152,
      caloriesEstimated: false,
    });

    expect(isComplete(answered)).toBe(true);
    await commit(repository, answered);

    expect(add).toHaveBeenCalledTimes(1);
    expect(records[0]?.items[0]?.calories).toBe(152);
  });
});

describe("unknown — ask the user for the figure, never supply one", () => {
  it("asks for calories instead of writing nothing", async () => {
    const { add } = fakeRepository();
    const pending = await start("마라샹궈 먹었어");

    expect(pending.parts[0]?.status).toBe("unknown");
    expect(isSettled(pending.parts)).toBe(false);
    expect(nextQuestion(pending)).toEqual({
      type: "provide_calories",
      partIndex: 0,
      label: "마라샹궈",
      othersResolved: false,
    });
    expect(add).toHaveBeenCalledTimes(0);
  });

  it("stores the user's answer as said, under the food's name", async () => {
    const { repository, records } = fakeRepository();
    const pending = await start("마라샹궈 먹었어");

    const answered = answerCalories(pending, 0, 700);
    expect(isComplete(answered)).toBe(true);
    await commit(repository, answered);

    expect(records[0]?.items[0]).toMatchObject({
      name: "마라샹궈",
      calories: 700,
      caloriesEstimated: false,
      calorieSource: "user",
    });
  });

  it("does not quote a scrap of sentence back as a food name", async () => {
    const pending = await start("이건 데이터베이스과 없을거 같고 뭔가 먹었다는");
    const question = nextQuestion(pending);
    if (question?.type !== "provide_calories") throw new Error("expected a calorie question");
    expect(question.label).toBeNull();
  });

  it("reads '빼고' and '모르겠어' as leaving the food out", () => {
    for (const message of ["빼고", "모르겠어", "몰라요", "빼고 기록"]) {
      expect(isSkipMessage(message), message).toBe(true);
    }
    expect(isSkipMessage("600")).toBe(false);
  });
});

describe("calories the user states", () => {
  it("stores a stated figure without looking the food up", async () => {
    // 갈비탕 is in the dataset; the user's number still wins.
    const parts = await resolveAddParts("갈비탕 720칼로리 먹었어", koreanFoodResolver);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      status: "resolved",
      item: { name: "갈비탕", calories: 720, calorieSource: "user", caloriesEstimated: false },
    });
  });

  it("records the screenshot sentence as 600 with no food name", async () => {
    const parts = await resolveAddParts(
      "음... 이건 데이터베이스과 없을거 같고 한 600kcal 먹었다는",
      koreanFoodResolver,
    );
    expect(parts).toEqual([
      {
        status: "resolved",
        phraseName: "직접 입력",
        item: { name: "직접 입력", calories: 600, caloriesEstimated: false, calorieSource: "user" },
      },
    ]);
  });

  it("prices the other foods in the sentence as usual", async () => {
    const parts = await resolveAddParts("갈비탕 하나랑 샌드위치 450kcal 먹었어", koreanFoodResolver);
    expect(parts.map((part) => part.status)).toEqual(["resolved", "resolved"]);
    const items = itemsOf(parts);
    expect(items[0]?.calorieSource).toBeUndefined();
    expect(items[1]).toMatchObject({ name: "샌드위치", calories: 450, calorieSource: "user" });
  });

  it("does not double count a figure stated for the whole sentence", async () => {
    const parts = await resolveAddParts("김치찌개랑 밥 합쳐서 800칼로리 먹었어", koreanFoodResolver);
    expect(itemsOf(parts)).toEqual([
      { name: "김치찌개, 밥", calories: 800, caloriesEstimated: false, calorieSource: "user" },
    ]);
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

  it("asks about an unknown food before writing the known one", async () => {
    const { repository, add, records } = fakeRepository();
    const pending = await start("갈비탕 하나랑 마라샹궈 먹었어");

    const question = nextQuestion(pending);
    expect(question).toMatchObject({ type: "provide_calories", partIndex: 1, othersResolved: true });
    expect(add).toHaveBeenCalledTimes(0);

    await commit(repository, answerCalories(pending, 1, 700));
    expect(records[0]?.items.map((item) => [item.name, item.calories])).toEqual([
      ["갈비탕", expect.any(Number)],
      ["마라샹궈", 700],
    ]);
  });

  it("keeps the known food when the unknown one is left out", async () => {
    const { repository, records } = fakeRepository();
    const pending = await start("갈비탕 하나랑 마라샹궈 먹었어");

    const skipped = skipUnknown(pending, 1);
    expect(isComplete(skipped)).toBe(true);
    await commit(repository, skipped);

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
    const pending = await start("닭가슴살 1팩 먹었어");

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
    // Re-pricing that lands on the stored figure changed nothing. Reporting
    // "고쳤어요" there would be a lie.
    const parts = await resolveAddParts("갈비탕 한 그릇 먹었어", koreanFoodResolver);
    const resolved = preferTargetFood(parts, "갈비탕")[0];
    if (resolved?.status !== "resolved") throw new Error("expected resolved");
    const stored = resolved.item.calories;

    expect(isSameAs(resolved.item, { name: "갈비탕", calories: stored })).toBe(true);
    expect(isSameAs(resolved.item, { name: "갈비탕", calories: Math.round(stored / 2) })).toBe(false);
  });

  it("reads the amount a correction already gives", async () => {
    // "그릇만" used to defeat the quantity parser, which left the app asking
    // for an amount the user had just said.
    const [part] = await resolveAddParts("갈비탕 반 그릇만 먹었어", koreanFoodResolver);
    if (part?.status !== "resolved") throw new Error("expected resolved");
    expect(part.item.amount).toBe("반 그릇");
  });

  it("recognises a correction of the target it could not read", async () => {
    // "국물만" is no amount the parser knows, so the whole phrase is the
    // name, and the matcher does not price the 갈비탕 inside it as one bowl.
    // The part is unknown and about the target: ask for the amount.
    const parts = await resolveAddParts("갈비탕 국물만 먹었어", koreanFoodResolver);
    expect(parts.map((part) => part.status)).toEqual(["unknown"]);
    expect(isUnreadCorrectionOf(parts, "갈비탕")).toBe(true);

    // A replacement is a real question about the new food, even though its
    // phrase contains the target's name.
    const sentence = "갈비탕 아니고 마라샹궈";
    const other = await resolveAddParts(sentence, koreanFoodResolver);
    expect(isUnreadCorrectionOf(other, "갈비탕", namesASubstitution(sentence))).toBe(false);
  });
});

describe("a counter the food does not publish", () => {
  it("waits for an amount and says which counters would work", async () => {
    const { add } = fakeRepository();
    const pending = await start("고기만두 5개 먹었어");

    const question = nextQuestion(pending);
    expect(question?.type).toBe("provide_quantity");
    if (question?.type !== "provide_quantity") return;
    expect(question.reason).toBe("unsupported_unit");
    expect(question.unit).toBe("개");
    expect(question.knownUnits).toEqual(["인분"]);
    expect(add).toHaveBeenCalledTimes(0);
  });
});

describe("a published household measure", () => {
  it("records 삶은 달걀 두 개 in one turn, marked estimated with its source", async () => {
    const { repository, records } = fakeRepository();
    const pending = await start("삶은 달걀 두 개 먹었어");

    expect(isSettled(pending.parts)).toBe(true);
    await commit(repository, pending);

    const item = records[0]?.items[0];
    expect(item?.name).toBe("삶은 달걀");
    expect(item?.caloriesEstimated).toBe(true);
    expect(item?.portionNote).toContain("50g");
  });
});

describe("a high-variance food", () => {
  it.each(["치킨 먹었어", "피자 먹었어", "마라탕 먹었어", "샤브샤브 먹었어"])(
    "records %s at the dataset figure without a question, flagged as varying",
    async (sentence) => {
      const { repository, records } = fakeRepository();
      const pending = await start(sentence);

      // No amount question and no calorie question: the food is settled.
      expect(isSettled(pending.parts)).toBe(true);
      await commit(repository, pending);

      const item = records[0]?.items[0];
      expect(item?.calories).toBeGreaterThan(0);
      expect(item?.calorieVariance).toBe("high");
      expect(item?.caloriesEstimated).toBe(true);
      expect(item?.calorieSource).toBeUndefined();
    },
  );

  it("stays an estimate even when the amount is said outright", async () => {
    const { repository, records } = fakeRepository();
    await commit(repository, await start("치킨 1인분 먹었어"));
    expect(records[0]?.items[0]?.caloriesEstimated).toBe(true);
  });

  it("does not turn 한 마리 into the row's portion", async () => {
    const pending = await start("치킨 한 마리 먹었어");
    expect(isSettled(pending.parts)).toBe(false);
  });

  it("does not flag an ordinary food", async () => {
    const { repository, records } = fakeRepository();
    await commit(repository, await start("김밥 한 줄 먹었어"));
    expect(records[0]?.items[0]?.calorieVariance).toBeUndefined();
  });

  it("keeps the user's own figure over a representative one", async () => {
    const { repository, records } = fakeRepository();
    await commit(repository, await start("마라탕 900kcal 먹었어"));
    const item = records[0]?.items[0];
    expect(item?.calories).toBe(900);
    expect(item?.calorieSource).toBe("user");
    expect(item?.calorieVariance).toBeUndefined();
  });
});

describe("some of it was left", () => {
  it("subtracts a leftover the arithmetic can settle", async () => {
    const [part] = await resolveAddParts("라면 먹었는데 반은 남겼어", koreanFoodResolver);
    if (part?.status !== "resolved") throw new Error("expected resolved");
    expect(part.item.amount).toBe("반");
  });

  it.each(["비빔밥 먹었는데 밥은 반 남겼어", "비빔밥 먹었는데 조금 남겼어"])(
    "asks rather than storing the full or half amount: %s",
    async (sentence) => {
      // Half the *rice* is not half the 비빔밥, and "조금" is no amount at
      // all. Storing 1그릇 would count what was left as eaten.
      const parts = await resolveAddParts(sentence, koreanFoodResolver);
      expect(parts).toHaveLength(1);
      const [part] = parts;
      expect(part?.status).toBe("unmeasurable");
      if (part?.status !== "unmeasurable") return;
      expect(part.reason).toBe("partly_left");
      expect(part.entries.map((entry) => entry.name)).toEqual(["비빔밥"]);
      expect(isSettled(parts)).toBe(false);
    },
  );
});
