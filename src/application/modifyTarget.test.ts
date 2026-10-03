import { describe, expect, it } from "vitest";
import type { Judge, Judgment, RecentItem } from "@/ai/judgment/types";
import { KOREAN_FOODS, koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { summarizeDay } from "@/domain/calories";
import type { FoodItem, MealRecord } from "@/domain/meal";
import type { MealRecordRepository } from "@/domain/repository";
import { describeQuestion } from "@/components/replyText";
import { runChat } from "./chatPipeline";
import { decideCommand, type Command } from "./commands";
import { replaceFoodItem } from "./editFood";
import { planModifyStart } from "./modifyFlow";
import { checkModifyTarget, mentionedNames } from "./modifyTarget";
import { confirmAdd, isComplete, nextQuestion, planModifyCommit } from "./pendingAdd";

/**
 * Which entry a correction lands on, when logged names overlap.
 *
 * The case that started this (browser, 2026-10-02, 426-food local build): 29
 * entries, among them 케이크 · 치즈케이크 · 초콜릿케이크. "케이크 700kcal로
 * 고쳐줘" changed the 초콜릿케이크 — Jev saw only the twelve newest entries,
 * 케이크 not among them, and picked 초콜릿케이크 at exactly the 0.5 floor; the
 * code fallback would have picked it too (newest substring match).
 */

const at = (minute: number) =>
  `2026-10-02T${String(9 + Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}:00+09:00`;

function entry(id: string, name: string, minute: number, calories = 300, amount?: string): RecentItem {
  return { id, name, calories, consumedAt: at(minute), ...(amount === undefined ? {} : { amount }) };
}

function modify(targetId: string | null, referenceConfidence: number | null, overrides: Partial<Judgment> = {}): Judgment {
  return {
    intent: "modify_food",
    intentConfidence: 0.99,
    actualConsumptionProbability: 0.9,
    clarificationProbability: 0.05,
    referenceTargetId: targetId,
    referenceConfidence,
    source: "jev",
    ...overrides,
  };
}

const decide = (judgment: Judgment, message: string, items: RecentItem[]) =>
  decideCommand(judgment, { message, now: at(600), dailyGoalCalories: 2000, recentItems: items });

const idsOf = (command: Command) =>
  command.type === "clarify" ? (command.candidates ?? []).map((candidate) => candidate.id) : [];

describe("mentionedNames: a name counts where it is said as itself", () => {
  const items = [entry("k", "케이크", 0), entry("c", "초콜릿케이크", 1), entry("z", "치즈케이크", 2)];

  it.each([
    ["케이크 700kcal로 고쳐줘", ["케이크"]],
    ["초콜릿케이크 700kcal로 고쳐줘", ["초콜릿케이크"]],
    ["초코케이크 반만 먹었어", ["초콜릿케이크"]], // a dataset alias of the logged name
    ["케이크랑 초콜릿케이크 반만 먹었어", ["케이크", "초콜릿케이크"]],
    ["딸기케이크였어", []], // 딸기케이크 is a dataset food, not logged: its 케이크 is not a mention
    ["아까 그거 700kcal야", []],
  ])("%s → %j", (message, names) => {
    expect(mentionedNames(message, items)).toEqual(names);
  });

  it("a one-syllable name is not read inside other words (회사, 배달)", () => {
    const short = [entry("h", "회", 0), entry("p", "배", 1), entry("g", "김밥", 2)];
    expect(mentionedNames("회사 앞에서 배달시킨 김밥 반만 먹었어", short)).toEqual(["김밥"]);
  });
});

describe("a correction lands on the entry the user named", () => {
  const two = [entry("k", "케이크", 0, 266, "1조각"), entry("c", "초콜릿케이크", 30, 292, "1조각")];
  const three = [...two, entry("z", "치즈케이크", 60, 300, "1조각")];

  it("케이크 + 초콜릿케이크: a confident wrong pick becomes a confirmation of 케이크", () => {
    for (const confidence of [0.5, 0.99]) {
      expect(decide(modify("c", confidence), "케이크 700kcal로 고쳐줘", two)).toEqual({
        type: "modify_candidate",
        targetId: "k",
        sourceText: "케이크 700kcal로 고쳐줘",
        needsConfirmation: true,
        parts: [],
      });
    }
  });

  it("the right pick is applied without a new question", () => {
    expect(decide(modify("k", 0.95), "케이크 700kcal로 고쳐줘", two)).toMatchObject({
      type: "modify_candidate",
      targetId: "k",
      needsConfirmation: false,
    });
  });

  it("Jev null, or under the floor: the fallback's newest-substring pick is checked too", () => {
    for (const judgment of [modify(null, 0.9), modify("c", 0.2), modify(null, null)]) {
      expect(decide(judgment, "케이크 700kcal로 고쳐줘", three)).toMatchObject({
        type: "modify_candidate",
        targetId: "k",
        needsConfirmation: true,
      });
    }
  });

  it.each([
    ["케이크 700kcal로 고쳐줘", "k"],
    ["치즈케이크 700kcal로 고쳐줘", "z"],
    ["초콜릿케이크 700kcal로 고쳐줘", "c"],
  ])("three cakes: %s with the right pick changes %s, unasked", (message, id) => {
    expect(decide(modify(id, 0.95), message, three)).toMatchObject({
      type: "modify_candidate",
      targetId: id,
      needsConfirmation: false,
    });
  });

  it("naming 초콜릿케이크 does not ask about 케이크 because it contains it", () => {
    expect(decide(modify("c", 0.95), "초콜릿케이크 반만 먹었어", three)).toMatchObject({
      type: "modify_candidate",
      targetId: "c",
      needsConfirmation: false,
    });
  });

  it("two names said separately: asks between them", () => {
    const command = decide(modify("c", 0.95), "케이크랑 초콜릿케이크 둘 다 반만 먹었어", three);
    expect(command).toMatchObject({ type: "clarify", reason: "unknown_target" });
    expect(idsOf(command).sort()).toEqual(["c", "k"]);
  });

  it("a longer name picked over a said shorter one is not a coin toss in the other direction", () => {
    // The pick is the shorter name, the sentence says the longer one: either
    // could be meant (it might name the replacement), so both are offered.
    const command = decide(modify("k", 0.95), "아까 거 치즈케이크였어", three);
    expect(command).toMatchObject({ type: "clarify", reason: "unknown_target" });
    expect(idsOf(command).sort()).toEqual(["k", "z"]);
  });

  it("the old side read from grammar is trusted: 'A 말고 B' proposes A", () => {
    expect(decide(modify("z", 0.95), "케이크 말고 치즈케이크였어", three)).toMatchObject({
      type: "modify_candidate",
      targetId: "k",
      needsConfirmation: true,
    });
  });

  it("only similar names, no exact entry: asks rather than taking the closest", () => {
    const cakes = [entry("c", "초콜릿케이크", 0), entry("z", "치즈케이크", 1)];
    const command = decide(modify("c", 0.95), "케이크 700kcal로 고쳐줘", cakes);
    expect(command).toMatchObject({ type: "clarify", reason: "unknown_target" });
    expect(idsOf(command).sort()).toEqual(["c", "z"]);
  });

  it("one similar name that is the pick still goes ahead (참치김밥 for 김밥)", () => {
    const tuna = [entry("t", "참치김밥", 0, 450, "1줄"), entry("r", "라면", 5, 500, "1개")];
    expect(decide(modify("t", 0.95), "김밥 반만 먹었어", tuna)).toMatchObject({
      type: "modify_candidate",
      targetId: "t",
      needsConfirmation: false,
    });
  });

  it("same name logged more than once: asks among them, newest is not a reason", () => {
    const twice = [entry("k1", "케이크", 0, 266, "1조각"), entry("k2", "케이크", 90, 532, "2조각"), entry("c", "초콜릿케이크", 120)];
    const command = decide(modify("k2", 0.99), "케이크 700kcal로 고쳐줘", twice);
    expect(command).toMatchObject({ type: "clarify", reason: "unknown_target" });
    expect(idsOf(command)).toEqual(["k2", "k1"]);
  });
});

describe("the entry is found anywhere in the day, not only in the newest few", () => {
  // 케이크 first, then 20 other foods — outside Jev's twelve and the four chips.
  const fillers = ["라면", "김밥", "떡볶이", "순대", "어묵", "쌀밥", "김치찌개", "된장찌개", "비빔밥", "짜장면",
    "짬뽕", "탕수육", "치킨", "피자", "햄버거", "콜라", "사과", "바나나", "우유", "아메리카노"];
  const day = [
    entry("k", "케이크", 0, 266, "1조각"),
    entry("a", "아이스크림", 1, 178, "1개"),
    ...fillers.map((name, index) => entry(`f${index}`, name, 10 + index)),
    entry("c", "초콜릿케이크", 100, 292, "1조각"),
  ];

  it("케이크 outside the twelve, 초콜릿케이크 picked: proposes 케이크", () => {
    expect(decide(modify("c", 0.5), "케이크 700kcal로 고쳐줘", day)).toMatchObject({
      type: "modify_candidate",
      targetId: "k",
      needsConfirmation: true,
    });
  });

  it("아이스크림 outside the four chips, judge wants to ask: 아이스크림 is the first chip", () => {
    // The browser case: "어떤 기록을 수정할까요?" offered the four newest,
    // none of them 아이스크림.
    const command = decide(modify(null, 0.9, { clarificationProbability: 0.9 }), "아이스크림 700kcal로 고쳐줘", day);
    expect(command).toMatchObject({ type: "clarify", reason: "unknown_target" });
    expect(idsOf(command)[0]).toBe("a");
  });

  it("a question about which entry puts the related ones first", () => {
    const twice = [entry("k1", "케이크", 0, 266, "1조각"), entry("k2", "케이크", 2, 532, "2조각"), ...day.slice(2)];
    const command = decide(modify(null, 0.9), "케이크 700kcal로 고쳐줘", twice);
    expect(idsOf(command).slice(0, 2).sort()).toEqual(["k1", "k2"]);
  });

  it("nothing named and nothing settled: the newest entries, as before", () => {
    const command = decide(modify(null, 0.9), "아까 그거 절반", day);
    expect(idsOf(command)).toEqual(["c", "f19", "f18", "f17"]);
  });
});

describe("not tuned to cakes: representative overlapping names from the dataset", () => {
  // Every pair (short, long) where a dataset name is said inside a longer
  // one — 김밥/참치김밥, 라면/짜장라면, 만두/고기만두 … One pair per short
  // name, so the sample grows with the data but not combinatorially.
  const names = KOREAN_FOODS.map((food) => food.name);
  const pairs = new Map<string, string>();
  for (const short of names) {
    if (short.length < 2) continue;
    const long = names.find((other) => other !== short && other.replace(/\s+/g, "").includes(short.replace(/\s+/g, "")));
    if (long !== undefined) pairs.set(short, long);
  }

  it("there are enough pairs to mean something", () => {
    expect(pairs.size).toBeGreaterThan(20);
  });

  it.each([...pairs])("%s said, %s picked → %s proposed; %s said → %s, unasked", (short, long) => {
    const items = [entry("s", short, 0), entry("l", long, 30)];
    expect(decide(modify("l", 0.99), `${short} 700kcal로 고쳐줘`, items)).toMatchObject({
      type: "modify_candidate",
      targetId: "s",
      needsConfirmation: true,
    });
    expect(decide(modify("l", 0.99), `${long} 700kcal로 고쳐줘`, items)).toMatchObject({
      type: "modify_candidate",
      targetId: "l",
      needsConfirmation: false,
    });
  });
});

/**
 * The browser half: the entry the question shows is the entry a yes writes,
 * a no writes nothing, and totals follow the store.
 */
function food(id: string, name: string, calories: number, amount: string): FoodItem {
  return { id, name, amount, calories, caloriesEstimated: false, calorieSource: "dataset" };
}

function record(id: string, minute: number, items: FoodItem[]): MealRecord {
  return {
    id,
    consumedAt: at(minute),
    sourceText: items.map((item) => item.name).join(" "),
    items,
    createdAt: at(minute),
    updatedAt: at(minute),
  };
}

function store(initial: MealRecord[]) {
  const records = initial.map((r) => ({ ...r, items: [...r.items] }));
  const repository: MealRecordRepository = {
    add: async () => undefined,
    getByDate: async () => records,
    getAll: async () => records,
    update: async (id, input) => {
      const index = records.findIndex((r) => r.id === id);
      if (index >= 0) records[index] = { ...records[index]!, ...input };
    },
    remove: async () => undefined,
  };
  return { repository, records };
}

const toItems = (records: MealRecord[]): RecentItem[] =>
  records.flatMap((r) => r.items.map((item) => ({ id: item.id, name: item.name, amount: item.amount, calories: item.calories, consumedAt: r.consumedAt })));

const judgeWith = (judgment: Judgment): Judge => ({ judge: async () => judgment });

describe("from the server's proposal to what is stored", () => {
  const day = () => [
    record("r1", 0, [food("k", "케이크", 266, "1조각")]),
    record("r2", 30, [food("z", "치즈케이크", 300, "1조각")]),
    record("r3", 60, [food("c", "초콜릿케이크", 292, "1조각")]),
  ];

  async function propose(records: MealRecord[], message: string, judgment: Judgment) {
    const { command } = await runChat(
      { message, now: at(600), dailyGoalCalories: 2000, recentItems: toItems(records) },
      undefined,
      { judge: judgeWith(judgment), resolver: koreanFoodResolver, candidateJudge: null },
    );
    if (command.type !== "modify_candidate") throw new Error(`expected modify_candidate, got ${command.type}`);
    const start = planModifyStart(records, command, at(601));
    if (start.kind !== "pending") throw new Error(`expected pending, got ${start.kind}`);
    return { command, pending: start.pending };
  }

  it("the question names 케이크 1조각 (09:00), and yes changes exactly that entry", async () => {
    const { repository, records } = store(day());
    const before = summarizeDay(records, 2000);
    const { command, pending } = await propose(records, "케이크 700kcal로 고쳐줘", modify("c", 0.5));

    expect(command.targetId).toBe("k");
    expect(pending.target?.itemId).toBe("k");
    const question = nextQuestion(pending);
    expect(question?.type).toBe("confirm_add");
    expect(question === null ? null : describeQuestion(question)).toMatchObject({
      text: "케이크 1조각(09:00) 기록을 700kcal로 바꿀까요?",
    });

    const confirmed = confirmAdd(pending);
    expect(isComplete(confirmed)).toBe(true);
    const { replacement, additions } = planModifyCommit(confirmed);
    expect(additions).toEqual([]);
    const result = await replaceFoodItem(repository, records, confirmed.target!.itemId, replacement!);
    expect(result.status).toBe("replaced");

    const after = await repository.getByDate("2026-10-02");
    const byId = new Map(after.flatMap((r) => r.items.map((item) => [item.id, item])));
    expect(byId.get("k")?.calories).toBe(700);
    expect(byId.get("z")?.calories).toBe(300);
    expect(byId.get("c")?.calories).toBe(292);
    expect(after.flatMap((r) => r.items)).toHaveLength(3);
    expect(summarizeDay(after, 2000).consumedCalories).toBe(before.consumedCalories - 266 + 700);
  });

  it("no leaves every entry as it was", async () => {
    const { records } = store(day());
    const snapshot = JSON.stringify(records);
    const { pending } = await propose(records, "케이크 700kcal로 고쳐줘", modify("c", 0.5));
    expect(nextQuestion(pending)?.type).toBe("confirm_add");
    // "아니요" drops the pending sentence; nothing was written before it.
    expect(JSON.stringify(records)).toBe(snapshot);
  });

  it("a target removed meanwhile is reported gone, not replaced by another entry", async () => {
    const { records } = store(day());
    const command = decide(modify("c", 0.5), "케이크 700kcal로 고쳐줘", toItems(records));
    if (command.type !== "modify_candidate") throw new Error("expected modify_candidate");
    const without = records.filter((r) => r.id !== "r1");
    expect(planModifyStart(without, { ...command, parts: [] }, at(601))).toEqual({ kind: "gone" });
  });
});

describe("checkModifyTarget leaves the unnamed cases alone", () => {
  it("a deictic sentence names nothing: the pick stands", () => {
    const items = [entry("k", "케이크", 0), entry("c", "초콜릿케이크", 1)];
    expect(checkModifyTarget("방금 그거 반만 먹었어", items, "c")).toEqual({ kind: "ok" });
  });
});
