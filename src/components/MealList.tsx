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

/**
 * A day's jotted notes, not a spreadsheet. No rules between rows, no repeated
 * "kcal" on every line — the figure above already established the unit, and
 * the number alone is what the eye is scanning for.
 */
export function MealList({ records, isLoading = false }: Props) {
  const groups = isLoading ? [] : groupItems(records);

  return (
    <section aria-labelledby="meals-heading" className="px-6">
      <h2 id="meals-heading" className="sr-only">
        오늘 먹은 것
      </h2>

      {isLoading ? (
        <LoadingRows />
      ) : groups.length === 0 ? (
        <p className="py-10 text-sm break-keep text-ink-soft">
          아직 기록이 없어요. 아래에 말해주시면 적어둘게요.
        </p>
      ) : (
        <div className="space-y-6 border-t border-line pt-5">
          {groups.map((group) => (
            <div key={group.label}>
              <h3 className="text-[0.75rem] font-medium tracking-[0.06em] text-ink-soft">
                {group.label}
              </h3>

              <ul className="mt-2.5 space-y-2">
                {group.items.map((item) => (
                  <li key={item.id} className="flex items-baseline gap-4">
                    <span className="min-w-0 flex-1 text-[0.9375rem] break-keep text-ink [overflow-wrap:anywhere]">
                      {item.name}
                      {item.amount !== undefined && (
                        <span className="text-ink-soft"> {item.amount}</span>
                      )}
                    </span>
                    <span className="numeric shrink-0 text-[0.8125rem] text-ink-soft">
                      {item.caloriesEstimated && (
                        <span title="추정값">~</span>
                      )}
                      {numberFormat.format(item.calories)}
                      <span className="sr-only"> kcal</span>
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

function LoadingRows() {
  return (
    <div className="space-y-3 border-t border-line pt-5" aria-hidden="true">
      {[70, 52, 60].map((width, index) => (
        <div key={index} className="flex items-center gap-4">
          <div
            className="h-3.5 rounded-md bg-raised"
            style={{ width: `${width}%` }}
          />
          <div className="ml-auto h-3.5 w-8 rounded-md bg-raised" />
        </div>
      ))}
    </div>
  );
}
