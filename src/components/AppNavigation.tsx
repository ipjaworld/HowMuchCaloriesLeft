"use client";

import Link from "next/link";
import { useId, useRef, useState } from "react";

export function AppNavigation({ current, signedIn = false, accountEnabled = true }: {
  current: "today" | "history" | "conversations" | "challenge" | "account";
  signedIn?: boolean;
  accountEnabled?: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const entries = [
    { key: "today", href: "/", label: "오늘" },
    { key: "history", href: "/history", label: "식사 기록" },
    { key: "conversations", href: "/conversations", label: "대화 기록" },
    { key: "challenge", href: "/challenge", label: "월간 기록 챌린지" },
  ];
  function close() { dialog.current?.close(); }
  return (
    <header className="app-navigation">
      <button type="button" className="menu-toggle" aria-label="메뉴 열기"
        aria-haspopup="dialog" aria-expanded={open} aria-controls={id}
        onClick={() => { dialog.current?.showModal(); setOpen(true); }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>
      <dialog ref={dialog} id={id} aria-label="주요 메뉴" className="navigation-dialog"
        onClose={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) close(); }}>
        <div className="navigation-drawer">
          <div className="flex items-center justify-between gap-4">
            <span className="brand-mark"><span className="brand-seed" aria-hidden="true" />오늘 얼마 먹어도 돼?</span>
            <button type="button" className="menu-toggle" aria-label="메뉴 닫기" onClick={close} autoFocus>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>
          </div>
          <nav aria-label="화면 이동" className="mt-10 grid gap-2">
            {entries.map(({ key, href, label }) => (
              <Link key={key} href={href} aria-current={current === key ? "page" : undefined}
                className="drawer-link gap-3" onClick={close}>{label}{key === "challenge" && <span className="text-xs font-normal text-ink-soft">준비 중</span>}</Link>
            ))}
          </nav>
          {accountEnabled && <Link href="/account" onClick={close}
            aria-current={current === "account" ? "page" : undefined}
            className="drawer-link mt-auto">{signedIn ? "내 계정" : "로그인"}</Link>}
        </div>
      </dialog>
    </header>
  );
}
