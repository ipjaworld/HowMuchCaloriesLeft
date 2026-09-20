import {
  MEAL_LABELS,
  MEAL_TYPES,
  type MockMealGroup,
} from "@/mocks/phase2";

const numberFormat = new Intl.NumberFormat("ko-KR");

type Props = {
  meals: MockMealGroup[];
};

export function MealList({ meals }: Props) {
  const groups = MEAL_TYPES.map((mealType) =>
    meals.find((group) => group.mealType === mealType),
  ).filter(
    (group): group is MockMealGroup =>
      group !== undefined && group.items.length > 0,
  );

  if (groups.length === 0) {
    return (
      <section aria-labelledby="meals-heading" className="px-5">
        <h2 id="meals-heading" className="sr-only">
          오늘 먹은 것
        </h2>
        <p className="py-8 text-sm text-neutral-500">
          아직 기록이 없어요.
        </p>
      </section>
    );
  }

  return (
    <section aria-labelledby="meals-heading" className="px-5">
      <h2 id="meals-heading" className="sr-only">
        오늘 먹은 것
      </h2>

      <div className="divide-y divide-neutral-100 border-t border-neutral-100">
        {groups.map((group) => (
          <div key={group.mealType} className="py-4">
            <h3 className="text-xs font-medium tracking-wide text-neutral-500">
              {MEAL_LABELS[group.mealType]}
            </h3>

            <ul className="mt-2 space-y-1.5">
              {group.items.map((item) => (
                <li key={item.id} className="flex items-baseline gap-3">
                  <span className="min-w-0 flex-1 break-keep text-[0.9375rem] text-neutral-800 [overflow-wrap:anywhere]">
                    {item.name}
                    {item.amount !== undefined && (
                      <span className="text-neutral-500"> {item.amount}</span>
                    )}
                  </span>
                  <span className="shrink-0 text-sm text-neutral-500 tabular-nums">
                    {numberFormat.format(item.calories)} kcal
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
