"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AccountStatus } from "@/domain/account";
import { TodayScreen } from "./TodayScreen";
import { HistoryScreen } from "./HistoryScreen";
import { AppNavigation } from "./AppNavigation";
export function AccountBoundary({ history = false }: { history?: boolean }) {
  const [status, setStatus] = useState<AccountStatus | null>(null),
    [failed, setFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account", { cache: "no-store" })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const value = (await r.json()) as AccountStatus;
        if (!cancelled) setStatus(value);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  if (failed)
    return (
      <p role="alert" className="p-6">
        계정을 확인하지 못했어요. 연결을 확인한 뒤 새로고침해 주세요.
      </p>
    );
  if (!status) return <p className="p-6 text-sm">불러오는 중</p>;
  if (status.recovery && status.recovery.state !== "active") return (
    <main className="space-y-4 p-6 text-sm">
      <p>카카오 연결이 해제되어 계정 기록을 잠갔어요. 내 계정에서 복구 가능 여부를 확인해 주세요.</p>
      <Link href="/account" className="underline">내 계정으로</Link>
    </main>
  );
  return (
    <>
      <AppNavigation current={history ? "history" : "today"} signedIn={!!status.userId} />
      {history ? (
        <HistoryScreen
          key={status.userId ?? "local"}
          accountId={status.userId}
        />
      ) : (
        <TodayScreen key={status.userId ?? "local"} accountId={status.userId} />
      )}
    </>
  );
}
