"use client";

import { useEffect, useMemo, useState } from "react";
import type { Intent, RecentItem } from "@/ai/judgment/types";
import {
  isSameAs,
  isSettled,
  namesASubstitution,
  itemsOf,
  preferTargetFood,
  type AddPart,
} from "@/application/addFood";
import { setDailyGoal, type SetDailyGoalResult } from "@/application/dailyGoal";
import { locateItem, removeFoodItem, replaceFoodItem } from "@/application/editFood";
import { addMealRecord } from "@/application/mealRecords";
import {
  answerChoice,
  answerQuantity,
  confirmAdd,
  isCancelMessage,
  isComplete,
  nextQuestion,
  type PendingAdd,
} from "@/application/pendingAdd";
import { summarizeDay } from "@/domain/calories";
import { todayKey } from "@/domain/date";
import type { MealRecord } from "@/domain/meal";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { createLocalStorageMealRecordRepository } from "@/infrastructure/localStorageMealRecordRepository";
import { ChatInput } from "./ChatInput";
import { GoalEditor } from "./GoalEditor";
import { MealList } from "./MealList";
import { TodaySummary } from "./TodaySummary";
import {
  describeAddFailure,
  describeAdded,
  describeAskAmount,
  describeCancelled,
  describeCommand,
  describeDeleted,
  describeModified,
  describeNothingAdded,
  describeQuestion,
  describeTargetGone,
  describeUnreadableAmount,
  type ClarifyOption,
  type Reply,
} from "./replyText";
import type { ChatResponse } from "@/app/api/chat/schema";
import type { ResolveResponse } from "@/app/api/resolve/route";

type State =
  | { status: "loading" }
  | {
      status: "ready";
      dateKey: string;
      records: MealRecord[];
      calorieTarget: number | null;
    };

/** What a clarifying question is waiting on, so an answer can be resolved here. */
type PendingClarification = {
  intent: Intent;
  candidates: { id: string; name: string }[];
};

/** The judge only needs the items, flattened, with their record's context. */
function toRecentItems(records: MealRecord[]): RecentItem[] {
  return records.flatMap((record) =>
    record.items.map((item) => ({
      id: item.id,
      name: item.name,
      ...(item.amount === undefined ? {} : { amount: item.amount }),
      calories: item.calories,
      ...(record.mealType === undefined ? {} : { mealType: record.mealType }),
      consumedAt: record.consumedAt,
    })),
  );
}

/**
 * The single client boundary.
 *
 * Hydration strategy: the server cannot see `localStorage`, and the browser's
 * timezone decides which day "today" is — so neither the records nor the date
 * key can be rendered on the server. Rather than guess and patch up a
 * mismatch, the first render is an explicit `loading` state that the server
 * and the client both produce identically; the effect below then reads
 * storage and fills it in. One frame, no `suppressHydrationWarning`, and
 * nothing above this component has to become a client component.
 */
export function TodayScreen() {
  const repositories = useMemo(
    () => ({
      meals: createLocalStorageMealRecordRepository(),
      goals: createLocalStorageDailyGoalRepository(),
    }),
    [],
  );

  const [state, setState] = useState<State>({ status: "loading" });
  const [reply, setReply] = useState<Reply | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [clarification, setClarification] =
    useState<PendingClarification | null>(null);
  /**
   * An "I ate ..." sentence that could not be finished in one turn. While it
   * is set, the next thing the user types is read as an answer to the open
   * question rather than as a new request — which is what keeps "200ml" from
   * being sent to Jev as a standalone message.
   */
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Computed here, not during render: on the server this would be the
      // server's timezone, which is not the user's day.
      const dateKey = todayKey();
      const [records, goal] = await Promise.all([
        repositories.meals.getByDate(dateKey),
        repositories.goals.get(dateKey),
      ]);

      if (cancelled) return;
      setState({
        status: "ready",
        dateKey,
        records,
        calorieTarget: goal?.calorieTarget ?? null,
      });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  const isLoading = state.status === "loading";
  const records = state.status === "ready" ? state.records : [];
  const summary = summarizeDay(
    records,
    state.status === "ready" ? state.calorieTarget : null,
  );

  /**
   * Writes one record for one sentence and re-reads the day.
   *
   * Re-reading rather than appending in memory: the repository is the owner,
   * and the summary the reply quotes has to be the stored truth, not an
   * optimistic guess about it.
   */
  async function commitAdd(pending: PendingAdd): Promise<void> {
    const items = itemsOf(pending.parts);
    const skipped = pending.parts
      .filter((part) => part.status === "unknown")
      .map((part) => part.phraseName);

    if (items.length === 0) {
      setReply(describeNothingAdded(pending.parts));
      return;
    }

    await addMealRecord(repositories.meals, {
      sourceText: pending.sourceText,
      items,
      consumedAt: pending.now,
      // No meal-type inference in this phase: guessing 점심 from a clock is a
      // rule nobody asked for, and the list already reads fine without it.
    });

    setReply(describeAdded(await reloadDay(), skipped));
  }

  /**
   * Re-reads the day from storage and returns the fresh summary.
   *
   * Every write goes through here rather than patching React state, so the
   * number a reply quotes is the stored one. An optimistic total that drifts
   * from storage is exactly the bug this app cannot afford.
   */
  async function reloadDay() {
    const dateKey = state.status === "ready" ? state.dateKey : todayKey();
    const calorieTarget = state.status === "ready" ? state.calorieTarget : null;
    const records = await repositories.meals.getByDate(dateKey);
    setState({ status: "ready", dateKey, records, calorieTarget });
    return summarizeDay(records, calorieTarget);
  }

  /**
   * Parks a correction on "how much of it?".
   *
   * Used when the target was settled some other way than by the sentence —
   * the user picked it from a list, or the wording was grammar the phrase
   * parser cannot read. Either way the food is known and only the amount is
   * not, which is exactly the Phase 6A question.
   */
  function askAmountFor(itemId: string): void {
    const found = locateItem(records, itemId);
    if (found === null) {
      setReply(describeTargetGone());
      return;
    }

    setPendingAdd({
      sourceText: found.record.sourceText,
      now: new Date().toISOString(),
      needsConfirmation: false,
      target: { itemId, foodName: found.item.name },
      parts: [
        {
          status: "unmeasurable",
          phraseName: found.item.name,
          entries: [{ id: found.item.id, name: found.item.name }],
          reason: "missing_serving",
        },
      ],
    });
    setReply(describeAskAmount(found.item.name));
  }

  /** Takes one logged food off the day. */
  async function applyDelete(targetId: string): Promise<void> {
    const result = await removeFoodItem(repositories.meals, records, targetId);

    if (result.status === "not_found") {
      setReply(describeTargetGone());
      return;
    }

    setReply(describeDeleted(result.item.name, await reloadDay()));
  }

  /** Applies a finished correction to the item it was about. */
  async function commitModify(pending: PendingAdd): Promise<void> {
    const target = pending.target;
    if (target === undefined) return;

    const next = itemsOf(pending.parts)[0];
    if (next === undefined) {
      setReply(describeNothingAdded(pending.parts));
      return;
    }

    const result = await replaceFoodItem(
      repositories.meals,
      records,
      target.itemId,
      next,
    );

    if (result.status === "not_found") {
      setReply(describeTargetGone());
      return;
    }

    setReply(describeModified(next.name, await reloadDay()));
  }

  /** Either finishes the sentence or asks the next question. */
  async function advance(pending: PendingAdd): Promise<void> {
    if (isComplete(pending)) {
      setPendingAdd(null);
      // Same questions, same answers — only the ending differs.
      await (pending.target === undefined
        ? commitAdd(pending)
        : commitModify(pending));
      return;
    }

    const question = nextQuestion(pending);
    setPendingAdd(pending);
    if (question !== null) setReply(describeQuestion(question));
  }

  /** A follow-up amount for a food the dataset knows but cannot size. */
  async function handleQuantityAnswer(
    pending: PendingAdd,
    amountText: string,
  ): Promise<void> {
    const question = nextQuestion(pending);
    if (question === null || question.type !== "provide_quantity") return;

    const foodName = question.entries[0]?.name;
    if (foodName === undefined) return;

    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ foodName, amountText }),
    });

    if (!response.ok) {
      setReply(describeAddFailure());
      return;
    }

    const result = (await response.json()) as ResolveResponse;
    if (result.status !== "resolved") {
      // Still pending: the question stands, so the user can try again.
      setReply(describeUnreadableAmount());
      return;
    }

    await advance(answerQuantity(pending, question.partIndex, result.item));
  }

  async function handleSetGoal(
    calorieTarget: number,
  ): Promise<SetDailyGoalResult> {
    if (state.status !== "ready") {
      return { ok: false, reason: "invalid_date" };
    }

    const result = await setDailyGoal(
      repositories.goals,
      state.dateKey,
      calorieTarget,
    );
    if (result.ok) {
      setState({ ...state, calorieTarget: result.goal.calorieTarget });
    }
    return result;
  }

  async function handleMessage(message: string) {
    setIsPending(true);
    setReply(null);

    try {
      // An open question owns the next message. Sending "200ml" to the judge
      // would spend a round trip to be told it is `other`.
      if (pendingAdd !== null) {
        if (isCancelMessage(message)) {
          const mode = pendingAdd.target === undefined ? "add" : "modify";
          setPendingAdd(null);
          setReply(describeCancelled(mode));
          return;
        }

        const question = nextQuestion(pendingAdd);
        if (question?.type === "provide_quantity") {
          await handleQuantityAnswer(pendingAdd, message);
          return;
        }
        // A food choice is made with the chips, not by typing. Anything else
        // drops the pending sentence and is treated as a fresh one.
        setPendingAdd(null);
      }

      setClarification(null);
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          now: new Date().toISOString(),
          dailyGoalCalories: summary.calorieTarget,
          recentItems: toRecentItems(records),
        }),
      });

      if (!response.ok) {
        setReply({
          kind: "statement",
          text: "지금은 답하기 어려워요. 잠시 후 다시 시도해주세요.",
        });
        return;
      }

      const { command } = (await response.json()) as ChatResponse;

      if (command.type === "modify_candidate") {
        await startModify(
          command.targetId,
          command.sourceText,
          command.parts,
          command.needsConfirmation,
        );
        return;
      }

      if (command.type === "delete_candidate") {
        await applyDelete(command.targetId);
        return;
      }

      if (command.type === "add") {
        await startAdd(
          command.sourceText,
          command.parts,
          command.needsConfirmation,
        );
        return;
      }

      setReply(describeCommand(command, summary));

      if (command.type === "clarify" && command.candidates !== undefined) {
        setClarification({
          intent: command.intent,
          candidates: command.candidates.map(({ id, name }) => ({ id, name })),
        });
      }
    } catch {
      setReply({
        kind: "statement",
        text: "연결이 안 되네요. 잠시 후 다시 시도해주세요.",
      });
    } finally {
      setIsPending(false);
    }
  }

  /**
   * A correction runs the same pipeline as an add, then lands on one item.
   *
   * The only thing it adds is the target: knowing the entry is 쌀밥 collapses
   * the ambiguity in "밥 반만 먹었어" before anyone is asked about it. When the
   * re-priced result matches what is already stored, the sentence was one the
   * phrase parser could not read — so it asks for the amount rather than
   * reporting a change that did not happen.
   */
  async function startModify(
    targetId: string,
    sourceText: string,
    parts: AddPart[],
    needsConfirmation: boolean,
  ): Promise<void> {
    const found = locateItem(records, targetId);
    if (found === null) {
      setReply(describeTargetGone());
      return;
    }

    const narrowed = preferTargetFood(
      parts,
      found.item.name,
      namesASubstitution(sourceText),
    );

    const pending: PendingAdd = {
      sourceText,
      now: new Date().toISOString(),
      parts: narrowed,
      needsConfirmation,
      target: { itemId: targetId, foodName: found.item.name },
    };

    const only = itemsOf(narrowed)[0];
    const nothingChanged =
      isSettled(narrowed) && only !== undefined && isSameAs(only, found.item);

    if (narrowed.length === 0 || nothingChanged) {
      // The sentence was a correction the phrase parser cannot read. Rather
      // than guess at its grammar, ask for the amount.
      askAmountFor(targetId);
      return;
    }

    await advance(pending);
  }

  async function startAdd(
    sourceText: string,
    parts: AddPart[],
    needsConfirmation: boolean,
  ): Promise<void> {
    const pending: PendingAdd = {
      sourceText,
      now: new Date().toISOString(),
      parts,
      needsConfirmation,
    };

    // Nothing to ask and nothing to confirm: one sentence, one record.
    if (!needsConfirmation && isSettled(parts)) {
      await commitAdd(pending);
      return;
    }

    // A sentence with nothing storable in it is not worth confirming.
    if (needsConfirmation && itemsOf(parts).length === 0 && isSettled(parts)) {
      setReply(describeNothingAdded(parts));
      return;
    }

    await advance(pending);
  }

  /** Answered on the client — a confirmation is not worth a second round trip. */
  function handleChooseOption(option: ClarifyOption) {
    // Picking one of the candidate foods. Their calories were computed for
    // the amount the user already gave, so this is a selection and needs no
    // second round trip.
    if (pendingAdd !== null) {
      const question = nextQuestion(pendingAdd);

      if (question?.type === "confirm_add") {
        if (option.id === "yes") {
          void advance(confirmAdd(pendingAdd));
        } else {
          setPendingAdd(null);
          setReply(describeCancelled(question.mode));
        }
        return;
      }

      if (question?.type === "choose_food") {
        void advance(answerChoice(pendingAdd, question.partIndex, option.id));
        return;
      }
    }

    if (option.id === "no") {
      setReply({ kind: "statement", text: "알겠어요. 그대로 둘게요." });
      setClarification(null);
      return;
    }

    const intent = clarification?.intent;

    if (intent === "modify_food" || intent === "delete_food") {
      // "yes" answers a confirmation, which offered exactly one candidate;
      // any other id is a pick from the list of the day's entries.
      const chosen =
        option.id === "yes"
          ? clarification?.candidates[0]
          : clarification?.candidates.find(
              (candidate) => candidate.id === option.id,
            );

      if (chosen !== undefined) {
        setClarification(null);

        if (intent === "delete_food") {
          void applyDelete(chosen.id);
          return;
        }

        // The target is settled but the sentence that asked for the change is
        // gone, so the amount is the one thing still missing. Asking for it
        // reuses the same question the add pipeline asks.
        void askAmountFor(chosen.id);
        return;
      }
    }

    setReply(describeTargetGone());
    setClarification(null);
  }

  return (
    <>
      <TodaySummary
        summary={summary}
        isLoading={isLoading}
        goalAction={
          isLoading ? undefined : (
            <GoalEditor
              currentTarget={summary.calorieTarget}
              onSubmit={handleSetGoal}
            />
          )
        }
      />

      <div className="flex-1 pb-8">
        <MealList records={records} isLoading={isLoading} />
      </div>

      <ChatInput
        onSubmit={(message) => void handleMessage(message)}
        onChooseOption={handleChooseOption}
        reply={reply}
        // Also blocked while the day is still being read: until then `records`
        // is empty, and a delete or a status question answered against an
        // empty day is a wrong answer rather than a slow one.
        isPending={isPending || isLoading}
      />
    </>
  );
}
