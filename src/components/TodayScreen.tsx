"use client";

import { useEffect, useMemo, useState } from "react";
import type { Intent, RecentItem } from "@/ai/judgment/types";
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
import {
  describeCommand,
  describeResolvedTarget,
  type ClarifyOption,
  type Reply,
} from "./replyText";
import type { ChatResponse } from "@/app/api/chat/schema";

type State =
  | { status: "loading" }
  | {
      status: "ready";
      dateKey: string;
      records: MealRecord[];
      calorieTarget: number | null;
    };

/** What a clarifying question is waiting on, so an answer can be resolved here. */
type PendingClarification = {
  intent: Intent;
  candidates: { id: string; name: string }[];
};

/** The judge only needs the items, flattened, with their record's context. */
function toRecentItems(records: MealRecord[]): RecentItem[] {
  return records.flatMap((record) =>
    record.items.map((item) => ({
      id: item.id,
      name: item.name,
      ...(item.amount === undefined ? {} : { amount: item.amount }),
      calories: item.calories,
      ...(record.mealType === undefined ? {} : { mealType: record.mealType }),
      consumedAt: record.consumedAt,
    })),
  );
}

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
  const [reply, setReply] = useState<Reply | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [clarification, setClarification] =
    useState<PendingClarification | null>(null);

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

  const isLoading = state.status === "loading";
  const records = state.status === "ready" ? state.records : [];
  const summary = summarizeDay(
    records,
    state.status === "ready" ? state.calorieTarget : null,
  );

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

  async function handleMessage(message: string) {
    setIsPending(true);
    setClarification(null);
    setReply(null);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          now: new Date().toISOString(),
          dailyGoalCalories: summary.calorieTarget,
          recentItems: toRecentItems(records),
        }),
      });

      if (!response.ok) {
        setReply({
          kind: "statement",
          text: "지금은 답하기 어려워요. 잠시 후 다시 시도해주세요.",
        });
        return;
      }

      const { command } = (await response.json()) as ChatResponse;
      setReply(describeCommand(command, summary));

      if (command.type === "clarify" && command.candidates !== undefined) {
        setClarification({
          intent: command.intent,
          candidates: command.candidates.map(({ id, name }) => ({ id, name })),
        });
      }
    } catch {
      setReply({
        kind: "statement",
        text: "연결이 안 되네요. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsPending(false);
    }
  }

  /** Answered on the client — a confirmation is not worth a second round trip. */
  function handleChooseOption(option: ClarifyOption) {
    if (option.id === "no") {
      setReply({ kind: "statement", text: "알겠어요. 그대로 둘게요." });
      setClarification(null);
      return;
    }

    const intent = clarification?.intent;

    if (intent === "modify_food" || intent === "delete_food") {
      const chosen =
        option.id === "yes"
          ? clarification?.candidates[0]
          : clarification?.candidates.find(
              (candidate) => candidate.id === option.id,
            );

      if (chosen !== undefined) {
        setReply({
          kind: "statement",
          text: describeResolvedTarget(intent, chosen.name),
        });
        setClarification(null);
        return;
      }
    }

    setReply({
      kind: "statement",
      text: "음식 정보를 확인하는 단계가 아직 연결되지 않았어요.",
    });
    setClarification(null);
  }

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

      <ChatInput
        onSubmit={(message) => void handleMessage(message)}
        onChooseOption={handleChooseOption}
        reply={reply}
        isPending={isPending}
      />
    </>
  );
}
