/**
 * Phase 2 mock data — the only place numbers live while there is no domain
 * layer and no persistence.
 *
 * Phase 3 replaces this wholesale: delete this file, and the components take
 * real `MealRecord` data instead. Nothing here is a domain model, and no
 * component computes its own numbers.
 */

export const MEAL_TYPES = ["breakfast", "lunch", "dinner", "snack"] as const;

export type MockMealType = (typeof MEAL_TYPES)[number];

export const MEAL_LABELS: Record<MockMealType, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

export type MockFoodItem = {
  id: string;
  name: string;
  /** "1개", "1공기" — omitted when the name already implies the portion. */
  amount?: string;
  calories: number;
};

export type MockMealGroup = {
  mealType: MockMealType;
  items: MockFoodItem[];
};

export type MockToday = {
  dailyGoalCalories: number;
  meals: MockMealGroup[];
};

/** Summing for display only. The real calculation lands in Phase 3. */
export function sumCalories(meals: MockMealGroup[]): number {
  return meals.reduce(
    (total, group) =>
      total + group.items.reduce((sum, item) => sum + item.calories, 0),
    0,
  );
}

/** 1,580 / 2,100 kcal — 520 남음. The everyday case. */
const typicalDay: MockToday = {
  dailyGoalCalories: 2100,
  meals: [
    {
      mealType: "breakfast",
      items: [
        { id: "m1", name: "삼각김밥", amount: "1개", calories: 210 },
        { id: "m2", name: "삶은 계란", amount: "1개", calories: 75 },
        { id: "m3", name: "그릭 요거트", calories: 120 },
      ],
    },
    {
      mealType: "lunch",
      items: [
        { id: "m4", name: "갈비탕", calories: 650 },
        { id: "m5", name: "흰쌀밥", amount: "1공기", calories: 320 },
        { id: "m6", name: "김치", calories: 35 },
      ],
    },
    {
      mealType: "snack",
      items: [
        { id: "m7", name: "아메리카노", amount: "1잔", calories: 10 },
        { id: "m8", name: "바나나", amount: "1개", calories: 160 },
      ],
    },
  ],
};

/** Exactly on target — the caption must not read "0 kcal 남았어요". */
const exactlyZero: MockToday = {
  dailyGoalCalories: 1000,
  meals: [
    {
      mealType: "lunch",
      items: [
        { id: "z1", name: "갈비탕", calories: 650 },
        { id: "z2", name: "흰쌀밥", amount: "1공기", calories: 320 },
        { id: "z3", name: "김치", calories: 30 },
      ],
    },
  ],
};

/** Over the goal — must never render as "-140 kcal 남았어요". */
const overGoal: MockToday = {
  dailyGoalCalories: 2100,
  meals: [
    ...typicalDay.meals,
    {
      mealType: "dinner",
      items: [
        { id: "o1", name: "치킨", amount: "3조각", calories: 540 },
        { id: "o2", name: "맥주", amount: "500ml", calories: 120 },
      ],
    },
  ],
};

/** Layout stress: long Korean names, four-digit kcal, an empty meal group. */
const longNames: MockToday = {
  dailyGoalCalories: 2100,
  meals: [
    {
      mealType: "lunch",
      items: [
        {
          id: "l1",
          name: "돼지고기 김치찌개 정식 (공기밥 리필 포함)",
          amount: "1인분",
          calories: 1120,
        },
        {
          id: "l2",
          name: "편의점 스팸마요 삼각김밥",
          amount: "2개",
          calories: 420,
        },
        {
          id: "l3",
          name: "아메리카노라떼카푸치노마키아토플랫화이트",
          amount: "1잔",
          calories: 250,
        },
      ],
    },
  ],
};

/** An empty day — the list must not leave a hole in the layout. */
const emptyDay: MockToday = {
  dailyGoalCalories: 2100,
  meals: [],
};

export const MOCK_SCENARIOS = {
  typical: typicalDay,
  exactlyZero,
  overGoal,
  longNames,
  empty: emptyDay,
} satisfies Record<string, MockToday>;

export type MockScenarioName = keyof typeof MOCK_SCENARIOS;

export function isScenarioName(value: unknown): value is MockScenarioName {
  return typeof value === "string" && value in MOCK_SCENARIOS;
}

export const DEFAULT_SCENARIO: MockScenarioName = "typical";
