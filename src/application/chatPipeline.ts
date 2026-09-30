import type { CandidateJudge } from "@/ai/judgment/candidateJudge";
import type { Judge, Judgment, JudgmentInput } from "@/ai/judgment/types";
import type { NutritionResolver } from "@/ai/nutrition/types";
import { resolveAddParts } from "./addFood";
import {
  filterUneatenQuestions,
  type CandidateFilterReport,
  type FilteredParts,
} from "./candidateFilter";
import { decideCommand, type ChosenTarget, type Command } from "./commands";
import { resolveModifyParts } from "./mixedModify";

/**
 * One sentence in, one command out — what `/api/chat` does, kept out of the
 * route so the eval can run exactly this and nothing resembling it.
 *
 * Two judgments go out together when the candidate filter is on: the intent
 * request as it always was, and the per-food request over the parser's
 * unsettled phrases. Neither waits for the other — the parse is local and
 * instant, so the second request can start before the first comes back. If
 * the sentence turns out not to be an add, its answer is simply not used.
 */

export type ChatDeps = {
  judge: Judge;
  resolver: NutritionResolver;
  /** Null when the filter is off or there is no Jev key. */
  candidateJudge: CandidateJudge | null;
};

export type ChatResult = {
  command: Command;
  judgment: Judgment;
  /** Present when an add was expanded; says what the filter did. */
  candidateFilter?: CandidateFilterReport;
};

export async function runChat(
  input: JudgmentInput,
  chosen: ChosenTarget | undefined,
  deps: ChatDeps,
): Promise<ChatResult> {
  // Started first and not awaited: it runs while the judge thinks. It never
  // rejects — a failed filter keeps every part.
  const filtered: Promise<FilteredParts> = resolveAddParts(input.message, deps.resolver).then(
    (parts) => filterUneatenQuestions(input.message, parts, deps.candidateJudge),
  );

  const judgment = await deps.judge.judge(input);
  const decided = decideCommand(judgment, input, chosen);

  if (decided.type === "add_candidate") {
    const { parts, report } = await filtered;
    return {
      command: {
        type: "add",
        sourceText: decided.sourceText,
        needsConfirmation: decided.needsConfirmation,
        parts,
      },
      judgment,
      candidateFilter: report,
    };
  }

  if (decided.type === "modify_candidate") {
    // The entry the judge picked, which the browser sent with today's items.
    const target = input.recentItems.find((item) => item.id === decided.targetId);
    const { parts, extraParts } = await resolveModifyParts(decided.sourceText, target, deps.resolver);
    return {
      command: {
        ...decided,
        parts,
        extraParts,
        // A sentence that would touch more than one food is always shown
        // before it is applied: a misread then costs a "no", never a record
        // changed or a food dropped without the user seeing it.
        needsConfirmation: decided.needsConfirmation || parts.length + extraParts.length > 1,
      },
      judgment,
    };
  }

  return { command: decided, judgment };
}
