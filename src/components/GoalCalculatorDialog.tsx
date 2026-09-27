"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  ACTIVITY_LEVELS,
  GOAL_MODES,
  PROFILE_BOUNDS,
  invalidFields,
  isAdoptable,
  optionFor,
  planFor,
  type ActivityLevel,
  type BodyFacts,
  type DietProfile,
  type GoalMode,
  type ProfileField,
  type Sex,
} from "@/domain/dietProfile";

const numberFormat = new Intl.NumberFormat("ko-KR");

export const PRIVACY_NOTICE =
  "입력한 정보는 이 기기에만 저장되며 서버에 전송되지 않습니다. 다른 기기와 자동으로 공유되지 않습니다.";

const ACTIVITY_LABELS: Record<ActivityLevel, { label: string; hint: string }> = {
  sedentary: { label: "거의 앉아서 지내요", hint: "운동은 거의 안 해요" },
  light: { label: "가볍게 움직여요", hint: "주 1~3회 운동" },
  moderate: { label: "꽤 움직여요", hint: "주 3~5회 운동" },
  active: { label: "많이 움직여요", hint: "주 6~7회 운동" },
};

/** Deliberately mild. "빠르게" is as far as the copy goes. */
const MODE_LABELS: Record<GoalMode, { label: string; hint: string }> = {
  maintenance: { label: "유지", hint: "지금 체중 유지" },
  moderate_loss: { label: "천천히 감량", hint: "하루 300 kcal 적게" },
  fast_loss: { label: "빠르게 감량", hint: "하루 700 kcal 적게" },
};

const FIELD_LABELS: Record<ProfileField, { label: string; unit: string }> = {
  weightKg: { label: "몸무게", unit: "kg" },
  heightCm: { label: "키", unit: "cm" },
  age: { label: "나이", unit: "세" },
};

export type CalculatorStep = "intro" | "form";

type Props = {
  /** Null keeps the dialog closed. */
  step: CalculatorStep | null;
  /** Prefills the form, so reopening is an edit rather than a re-entry. */
  savedProfile: DietProfile | null;
  onStart: () => void;
  /** "직접 입력할게요" — the manual field should open next. */
  onChooseManual: () => void;
  /** Closed without choosing: ESC, the close button, or 닫기. */
  onDismiss: () => void;
  /** The target is recomputed by the use case; only the choice goes up. */
  onAccept: (facts: BodyFacts, mode: GoalMode) => Promise<boolean>;
  onForget: () => void;
};

type Draft = Record<ProfileField, string> & {
  sex: Sex | null;
  activityLevel: ActivityLevel | null;
  goalMode: GoalMode | null;
};

function draftFrom(profile: DietProfile | null): Draft {
  if (profile === null) {
    return { weightKg: "", heightCm: "", age: "", sex: null, activityLevel: null, goalMode: null };
  }
  return {
    weightKg: String(profile.weightKg),
    heightCm: String(profile.heightCm),
    age: String(profile.age),
    sex: profile.sex,
    activityLevel: profile.activityLevel,
    goalMode: profile.goalMode,
  };
}

/** The facts, once every field holds a usable value. */
function factsFrom(draft: Draft): BodyFacts | null {
  if (draft.sex === null || draft.activityLevel === null) return null;
  const facts: BodyFacts = {
    weightKg: Number(draft.weightKg),
    heightCm: Number(draft.heightCm),
    age: Number(draft.age),
    sex: draft.sex,
    activityLevel: draft.activityLevel,
  };
  if (draft.weightKg === "" || draft.heightCm === "" || draft.age === "") return null;
  if (!Number.isInteger(facts.age)) return null;
  return invalidFields(facts).length === 0 ? facts : null;
}

/**
 * The goal calculator, in a native `<dialog>`.
 *
 * Native because it brings the parts that are easy to get wrong for free: a
 * modal that makes the page behind it inert, ESC to close, focus moved in on
 * open and handed back on close. Nothing else on the screen is a modal, so a
 * component library would be a lot of weight for one.
 *
 * Two steps. The first is only ever shown on a first visit, and it is a
 * question, not a form: someone who knows their number should be one tap from
 * typing it. The second is the calculator, reachable any time from the goal
 * control.
 */
export function GoalCalculatorDialog({
  step,
  savedProfile,
  onStart,
  onChooseManual,
  onDismiss,
  onAccept,
  onForget,
}: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  // Open and close follow the prop. `showModal` is what makes it modal —
  // setting `open` directly would leave the page behind it interactive.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    if (step !== null && !dialog.open) dialog.showModal();
    if (step === null && dialog.open) dialog.close();
  }, [step]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      // ESC and the form's own close both land here; the parent decides what
      // closing means for this step.
      onClose={() => {
        if (step !== null) onDismiss();
      }}
      className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[26rem] overflow-y-auto rounded-3xl bg-surface p-0 text-ink shadow-[0_24px_60px_-20px_rgba(27,25,23,0.45)] backdrop:bg-ink/35"
    >
      {step === "intro" && (
        <IntroStep
          titleId={titleId}
          onStart={onStart}
          onChooseManual={onChooseManual}
        />
      )}
      {step === "form" && (
        <FormStep
          // Remounted per opening so a cancelled edit does not linger.
          key={savedProfile?.updatedAt ?? "new"}
          titleId={titleId}
          savedProfile={savedProfile}
          onDismiss={onDismiss}
          onAccept={onAccept}
          onForget={onForget}
        />
      )}
    </dialog>
  );
}

function PrivacyNote() {
  return (
    <p className="rounded-2xl bg-raised px-4 py-3 text-[0.8125rem] leading-relaxed break-keep text-ink-soft">
      {PRIVACY_NOTICE}
    </p>
  );
}

function IntroStep({
  titleId,
  onStart,
  onChooseManual,
}: {
  titleId: string;
  onStart: () => void;
  onChooseManual: () => void;
}) {
  return (
    <div className="px-6 pt-7 pb-6">
      <h2 id={titleId} className="text-[1.1875rem] font-semibold break-keep">
        하루 목표를 대략 계산해 볼까요?
      </h2>
      <p className="mt-2.5 text-[0.9375rem] leading-relaxed break-keep text-ink-soft">
        몸무게·키·나이·활동량으로 예상 유지 칼로리를 계산해 드려요. 이미 정한 목표가
        있으면 바로 입력해도 돼요.
      </p>

      <div className="mt-5">
        <PrivacyNote />
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <button
          type="button"
          onClick={onStart}
          autoFocus
          className="h-12 rounded-full bg-ink px-5 text-[0.9375rem] font-medium text-surface focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none"
        >
          계산하기
        </button>
        <button
          type="button"
          onClick={onChooseManual}
          className="h-12 rounded-full border border-line-strong px-5 text-[0.9375rem] text-ink transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
        >
          직접 입력할게요
        </button>
      </div>
    </div>
  );
}

function FormStep({
  titleId,
  savedProfile,
  onDismiss,
  onAccept,
  onForget,
}: {
  titleId: string;
  savedProfile: DietProfile | null;
  onDismiss: () => void;
  onAccept: Props["onAccept"];
  onForget: () => void;
}) {
  const baseId = useId();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(savedProfile));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const facts = factsFrom(draft);
  const plan = facts === null ? null : planFor(facts);
  const chosen =
    plan === null || draft.goalMode === null ? null : optionFor(plan, draft.goalMode);
  const canAccept = facts !== null && chosen !== null && isAdoptable(chosen) && !isSaving;

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((current) => ({ ...current, [key]: value }));
    setError(null);
  }

  /** Out of range, but only once something has been typed. */
  function fieldError(field: ProfileField): string | null {
    const raw = draft[field];
    if (raw === "") return null;
    const value = Number(raw);
    const { min, max } = PROFILE_BOUNDS[field];
    const badAge = field === "age" && !Number.isInteger(value);
    if (!Number.isFinite(value) || value < min || value > max || badAge) {
      return `${min}~${max}${FIELD_LABELS[field].unit} 사이로 입력해주세요.`;
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canAccept || facts === null || chosen === null) return;

    setIsSaving(true);
    const ok = await onAccept(facts, chosen.mode);
    setIsSaving(false);
    if (!ok) setError("목표를 저장하지 못했어요. 다시 시도해주세요.");
  }

  return (
    <form onSubmit={handleSubmit} className="px-6 pt-7 pb-6" noValidate>
      <div className="flex items-start justify-between gap-3">
        <h2 id={titleId} className="text-[1.1875rem] font-semibold break-keep">
          하루 목표 계산
        </h2>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="닫기"
          className="-m-2 shrink-0 rounded-full p-2 text-ink-soft transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
        >
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-2.5">
        {(Object.keys(FIELD_LABELS) as ProfileField[]).map((field, index) => {
          const id = `${baseId}-${field}`;
          const message = fieldError(field);
          return (
            <div key={field} className="min-w-0">
              <label htmlFor={id} className="text-[0.8125rem] text-ink-soft">
                {FIELD_LABELS[field].label}
              </label>
              <div className="mt-1.5 flex h-11 items-center rounded-xl border border-line-strong bg-surface px-3 focus-within:border-ink">
                <input
                  id={id}
                  type="text"
                  inputMode={field === "weightKg" ? "decimal" : "numeric"}
                  autoComplete="off"
                  // The first field takes focus when the form opens.
                  autoFocus={index === 0}
                  value={draft[field]}
                  onChange={(event) => {
                    const cleaned =
                      field === "weightKg"
                        ? event.target.value.replace(/[^\d.]/g, "").replace(/(\..*)\./g, "$1")
                        : event.target.value.replace(/\D/g, "");
                    update(field, cleaned.slice(0, 5));
                  }}
                  aria-invalid={message !== null}
                  aria-describedby={message === null ? undefined : `${id}-error`}
                  className="numeric w-full min-w-0 bg-transparent text-base text-ink focus-visible:outline-none"
                />
                <span className="shrink-0 pl-1 text-[0.8125rem] text-ink-soft">
                  {FIELD_LABELS[field].unit}
                </span>
              </div>
              {message !== null && (
                <p id={`${id}-error`} className="mt-1 text-[0.75rem] break-keep text-accent">
                  {message}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <fieldset className="mt-5">
        <legend className="text-[0.8125rem] text-ink-soft">성별</legend>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          {(
            [
              ["female", "여성"],
              ["male", "남성"],
            ] as const
          ).map(([value, label]) => (
            <Choice
              key={value}
              name={`${baseId}-sex`}
              checked={draft.sex === value}
              onChange={() => update("sex", value)}
              label={label}
            />
          ))}
        </div>
      </fieldset>

      <fieldset className="mt-5">
        <legend className="text-[0.8125rem] text-ink-soft">평소 활동량</legend>
        <div className="mt-1.5 grid gap-2">
          {ACTIVITY_LEVELS.map((level) => (
            <Choice
              key={level}
              name={`${baseId}-activity`}
              checked={draft.activityLevel === level}
              onChange={() => update("activityLevel", level)}
              label={ACTIVITY_LABELS[level].label}
              hint={ACTIVITY_LABELS[level].hint}
            />
          ))}
        </div>
      </fieldset>

      {plan !== null && (
        <section aria-live="polite" className="mt-6 border-t border-line pt-5">
          <p className="text-[0.8125rem] text-ink-soft">예상 유지 칼로리</p>
          <p className="mt-1 flex items-baseline gap-1.5">
            <span className="text-[0.9375rem] text-ink-soft">약</span>
            <span className="numeric text-[1.75rem] font-semibold">
              {numberFormat.format(plan.maintenance)}
            </span>
            <span className="text-[0.9375rem] text-ink-soft">kcal</span>
          </p>
          <p className="mt-1 text-[0.75rem] leading-relaxed break-keep text-ink-soft">
            공식(Mifflin-St Jeor)으로 계산한 추정치예요. 실제 필요량과는 다를 수 있어요.
          </p>

          <fieldset className="mt-5">
            <legend className="text-[0.8125rem] text-ink-soft">목표</legend>
            <div className="mt-1.5 grid gap-2">
              {GOAL_MODES.map((mode) => {
                const option = optionFor(plan, mode);
                const target = `${numberFormat.format(option.target)} kcal`;
                // Worded as what the app does, not as what is safe: the
                // number is a conservative suggestion guardrail, not a
                // medical cutoff.
                const hint = option.belowFloor
                  ? `${target} — 앱이 자동으로 제안하지 않는 범위예요`
                  : option.outOfRange
                    ? `${target} — 목표로 입력할 수 있는 범위를 벗어나요`
                    : MODE_LABELS[mode].hint;
                return (
                  <Choice
                    key={mode}
                    name={`${baseId}-mode`}
                    checked={draft.goalMode === mode}
                    disabled={!isAdoptable(option)}
                    onChange={() => update("goalMode", mode)}
                    label={MODE_LABELS[mode].label}
                    hint={hint}
                    trailing={isAdoptable(option) ? target : undefined}
                  />
                );
              })}
            </div>
          </fieldset>

          {plan.options.some((option) => option.belowFloor) && (
            <p className="mt-2.5 text-[0.75rem] leading-relaxed break-keep text-ink-soft">
              {numberFormat.format(plan.floor)} kcal 미만은 자동으로 제안하지 않아요. 원하는
              목표는 직접 입력할 수 있어요.
            </p>
          )}
        </section>
      )}

      <div className="mt-6">
        <PrivacyNote />
      </div>

      {error !== null && (
        <p role="alert" className="mt-3 text-sm text-accent">
          {error}
        </p>
      )}

      <div className="mt-5 flex flex-col gap-2">
        <button
          type="submit"
          disabled={!canAccept}
          className="h-12 rounded-full bg-ink px-5 text-[0.9375rem] font-medium text-surface transition-opacity focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:outline-none disabled:opacity-25"
        >
          {chosen === null || !isAdoptable(chosen)
            ? "목표를 골라주세요"
            : `${numberFormat.format(chosen.target)} kcal로 정하기`}
        </button>
        {savedProfile !== null && (
          <button
            type="button"
            onClick={onForget}
            className="h-11 rounded-full px-5 text-[0.8125rem] text-ink-soft underline decoration-line-strong underline-offset-[3px] transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-ink focus-visible:outline-none"
          >
            저장된 신체 정보 지우기
          </button>
        )}
      </div>
    </form>
  );
}

function Choice({
  name,
  checked,
  disabled = false,
  onChange,
  label,
  hint,
  trailing,
}: {
  name: string;
  checked: boolean;
  disabled?: boolean;
  onChange: () => void;
  label: string;
  hint?: string;
  trailing?: string;
}) {
  return (
    <label
      className={`flex min-h-11 items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ink ${
        disabled
          ? "cursor-not-allowed border-line bg-raised"
          : checked
            ? "cursor-pointer border-ink bg-surface"
            : "cursor-pointer border-line-strong bg-surface hover:bg-raised"
      }`}
    >
      <input
        type="radio"
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={onChange}
        className="sr-only"
      />
      <span
        aria-hidden="true"
        className={`h-4 w-4 shrink-0 rounded-full border ${
          checked ? "border-[5px] border-ink" : "border-line-strong"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className={`block text-[0.9375rem] ${disabled ? "text-ink-soft" : "text-ink"}`}>
          {label}
        </span>
        {hint !== undefined && (
          <span className="block text-[0.75rem] break-keep text-ink-soft">{hint}</span>
        )}
      </span>
      {trailing !== undefined && (
        <span className="numeric shrink-0 text-[0.875rem] text-ink">{trailing}</span>
      )}
    </label>
  );
}
