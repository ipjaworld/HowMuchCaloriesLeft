"use client";

import { useEffect, useMemo, useState } from "react";
import { setDailyGoal, type SetDailyGoalResult } from "@/application/dailyGoal";
import { summarizeDay } from "@/domain/calories";
import { todayKey } from "@/domain/date";
import type { MealRecord } from "@/domain/meal";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { createLocalStorageMealRecordRepository } from "@/infrastructure/localStorageMealRecordRepository";
import { ChatInput } from "./ChatInput";
import { GoalEditor } from "./GoalEditor";
import { MealList } from "./MealList";
import { TodaySummary } from "./TodaySummary";

type State =
  | { status: "loading" }
  | {
      status: "ready";
      dateKey: string;
      records: MealRecord[];
      calorieTarget: number | null;
    };

/**
 * The single client boundary.
 *
 * Hydration strategy: the server cannot see `localStorage`, and the browser's
 * timezone decides which day "today" is — so neither the records nor the date
 * key can be rendered on the server. Rather than guess and patch up a
 * mismatch, the first render is an explicit `loading` state that the server
 * and the client both produce identically; the effect below then reads
 * storage and fills it in. One frame, no `suppressHydrationWarning`, and
 * nothing above this component has to become a client component.
 */
export function TodayScreen() {
  const repositories = useMemo(
    () => ({
      meals: createLocalStorageMealRecordRepository(),
      goals: createLocalStorageDailyGoalRepository(),
    }),
    [],
  );

  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Computed here, not during render: on the server this would be the
      // server's timezone, which is not the user's day.
      const dateKey = todayKey();
      const [records, goal] = await Promise.all([
        repositories.meals.getByDate(dateKey),
        repositories.goals.get(dateKey),
      ]);

      if (cancelled) return;
      setState({
        status: "ready",
        dateKey,
        records,
        calorieTarget: goal?.calorieTarget ?? null,
      });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  async function handleSetGoal(
    calorieTarget: number,
  ): Promise<SetDailyGoalResult> {
    if (state.status !== "ready") {
      return { ok: false, reason: "invalid_date" };
    }

    const result = await setDailyGoal(
      repositories.goals,
      state.dateKey,
      calorieTarget,
    );
    if (result.ok) {
      setState({ ...state, calorieTarget: result.goal.calorieTarget });
    }
    return result;
  }

  const isLoading = state.status === "loading";
  const records = state.status === "ready" ? state.records : [];
  const summary = summarizeDay(
    records,
    state.status === "ready" ? state.calorieTarget : null,
  );

  return (
    <>
      <TodaySummary
        summary={summary}
        isLoading={isLoading}
        goalAction={
          isLoading ? undefined : (
            <GoalEditor
              currentTarget={summary.calorieTarget}
              onSubmit={handleSetGoal}
            />
          )
        }
      />

      <div className="flex-1 pb-6">
        <MealList records={records} isLoading={isLoading} />
      </div>

      <ChatInput />
    </>
  );
}
