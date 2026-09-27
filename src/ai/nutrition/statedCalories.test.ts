import { describe, expect, it } from "vitest";
import {
  cleanFoodLabel,
  findStatedCalories,
  readCalorieAnswer,
  statesATotal,
} from "./statedCalories";

describe("findStatedCalories", () => {
  it.each([
    ["샌드위치 450kcal", 450, "샌드위치"],
    ["샌드위치 450 kcal", 450, "샌드위치"],
    ["제육덮밥 720칼로리", 720, "제육덮밥"],
    ["도시락인데 한 700칼로리래", 700, "도시락"],
    ["라면은 500칼", 500, "라면"],
    ["1,200kcal", 1200, null],
    ["한 600kcal", 600, null],
    ["450kcal짜리 샌드위치", 450, "샌드위치"],
    ["제육덮밥 먹었는데 720칼로리였어", 720, "제육덮밥"],
    ["600kcal였어", 600, null],
    ["음... 이건 데이터베이스과 없을거 같고 한 600kcal 먹었다는", 600, null],
  ])("%s → %d, %s", (segment, calories, label) => {
    expect(findStatedCalories(segment)).toEqual({ calories, label });
  });

  it("takes the last figure when a sentence corrects itself", () => {
    expect(findStatedCalories("600칼로리 말고 800칼로리")?.calories).toBe(800);
  });

  it("ignores a number without a calorie unit — it could be grams", () => {
    expect(findStatedCalories("간식 한 300")).toBeNull();
    expect(findStatedCalories("우유 200ml")).toBeNull();
    expect(findStatedCalories("칼국수 2그릇")).toBeNull();
  });
});

describe("cleanFoodLabel", () => {
  it("keeps short names and drops hedges", () => {
    expect(cleanFoodLabel("대충 회사 도시락")).toBe("회사 도시락");
    expect(cleanFoodLabel("치킨은")).toBe("치킨");
    expect(cleanFoodLabel("마라탕")).toBe("마라탕");
  });

  it("refuses talk that is not a name", () => {
    expect(cleanFoodLabel("없을거 같고")).toBeNull();
    expect(cleanFoodLabel("모르겠어 그냥 많이")).toBeNull();
    expect(cleanFoodLabel("그거")).toBeNull();
    expect(cleanFoodLabel("")).toBeNull();
  });
});

describe("statesATotal", () => {
  it("spots the words that make one figure cover everything", () => {
    expect(statesATotal("밥 합쳐서 800칼로리")).toBe(true);
    expect(statesATotal("샌드위치 450kcal")).toBe(false);
  });
});

describe("readCalorieAnswer", () => {
  it.each([
    ["600", 600],
    ["600kcal", 600],
    ["한 600", 600],
    ["대충 600 정도요", 600],
    ["1,200", 1200],
    ["700칼로리요", 700],
  ])("reads %s as %d kcal", (message, calories) => {
    expect(readCalorieAnswer(message)).toEqual({ status: "calories", calories });
  });

  it("flags an amount in another unit", () => {
    expect(readCalorieAnswer("200g")).toEqual({ status: "wrong_unit" });
  });

  it("returns null for a new sentence, so it is read as one", () => {
    expect(readCalorieAnswer("김밥 먹었어")).toBeNull();
    expect(readCalorieAnswer("사과 2개 먹었어")).toBeNull();
  });
});
