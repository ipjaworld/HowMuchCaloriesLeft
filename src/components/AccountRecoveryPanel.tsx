"use client";
import { useRef, useState } from "react";
import type { AccountRecovery } from "@/domain/account";

export function AccountRecoveryPanel({ recovery, userId }: { recovery: AccountRecovery; userId: string }) {
  const [consent, setConsent] = useState(false);
  const [profileConsent, setProfileConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const lock = useRef(false);
  async function restore() {
    if (lock.current || !consent || recovery.state !== "recoverable") return;
    lock.current = true; setBusy(true);
    try {
      const response = await fetch("/api/account/recovery", {
        method: "POST", headers: { "content-type": "application/json", "x-account-id": userId },
        body: JSON.stringify({ consent: true, profileConsent, disconnectedAt: recovery.disconnectedAt }),
      });
      if (!response.ok) throw new Error();
      // Drop all stale repository caches and reload the now-active account.
      window.location.reload();
    } catch {
      setNotice("복구하지 못했어요. 기한을 확인하고 같은 카카오 계정으로 다시 로그인해 주세요.");
      lock.current = false; setBusy(false);
    }
  }
  if (recovery.state === "active") return null;
  return <section className="space-y-3 text-sm">
    <h2 className="font-medium">카카오 연결 해제 · 기록 복구</h2>
    {recovery.state === "pending" ? <p>연결 해제를 처리하고 있어요. 기록은 잠겨 있어요. 잠시 후 같은 카카오 계정으로 다시 로그인해 주세요.</p>
      : recovery.state === "expired" ? <p>7일 복구 기한이 지나 기록을 복구할 수 없어요. 계정과 기록은 삭제 대상이며, 다시 연결해도 복원되지 않아요.</p>
      : <>
        <p>카카오 연결이 해제되어 기록을 잠갔어요. {new Intl.DateTimeFormat("ko-KR", {
          timeZone: "Asia/Seoul", dateStyle: "long", timeStyle: "short",
        }).format(new Date(recovery.deleteAfter))} (한국 시간) 전까지 다시 동의하면 기록을 복구할 수 있어요.</p>
        <label className="flex gap-2"><input type="checkbox" checked={consent} onChange={e => setConsent(e.target.checked)} />
          계정 식별정보와 식사·목표·대화 기록의 수집·이용에 다시 동의하고 복구합니다. (필수)</label>
        <p>목적은 로그인과 기록 보관이며, 계정 삭제까지 보관해요. 대화는 기존 30일 보관 기준을 유지해요.</p>
        <label className="flex gap-2"><input type="checkbox" checked={profileConsent} onChange={e => setProfileConsent(e.target.checked)} />
          이전에 보관한 계산기 정보의 수집·이용과 계정 보관에 다시 동의합니다. (선택)</label>
        <p>키·몸무게·나이·성별·활동량·목표 방식을 기기 간 계산기에 사용하며 철회 또는 계정 삭제까지 보관해요.
          선택하지 않고 복구하면 계정의 계산기 정보는 삭제해요. 기기 원본은 남아요.</p>
        <button disabled={!consent || busy} className="quiet-button" onClick={() => void restore()}>
          동의하고 기록 복구
        </button>
      </>}
    {notice && <p role="alert">{notice}</p>}
  </section>;
}
