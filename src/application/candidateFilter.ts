import { NOUL_THRESHOLDS } from "@/ai/judgment/confidence";
import type { CandidateJudge } from "@/ai/judgment/candidateJudge";
import type { AddPart } from "./addFood";

/**
 * Drops questions about things the user did not eat.
 *
 * "팀원들이랑 회식에서 삼겹살 먹었어" parses to a 삼겹살 record and an
 * unknown "팀원들" — and an unknown becomes "팀원들 대략 몇 kcal였나요?". The
 * parser cannot tell a person from a food it does not know, and a word list
 * that tried would never end. Jev can: each unsettled phrase goes to it with
 * the sentence, and one it judges uneaten is not asked about.
 *
 * What this never does, by construction:
 *   - touch a resolved part — it removes questions, not records;
 *   - add, rename or re-price anything — it can only keep or drop;
 *   - fail the sentence — any error keeps every part, so the worst case is
 *     one question too many.
 */

export type CandidateFilterReport =
  | { status: "off" }
  /** Nothing to ask about, so nothing was sent. */
  | { status: "no_questions" }
  | { status: "applied"; asked: number; dropped: string[] }
  | { status: "failed"; asked: number; error: string };

export type FilteredParts = { parts: AddPart[]; report: CandidateFilterReport };

/** A part that would become a question to the user. */
export function isQuestionPart(part: AddPart): boolean {
  return part.status === "ambiguous" || part.status === "unmeasurable" || part.status === "unknown";
}

/** The pure half: which questions survive, given one probability per question part. */
export function dropUneatenQuestions(
  parts: AddPart[],
  eaten: number[],
  threshold: number = NOUL_THRESHOLDS.candidateEaten,
): { parts: AddPart[]; dropped: string[] } {
  const dropped: string[] = [];
  let question = 0;
  const kept = parts.filter((part) => {
    if (!isQuestionPart(part)) return true;
    const probability = eaten[question++];
    // No answer for this part is not an answer of "no".
    if (probability === undefined || probability >= threshold) return true;
    dropped.push(part.phraseName);
    return false;
  });
  return { parts: kept, dropped };
}

export async function filterUneatenQuestions(
  message: string,
  parts: AddPart[],
  judge: CandidateJudge | null,
): Promise<FilteredParts> {
  if (judge === null) return { parts, report: { status: "off" } };

  const questions = parts.filter(isQuestionPart);
  if (questions.length === 0) return { parts, report: { status: "no_questions" } };

  try {
    const eaten = await judge.judgeEaten(
      message,
      questions.map((part) => part.phraseName),
    );
    if (eaten.length !== questions.length) throw new Error("answer count mismatch");
    const { parts: kept, dropped } = dropUneatenQuestions(parts, eaten);
    return { parts: kept, report: { status: "applied", asked: questions.length, dropped } };
  } catch (error) {
    // Timeout, rate limit, malformed answer: ask everything, as before.
    return {
      parts,
      report: {
        status: "failed",
        asked: questions.length,
        error: error instanceof Error ? error.name : "unknown",
      },
    };
  }
}
