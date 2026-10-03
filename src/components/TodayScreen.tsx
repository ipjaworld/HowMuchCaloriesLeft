"use client";

import { useEffect, useMemo, useState } from "react";
import type { Intent } from "@/ai/judgment/types";
import { readAmountAnswer } from "@/ai/nutrition/quantity";
import { readCalorieAnswer } from "@/ai/nutrition/statedCalories";
import { isAllUnknown, isSettled, itemsOf, type AddPart } from "@/application/addFood";
import type { ChosenTarget } from "@/application/commands";
import { adoptCalculatedGoal, shouldOfferCalculator } from "@/application/calculatedGoal";
import { setDailyGoal, type SetDailyGoalResult } from "@/application/dailyGoal";
import {
  locateItem,
  removeFoodItem,
  replaceFoodItem,
  restoreFoodItem,
  type Removed,
} from "@/application/editFood";
import { addMealRecord } from "@/application/mealRecords";
import { planModifyStart } from "@/application/modifyFlow";
import {
  answerCalories,
  answerChoice,
  answerQuantity,
  confirmAdd,
  isCancelMessage,
  isComplete,
  isModifyPart,
  isSkipMessage,
  nextQuestion,
  planModifyCommit,
  skipUnknown,
  type PendingAdd,
} from "@/application/pendingAdd";
import { summarizeDay } from "@/domain/calories";
import { todayKey } from "@/domain/date";
import type { BodyFacts, DietProfile, GoalMode } from "@/domain/dietProfile";
import { isValidCalorieValue } from "@/domain/limits";
import type { MealRecord } from "@/domain/meal";
import { createLocalStorageDailyGoalRepository } from "@/infrastructure/localStorageDailyGoalRepository";
import { createLocalStorageDietProfileRepository } from "@/infrastructure/localStorageDietProfileRepository";
import { createLocalStorageMealRecordRepository } from "@/infrastructure/localStorageMealRecordRepository";
import { ChatInput } from "./ChatInput";
import { buildChatRequest } from "./chatRequest";
import { GoalCalculatorDialog, type CalculatorStep } from "./GoalCalculatorDialog";
import { GoalEditor } from "./GoalEditor";
import { MealList } from "./MealList";
import { TodaySummary } from "./TodaySummary";
import {
  describeAddFailure,
  describeAdded,
  describeAlreadyLogged,
  describeAskAmount,
  describeCaloriesWanted,
  describeCancelled,
  describeCommand,
  describeDeleted,
  describeModified,
  describeNoneOfThese,
  describeRestored,
  describeNothingAdded,
  describeQuestion,
  describeTargetGone,
  describeUnreadableAmount,
  NONE_OF_THESE,
  UNDO_DELETE,
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
  /**
   * The sentence that asked. A correction like "사과 두 개였어" is still the
   * answer once the user has picked which 사과 — so it is sent again rather
   * than thrown away and replaced by "how much?".
   */
  sourceText: string;
};

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
      // Body facts. Read and written here only; never part of a request.
      profile: createLocalStorageDietProfileRepository(),
    }),
    [],
  );

  const [state, setState] = useState<State>({ status: "loading" });
  const [reply, setReply] = useState<Reply | null>(null);
  const [isPending, setIsPending] = useState(false);
  const [clarification, setClarification] =
    useState<PendingClarification | null>(null);
  /** What the user last said, shown as their side of the exchange. */
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  /** The last delete, for as long as its 되돌리기 is on screen. */
  const [lastRemoved, setLastRemoved] = useState<Removed | null>(null);
  /**
   * An "I ate ..." sentence that could not be finished in one turn. While it
   * is set, the next thing the user types is read as an answer to the open
   * question rather than as a new request — which is what keeps "200ml" from
   * being sent to Jev as a standalone message.
   */
  const [pendingAdd, setPendingAdd] = useState<PendingAdd | null>(null);
  /** Which calculator step is showing, or null when it is closed. */
  const [calculator, setCalculator] = useState<CalculatorStep | null>(null);
  const [savedProfile, setSavedProfile] = useState<DietProfile | null>(null);
  /**
   * "직접 입력할게요" should land on the input, not on the button that opens
   * it. The key remounts the field open; the flag is one-shot, cleared as soon
   * as the field closes, so a later remount — the summary switching layout
   * once a goal exists — does not pop it open again.
   */
  const [manualGoalKey, setManualGoalKey] = useState(0);
  const [manualGoalRequested, setManualGoalRequested] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // Computed here, not during render: on the server this would be the
      // server's timezone, which is not the user's day.
      const dateKey = todayKey();
      const [records, goal, profile, promptSeen] = await Promise.all([
        repositories.meals.getByDate(dateKey),
        repositories.goals.get(dateKey),
        repositories.profile.get(),
        repositories.profile.hasSeenPrompt(),
      ]);

      if (cancelled) return;
      setState({
        status: "ready",
        dateKey,
        records,
        calorieTarget: goal?.calorieTarget ?? null,
      });
      setSavedProfile(profile);

      // First visit only: no goal, no profile, and the question never
      // answered. Anyone already using the app with a typed goal is not
      // interrupted by it.
      if (
        shouldOfferCalculator({
          hasGoal: goal !== null,
          hasProfile: profile !== null,
          promptSeen,
        })
      ) {
        setCalculator("intro");
      }
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
      .filter((part) => part.status === "unknown" || part.status === "skipped")
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

    const highVariance = items
      .filter((item) => item.calorieVariance === "high")
      .map((item) => item.name);

    setReply(describeAdded(await reloadDay(), skipped, highVariance));
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

    setLastRemoved(result);
    setReply(describeDeleted(result.item, await reloadDay()));
  }

  /**
   * The × on a row. Whatever was being asked is dropped first: the user has
   * moved on, and a pending correction may have been about this very row.
   */
  async function handleDeleteItem(itemId: string): Promise<void> {
    // A tap says nothing, so the exchange shows only the app's answer.
    setLastMessage(null);
    setPendingAdd(null);
    setClarification(null);
    setIsPending(true);
    try {
      await applyDelete(itemId);
    } finally {
      setIsPending(false);
    }
  }

  async function undoDelete(removed: Removed): Promise<void> {
    setLastRemoved(null);
    await restoreFoodItem(repositories.meals, records, removed);
    setReply(describeRestored(removed.item, await reloadDay()));
  }

  /**
   * Applies a finished correction to the item it was about, and adds
   * whatever else the sentence settled. Nothing settled is discarded.
   */
  async function commitModify(pending: PendingAdd): Promise<void> {
    const target = pending.target;
    if (target === undefined) return;

    const { replacement, additions, skipped } = planModifyCommit(pending);

    // The correction itself was skipped; what the sentence added still stands.
    if (replacement === null) {
      if (additions.length === 0) {
        setReply(describeNothingAdded(pending.parts));
        return;
      }
      await commitAdd({ ...pending, target: undefined, parts: pending.parts.filter((_, index) => !isModifyPart(pending, index)) });
      return;
    }

    const before = locateItem(records, target.itemId)?.item;
    const result = await replaceFoodItem(
      repositories.meals,
      records,
      target.itemId,
      replacement,
    );

    if (result.status === "not_found") {
      setReply(describeTargetGone());
      return;
    }

    if (additions.length > 0) {
      await addMealRecord(repositories.meals, {
        sourceText: pending.sourceText,
        items: additions,
        consumedAt: pending.now,
      });
    }

    const summaryAfter = await reloadDay();
    setReply(
      describeModified(before ?? replacement, replacement, summaryAfter, additions, skipped),
    );
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

  /**
   * A follow-up amount for a food the dataset knows but cannot size. Returns
   * false when it was not an amount at all, so the caller can read it as a
   * new sentence — the same rule as `handleCalorieAnswer`.
   */
  async function handleQuantityAnswer(
    pending: PendingAdd,
    amountText: string,
  ): Promise<boolean> {
    const question = nextQuestion(pending);
    if (question === null || question.type !== "provide_quantity") return false;

    // "몰라" has no amount but is still about the question, so it stands.
    if (isSkipMessage(amountText)) {
      setReply(describeUnreadableAmount());
      return true;
    }
    if (readAmountAnswer(amountText) === null) return false;

    const foodName = question.entries[0]?.name;
    if (foodName === undefined) return false;

    const response = await fetch("/api/resolve", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ foodName, amountText }),
    });

    if (!response.ok) {
      setReply(describeAddFailure());
      return true;
    }

    const result = (await response.json()) as ResolveResponse;
    if (result.status !== "resolved") {
      // Still pending: the question stands, so the user can try again.
      setReply(describeUnreadableAmount());
      return true;
    }

    await advance(answerQuantity(pending, question.partIndex, result.item));
    return true;
  }

  /**
   * A reply to "대략 몇 kcal였나요?". Returns false when it was not an answer
   * at all, so the caller can read it as a new sentence instead — someone
   * who types "김밥 먹었어" here has moved on, and holding them to the
   * question would be the app insisting on its own data model.
   */
  async function handleCalorieAnswer(
    pending: PendingAdd,
    message: string,
  ): Promise<boolean> {
    const question = nextQuestion(pending);
    if (question === null || question.type !== "provide_calories") return false;

    if (isSkipMessage(message)) {
      await advance(skipUnknown(pending, question.partIndex));
      return true;
    }

    const answer = readCalorieAnswer(message);
    if (answer === null) return false;

    if (answer.status === "wrong_unit" || !isValidCalorieValue(answer.calories)) {
      // Still pending: the question stands.
      setReply(describeCaloriesWanted());
      return true;
    }

    await advance(answerCalories(pending, question.partIndex, answer.calories));
    return true;
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
      // In the same update as the new goal, so the summary's switch to its
      // "with goal" layout never remounts the field still flagged open.
      setManualGoalRequested(false);
      setState({ ...state, calorieTarget: result.goal.calorieTarget });
    }
    return result;
  }

  /** The first-visit question was answered or waved away; never ask again. */
  function closeCalculator(): void {
    setCalculator(null);
    void repositories.profile.markPromptSeen();
  }

  /**
   * A calculated target becomes an ordinary `DailyGoal` — the same one the
   * manual field writes. The number the dialog showed is not trusted; the
   * use case recomputes it from the facts.
   */
  async function handleAcceptCalculated(
    facts: BodyFacts,
    goalMode: GoalMode,
  ): Promise<boolean> {
    if (state.status !== "ready") return false;

    const result = await adoptCalculatedGoal(repositories, {
      date: state.dateKey,
      facts,
      goalMode,
      now: new Date(),
    });
    if (!result.ok) return false;

    setState({ ...state, calorieTarget: result.goal.calorieTarget });
    setSavedProfile(result.profile);
    setCalculator(null);
    return true;
  }

  async function handleForgetProfile(): Promise<void> {
    await repositories.profile.clear();
    setSavedProfile(null);
    closeCalculator();
  }

  /**
   * `chosen` is the record the user picked when asked which one a sentence
   * was about. It is final — the server acts on it and never asks again.
   */
  async function handleMessage(message: string, chosen?: ChosenTarget) {
    setIsPending(true);
    setReply(null);
    // A re-send after a pick keeps the pick as what was said.
    if (chosen === undefined) setLastMessage(message);
    // A new sentence replaces the reply that carried 되돌리기.
    setLastRemoved(null);

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
        if (
          question?.type === "provide_quantity" &&
          (await handleQuantityAnswer(pendingAdd, message))
        ) {
          return;
        }
        if (
          question?.type === "provide_calories" &&
          (await handleCalorieAnswer(pendingAdd, message))
        ) {
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
        body: JSON.stringify(
          buildChatRequest({
            message,
            now: new Date(),
            dailyGoalCalories: summary.calorieTarget,
            records,
            chosen,
          }),
        ),
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
          command.extraParts ?? [],
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
          sourceText: message,
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

  /** A correction the server proposed; see `planModifyStart` for the cases. */
  async function startModify(
    targetId: string,
    sourceText: string,
    parts: AddPart[],
    needsConfirmation: boolean,
    /** Other foods the sentence reported, added beside the correction. */
    extraParts: AddPart[] = [],
  ): Promise<void> {
    const start = planModifyStart(
      records,
      { targetId, sourceText, parts, needsConfirmation, extraParts },
      new Date().toISOString(),
    );

    switch (start.kind) {
      case "gone":
        setReply(describeTargetGone());
        return;
      case "add_instead":
        await startAdd(sourceText, start.parts, true);
        return;
      case "already_logged":
        setReply(describeAlreadyLogged(start.item));
        return;
      case "ask_amount":
        askAmountFor(start.itemId);
        return;
      case "pending":
        await advance(start.pending);
        return;
    }
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

    // A sentence with nothing storable in it is not worth confirming. Only
    // a confident report goes on to ask for calories: a sentence the judge
    // half-believed was about food is not worth a follow-up question.
    if (needsConfirmation && isAllUnknown(parts)) {
      setReply(describeNothingAdded(parts));
      return;
    }

    await advance(pending);
  }

  /** Answered on the client — a confirmation is not worth a second round trip. */
  function handleChooseOption(option: ClarifyOption) {
    // Picking a chip is the user's turn: it reads as what they said.
    setLastMessage(option.label);

    if (option.id === UNDO_DELETE) {
      if (lastRemoved !== null) void undoDelete(lastRemoved);
      return;
    }

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

      if (question?.type === "provide_calories") {
        if (option.id === "skip") {
          void advance(skipUnknown(pendingAdd, question.partIndex));
        } else {
          setPendingAdd(null);
          setReply(describeCancelled("add"));
        }
        return;
      }
    }

    if (option.id === "no") {
      setReply({ kind: "statement", text: "알겠어요. 그대로 둘게요." });
      setClarification(null);
      return;
    }

    const intent = clarification?.intent;

    // The entry is not among the chips. Nothing is changed and nothing is
    // added: a correction that found no entry is not a new meal.
    if (option.id === NONE_OF_THESE && (intent === "modify_food" || intent === "delete_food")) {
      setClarification(null);
      setReply(describeNoneOfThese(intent));
      return;
    }

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

        // The target is settled; the sentence still says what to change it
        // to. Only a confirmation's "yes" has no sentence worth resending, and
        // then the amount is the one thing still missing.
        const sourceText = clarification?.sourceText;
        if (option.id !== "yes" && sourceText !== undefined) {
          void handleMessage(sourceText, { targetId: chosen.id, intent: "modify_food" });
          return;
        }
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
              key={manualGoalKey}
              startOpen={manualGoalRequested}
              onClose={() => setManualGoalRequested(false)}
              currentTarget={summary.calorieTarget}
              onSubmit={handleSetGoal}
              onOpenCalculator={() => setCalculator("form")}
            />
          )
        }
      />

      <div className="flex-1 pb-8">
        <MealList
          records={records}
          isLoading={isLoading}
          onDeleteItem={(item) => void handleDeleteItem(item.id)}
          isBusy={isPending}
        />
      </div>

      <ChatInput
        onSubmit={(message) => void handleMessage(message)}
        onChooseOption={handleChooseOption}
        reply={reply}
        lastMessage={lastMessage}
        // Also blocked while the day is still being read: until then `records`
        // is empty, and a delete or a status question answered against an
        // empty day is a wrong answer rather than a slow one.
        isPending={isPending || isLoading}
      />

      <GoalCalculatorDialog
        step={calculator}
        savedProfile={savedProfile}
        onStart={() => setCalculator("form")}
        onChooseManual={() => {
          closeCalculator();
          setManualGoalRequested(true);
          setManualGoalKey((count) => count + 1);
        }}
        onDismiss={closeCalculator}
        onAccept={handleAcceptCalculated}
        onForget={() => void handleForgetProfile()}
      />
    </>
  );
}
