"use client";

import { useEffect, useState } from "react";
import { buildMoveLink, movePayloadIsEmpty, type MovePayload } from "@/application/originMove";
import { markMoved, readLocalMovePayload, readMovedAt } from "@/infrastructure/localMove";

const button =
  "inline-flex min-h-12 items-center justify-center rounded-full px-5 text-[0.9375rem] font-medium disabled:opacity-40";

/**
 * What the old address shows instead of the app.
 *
 * The records in this browser belong to this address and the new one cannot
 * see them, so the way across is a link that carries them. They are left in
 * place here: nothing is deleted on the strength of a link having been opened.
 */
export function MovedScreen({ target }: { target: string | null }) {
  const [local, setLocal] = useState<MovePayload | null>(null);
  const [movedAt, setMovedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    void readLocalMovePayload().then((payload) => {
      if (cancelled) return;
      setLocal(payload);
      setMovedAt(readMovedAt());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (target === null) {
    return (
      <div className="account-content">
        <h1 className="page-title">주소가 바뀌었어요</h1>
        <p className="text-sm">새 주소를 준비하고 있어요. 잠시 뒤 다시 열어 주세요.</p>
      </div>
    );
  }

  const host = new URL(target).host;
  const hasRecords = local !== null && !movePayloadIsEmpty(local);

  async function move() {
    if (local === null || target === null) return;
    setBusy(true);
    setNotice("");
    try {
      const link = await buildMoveLink(target, local);
      if (link === null) {
        setNotice(
          "기록이 많아서 한 번에 옮기지 못했어요. 기록은 이 브라우저에 그대로 있어요.",
        );
        return;
      }
      markMoved();
      window.location.assign(link.href);
    } catch {
      setNotice("기록을 준비하지 못했어요. 잠시 뒤 다시 눌러 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="account-content">
      <div className="space-y-3">
        <p className="page-eyebrow">안내</p>
        <h1 className="page-title">주소가 바뀌었어요</h1>
        <p className="text-sm">
          오늘 얼마 먹어도 돼?는 이제 <strong className="font-semibold">{host}</strong>
          에서 열려요.
        </p>
      </div>

      {local === null ? (
        <p className="text-sm">이 브라우저의 기록을 확인하는 중</p>
      ) : hasRecords ? (
        <section className="space-y-4">
          <h2 className="font-medium">이 브라우저의 기록 옮기기</h2>
          <p className="text-sm">
            식사 {local.data.records.length}개 · 목표 {local.data.goals.length}개 · 대화{" "}
            {local.data.turns.length}개
          </p>
          <p className="text-xs text-ink-soft">
            기록은 이 브라우저 안에서 새 주소로 바로 건네져요. 서버로 보내지 않고, 여기 있는
            원본은 지우지 않아요. 새 주소에서 한 번 더 확인한 뒤 저장해요. 계산기에 넣은
            신체정보는 옮기지 않아요.
          </p>
          {movedAt !== null && (
            <p className="text-xs text-ink-soft">
              {new Date(movedAt).toLocaleDateString("ko-KR")}에 옮긴 적이 있어요. 다시 옮겨도
              같은 기록이 두 번 들어가지 않아요.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={`${button} bg-brand text-surface`}
              disabled={busy}
              onClick={() => void move()}
            >
              기록 옮기고 새 주소로 가기
            </button>
            <a className={`${button} bg-raised text-ink`} href={target}>
              기록 없이 가기
            </a>
          </div>
        </section>
      ) : (
        <section className="space-y-4">
          <p className="text-sm">이 브라우저에 옮길 기록이 없어요.</p>
          <a className={`${button} bg-brand text-surface`} href={target}>
            새 주소로 가기
          </a>
        </section>
      )}

      {notice && (
        <p role="alert" className="text-sm">
          {notice}
        </p>
      )}

      <p className="text-xs text-ink-soft">
        로그인해서 쓰셨다면 새 주소에서 다시 로그인해 주세요. 계정에 저장한 기록은 그대로
        있어요.
      </p>
    </div>
  );
}
