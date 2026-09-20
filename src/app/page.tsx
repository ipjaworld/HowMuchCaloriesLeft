import { ChatInput } from "@/components/ChatInput";
import { MealList } from "@/components/MealList";
import { TodaySummary } from "@/components/TodaySummary";
import {
  DEFAULT_SCENARIO,
  MOCK_SCENARIOS,
  isScenarioName,
  sumCalories,
} from "@/mocks/phase2";

/**
 * Phase 2: mock data only. No persistence, no AI, no records are created.
 *
 * `?scenario=overGoal` (or exactlyZero / longNames / empty) switches the mock
 * day so the edge cases can be looked at in a real browser. It goes away with
 * the mocks in Phase 3.
 */
export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { scenario } = await searchParams;
  const today =
    MOCK_SCENARIOS[isScenarioName(scenario) ? scenario : DEFAULT_SCENARIO];

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col bg-white sm:border-x sm:border-neutral-100">
      <TodaySummary
        consumedCalories={sumCalories(today.meals)}
        dailyGoalCalories={today.dailyGoalCalories}
      />

      <div className="flex-1 pb-6">
        <MealList meals={today.meals} />
      </div>

      <ChatInput />
    </main>
  );
}
