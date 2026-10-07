"use client";

import { useState } from "react";
import { replyText, type ClarifyOption, type Reply } from "./replyText";

type Props = {
  onSubmit: (message: string) => void;
  /** Chosen answer to a clarifying question; resolved on the client. */
  onChooseOption: (option: ClarifyOption) => void;
  reply: Reply | null;
  /**
   * What the user last said — typed, or the chip they picked — shown above
   * the reply it got. Null for an action with no words, like the ×.
   */
  lastMessage: string | null;
  isPending: boolean;
};

/**
 * The half of the app that makes it feel like talking to something.
 *
 * One exchange, messenger-style: what the user said on the right in white,
 * the app's answer on the left in ink — the same pairing the product's own
 * landing page shows. Only the latest exchange, never a transcript: this app
 * shows today's state, not a conversation history, and the previous
 * exchange is replaced the moment a new one starts.
 */
export function ChatInput({
  onSubmit,
  onChooseOption,
  reply,
  lastMessage,
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
    <div className="sticky bottom-0 bg-surface/95 px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
      <div className="mb-3 min-h-[0.5rem] space-y-2">
        {lastMessage !== null && (isPending || reply !== null) && (
          <div className="animate-rise flex justify-end">
            <p className="max-w-[80%] rounded-[1.125rem] rounded-br-md border border-line-strong bg-surface px-3.5 py-2.5 text-[0.875rem] leading-relaxed break-keep text-ink [overflow-wrap:anywhere]">
              <span className="sr-only">나: </span>
              {lastMessage}
            </p>
          </div>
        )}

        {isPending && <Thinking />}

        {!isPending && reply !== null && (
          <div className="animate-rise" role="status">
            <p className="inline-block max-w-[88%] rounded-[1.125rem] rounded-bl-md bg-ink px-3.5 py-2.5 text-[0.875rem] leading-relaxed break-keep text-surface [overflow-wrap:anywhere]">
              {replyText(reply)}
            </p>

            {reply.kind === "question" && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {reply.options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => onChooseOption(option)}
                    className="h-11 max-w-full truncate rounded-full border border-line-strong bg-surface px-4 text-[0.875rem] text-ink transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

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
          className="h-12 min-w-0 flex-1 rounded-full border border-line-strong bg-raised px-4.5 text-base text-ink transition-colors placeholder:text-ink-soft focus-visible:border-ink focus-visible:bg-surface focus-visible:outline-none disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={!canSubmit}
          className="h-12 shrink-0 rounded-full bg-ink px-5 text-[0.875rem] font-medium text-surface transition-opacity focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-25"
        >
          기록
        </button>
      </form>
    </div>
  );
}

function Thinking() {
  return (
    <p
      className="inline-flex items-center gap-1.5 rounded-[1.125rem] rounded-bl-md bg-ink px-3.5 py-3"
      role="status"
    >
      <span className="sr-only">생각하는 중</span>
      {[0, 1, 2].map((index) => (
        <span
          key={index}
          aria-hidden="true"
          className="thinking-dot h-1.5 w-1.5 rounded-full bg-surface"
          style={{ animationDelay: `${index * 160}ms` }}
        />
      ))}
    </p>
  );
}
