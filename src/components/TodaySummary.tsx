import type { ReactNode } from "react";
import type { DailySummary } from "@/domain/calories";

const numberFormat = new Intl.NumberFormat("ko-KR");

/**
 * Wording only. The domain returns `remainingCalories: -140`; deciding that
 * this reads "140 kcal 더 먹었어요" is this layer's job.
 */
export function describeRemaining(remainingCalories: number): {
  amount: number;
  caption: string;
  isOver: boolean;
} {
  if (remainingCalories > 0) {
    return { amount: remainingCalories, caption: "남았어요", isOver: false };
  }
  if (remainingCalories === 0) {
    return { amount: 0, caption: "딱 맞췄어요", isOver: false };
  }
  return { amount: -remainingCalories, caption: "더 먹었어요", isOver: true };
}

type Props = {
  summary: DailySummary;
  /** The "목표 설정" / "목표 수정" control, placed differently per state. */
  goalAction?: ReactNode;
  /** True until storage has been read; keeps SSR and first paint identical. */
  isLoading?: boolean;
};

export function TodaySummary({ summary, goalAction, isLoading = false }: Props) {
  return (
    <section aria-labelledby="today-heading" className="px-6 pt-11 pb-7">
      <h1
        id="today-heading"
        className="text-[0.8125rem] font-medium tracking-[0.02em] text-ink-soft"
      >
        오늘
      </h1>

      {isLoading ? (
        <LoadingFigure />
      ) : summary.remainingCalories === null ? (
        <NoGoal consumedCalories={summary.consumedCalories} goalAction={goalAction} />
      ) : (
        <WithGoal summary={summary} goalAction={goalAction} />
      )}
    </section>
  );
}

/** The hero number, in the one size and weight the whole screen is built around. */
function Figure({ value, unit, tone }: { value: string; unit: string; tone: string }) {
  return (
    <p className="mt-2.5 flex items-baseline gap-2">
      <span
        className={`numeric text-[4.25rem] leading-[0.92] font-semibold ${tone}`}
      >
        {value}
      </span>
      <span className={`text-[1.375rem] font-medium ${tone}`}>{unit}</span>
    </p>
  );
}

function LoadingFigure() {
  return (
    <>
      <div className="mt-3.5 h-[3.9rem] w-40 rounded-xl bg-raised" aria-hidden="true" />
      <div className="mt-3 h-[1.125rem] w-20 rounded-md bg-raised" aria-hidden="true" />
      <p className="sr-only">불러오는 중</p>
    </>
  );
}

function NoGoal({
  consumedCalories,
  goalAction,
}: {
  consumedCalories: number;
  goalAction?: ReactNode;
}) {
  return (
    <>
      <Figure
        value={numberFormat.format(consumedCalories)}
        unit="kcal"
        tone="text-ink"
      />
      <p className="mt-2 text-[1.0625rem] text-ink-soft">먹었어요</p>

      <div className="mt-7 rounded-2xl bg-raised px-4 py-3.5">
        {/* break-keep so Korean wraps between words, not after 알려드려. */}
        <p className="text-sm break-keep text-ink-soft">
          목표를 정하면 남은 칼로리를 알려드려요.
        </p>
        {goalAction !== undefined && <div className="mt-2.5">{goalAction}</div>}
      </div>
    </>
  );
}

function WithGoal({
  summary,
  goalAction,
}: {
  summary: DailySummary;
  goalAction?: ReactNode;
}) {
  const { consumedCalories, calorieTarget, remainingCalories } = summary;
  if (calorieTarget === null || remainingCalories === null) return null;

  const remaining = describeRemaining(remainingCalories);
  const tone = remaining.isOver ? "text-accent" : "text-ink";
  const progress =
    calorieTarget > 0 ? Math.min(consumedCalories / calorieTarget, 1) * 100 : 0;

  return (
    <>
      <Figure
        value={numberFormat.format(remaining.amount)}
        unit="kcal"
        tone={tone}
      />
      <p
        className={`mt-2 text-[1.0625rem] ${
          remaining.isOver ? "text-accent" : "text-ink-soft"
        }`}
      >
        {remaining.caption}
      </p>

      {/* The numbers under it say the same thing; announcing the bar is noise. */}
      <div
        aria-hidden="true"
        className="mt-7 h-1 w-full overflow-hidden rounded-full bg-line"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-out ${
            remaining.isOver ? "bg-accent-soft" : "bg-ink"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <p className="numeric text-[0.8125rem] text-ink-soft">
          {numberFormat.format(consumedCalories)} /{" "}
          {numberFormat.format(calorieTarget)} kcal
        </p>
        {goalAction}
      </div>
    </>
  );
}
