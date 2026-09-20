import type { Command } from "@/application/commands";
import type { DailySummary } from "@/domain/calories";

/**
 * Every sentence the app says, built in code from a Command and the current
 * domain state. The server sends reason codes, never prose — it does not know
 * the totals and has no business wording an answer.
 *
 * House style: short, factual, no encouragement and no coaching.
 */

const numberFormat = new Intl.NumberFormat("ko-KR");

/**
 * Whether the last syllable carries a final consonant (받침), which is what
 * decides between every Korean particle pair. False for anything that is not
 * a Hangul syllable, which picks the vowel-ending form — the safer guess for
 * a loanword.
 */
function hasFinalConsonant(word: string): boolean {
  const last = word.trim().at(-1);
  if (last === undefined) return false;

  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return false;
  return (code - 0xac00) % 28 !== 0;
}

/** 을/를 — the object particle. */
export function objectParticle(word: string): "을" | "를" {
  return hasFinalConsonant(word) ? "을" : "를";
}

/** 은/는 — the topic particle. 수정은, 삭제는. */
export function topicParticle(word: string): "은" | "는" {
  return hasFinalConsonant(word) ? "은" : "는";
}

export type ClarifyOption = {
  /** Candidate id, or "no" for a plain refusal. */
  id: string;
  label: string;
};

export type Reply =
  | { kind: "statement"; text: string }
  | { kind: "question"; text: string; options: ClarifyOption[] };

function describeStatus(summary: DailySummary): string {
  if (summary.remainingCalories === null) {
    return "목표를 정하면 알려드릴게요.";
  }

  const eaten = `지금까지 ${numberFormat.format(summary.consumedCalories)} kcal 먹었어요.`;

  if (summary.remainingCalories > 0) {
    return `${eaten} ${numberFormat.format(summary.remainingCalories)} kcal 남았어요.`;
  }
  if (summary.remainingCalories === 0) {
    return `${eaten} 목표에 딱 맞췄어요.`;
  }
  return `${eaten} ${numberFormat.format(-summary.remainingCalories)} kcal 더 먹었어요.`;
}

/** The name of a candidate, for a question that has to point at one. */
function nameOf(command: Extract<Command, { type: "clarify" }>): string | null {
  const only = command.candidates?.length === 1 ? command.candidates[0] : undefined;
  return only?.name ?? null;
}

function describeClarify(command: Extract<Command, { type: "clarify" }>): Reply {
  const yesNo: ClarifyOption[] = [
    { id: "yes", label: "네" },
    { id: "no", label: "아니요" },
  ];

  const candidateOptions: ClarifyOption[] = (command.candidates ?? []).map(
    (candidate) => ({
      id: candidate.id,
      label:
        candidate.amount === undefined
          ? candidate.name
          : `${candidate.name} ${candidate.amount}`,
    }),
  );

  switch (command.reason) {
    case "low_confidence":
      return {
        kind: "statement",
        text: "무슨 말씀인지 잘 모르겠어요. 조금만 더 자세히 알려주세요.",
      };

    case "unclear_food":
      return { kind: "statement", text: "무엇을 얼마나 드셨는지 알려주세요." };

    case "unknown_target": {
      const text =
        command.intent === "delete_food"
          ? "어떤 기록을 취소할까요?"
          : "어떤 기록을 수정할까요?";
      return candidateOptions.length > 0
        ? { kind: "question", text, options: candidateOptions }
        : { kind: "statement", text: "아직 오늘 기록이 없어요." };
    }

    case "confirm_action": {
      const name = nameOf(command);
      if (command.intent === "add_food") {
        return { kind: "question", text: "기록할까요?", options: yesNo };
      }
      const verb = command.intent === "delete_food" ? "취소" : "수정";
      const text =
        name === null
          ? `${verb}할까요?`
          : `${name}${objectParticle(name)} ${verb}할까요?`;
      return { kind: "question", text, options: yesNo };
    }
  }
}

export function describeCommand(
  command: Command,
  summary: DailySummary,
): Reply {
  switch (command.type) {
    case "answer":
      return {
        kind: "statement",
        text:
          command.kind === "status"
            ? describeStatus(summary)
            : "추천은 다음 단계에서 연결할게요.",
      };

    case "add_candidate":
      return {
        kind: "statement",
        text: "음식 정보를 확인하는 단계가 아직 연결되지 않았어요.",
      };

    case "modify_candidate":
      return {
        kind: "statement",
        text: "수정할 기록은 찾았어요. 수정은 다음 단계에서 연결할게요.",
      };

    case "delete_candidate":
      return {
        kind: "statement",
        text: "취소할 기록은 찾았어요. 삭제는 다음 단계에서 연결할게요.",
      };

    case "clarify":
      return describeClarify(command);

    case "ignore":
      return {
        kind: "statement",
        text: "먹은 걸 말씀해주시면 기록할게요.",
      };
  }
}

/** After the user picks an entry in a clarifying question. */
export function describeResolvedTarget(
  intent: "modify_food" | "delete_food",
  name: string,
): string {
  const verb = intent === "delete_food" ? "삭제" : "수정";
  return `${name}${objectParticle(name)} 찾았어요. ${verb}${topicParticle(verb)} 다음 단계에서 연결할게요.`;
}
