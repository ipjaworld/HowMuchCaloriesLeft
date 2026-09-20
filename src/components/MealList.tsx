import { MEAL_TYPES, type FoodItem, type MealRecord, type MealType } from "@/domain/meal";

const numberFormat = new Intl.NumberFormat("ko-KR");

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "아침",
  lunch: "점심",
  dinner: "저녁",
  snack: "간식",
};

/** Records with no meal type still have to appear somewhere. */
const UNLABELLED = "그 외";

type Group = { label: string; items: FoodItem[] };

/**
 * Groups by meal type in day order, with untyped records collected at the
 * end. Read-only on purpose: editing happens by talking to the app, so no
 * edit or delete buttons live here.
 */
function groupItems(records: MealRecord[]): Group[] {
  const byMealType = new Map<string, FoodItem[]>();

  for (const record of records) {
    const key = record.mealType ?? UNLABELLED;
    const bucket = byMealType.get(key) ?? [];
    bucket.push(...record.items);
    byMealType.set(key, bucket);
  }

  const ordered: Group[] = [];
  for (const mealType of MEAL_TYPES) {
    const items = byMealType.get(mealType);
    if (items !== undefined && items.length > 0) {
      ordered.push({ label: MEAL_LABELS[mealType], items });
    }
  }

  const rest = byMealType.get(UNLABELLED);
  if (rest !== undefined && rest.length > 0) {
    ordered.push({ label: UNLABELLED, items: rest });
  }

  return ordered;
}

type Props = {
  records: MealRecord[];
  isLoading?: boolean;
};

export function MealList({ records, isLoading = false }: Props) {
  const groups = isLoading ? [] : groupItems(records);

  return (
    <section aria-labelledby="meals-heading" className="px-5">
      <h2 id="meals-heading" className="sr-only">
        오늘 먹은 것
      </h2>

      {isLoading ? null : groups.length === 0 ? (
        <p className="py-8 text-sm text-neutral-500">아직 기록이 없어요.</p>
      ) : (
        <div className="divide-y divide-neutral-100 border-t border-neutral-100">
          {groups.map((group) => (
            <div key={group.label} className="py-4">
              <h3 className="text-xs font-medium tracking-wide text-neutral-500">
                {group.label}
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
                      {item.caloriesEstimated && (
                        <span aria-label="추정값" title="추정값">
                          ~
                        </span>
                      )}
                      {numberFormat.format(item.calories)} kcal
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
