"use client";

import { useRef, useState } from "react";

import { getBrowserStorage, readJson, STORAGE_KEYS, writeJson } from "@/infrastructure/storage";
import { readPhoto } from "./photoInput";
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
  /**
   * Photo input is switched on. A photo never records anything by itself: it
   * fills this box with what was read, and the user sends it or changes it.
   */
  photoEnabled?: boolean;
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
  photoEnabled = false,
}: Props) {
  const [text, setText] = useState("");
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const [photoIntro, setPhotoIntro] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const textInput = useRef<HTMLInputElement>(null);

  const trimmed = text.trim();
  const busy = isPending || photoBusy;
  const canSubmit = trimmed.length > 0 && !busy;

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSubmit) return;

    onSubmit(trimmed);
    setText("");
    setPhotoNote(null);
  }

  /** The first photo waits for the user to be told where it goes. */
  function handlePhotoButton() {
    setPhotoNote(null);
    if (readJson(getBrowserStorage(), STORAGE_KEYS.photoNotice) === null) setPhotoIntro(true);
    else fileInput.current?.click();
  }

  function acceptPhotoIntro() {
    writeJson(getBrowserStorage(), STORAGE_KEYS.photoNotice, { version: 1, seenAt: new Date().toISOString() });
    setPhotoIntro(false);
    fileInput.current?.click();
  }

  async function handlePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Cleared so that choosing the same photo again is still a change.
    event.target.value = "";
    if (file === undefined) return;

    setPhotoBusy(true);
    setPhotoNote(null);
    try {
      const outcome = await readPhoto(file);
      if (outcome.kind === "filled") {
        setText((current) => (current.trim() === "" ? outcome.sentence : `${current.trim()}, ${outcome.sentence}`));
        setPhotoNote(outcome.note);
        // After the re-render that enables the box again.
        setTimeout(() => textInput.current?.focus(), 0);
      } else {
        setPhotoNote(outcome.text);
      }
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <div className="sticky bottom-0 bg-surface/95 px-6 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm sm:rounded-b-[28px] sm:px-10">

      <div className="mb-3 min-h-[0.5rem] space-y-2">
        {lastMessage !== null && (isPending || reply !== null) && (
          <div className="animate-rise flex justify-end">
            <p className="max-w-[80%] rounded-[1.125rem] rounded-br-md bg-raised px-3.5 py-2.5 text-[0.875rem] leading-relaxed break-keep text-ink [overflow-wrap:anywhere]">
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
                    className="h-11 max-w-full truncate rounded-full bg-raised px-4 text-[0.875rem] text-ink transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {photoIntro && (
        <div className="animate-rise mb-3 space-y-3 rounded-2xl bg-raised p-4 text-[0.8125rem] leading-relaxed break-keep text-ink">
          <p>
            사진은 음식 이름과 양을 읽는 데만 써요. 읽기 위해 Anthropic(미국)으로 보내고, 이 앱은
            사진을 저장하지 않아요. 읽은 내용은 입력창에 채워 드리니 확인하고 기록해 주세요.
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={acceptPhotoIntro}
              className="h-11 rounded-full bg-brand px-4 text-[0.875rem] font-medium text-surface focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none"
            >
              사진 고르기
            </button>
            <button
              type="button"
              onClick={() => setPhotoIntro(false)}
              className="h-11 rounded-full bg-surface px-4 text-[0.875rem] text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {(photoBusy || photoNote !== null) && (
        <p role="status" className="mb-2 px-1 text-[0.8125rem] break-keep text-ink-soft">
          {photoBusy ? "사진을 읽는 중" : photoNote}
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex items-end gap-2">
        {photoEnabled && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => void handlePhoto(event)}
            />
            <button
              type="button"
              aria-label="사진으로 입력"
              disabled={busy}
              onClick={handlePhotoButton}
              className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-raised text-ink transition-opacity focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none disabled:opacity-40"
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2.1l1.2-1.8a1 1 0 0 1 .8-.45h4.8a1 1 0 0 1 .8.45L16.4 7h2.1A1.5 1.5 0 0 1 20 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5z" />
                <circle cx="12" cy="13" r="3.25" />
              </svg>
            </button>
          </>
        )}
        <label htmlFor="meal-input" className="sr-only">
          먹은 것을 입력하세요
        </label>

        <input
          ref={textInput}
          id="meal-input"
          name="meal"
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="뭘 드셨나요?"
          autoComplete="off"
          enterKeyHint="send"
          disabled={busy}
          className="h-12 min-w-0 flex-1 rounded-full bg-raised px-4.5 text-base text-ink transition-colors placeholder:text-ink-soft focus-visible:border-ink focus-visible:bg-surface focus-visible:outline-none disabled:opacity-60"
        />

        <button
          type="submit"
          disabled={!canSubmit}
          className="h-12 shrink-0 rounded-full bg-brand px-5 text-[0.875rem] font-medium text-surface transition-opacity focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-25"
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
