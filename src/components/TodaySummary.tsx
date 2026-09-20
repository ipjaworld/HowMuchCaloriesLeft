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
    <section aria-labelledby="today-heading" className="px-5 pt-8 pb-6">
      <h1 id="today-heading" className="text-sm font-medium text-neutral-500">
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

function LoadingFigure() {
  return (
    <>
      <p className="mt-2 flex items-baseline gap-1.5" aria-hidden="true">
        <span className="text-6xl leading-none font-semibold tracking-tight text-neutral-200">
          &mdash;
        </span>
        <span className="text-2xl font-medium text-neutral-200">kcal</span>
      </p>
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
      <p className="mt-2 flex items-baseline gap-1.5">
        <span className="text-6xl leading-none font-semibold tracking-tight text-neutral-900 tabular-nums">
          {numberFormat.format(consumedCalories)}
        </span>
        <span className="text-2xl font-medium text-neutral-900">kcal</span>
      </p>

      <p className="mt-1.5 text-lg text-neutral-700">먹었어요</p>

      <p className="mt-4 text-sm text-neutral-500">
        목표를 정하면 얼마나 더 먹을 수 있는지 알려드려요.
      </p>

      {goalAction !== undefined && <div className="mt-3">{goalAction}</div>}
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
  const progress =
    calorieTarget > 0
      ? Math.min(consumedCalories / calorieTarget, 1) * 100
      : 0;

  return (
    <>
      <p className="mt-2 flex items-baseline gap-1.5">
        <span
          className={`text-6xl leading-none font-semibold tracking-tight tabular-nums ${
            remaining.isOver ? "text-amber-700" : "text-neutral-900"
          }`}
        >
          {numberFormat.format(remaining.amount)}
        </span>
        <span
          className={`text-2xl font-medium ${
            remaining.isOver ? "text-amber-700" : "text-neutral-900"
          }`}
        >
          kcal
        </span>
      </p>

      <p
        className={`mt-1.5 text-lg ${
          remaining.isOver ? "text-amber-700" : "text-neutral-700"
        }`}
      >
        {remaining.caption}
      </p>

      {/* The numbers below say the same thing; announcing the bar too is noise. */}
      <div
        aria-hidden="true"
        className="mt-5 h-1.5 w-full overflow-hidden rounded-full bg-neutral-200"
      >
        <div
          className={`h-full rounded-full ${
            remaining.isOver ? "bg-amber-500" : "bg-neutral-900"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-3">
        <p className="text-sm text-neutral-500 tabular-nums">
          {numberFormat.format(consumedCalories)} /{" "}
          {numberFormat.format(calorieTarget)} kcal
        </p>
        {goalAction}
      </div>
    </>
  );
}
