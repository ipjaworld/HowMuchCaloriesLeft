"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AccountProfilePanel } from "./AccountProfilePanel";
import { AccountRecoveryPanel } from "./AccountRecoveryPanel";
import { AppNavigation } from "./AppNavigation";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AccountData, AccountStatus } from "@/domain/account";
import { createRemoteRepositories } from "@/infrastructure/remoteRepositories";
import { createLocalStorageMealRecordRepository } from "@/infrastructure/localStorageMealRecordRepository";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { createLocalStorageConversationRepository } from "@/infrastructure/localStorageConversationRepository";
import { createLocalStorageSyncMetaRepository } from "@/infrastructure/localStorageSyncMetaRepository";

export function AccountScreen({
  loginFailed = false,
  welcome = false,
}: {
  loginFailed?: boolean;
  welcome?: boolean;
}) {
  const router = useRouter();
  const lock = useRef(false);
  const [status, setStatus] = useState<AccountStatus | null>(null),
    [local, setLocal] = useState<AccountData | null>(null),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirmImport, setConfirmImport] = useState(false),
    [confirmDelete, setConfirmDelete] = useState(false);
  const userId = status?.userId;
  const suspended = !!status?.recovery && status.recovery.state !== "active";
  const remote = useMemo(
    () => (userId ? createRemoteRepositories(userId) : null),
    [userId],
  );
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const response = await fetch("/api/account", { cache: "no-store" });
      if (!response.ok) throw new Error();
      const result = (await response.json()) as AccountStatus;
      const [records, goals, conversation, meta] = await Promise.all([
        createLocalStorageMealRecordRepository().getAll(),
        createLocalStorageDailyGoalRepository().getAll(),
        createLocalStorageConversationRepository().getAll(),
        createLocalStorageSyncMetaRepository().get(),
      ]);
      if (!cancelled) {
        setStatus(result);
        setLocal({ records, goals, turns: conversation.turns, meta });
      }
    })().catch(() => {
      if (!cancelled)
        setNotice("계정 정보를 불러오지 못했어요. 새로고침해 주세요.");
    });
    return () => {
      cancelled = true;
    };
  }, []);
  async function perform(action: () => Promise<void>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setNotice("");
    try {
      await action();
    } catch (error) {
      setNotice(
        error instanceof Error && error.message
          ? error.message
          : "처리하지 못했어요. 다시 시도해 주세요.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function importData() {
    if (!remote || !local) return;
    await remote.import(local);
    const result = await remote.snapshot();
    setConfirmImport(false);
    setNotice(
      `합쳤어요. 계정의 식사 기록 ${result.data.records.length}개, 목표 ${result.data.goals.length}개, 대화 ${result.data.turns.length}개. 기기의 원본도 남겨두었어요.`,
    );
  }
  async function exportData() {
    const data = remote ? (await remote.snapshot()).data : local;
    if (!data) return;
    let calculator: unknown = null;
    if (userId) {
      const response = await fetch("/api/account/profile", {
        cache: "no-store",
        headers: { "x-account-id": userId },
      });
      if (!response.ok)
        throw new Error("계산기 정보를 내보내지 못했어요. 다시 시도해 주세요.");
      calculator = await response.json();
    }
    const blob = new Blob(
      [
        JSON.stringify(
          {
            version: 1,
            exportedAt: new Date().toISOString(),
            ...data,
            ...(userId ? { calculator } : {}),
          },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = "how-much-calories-left.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function leave(remove: boolean) {
    const response = await fetch("/api/account", {
      method: remove ? "DELETE" : "POST",
      headers: {
        "x-account-id": userId ?? "",
        ...(remove ? { "x-confirm-delete": "delete-my-account" } : {}),
      },
    });
    if (!response.ok)
      throw new Error(
        remove ? "계정을 삭제하지 못했어요." : "로그아웃하지 못했어요.",
      );
    router.push("/");
    router.refresh();
  }
  const button = "quiet-button";
  return (
    <main className={`app-shell ${userId && !suspended ? "account-shell" : ""}`}>
      <AppNavigation current="account" signedIn={!!userId} />
      <div className={`account-content ${userId && !suspended ? "account-workspace" : ""}`}>
      <header className="account-hero">
        <div>
          <p className="page-eyebrow">{userId && !suspended ? "나의 기록 공간" : "기록과 설정"}</p>
          <h1 className="page-title">{userId && !suspended ? (welcome ? <>반가워요.<br />오늘의 기록을 이어가세요.</> : <>나의 기록,<br />어디서든 이어서.</>) : "어디서든, 나의 기록"}</h1>
          <p className="mt-4 text-sm text-ink-soft">{userId && !suspended ? "식사와 목표를 계정에 보관하고 있어요. 다른 기기에서도 이어서 볼 수 있어요." : "가볍게 기록하고, 필요할 때 이어서 보세요."}</p>
          {userId && !suspended && <p className="mt-2 text-xs text-ink-soft">저장할 때는 인터넷 연결이 필요해요.</p>}
        </div>
        {userId && !suspended && <div className="account-hero-actions">
          <Link href="/" className="account-primary">오늘 기록하기 <span aria-hidden="true">↗</span></Link>
          <Link href="/history" className="inline-flex min-h-11 items-center justify-center text-sm text-brand">내 기록 보기</Link>
        </div>}
      </header>
      {notice && (
        <p role="status" className="account-notice text-sm">
          {notice}
        </p>
      )}
      {loginFailed && (
        <p role="alert" className="text-sm">
          로그인을 마치지 못했어요. 동의 항목을 확인하고 다시 시도해 주세요.
        </p>
      )}
      {!status ? (
        <p>불러오는 중</p>
      ) : !status.configured ? (
        <p>로그인은 준비 중이에요. 지금처럼 이 기기에 기록할 수 있어요.</p>
      ) : !status.userId ? (
        <>
          <p className="text-sm text-ink-soft">
            로그인은 선택이에요. 로그인하면 기록을 계정에 보관하고 다른 기기에서
            볼 수 있어요. 이 기기의 기존 기록은 따로 동의한 뒤 합쳐요.
          </p>
          <form action="/api/auth/start" method="post" className="consent-form">
            <label className="flex gap-2 text-sm">
              <input type="checkbox" name="age" value="yes" required />만 14세
              이상입니다. (필수)
            </label>
            <label className="flex gap-2 text-sm">
              <input type="checkbox" name="consent" value="yes" required />
              계정 식별정보와 식사·목표·대화 기록의 수집·이용에 동의합니다.
              (필수)
            </label>
            <p className="text-xs text-ink-soft">
              목적: 로그인 및 기록 보관. 보관: 계정 삭제까지, 대화는 KST 기준
              30일. 동의하지 않아도 로그인 없이 사용할 수 있어요.{" "}
              <Link className="underline" href="/privacy">
                개인정보처리방침
              </Link>
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              {status.providers.map((provider) => (
                <button
                  key={provider}
                  className="login-provider"
                  type="submit"
                  name="provider"
                  value={provider}
                >
                  {provider === "google" ? "Google" : "카카오"}로 계속
                </button>
              ))}
            </div>
            {status.recoveryEnabled && <p className="text-xs">
              카카오만 연결된 계정에서 연결을 해제하면 기록 접근을 막고 7일 동안 복구를 기다린 뒤 삭제해요.
              그 안에 같은 카카오 계정으로 다시 인증하고 동의하면 복구할 수 있어요.
            </p>}
          </form>
        </>
      ) : suspended && status.recovery ? (
        <>
          <AccountRecoveryPanel recovery={status.recovery} userId={status.userId} />
          <button className={button} disabled={busy} onClick={() => void perform(() => leave(false))}>로그아웃 · 다시 로그인</button>
          <p className="text-sm">복구 대신 계정과 계정 기록을 지금 영구 삭제할 수도 있어요. 기기 원본은 남아요.</p>
          {confirmDelete ? <>
            <p>삭제하면 7일 유예 없이 모든 계정 기록을 즉시 삭제하며 되돌릴 수 없어요.</p>
            <button className={button} disabled={busy} onClick={() => void perform(() => leave(true))}>계정과 기록 모두 삭제</button>
            <button className={button} disabled={busy} onClick={() => setConfirmDelete(false)}>취소</button>
          </> : <button className={button} disabled={busy} onClick={() => setConfirmDelete(true)}>계정·기록 삭제</button>}
        </>
      ) : (
        <>
          <div className="account-section-heading"><h2>필요한 설정만, 가볍게</h2><p>기존 기록과 계산기 정보를 관리해요.</p></div>
          {local && (
            <section className="account-setting space-y-3">
              <h2 className="font-medium">이 기기 기록 합치기</h2>
              <p className="text-sm">
                식사 {local.records.length}개 · 목표 {local.goals.length}개 ·
                대화 {local.turns.length}개
              </p>
              <p className="text-xs">
                같은 기록은 마지막 변경을 따르고, 삭제 표시도 반영해요. 계산기
                신체정보는 포함하지 않아요.
              </p>
              {confirmImport ? (
                <>
                  <p className="text-sm">
                    이 기기의 기록을 현재 계정에 합칠까요? 원본은 기기에 남겨요.
                  </p>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => void perform(importData)}
                  >
                    동의하고 합치기
                  </button>
                  <button
                    className={button}
                    disabled={busy}
                    onClick={() => setConfirmImport(false)}
                  >
                    취소
                  </button>
                </>
              ) : (
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => setConfirmImport(true)}
                >
                  합칠 내용 확인
                </button>
              )}
            </section>
          )}
          <AccountProfilePanel userId={status.userId} />
          {status.recoveryEnabled && <section className="space-y-2 text-sm">
            <h2 className="font-medium">카카오 연결</h2>
            <p>카카오에서 연결을 해제하면 이 앱에서 다시 인증해야 해요. 같은 계정에 다른 로그인이 연결되어 있으면 기록은 유지해요.</p>
            <p>카카오만 연결된 계정은 기록을 잠그고 7일간 복구를 기다린 뒤 삭제해요. 필요한 기록은 미리 내보내 주세요.</p>
          </section>}

        </>
      )}
      {local && !suspended && (
        <details className="account-secondary account-export">
        <summary>기록 사본 내보내기</summary>
        <div className="space-y-3">
        <p className="text-xs">기록을 JSON 파일로 내려받아요. 파일을 앱으로 다시 가져오는 기능은 아직 지원하지 않아요.</p>
        <button
          className={button}
          disabled={busy}
          onClick={() => void perform(exportData)}
        >
          {status?.userId ? "계정" : "이 기기"} 기록 내보내기 (JSON)
        </button>
        </div>
        </details>
      )}
      {userId && !suspended && (
          <details className="account-secondary">
            <summary>계정 삭제</summary>
            <div className="space-y-3">
            <p className="text-sm">
              계정과 계정에 보관한 기록을 삭제해요. 기기 원본은 남아요.
            </p>
            {confirmDelete ? (
              <>
                <p>삭제한 계정 기록은 되돌릴 수 없어요.</p>
                <button
                  className={`${button} danger-action`}
                  disabled={busy}
                  onClick={() => void perform(() => leave(true))}
                >
                  계정과 기록 모두 삭제
                </button>
                <button
                  className={button}
                  disabled={busy}
                  onClick={() => setConfirmDelete(false)}
                >
                  취소
                </button>
              </>
            ) : (
              <button
                className={`${button} danger-action`}
                disabled={busy}
                onClick={() => setConfirmDelete(true)}
              >
                계정 삭제하기
              </button>
            )}
            </div>
          </details>
      )}
      <footer className="flex flex-wrap items-center justify-between gap-4 text-xs text-ink-soft">
        <Link href="/privacy" className="underline">
          개인정보처리방침
        </Link>
        {userId && !suspended && <button className="min-h-11 px-2" disabled={busy}
          onClick={() => void perform(() => leave(false))}>로그아웃</button>}
      </footer>
      </div>
    </main>
  );
}
