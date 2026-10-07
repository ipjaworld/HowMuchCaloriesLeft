"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { AccountStatus } from "@/domain/account";
import { TodayScreen } from "./TodayScreen";
import { HistoryScreen } from "./HistoryScreen";
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
  return (
    <>
      <nav className="px-6 pt-3 text-right text-sm">
        <Link href="/account">
          {status.userId ? "내 계정" : "로그인 · 기록 보관"}
        </Link>
      </nav>
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
