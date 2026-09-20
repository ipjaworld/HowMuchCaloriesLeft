"use client";

import { useId, useState } from "react";
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
};

/**
 * Deliberately not a settings page: a text button that swaps into a small
 * inline field, inside the summary the user is already looking at.
 *
 * There is no suggested default. Putting "2100" in the field would read as a
 * recommended intake, which this app does not give.
 */
export function GoalEditor({ currentTarget, onSubmit }: Props) {
  const inputId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function open() {
    setValue(currentTarget === null ? "" : String(currentTarget));
    setError(null);
    setIsOpen(true);
  }

  function close() {
    setIsOpen(false);
    setError(null);
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

  if (!isOpen) {
    return (
      // The negative margin cancels the padding, so the tap area is 44px tall
      // without the text moving off the totals line.
      <button
        type="button"
        onClick={open}
        className="-m-3 shrink-0 rounded p-3 text-sm text-neutral-500 underline underline-offset-2 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none"
      >
        {currentTarget === null ? "목표 설정" : "목표 수정"}
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
          className="h-11 w-32 min-w-0 rounded-full border border-neutral-300 bg-white px-4 text-base text-neutral-900 placeholder:text-neutral-500 focus-visible:border-neutral-900 focus-visible:ring-1 focus-visible:ring-neutral-900 focus-visible:outline-none"
        />

        <button
          type="submit"
          className="h-11 shrink-0 rounded-full bg-neutral-900 px-4 text-sm font-medium text-white focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          확인
        </button>

        <button
          type="button"
          onClick={close}
          className="h-11 shrink-0 px-2 text-sm text-neutral-500 focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:outline-none"
        >
          취소
        </button>
      </div>

      {error !== null && (
        <p id={`${inputId}-error`} role="alert" className="mt-2 text-sm text-amber-700">
          {error}
        </p>
      )}
    </form>
  );
}
