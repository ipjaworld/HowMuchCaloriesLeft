"use client";

import { useState } from "react";
import type { ClarifyOption, Reply } from "./replyText";

type Props = {
  onSubmit: (message: string) => void;
  /** Chosen answer to a clarifying question; resolved on the client. */
  onChooseOption: (option: ClarifyOption) => void;
  reply: Reply | null;
  isPending: boolean;
};

export function ChatInput({
  onSubmit,
  onChooseOption,
  reply,
  isPending,
}: Props) {
  const [text, setText] = useState("");

  const trimmed = text.trim();
  const canSubmit = trimmed.length > 0 && !isPending;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    onSubmit(trimmed);
    setText("");
  }

  return (
    <div className="sticky bottom-0 border-t border-neutral-100 bg-white px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      {isPending && (
        <p className="mb-2.5 text-xs text-neutral-500">생각하는 중…</p>
      )}

      {!isPending && reply !== null && (
        <div className="mb-2.5" role="status">
          <p className="text-sm break-keep text-neutral-700 [overflow-wrap:anywhere]">
            {reply.text}
          </p>

          {reply.kind === "question" && (
            <div className="mt-2 flex flex-wrap gap-2">
              {reply.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => onChooseOption(option)}
                  className="h-11 max-w-full truncate rounded-full border border-neutral-300 px-4 text-sm text-neutral-800 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none"
                >
                  {option.label}
                </button>
              ))}
            </div>
          )}
        </div>
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
          disabled={isPending}
          className="h-11 min-w-0 flex-1 rounded-full border border-neutral-200 bg-neutral-50 px-4 text-base text-neutral-900 placeholder:text-neutral-500 focus-visible:border-neutral-900 focus-visible:bg-white focus-visible:ring-1 focus-visible:ring-neutral-900 focus-visible:outline-none disabled:opacity-60"
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
