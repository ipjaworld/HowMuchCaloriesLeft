"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { decodeMovePayload, moveFragment, movePayloadIsEmpty, type MovePayload } from "@/application/originMove";
import { applyMovePayload } from "@/infrastructure/localMove";

const button =
  "inline-flex min-h-12 items-center justify-center rounded-full px-5 text-[0.9375rem] font-medium disabled:opacity-40";

type State =
  | { step: "reading" }
  | { step: "none" }
  | { step: "invalid" }
  | { step: "ready"; payload: MovePayload }
  | { step: "done"; conversationSaved: boolean }
  | { step: "failed" };

/**
 * The receiving end of the move from the old address.
 *
 * A link can be written by anyone, so arriving on this page saves nothing:
 * the payload is checked, described, and merged only when the user says so.
 */
export function ImportScreen() {
  const [state, setState] = useState<State>({ step: "reading" });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const encoded = moveFragment(window.location.hash);
    void (async () => {
      if (encoded === null) return { step: "none" } as const;
      const payload = await decodeMovePayload(encoded);
      if (payload === null) return { step: "invalid" } as const;
      return movePayloadIsEmpty(payload) ? ({ step: "none" } as const) : ({ step: "ready", payload } as const);
    })().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /** The records must not sit in the address bar, history or a shared link. */
  function clearFragment() {
    window.history.replaceState(null, "", window.location.pathname);
  }

  async function accept(payload: MovePayload) {
    setBusy(true);
    try {
      const result = await applyMovePayload(payload);
      if (!result.saved) {
        setState({ step: "failed" });
        return;
      }
      clearFragment();
      setState({ step: "done", conversationSaved: result.conversationSaved });
    } catch {
      setState({ step: "failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-content">
      <div className="space-y-3">
        <p className="page-eyebrow">기록 옮기기</p>
        <h1 className="page-title">이전 주소의 기록 가져오기</h1>
      </div>

      {state.step === "reading" && <p className="text-sm">기록을 확인하는 중</p>}

      {state.step === "none" && (
        <section className="space-y-4">
          <p className="text-sm">가져올 기록이 없어요.</p>
          <Link className={`${button} bg-brand text-surface`} href="/">
            오늘 화면으로
          </Link>
        </section>
      )}

      {state.step === "invalid" && (
        <section className="space-y-4">
          <p role="alert" className="text-sm">
            기록을 읽지 못했어요. 이전 주소에서 옮기기를 다시 눌러 주세요. 이 브라우저에는
            아무것도 저장하지 않았어요.
          </p>
          <Link className={`${button} bg-raised text-ink`} href="/">
            오늘 화면으로
          </Link>
        </section>
      )}

      {state.step === "ready" && (
        <section className="space-y-4">
          <p className="text-sm">
            식사 {state.payload.data.records.length}개 · 목표 {state.payload.data.goals.length}개 ·
            대화 {state.payload.data.turns.length}개
          </p>
          <p className="text-sm">이 기록을 이 브라우저에 저장할까요?</p>
          <p className="text-xs text-ink-soft">
            이미 여기 있는 기록과 합쳐요. 같은 기록은 마지막 변경을 따르고 두 번 들어가지
            않아요. 서버로 보내지 않아요.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${button} bg-brand text-surface`}
              disabled={busy}
              onClick={() => void accept(state.payload)}
            >
              가져오기
            </button>
            <Link
              className={`${button} bg-raised text-ink`}
              href="/"
              onClick={clearFragment}
            >
              가져오지 않기
            </Link>
          </div>
        </section>
      )}

      {state.step === "done" && (
        <section className="space-y-4">
          <p role="status" className="text-sm">
            기록을 가져왔어요.
            {!state.conversationSaved && " 대화 기록은 저장 공간이 부족해 가져오지 못했어요."}
          </p>
          <p className="text-xs text-ink-soft">
            로그인해서 쓰신다면 내 계정의 ‘이 기기 기록 합치기’로 계정에도 넣을 수 있어요.
          </p>
          <Link className={`${button} bg-brand text-surface`} href="/">
            오늘 화면으로
          </Link>
        </section>
      )}

      {state.step === "failed" && (
        <section className="space-y-4">
          <p role="alert" className="text-sm">
            저장하지 못했어요. 브라우저 저장 공간을 확인한 뒤 다시 눌러 주세요. 이전 주소의
            기록은 그대로 있어요.
          </p>
          <button
            type="button"
            className={`${button} bg-brand text-surface`}
            onClick={() => window.location.reload()}
          >
            다시 시도
          </button>
        </section>
      )}
    </div>
  );
}
