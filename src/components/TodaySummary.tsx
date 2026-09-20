const numberFormat = new Intl.NumberFormat("ko-KR");

type RemainingDisplay = {
  state: "under" | "exact" | "over";
  /** Always non-negative. "-140 kcal 남았어요" is not a sentence anyone wants. */
  amount: number;
  caption: string;
};

/**
 * Display formatting only. The real calculation moves to the domain layer in
 * Phase 3; this function just decides how a number is worded.
 */
export function formatRemaining(
  consumedCalories: number,
  dailyGoalCalories: number,
): RemainingDisplay {
  const remaining = dailyGoalCalories - consumedCalories;

  if (remaining > 0) {
    return { state: "under", amount: remaining, caption: "남았어요" };
  }
  if (remaining === 0) {
    return { state: "exact", amount: 0, caption: "딱 맞췄어요" };
  }
  return { state: "over", amount: -remaining, caption: "더 먹었어요" };
}

type Props = {
  consumedCalories: number;
  dailyGoalCalories: number;
};

export function TodaySummary({ consumedCalories, dailyGoalCalories }: Props) {
  const remaining = formatRemaining(consumedCalories, dailyGoalCalories);
  const isOver = remaining.state === "over";

  const progress =
    dailyGoalCalories > 0
      ? Math.min(consumedCalories / dailyGoalCalories, 1) * 100
      : 0;

  return (
    <section aria-labelledby="today-heading" className="px-5 pt-8 pb-6">
      <h1 id="today-heading" className="text-sm font-medium text-neutral-500">
        오늘
      </h1>

      <p className="mt-2 flex items-baseline gap-1.5">
        <span
          className={`text-6xl leading-none font-semibold tracking-tight tabular-nums ${
            isOver ? "text-amber-700" : "text-neutral-900"
          }`}
        >
          {numberFormat.format(remaining.amount)}
        </span>
        <span
          className={`text-2xl font-medium ${
            isOver ? "text-amber-700" : "text-neutral-900"
          }`}
        >
          kcal
        </span>
      </p>

      <p
        className={`mt-1.5 text-lg ${
          isOver ? "text-amber-700" : "text-neutral-700"
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
            isOver ? "bg-amber-500" : "bg-neutral-900"
          }`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="mt-2 text-sm text-neutral-500 tabular-nums">
        {numberFormat.format(consumedCalories)} /{" "}
        {numberFormat.format(dailyGoalCalories)} kcal
      </p>
    </section>
  );
}
