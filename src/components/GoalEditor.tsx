"use client";

import { useEffect, useId, useRef, useState } from "react";
import { DAILY_GOAL_RANGE, type SetDailyGoalResult } from "@/application/dailyGoal";

const numberFormat = new Intl.NumberFormat("ko-KR");

type GoalError = Extract<SetDailyGoalResult, { ok: false }>["reason"];

const MESSAGES: Record<GoalError, string> = {
  not_a_number: "숫자만 입력해주세요.",
  out_of_range: `${numberFormat.format(DAILY_GOAL_RANGE.min)} ~ ${numberFormat.format(DAILY_GOAL_RANGE.max)} 사이로 입력해주세요.`,
  invalid_date: "날짜를 다시 확인해주세요.",
};

type Props = {
  currentTarget: number | null;
  onSubmit: (calorieTarget: number) => Promise<SetDailyGoalResult>;
  /** Opens the calculator. The manual field is never replaced by it. */
  onOpenCalculator?: () => void;
  /**
   * Mount with the field already open — used right after "직접 입력할게요",
   * so the choice leads straight to the input instead of back to a button.
   * The parent remounts with a new `key` to trigger it again.
   */
  startOpen?: boolean;
  /** The inline field closed — saved or cancelled. */
  onClose?: () => void;
};

/**
 * Deliberately not a settings page: a small control that swaps into an inline
 * field, inside the summary the user is already looking at.
 *
 * Before a goal exists it reads as an invitation; afterwards it recedes to a
 * quiet link beside the totals. There is no suggested default — a prefilled
 * 2100 would read as a recommended intake, which this app does not give.
 *
 * The calculator sits next to it rather than in front of it. Someone who
 * knows their number types it; someone who does not gets an estimate. Either
 * way the result is the same `DailyGoal`, and whichever was set last wins.
 */
export function GoalEditor({
  currentTarget,
  onSubmit,
  onOpenCalculator,
  startOpen = false,
  onClose,
}: Props) {
  const inputId = useId();
  const [isOpen, setIsOpen] = useState(startOpen);
  const [value, setValue] = useState(
    startOpen && currentTarget !== null ? String(currentTarget) : "",
  );
  const [error, setError] = useState<string | null>(null);

  const isFirstTime = currentTarget === null;
  const inputRef = useRef<HTMLInputElement>(null);

  // Opened from the calculator's "직접 입력할게요": the closing <dialog>
  // hands focus back to whatever had it before, in an effect that runs after
  // this field's own autoFocus. A zero-delay task lands after both — and,
  // unlike a frame callback, still runs in a background tab.
  useEffect(() => {
    if (!startOpen) return;
    const timer = setTimeout(() => inputRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [startOpen]);

  function open() {
    setValue(currentTarget === null ? "" : String(currentTarget));
    setError(null);
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
    setError(null);
    onClose?.();
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const digits = value.trim();
    if (digits === "") {
      setError(MESSAGES.not_a_number);
      return;
    }

    const result = await onSubmit(Number(digits));
    if (result.ok) {
      close();
      return;
    }
    setError(MESSAGES[result.reason]);
  }

  const calculatorLink =
    onOpenCalculator === undefined ? null : (
      <button
        type="button"
        onClick={onOpenCalculator}
        className="-m-3 shrink-0 rounded p-3 text-[0.8125rem] text-ink-soft underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
      >
        계산해서 정하기
      </button>
    );

  if (!isOpen) {
    return isFirstTime ? (
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <button
          type="button"
          onClick={open}
          className="h-11 rounded-full bg-ink px-4 text-[0.875rem] font-medium text-surface transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          목표 설정
        </button>
        {calculatorLink}
      </div>
    ) : (
      // The negative margin cancels the padding, so the tap area is 44px tall
      // without the text drifting off the totals line.
      <button
        type="button"
        onClick={open}
        className="-m-3 shrink-0 rounded p-3 text-[0.8125rem] text-ink-soft underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
      >
        목표 수정
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="flex items-center gap-2">
        <label htmlFor={inputId} className="sr-only">
          하루 목표 칼로리
        </label>

        <input
          id={inputId}
          ref={inputRef}
          // `type="text"` with a numeric keypad: no spinner, and no way to
          // type "e" or "+" the way `type="number"` allows.
          type="text"
          inputMode="numeric"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={(event) => {
            setValue(event.target.value.replace(/\D/g, ""));
            setError(null);
          }}
          placeholder="목표 kcal"
          aria-invalid={error !== null}
          aria-describedby={error === null ? undefined : `${inputId}-error`}
          className="numeric h-11 w-32 min-w-0 rounded-full border border-line-strong bg-surface px-4 text-base text-ink placeholder:text-ink-soft focus-visible:border-ink focus-visible:outline-none"
        />

        <button
          type="submit"
          className="h-11 shrink-0 rounded-full bg-ink px-4 text-[0.875rem] font-medium text-surface focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          확인
        </button>

        <button
          type="button"
          onClick={close}
          className="h-11 shrink-0 px-2 text-[0.8125rem] text-ink-soft transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
        >
          취소
        </button>
      </div>

      {error !== null && (
        <p id={`${inputId}-error`} role="alert" className="mt-2 text-sm text-accent">
          {error}
        </p>
      )}

      {calculatorLink !== null && (
        <p className="mt-3.5 text-[0.8125rem] text-ink-soft">
          목표를 모르겠다면 {calculatorLink}
        </p>
      )}
    </form>
  );
}
