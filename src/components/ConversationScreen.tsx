"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { ConversationTurn } from "@/domain/conversation";
import { clockTimeOf, todayKey } from "@/domain/date";
import { createLocalStorageConversationRepository } from "@/infrastructure/localStorageConversationRepository";
import { createRemoteRepositories } from "@/infrastructure/remoteRepositories";
import { conversationDays } from "./conversationView";
import { describeHistoryDate } from "./historyText";
import { describeStorageNotice } from "./replyText";

export function ConversationScreen({ accountId = null }: { accountId?: string | null }) {
  const repository = useMemo(() => accountId
    ? createRemoteRepositories(accountId).conversation
    : createLocalStorageConversationRepository(), [accountId]);
  const [state, setState] = useState<{ turns: ConversationTurn[]; today: string; notice: string | null } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void repository.getAll().then(result => {
      if (!cancelled) setState({ turns: result.turns, today: todayKey(),
        notice: !result.saved ? describeStorageNotice("conversation") : result.dropped ? describeStorageNotice("trimmed") : null });
    }).catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [repository]);
  return <>
    <header className="shrink-0 px-6 pt-6 pb-4 sm:px-10">
      <div className="flex items-center justify-between gap-4">
        <h1 className="page-title">대화 기록</h1>
        <Link href="/" className="inline-flex min-h-11 items-center text-sm text-ink-soft underline underline-offset-4">오늘로</Link>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-ink-soft">최근 30일의 대화예요. 답변 속 숫자는 대화 당시 기준이에요.</p>
    </header>
    <div role="region" aria-label="대화 내용" tabIndex={0} className="conversation-scroll">
    {failed ? <p role="alert" className="px-6">대화를 불러오지 못했어요. 연결을 확인하고 새로고침해 주세요.</p>
      : !state ? <p role="status" className="px-6 text-sm text-ink-soft">불러오는 중</p>
      : <>
        {state.notice && <p role="alert" className="px-6 text-sm text-accent">{state.notice}</p>}
        <ConversationTranscript turns={state.turns} today={state.today} />
      </>}
    </div>
  </>;
}

export function ConversationTranscript({ turns, today }: { turns: ConversationTurn[]; today: string }) {
  const days = conversationDays(turns, today);
  if (!days.length) return <p className="px-6 text-sm text-ink-soft sm:px-10">아직 보관된 대화가 없어요. 오늘 화면에서 말을 걸어보세요.</p>;
  return <div className="space-y-10 px-6 pb-10 sm:px-10">
    {days.map(([day, entries]) => <section key={day} id={`day-${day}`} className="scroll-mt-6">
      <h2 className="mb-6 text-sm font-medium text-ink-soft">{describeHistoryDate(day, today)}</h2>
      <ol className="space-y-7">
        {entries.map(turn => <li key={turn.id} className="space-y-2">
          <time dateTime={turn.at} className="block text-center text-xs text-ink-soft">{clockTimeOf(turn.at)}</time>
          {turn.user !== null && <p className="ml-auto w-fit max-w-[88%] rounded-2xl rounded-br-md bg-raised px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]"><span className="sr-only">나: </span>{turn.user}</p>}
          <p className="w-fit max-w-[88%] rounded-2xl rounded-bl-md bg-ink px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap text-surface [overflow-wrap:anywhere]"><span className="sr-only">답변: </span>{turn.reply}</p>
        </li>)}
      </ol>
    </section>)}
  </div>;
}
