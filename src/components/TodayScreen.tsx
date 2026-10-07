"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { makeConversationTurn } from "@/application/conversation";
import { createRemoteRepositories, AccountStorageError } from "@/infrastructure/remoteRepositories";
import { createAccountProfileRepository } from "@/infrastructure/accountProfileRepository";
import type { ConversationTurn } from "@/domain/conversation";
import { createLocalStorageConversationRepository } from "@/infrastructure/localStorageConversationRepository";
import { replyText, describeStorageNotice, describeStorageFailure, describeConnectionFailure } from "./replyText";
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
  answerAllOfChoices,
  answerCalories,
  answerChoice,
  answerNoneOfChoices,
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
import { latestExchange } from "./conversationView";
import { buildChatRequest } from "./chatRequest";
import { GoalCalculatorDialog, type CalculatorStep } from "./GoalCalculatorDialog";
import { GoalEditor } from "./GoalEditor";
import { MealList } from "./MealList";
import { TodaySummary } from "./TodaySummary";
import {
  describeAddFailure,
  describeUsageLimit,
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
  CANCEL_PENDING,
  NONE_OF_THESE,
  ALL_OF_THESE,
  OTHER_FOOD,
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
export function TodayScreen({accountId=null}:{accountId?:string|null} = {}) {
  const [storageNotice, setStorageNotice] = useState<string | null>(null);
  const turnReply = useRef<{ reply: Reply; outcome: ConversationTurn["outcome"] } | null>(null);
  const turnBusy = useRef(false);
  const turnLimited = useRef(false);
  const repositories = useMemo(
    () => ({
      meals: createLocalStorageMealRecordRepository({ onMetadataFailure: () => setStorageNotice(describeStorageNotice("metadata")) }),
      goals: createLocalStorageDailyGoalRepository({ onMetadataFailure: () => setStorageNotice(describeStorageNotice("metadata")) }),
      conversation: createLocalStorageConversationRepository(),
      ...(accountId ? createRemoteRepositories(accountId) : {}),
      // Body facts use only the separately consented profile route, never judgment.
      profile: accountId ? createAccountProfileRepository(createLocalStorageDietProfileRepository(),accountId) : createLocalStorageDietProfileRepository(),
    }),
    [accountId],
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
      const [records, goal, profile, promptSeen, conversation] = await Promise.all([
        repositories.meals.getByDate(dateKey),
        repositories.goals.get(dateKey),
        repositories.profile.get(),
        repositories.profile.hasSeenPrompt(),
        repositories.conversation.getAll(),
      ]);

      if (cancelled) return;
      setState({
        status: "ready",
        dateKey,
        records,
        calorieTarget: goal?.calorieTarget ?? null,
      });
      setSavedProfile(profile);
      const latest = latestExchange(conversation.turns, dateKey);
      if (latest) {
        setLastMessage(latest.user);
        setReply({ kind: "statement", text: latest.reply });
      }
      if (!conversation.saved) setStorageNotice(describeStorageNotice("conversation"));
      else if (conversation.dropped > 0) setStorageNotice(describeStorageNotice("trimmed"));

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

    void load().catch(() => { if(!cancelled) setStorageNotice("기록을 불러오지 못했어요. 연결을 확인한 뒤 새로고침해 주세요."); });
    return () => {
      cancelled = true;
    };
  }, [repositories]);

  function showReply(next: Reply | null, outcome: ConversationTurn["outcome"] = "asked") {
    turnReply.current = next === null ? null : { reply: next, outcome };
    setReply(next);
  }

  async function runTurn(user: string | null, action: () => Promise<void>) {
    if (turnBusy.current || state.status !== "ready") return;
    turnBusy.current = true;
    setIsPending(true);
    setStorageNotice(null);
    setLastMessage(user);
    turnReply.current = null;
    turnLimited.current = false;
    try {
      const before = await repositories.meals.getAll();
      try {
        await action();
      } catch (error) {
        if(error instanceof AccountStorageError) {
          await reloadDay();
          setStorageNotice(error.message);
          showReply(describeStorageFailure(), "failed");
          return;
        }
        await reloadDay();
        showReply(describeStorageFailure(), "failed");
      }
      if (turnLimited.current) {
        setPendingAdd(pendingAdd);
        setClarification(clarification);
        setLastRemoved(lastRemoved);
        setReply(describeUsageLimit(reply));
        return;
      }
      // This boundary owns the whole turn, including persistence and rapid
      // repeated taps. Intermediate questions are not extra turns.
      const result = turnReply.current as { reply: Reply; outcome: ConversationTurn["outcome"] } | null;
      if (result !== null) {
        const after = await repositories.meals.getAll();
        const turn = makeConversationTurn({ user, reply: replyText(result.reply), outcome: result.outcome }, before, after);
        try {
          const saved = await repositories.conversation.append(turn);
          if (!saved.saved) setStorageNotice(describeStorageNotice("conversation"));
          else if (saved.dropped > 0) setStorageNotice(describeStorageNotice("trimmed"));
        } catch {
          setStorageNotice(describeStorageNotice("conversation"));
        }
      }
    } finally {
      turnBusy.current = false;
      setIsPending(false);
    }
  }

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
      showReply(describeNothingAdded(pending.parts), "nothing_added");
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

    const recorded = pending.parts.flatMap((part) =>
      part.status === "resolved"
        ? [
            {
              ...part.item,
              ...(part.amountAssumed === true ? { amountAssumed: true } : {}),
              ...(part.variantAssumed === undefined ? {} : { variantAssumed: part.variantAssumed }),
            },
          ]
        : [],
    );

    showReply(describeAdded(await reloadDay(), skipped, highVariance, recorded), "added");
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
      showReply(describeTargetGone(), "failed");
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
    showReply(describeAskAmount(found.item.name));
  }

  /** Takes one logged food off the day. */
  async function applyDelete(targetId: string): Promise<void> {
    const result = await removeFoodItem(repositories.meals, records, targetId);

    if (result.status === "not_found") {
      showReply(describeTargetGone(), "failed");
      return;
    }

    setLastRemoved(result);
    showReply(describeDeleted(result.item, await reloadDay()), "removed");
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
    await applyDelete(itemId);
  }

  async function undoDelete(removed: Removed): Promise<void> {
    await restoreFoodItem(repositories.meals, records, removed);
    setLastRemoved(null);
    showReply(describeRestored(removed.item, await reloadDay()), "restored");
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
        showReply(describeNothingAdded(pending.parts), "nothing_added");
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
      showReply(describeTargetGone(), "failed");
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
    showReply(
      describeModified(before ?? replacement, replacement, summaryAfter, additions, skipped), "modified",
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
    if (question !== null) showReply(describeQuestion(question));
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
      showReply(describeUnreadableAmount());
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
      if (response.status === 429) {
        turnLimited.current = true;
        return true;
      }
      showReply(describeAddFailure(), "failed");
      return true;
    }

    const result = (await response.json()) as ResolveResponse;
    if (result.status !== "resolved") {
      // Still pending: the question stands, so the user can try again.
      showReply(describeUnreadableAmount());
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
      showReply(describeCaloriesWanted());
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

    let result;
    try { result = await adoptCalculatedGoal(repositories, {
      date: state.dateKey,
      facts,
      goalMode,
      now: new Date(),
    }); } catch {
      const savedGoal = await repositories.goals.get(state.dateKey).catch(()=>null);
      if(savedGoal) setState({...state,calorieTarget:savedGoal.calorieTarget});
      setStorageNotice("계산기 정보를 저장하지 못했어요. 목표 숫자는 이미 저장됐을 수 있어요. 연결을 확인한 뒤 다시 해 주세요.");
      return false;
    }
    if (!result.ok) return false;

    setState({ ...state, calorieTarget: result.goal.calorieTarget });
    setSavedProfile(result.profile);
    setCalculator(null);
    return true;
  }

  async function handleForgetProfile(): Promise<void> {
    try { await repositories.profile.clear(); } catch {
      setStorageNotice("계산기 정보를 지우지 못했어요. 연결을 확인한 뒤 다시 해 주세요.");
      return;
    }
    setSavedProfile(null);
    closeCalculator();
  }

  /**
   * `chosen` is the record the user picked when asked which one a sentence
   * was about. It is final — the server acts on it and never asks again.
   */
  async function handleMessage(message: string, chosen?: ChosenTarget) {
    setIsPending(true);
    showReply(null);
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
          showReply(describeCancelled(mode), "cancelled");
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
        if (response.status === 429) {
          turnLimited.current = true;
          return;
        }
        showReply(describeAddFailure(), "failed");
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

      showReply(describeCommand(command, summary), command.type === "clarify" ? "asked" : command.type === "ignore" ? "nothing_added" : "answered");

      if (command.type === "clarify" && command.candidates !== undefined) {
        setClarification({
          intent: command.intent,
          candidates: command.candidates.map(({ id, name }) => ({ id, name })),
          sourceText: message,
        });
      }
    } catch (error) {
      if (error instanceof TypeError) showReply(describeConnectionFailure(), "failed");
      else throw error;
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
        showReply(describeTargetGone(), "failed");
        return;
      case "add_instead":
        await startAdd(sourceText, start.parts, true);
        return;
      case "already_logged":
        showReply(describeAlreadyLogged(start.item), "answered");
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
      showReply(describeNothingAdded(parts), "nothing_added");
      return;
    }

    await advance(pending);
  }

  /** Answered on the client — a confirmation is not worth a second round trip. */
  async function handleChooseOption(option: ClarifyOption) {
    // Picking a chip is the user's turn: it reads as what they said.
    setLastMessage(option.label);

    if (option.id === UNDO_DELETE) {
      if (lastRemoved !== null) await undoDelete(lastRemoved);
      return;
    }

    // Picking one of the candidate foods. Their calories were computed for
    // the amount the user already gave, so this is a selection and needs no
    // second round trip.
    if (pendingAdd !== null) {
      const question = nextQuestion(pendingAdd);

      if (question?.type === "confirm_add") {
        if (option.id === "yes") {
          await advance(confirmAdd(pendingAdd));
        } else {
          setPendingAdd(null);
          showReply(describeCancelled(question.mode), "cancelled");
        }
        return;
      }

      if (question?.type === "choose_food") {
        if (option.id === CANCEL_PENDING) {
          setPendingAdd(null);
          showReply(describeCancelled(pendingAdd.target === undefined ? "add" : "modify"), "cancelled");
          return;
        }
        await advance(
          option.id === OTHER_FOOD
            ? answerNoneOfChoices(pendingAdd, question.partIndex)
            : option.id === ALL_OF_THESE
              ? answerAllOfChoices(pendingAdd, question.partIndex)
              : answerChoice(pendingAdd, question.partIndex, option.id),
        );
        return;
      }

      if (question?.type === "provide_calories") {
        if (option.id === "skip") {
          await advance(skipUnknown(pendingAdd, question.partIndex));
        } else {
          setPendingAdd(null);
          showReply(describeCancelled("add"), "cancelled");
        }
        return;
      }
    }

    if (option.id === "no") {
      showReply(describeCancelled("modify"), "cancelled");
      setClarification(null);
      return;
    }

    const intent = clarification?.intent;

    // The entry is not among the chips. Nothing is changed and nothing is
    // added: a correction that found no entry is not a new meal.
    if (option.id === NONE_OF_THESE && (intent === "modify_food" || intent === "delete_food")) {
      setClarification(null);
      showReply(describeNoneOfThese(intent), "cancelled");
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
          await applyDelete(chosen.id);
          return;
        }

        // The target is settled; the sentence still says what to change it
        // to. Only a confirmation's "yes" has no sentence worth resending, and
        // then the amount is the one thing still missing.
        const sourceText = clarification?.sourceText;
        if (option.id !== "yes" && sourceText !== undefined) {
          await handleMessage(sourceText, { targetId: chosen.id, intent: "modify_food" });
          return;
        }
        askAmountFor(chosen.id);
        return;
      }
    }

    showReply(describeTargetGone(), "failed");
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
          onDeleteItem={(item) => void runTurn(null, () => handleDeleteItem(item.id))}
          isBusy={isPending}
        />
      </div>

      {storageNotice !== null && <p role="alert" className="px-6 py-2 text-sm text-accent">{storageNotice}</p>}

      <ChatInput
        onSubmit={(message) => void runTurn(message, () => handleMessage(message))}
        onChooseOption={(option) => void runTurn(option.id === UNDO_DELETE ? null : option.label, () => handleChooseOption(option))}
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
