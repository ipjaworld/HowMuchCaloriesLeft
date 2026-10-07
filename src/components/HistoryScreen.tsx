"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { todayKey, dateKeyOf } from "@/domain/date";
import type { ConversationTurn } from "@/domain/conversation";
import type { MealRecord } from "@/domain/meal";
import { summarizeHistory, summarizeHistoryDay, effectiveGoal, type DayHistory } from "@/domain/history";
import { createLocalStorageConversationRepository } from "@/infrastructure/localStorageConversationRepository";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { createLocalStorageMealRecordRepository } from "@/infrastructure/localStorageMealRecordRepository";
import { describeHistoryDate, describeHistoryDay } from "./historyText";
import { describeStorageNotice } from "./replyText";
import { MealList } from "./MealList";
import { createRemoteRepositories } from "@/infrastructure/remoteRepositories";
import { recordConsistency } from "@/domain/recordConsistency";

type State =
  | { status: "loading" }
  | { status: "ready"; today: string; days: DayHistory[]; records: MealRecord[]; turns: ConversationTurn[]; notice: string | null };

/**
 * Past days, newest first: one line of figures per day, and the day's own
 * list one tap away. Read-only — changes still happen by talking on Today.
 *
 * Built to be scanned: the eye runs down the right-hand totals and stops on
 * the few that are set apart. Nothing here grades a day.
 */
export function HistoryScreen({accountId=null}:{accountId?:string|null} = {}) {
  const repositories = useMemo(
    () => ({
      meals: createLocalStorageMealRecordRepository(),
      goals: createLocalStorageDailyGoalRepository(),
      conversation: createLocalStorageConversationRepository(),
      ...(accountId ? createRemoteRepositories(accountId) : {}),
    }),
    [accountId],
  );
  const [state, setState] = useState<State>({ status: "loading" });
  const [openDate, setOpenDate] = useState<string | null>(null);
  const [loadError,setLoadError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const today = todayKey();
      const [records, goals, conversation] = await Promise.all([
        repositories.meals.getAll(), repositories.goals.getAll(), repositories.conversation.getAll(),
      ]);
      const days = summarizeHistory(
        records,
        goals,
        today,
      );
      for (const turn of conversation.turns) {
        const date = dateKeyOf(turn.at);
        if (date !== null && !days.some((day) => day.date === date)) {
          days.push(summarizeHistoryDay(date, [], effectiveGoal(goals, date)?.calorieTarget ?? null));
        }
      }
      days.sort((a, b) => b.date.localeCompare(a.date));
      const notice = !conversation.saved ? describeStorageNotice("conversation")
        : conversation.dropped > 0 ? describeStorageNotice("trimmed") : null;
      if (!cancelled) setState({ status: "ready", today, days, records, turns: conversation.turns, notice });
    })().catch(()=>{if(!cancelled)setLoadError(true);});
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  return (
    <>
      <header className="flex items-center justify-between px-6 pt-9 pb-8 sm:px-10">
        <h1 className="page-title">지난 기록</h1>
        <Link
          href="/"
          className="text-[0.8125rem] text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink"
        >
          오늘로
        </Link>
      </header>
      {state.status === "ready" && <ConsistencySummary records={state.records} today={state.today} />}
      {state.status === "ready" && state.notice !== null && <p role="alert" className="px-6 text-sm text-accent">{state.notice}</p>}

      {loadError ? <p role="alert" className="px-6">기록을 불러오지 못했어요. 연결을 확인한 뒤 새로고침해 주세요.</p> : state.status === "loading" ? (
        <p className="px-6 text-sm text-ink-soft">불러오는 중</p>
      ) : state.days.length === 0 ? (
        <p className="px-6 py-4 text-sm break-keep text-ink-soft">
          아직 기록이 없어요. 오늘 먹은 걸 말해주시면 여기에 쌓여요.
        </p>
      ) : (
        <ul className="space-y-2 px-4 pb-10 sm:px-6">
          {state.days.map((day) => (
            <HistoryRow
              key={day.date}
              day={day}
              today={state.today}
              turns={state.turns.filter((turn) => dateKeyOf(turn.at) === day.date)}
              isOpen={openDate === day.date}
              onToggle={() => setOpenDate(openDate === day.date ? null : day.date)}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function ConsistencySummary({ records, today }: { records: MealRecord[]; today: string }) {
  const summary = recordConsistency(records, today);
  return <section aria-label="나의 기록 습관" className="mx-6 mb-8 sm:mx-10">
    <p className="text-sm font-medium text-brand">이번 달 {summary.month}일 기록했어요</p>
    <p className="mt-2 text-sm text-ink">현재 {summary.streak}일 연속 · 누적 {summary.total}일</p>
    <p className="mt-2 text-xs leading-6 text-ink-soft">
      저장된 식사 날짜 기준이에요. 하루 여러 번 기록해도 하루로 세어요.
      {!summary.recordedToday && summary.streak > 0 && " 오늘 기록하면 연속 기록을 이어갈 수 있어요."}
    </p>
  </section>;
}

function HistoryRow({
  day,
  today,
  turns,
  isOpen,
  onToggle,
}: {
  day: DayHistory;
  today: string;
  turns: ConversationTurn[];
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
          {dateLabel}<span aria-hidden="true" className="ml-2 text-xs text-ink-soft">{isOpen ? "−" : "+"}</span>
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

  return (
    <li className="rounded-2xl bg-raised/60">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        aria-controls={panelId}
        className="block w-full rounded-2xl px-5 py-5 text-left focus-visible:bg-raised focus-visible:outline-none"
      >
        {summary}
      </button>
      {isOpen && (
        <div id={panelId} className="pb-4">
          {day.records.length > 0 && <MealList records={day.records} showSourceText />}
          <Link href="/conversations" className="mx-6 mt-4 inline-flex min-h-11 items-center text-sm text-ink-soft underline underline-offset-4">
            대화 기록 보기{turns.length > 0 ? ` · 이날 ${turns.length}건` : ""}
          </Link>
        </div>
      )}
    </li>
  );
}
