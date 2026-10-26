import { describe, expect, it } from "vitest";
import type { Judge, Judgment } from "@/ai/judgment/types";
import { koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import { runChat } from "./chatPipeline";
import { readTalk } from "./smallTalk";

const read = (message: string) => readTalk(message, koreanFoodResolver);

describe("what a sentence that changes nothing was about (D07, 2026-10-26)", () => {
  it.each([
    ["떡볶이 칼로리 높아?", ["떡볶이"]],
    ["떡볶이 몇 칼로리야", ["떡볶이"]],
    ["떡볶이는 칼로리 얼마나 돼?", ["떡볶이"]],
    ["김밥 한 줄 칼로리", ["김밥"]],
    ["치킨 반 마리 열량", ["치킨"]],
    ["내일 치킨 먹을 거야", ["치킨"]],
    ["라면 먹어도 될까", ["라면"]],
    ["삼겹살 먹고 싶다", ["삼겹살구이"]],
  ])("answers a question about a food: %s", async (message, names) => {
    const talk = await read(message);
    expect(talk?.kind).toBe("food_info");
    if (talk?.kind !== "food_info") return;
    expect(talk.foods.map((food) => food.name)).toEqual(names);
    for (const food of talk.foods) expect(food.calories).toBeGreaterThan(0);
  });

  it("prices the amount said, and marks an assumed serving as an estimate", async () => {
    const one = await read("김밥 한 줄 칼로리");
    const two = await read("김밥 두 줄 칼로리");
    const bare = await read("김밥 칼로리");
    if (one?.kind !== "food_info" || two?.kind !== "food_info" || bare?.kind !== "food_info") throw new Error("expected food_info");
    expect(two.foods[0]?.calories).toBe(2 * (one.foods[0]?.calories ?? 0));
    expect(bare.foods[0]?.estimated).toBe(true);
  });

  it.each([
    ["안녕", "greeting"],
    ["안녕하세요~", "greeting"],
    ["고마워", "thanks"],
    ["감사합니다", "thanks"],
    ["배고파", "hungry"],
    ["아 출출하다", "hungry"],
    ["배불러 죽겠다", "full"],
  ])("takes a conversational turn: %s → %s", async (message, kind) => {
    expect((await read(message))?.kind).toBe(kind);
  });

  it.each(["빵 터졌네", "사과했는데 안 받아줬어", "오늘 진짜 죽겠다", "ㅋㅋㅋ", "살 찌겠다", "아무 칼로리"])(
    "says nothing about food that was not asked about: %s",
    async (message) => {
      expect(await read(message)).toBeNull();
    },
  );
});

describe("the pipeline adds talk only where nothing is stored", () => {
  function judged(intent: Judgment["intent"], actualConsumptionProbability = 0.05): Judge {
    return {
      judge: () =>
        Promise.resolve({
          intent,
          intentConfidence: 0.95,
          actualConsumptionProbability,
          clarificationProbability: 0.1,
          referenceTargetId: null,
          referenceConfidence: null,
          source: "jev",
        }),
    };
  }
  const chat = (message: string, judge: Judge) =>
    runChat(
      { message, now: "2026-10-26T12:30:00+09:00", dailyGoalCalories: 1800, recentItems: [] },
      undefined,
      { judge, resolver: koreanFoodResolver, candidateJudge: null },
    ).then((result) => result.command);

  it("an off-topic sentence carries what it was about", async () => {
    const command = await chat("안녕", judged("other"));
    expect(command).toEqual({ type: "ignore", reason: "off_topic", talk: { kind: "greeting" } });
  });

  it("a food mentioned but not eaten is answered, not recorded", async () => {
    const command = await chat("떡볶이 칼로리 높아?", judged("add_food", 0.05));
    expect(command.type).toBe("ignore");
    expect(command.type === "ignore" && command.talk?.kind).toBe("food_info");
  });

  it("a recommendation question about a food gets the food's figure", async () => {
    const command = await chat("치킨 먹어도 돼?", judged("ask_recommendation"));
    expect(command.type === "answer" && command.talk?.kind).toBe("food_info");
  });

  it("leaves adds and status questions as they were", async () => {
    const add = await chat("김밥 한 줄 먹었어", judged("add_food", 0.98));
    expect(add.type).toBe("add");
    expect("talk" in add).toBe(false);
    const status = await chat("배고파 얼마나 남았어", judged("ask_status"));
    expect(status).toEqual({ type: "answer", kind: "status" });
  });

  it("keeps the plain reply when there is nothing to say about the sentence", async () => {
    expect(await chat("오늘 진짜 죽겠다", judged("other"))).toEqual({ type: "ignore", reason: "off_topic" });
  });
});
