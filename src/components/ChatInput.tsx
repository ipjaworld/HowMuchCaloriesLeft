"use client";

import { useState } from "react";

export function ChatInput() {
  const [text, setText] = useState("");
  /** Phase 2 only: echoes the last submission so the interaction is visible. */
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null);

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    setLastSubmitted(trimmed);
    setText("");
  }

  return (
    <div className="sticky bottom-0 border-t border-neutral-100 bg-white px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {/* Clamped: a long sentence must not push the input off the screen. */}
      {lastSubmitted !== null && (
        <p className="mb-2.5 line-clamp-2 text-xs break-keep text-neutral-500 [overflow-wrap:anywhere]">
          “{lastSubmitted}” — 아직 기록되지 않아요
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        <label htmlFor="meal-input" className="sr-only">
          먹은 것을 입력하세요
        </label>

        <input
          id="meal-input"
          name="meal"
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="뭘 드셨나요?"
          autoComplete="off"
          enterKeyHint="send"
          className="h-11 min-w-0 flex-1 rounded-full border border-neutral-200 bg-neutral-50 px-4 text-base text-neutral-900 placeholder:text-neutral-500 focus-visible:border-neutral-900 focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-neutral-900 focus-visible:outline-none"
        />

        <button
          type="submit"
          disabled={!canSubmit}
          className="h-11 shrink-0 rounded-full bg-neutral-900 px-5 text-sm font-medium text-white transition-opacity focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-30"
        >
          기록
        </button>
      </form>
    </div>
  );
}
