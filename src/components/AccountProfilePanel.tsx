"use client";
import { useEffect, useRef, useState } from "react";
import type { AccountProfile } from "@/infrastructure/accountProfileRepository";
import { createLocalStorageDietProfileRepository } from "@/infrastructure/localStorageDietProfileRepository";
export function AccountProfilePanel({ userId }: { userId: string }) {
  const [state, setState] = useState<AccountProfile | null>(null),
    [confirm, setConfirm] = useState(false),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/account/profile", {
      cache: "no-store",
      headers: { "x-account-id": userId },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error();
        const data = (await r.json()) as AccountProfile;
        if (!cancelled) setState(data);
      })
      .catch(() => {
        if (!cancelled) setNotice("계산기 정보 설정을 불러오지 못했어요.");
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);
  async function change(enable: boolean) {
    if (lock.current || !state) return;
    lock.current = true;
    setBusy(true);
    try {
      const profile = enable
        ? await createLocalStorageDietProfileRepository().get()
        : null;
      const response = await fetch("/api/account/profile", {
        method: enable ? "POST" : "DELETE",
        headers: {
          "content-type": "application/json",
          "x-account-id": userId,
          "x-revision": String(state.revision),
          "x-consent-at": state.consentAt ?? "",
        },
        ...(enable ? { body: JSON.stringify({ consent: true, profile }) } : {}),
      });
      if (!response.ok) throw new Error();
      setState((await response.json()) as AccountProfile);
      setConfirm(false);
      setNotice(
        enable
          ? "계산기 정보를 계정에 보관해요. 이후 계산기 변경도 함께 저장해요."
          : "동의를 철회하고 계정의 계산기 정보를 삭제했어요. 기기 원본은 남아요.",
      );
    } catch {
      setNotice("변경하지 못했어요. 새로고침한 뒤 다시 해 주세요.");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3">
      <h2 className="font-medium">계산기 정보 보관 (선택)</h2>
      <p className="text-sm">
        기본은 꺼져 있어요. 켜면 키·몸무게·나이·성별·활동량·목표 방식을 계정에
        보관하고 다른 기기의 계산기에서도 사용해요. 음식 판단에는 보내지 않아요.
      </p>
      {notice && (
        <p role="status" className="text-sm">
          {notice}
        </p>
      )}
      {state &&
        (state.enabled ? (
          <button
            disabled={busy}
            className="quiet-button"
            onClick={() => void change(false)}
          >
            보관 끄기 · 계정의 계산기 정보 삭제
          </button>
        ) : confirm ? (
          <>
            <p className="text-sm">
              계산기 입력값의 별도 수집·이용과 계정 보관에 동의하나요? 목적은
              기기 간 계산기 정보 공유이며, 철회 또는 계정 삭제까지 보관해요.
              거부해도 나머지 기능은 그대로 쓸 수 있어요.
            </p>
            <button
              disabled={busy}
              className="quiet-button"
              onClick={() => void change(true)}
            >
              동의하고 켜기
            </button>
            <button
              disabled={busy}
              className="p-3 text-sm"
              onClick={() => setConfirm(false)}
            >
              취소
            </button>
          </>
        ) : (
          <button
            className="quiet-button"
            onClick={() => setConfirm(true)}
          >
            보관 내용 확인
          </button>
        ))}
    </section>
  );
}
