"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { todayKey } from "@/domain/date";
import { summarizeHistory, type DayHistory } from "@/domain/history";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { createLocalStorageMealRecordRepository } from "@/infrastructure/localStorageMealRecordRepository";
import { describeHistoryDate, describeHistoryDay } from "./historyText";
import { MealList } from "./MealList";

type State =
  | { status: "loading" }
  | { status: "ready"; today: string; days: DayHistory[] };

/**
 * Past days, newest first: one line of figures per day, and the day's own
 * list one tap away. Read-only — changes still happen by talking on Today.
 *
 * Built to be scanned: the eye runs down the right-hand totals and stops on
 * the few that are set apart. Nothing here grades a day.
 */
export function HistoryScreen() {
  const repositories = useMemo(
    () => ({
      meals: createLocalStorageMealRecordRepository(),
      goals: createLocalStorageDailyGoalRepository(),
    }),
    [],
  );
  const [state, setState] = useState<State>({ status: "loading" });
  const [openDate, setOpenDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const today = todayKey();
      const days = summarizeHistory(
        await repositories.meals.getAll(),
        await repositories.goals.getAll(),
        today,
      );
      if (!cancelled) setState({ status: "ready", today, days });
    })();
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  return (
    <>
      <header className="flex items-center justify-between px-6 pt-11 pb-6">
        <h1 className="text-[1.1875rem] font-semibold">지난 기록</h1>
        <Link
          href="/"
          className="text-[0.8125rem] text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink"
        >
          오늘로
        </Link>
      </header>

      {state.status === "loading" ? (
        <p className="px-6 text-sm text-ink-soft">불러오는 중</p>
      ) : state.days.length === 0 ? (
        <p className="px-6 py-4 text-sm break-keep text-ink-soft">
          아직 기록이 없어요. 오늘 먹은 걸 말해주시면 여기에 쌓여요.
        </p>
      ) : (
        <ul className="border-t border-line pb-10">
          {state.days.map((day) => (
            <HistoryRow
              key={day.date}
              day={day}
              today={state.today}
              isOpen={openDate === day.date}
              onToggle={() => setOpenDate(openDate === day.date ? null : day.date)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function HistoryRow({
  day,
  today,
  isOpen,
  onToggle,
}: {
  day: DayHistory;
  today: string;
  isOpen: boolean;
  onToggle: () => void;
}) {
  const text = describeHistoryDay(day);
  const dateLabel = describeHistoryDate(day.date, today);
  const panelId = `history-${day.date}`;
  const isEmpty = text.figures === null;

  const summary = (
    <>
      <span className="flex items-baseline justify-between gap-4">
        <span className={`text-[0.9375rem] font-medium ${isEmpty ? "text-ink-soft" : "text-ink"}`}>
          {dateLabel}
        </span>
        {text.figures !== null && (
          <span className="numeric shrink-0 text-[0.9375rem] text-ink">{text.figures}</span>
        )}
      </span>
      <span className="mt-1 flex items-baseline justify-between gap-4 text-[0.8125rem]">
        <span className={`break-keep ${text.isOver ? "text-accent" : "text-ink-soft"}`}>
          {text.note}
        </span>
        {text.count !== null && <span className="shrink-0 text-ink-soft">{text.count}</span>}
      </span>
    </>
  );

  if (isEmpty) {
    return <li className="block border-b border-line px-6 py-3.5">{summary}</li>;
  }

  return (
    <li className="border-b border-line">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="block w-full px-6 py-3.5 text-left focus-visible:bg-raised focus-visible:outline-none"
      >
        {summary}
      </button>
      {isOpen && (
        <div id={panelId} className="pb-4">
          <MealList records={day.records} />
        </div>
      )}
    </li>
  );
}
