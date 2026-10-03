import { cleanFoodLabel } from "@/ai/nutrition/statedCalories";
import type { AddPart } from "@/application/addFood";
import type { Command } from "@/application/commands";
import type { PendingQuestion } from "@/application/pendingAdd";
import type { DailySummary } from "@/domain/calories";
import { clockTimeOf } from "@/domain/date";

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

/** 으로/로 — 받침이 없거나 ㄹ 받침이면 로. 인분으로, 개로, 줄로. */
export function directionParticle(word: string): "으로" | "로" {
  const last = word.trim().at(-1);
  if (last === undefined) return "로";
  const code = last.charCodeAt(0);
  if (code < 0xac00 || code > 0xd7a3) return "로";
  const final = (code - 0xac00) % 28;
  return final === 0 || final === 8 ? "로" : "으로";
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

const TIMES = ["", "한", "두", "세", "네"];

/** The chip under "어떤 ○○인가요?" that says the food is none of those offered. */
export const OTHER_FOOD = "other_food";

/** The chip that drops an unfinished sentence; nothing has been stored yet. */
export const CANCEL_PENDING = "cancel_pending";

/** The chip under "어떤 기록을…?" that says the entry is not among those shown. */
export const NONE_OF_THESE = "none_of_these";

/** "케이크 1조각", plus the time when another candidate has the same name and amount. */
function baseLabel(
  candidate: { id: string; name: string; amount?: string; consumedAt?: string },
  all: { id: string; name: string; amount?: string }[],
): string {
  const base = candidate.amount === undefined ? candidate.name : `${candidate.name} ${candidate.amount}`;
  const twin = all.some(
    (other) => other.id !== candidate.id && other.name === candidate.name && other.amount === candidate.amount,
  );
  const time = candidate.consumedAt === undefined ? null : clockTimeOf(candidate.consumedAt);
  return twin && time !== null ? `${base} · ${time}` : base;
}

/**
 * Chip labels for "어떤 기록…?", one per stored entry. "케이크 1조각 · 15:10"
 * tells same-looking entries apart by when they were logged. When even that
 * is the same, the entries are numbered in the order they were logged — the
 * only other fact there is. Nothing is made up, and each chip keeps its id.
 */
function candidateLabels(
  candidates: { id: string; name: string; amount?: string; consumedAt?: string }[],
): string[] {
  const labels = candidates.map((candidate) => baseLabel(candidate, candidates));
  return labels.map((label, index) => {
    const same = labels.flatMap((other, at) => (other === label ? [at] : []));
    if (same.length < 2) return label;
    // Candidates arrive newest first; entries logged at the same moment keep
    // the day's order, so the earlier-logged one comes first among them.
    return `${label} · ${same.indexOf(index) + 1}번째 기록`;
  });
}

/** Said after "해당 없음": nothing changed, and how to point at the entry. */
export function describeNoneOfThese(intent: "modify_food" | "delete_food"): Reply {
  return {
    kind: "statement",
    text:
      intent === "delete_food"
        ? "아무것도 지우지 않았어요. 지울 음식 이름을 다시 말씀해주세요."
        : "아무것도 바꾸지 않았어요. 고칠 음식 이름과 바꿀 내용을 다시 말씀해주세요.",
  };
}

/**
 * "사과를 두 번 기록했어요. 어느 기록을 고칠까요?" — when every candidate is
 * the same food, saying so explains why the app is asking at all.
 */
function sameFoodTwice(candidates: { name: string }[]): string | null {
  const first = candidates[0]?.name;
  if (first === undefined || candidates.length < 2) return null;
  if (!candidates.every((candidate) => candidate.name === first)) return null;
  const times = TIMES[candidates.length] ?? `${candidates.length}`;
  return `${first}${objectParticle(first)} ${times} 번 기록했어요. 어느 기록인가요?`;
}

function describeClarify(command: Extract<Command, { type: "clarify" }>): Reply {
  const yesNo: ClarifyOption[] = [
    { id: "yes", label: "네" },
    { id: "no", label: "아니요" },
  ];

  const candidates = command.candidates ?? [];
  const labels = candidateLabels(candidates);
  const candidateOptions: ClarifyOption[] = candidates.map((candidate, index) => ({
    id: candidate.id,
    label: labels[index] ?? candidate.name,
  }));

  switch (command.reason) {
    case "low_confidence":
      return {
        kind: "statement",
        text: "무슨 말씀인지 잘 모르겠어요. 조금만 더 자세히 알려주세요.",
      };

    case "unknown_target": {
      const verb = command.intent === "delete_food" ? "취소할까요?" : "수정할까요?";
      const text = sameFoodTwice(command.candidates ?? []) ?? `어떤 기록을 ${verb}`;
      // Only a few chips fit, and the entry meant may not be among them. "해당
      // 없음" is always there so nobody has to pick a wrong one to move on.
      return candidateOptions.length > 0
        ? { kind: "question", text, options: [...candidateOptions, { id: NONE_OF_THESE, label: "해당 없음" }] }
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
            : command.kind === "goal_setting"
              ? "목표는 위의 '목표 수정'에서 바꿀 수 있어요."
              // Honest about the limit without narrating a roadmap: "다음
              // 단계" is a word about our backlog, not about their day.
              : "뭘 먹을지는 아직 못 골라드려요. 드신 걸 말씀해주시면 기록할게요.",
      };

    case "add_candidate":
    case "add":
      // Both are handled by the caller, which knows the totals after the
      // record was written and what is still being asked. Reaching here means
      // the screen did not route it, so say nothing invented.
      return {
        kind: "statement",
        text: "무엇을 드셨는지 다시 말씀해주시겠어요?",
      };

    case "modify_candidate":
    case "delete_candidate":
      // Handled by the caller, which owns the records and the totals. Getting
      // here means the screen did not route it.
      return {
        kind: "statement",
        text: "어떤 기록을 말씀하시는지 다시 알려주시겠어요?",
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


/**
 * Everything the add pipeline says.
 *
 * House style holds: state what happened and what is left, then stop. No
 * encouragement, no nutrition advice, and never a number the domain did not
 * calculate.
 */

/** Joins names the way a sentence would: "쌀밥과 갈비탕". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  const before = names.at(-2) ?? "";
  return `${names.slice(0, -1).join(", ")}${hasFinalConsonant(before) ? "과" : "와"} ${names.at(-1) ?? ""}`;
}

/**
 * Said after the record is written, so the totals are the real ones.
 *
 * `summary` must already include the new record — the caller recalculates
 * before asking for this sentence, because the server never knew the totals
 * and this function must not add anything up itself.
 */
export function describeAdded(
  summary: DailySummary,
  skipped: string[] = [],
  /** Foods recorded at a representative figure: 마라탕, 치킨, 피자. */
  highVariance: string[] = [],
): Reply {
  const lines = ["기록했어요."];

  lines.push(`오늘 ${numberFormat.format(summary.consumedCalories)} kcal 먹었어요.`);

  // The remaining figure is the one the app exists to show, but only a goal
  // makes it meaningful — without one, stop after the total rather than
  // prompting for a goal on every single entry.
  if (summary.remainingCalories !== null) {
    if (summary.remainingCalories > 0) {
      lines.push(`${numberFormat.format(summary.remainingCalories)} kcal 남았어요.`);
    } else if (summary.remainingCalories === 0) {
      lines.push("목표에 딱 맞췄어요.");
    } else {
      lines.push(`${numberFormat.format(-summary.remainingCalories)} kcal 넘었어요.`);
    }
  }

  if (skipped.length > 0) {
    lines.push(`${unknownSubject(skipped)} 빼고 기록했어요.`);
  }

  // Said once, after the totals, and never as a question: the food is already
  // recorded at the dataset's figure. Naming it tells the user which line the
  // "~" in the list is about.
  const varying = [...new Set(highVariance)];
  if (varying.length > 0) {
    const names = listNames(varying);
    lines.push(
      `${names}${topicParticle(varying.at(-1) ?? names)} 재료와 양에 따라 칼로리 차이가 클 수 있어요. ${highVarianceHint(varying[0] ?? names)}`,
    );
  }

  return { kind: "statement", text: lines.join(" ") };
}

/**
 * How to change a representative figure, in the app's own words.
 *
 * It spells out a sentence to say, with the food just recorded in it, because
 * the looser "…은 800kcal였어" was read as a second record of the same food
 * rather than a correction. "…로 고쳐줘" is the form that is read as one.
 */
export function highVarianceHint(food: string): string {
  return `다르면 "${food} 800kcal로 고쳐줘"처럼 말해주세요.`;
}

/**
 * The subject of a sentence about foods the dataset lacks, with its particle.
 *
 * A phrase is quoted back only when it reads as a food name. When the parser
 * could not find one, the "name" is a scrap of the user's sentence, and
 * repeating it with a particle glued on reads as the app not listening.
 */
function unknownSubject(names: string[]): string {
  const labels = names.map(cleanFoodLabel);
  if (labels.length === 0 || labels.some((label) => label === null)) {
    return "말씀하신 음식은";
  }
  const named = labels as string[];
  return `${listNames(named)}${topicParticle(named.at(-1) ?? "")}`;
}

/** Nothing in the sentence could be priced, so nothing was written. */
export function describeNothingAdded(parts: AddPart[]): Reply {
  const unknown = parts
    .filter((part) => part.status === "unknown" || part.status === "skipped")
    .map((part) => part.phraseName);

  if (unknown.length === 0) {
    return { kind: "statement", text: "무엇을 드셨는지 알려주세요." };
  }

  return {
    kind: "statement",
    // Says how to get past it, because the way past is the user's to take:
    // a figure they know is stored as said.
    text: `${unknownSubject(unknown)} 아직 정보가 없어요. "샌드위치 450kcal"처럼 칼로리를 함께 말씀해주시면 그대로 적을게요.`,
  };
}

/** The reply to "몇 kcal였나요?" was an amount, not calories. */
export function describeCaloriesWanted(): Reply {
  return {
    kind: "statement",
    text: "칼로리로 알려주세요. 600처럼 숫자만 적으셔도 돼요.",
  };
}

/**
 * The open question.
 *
 * `unmeasurable` never borrows `unknown`'s wording: the food *was* found, and
 * the sentence has to make that clear or the user will not realise that one
 * word from them settles it. The question is built from the reason and the
 * entry rather than written per food, so a new seed needs no new copy.
 */
export function describeQuestion(question: PendingQuestion): Reply {
  if (question.type === "confirm_add") {
    const what = question.names.length > 0 ? listNames(question.names) : null;
    const added = question.addNames !== undefined && question.addNames.length > 0
      ? listNames(question.addNames)
      : null;
    // A correction that also adds says both, so no food it touches is hidden.
    if (added !== null) {
      return {
        kind: "question",
        text:
          what === null
            ? `${added}${objectParticle(added)} 새로 기록할까요?`
            : `${what}${objectParticle(what)} 고치고 ${added}${objectParticle(added)} 새로 기록할까요?`,
        options: [
          { id: "yes", label: "네" },
          { id: "no", label: "아니요" },
        ],
      };
    }
    // A modify names the exact entry a "yes" will change, and what it becomes.
    const change = question.mode === "modify" ? question.change : undefined;
    if (change !== undefined && change.replacement !== null) {
      return {
        kind: "question",
        text: describeChange(change.target, change.replacement),
        options: [
          { id: "yes", label: "네" },
          { id: "no", label: "아니요" },
        ],
      };
    }
    const verb = question.mode === "modify" ? "고칠까요?" : "기록할까요?";
    return {
      kind: "question",
      text: what === null ? verb : `${what}${objectParticle(what)} ${verb}`,
      options: [
        { id: "yes", label: "네" },
        { id: "no", label: "아니요" },
      ],
    };
  }

  if (question.type === "choose_food") {
    return {
      kind: "question",
      // A replacement does not name the old food in the question — the phrase
      // it came from is the whole correction, which reads as nonsense.
      text:
        question.mode === "modify"
          ? "무엇으로 바꿀까요?"
          : `어떤 ${question.phraseName}인가요?`,
      // The offered foods are only the ones the dataset has. The way out —
      // naming the calories instead, or dropping the sentence — is always
      // there, so nobody has to pick a wrong food to move on.
      options: [
        ...question.candidates.map((candidate) => ({
          id: candidate.entryId,
          label: candidate.name,
        })),
        { id: OTHER_FOOD, label: "다른 음식이에요" },
        { id: CANCEL_PENDING, label: "취소" },
      ],
    };
  }

  if (question.type === "provide_calories") {
    const subject =
      question.label === null
        ? "말씀하신 음식은"
        : `${question.label}${topicParticle(question.label)}`;
    return {
      kind: "question",
      text: `${subject} 아직 정보가 없어요. 대략 몇 kcal였는지 알려주시면 그대로 적을게요.`,
      options: [
        question.othersResolved
          ? { id: "skip", label: "빼고 기록" }
          : { id: "no", label: "그만두기" },
      ],
    };
  }

  const name = question.entries[0]?.name ?? question.phraseName;

  // Some of it was left, and how much of the whole that was cannot be
  // worked out — "밥은 반 남겼어" of a 비빔밥. Ask for what was eaten in
  // total, in the counters the food has, and say why.
  if (question.reason === "partly_left") {
    const known = question.knownUnits ?? [];
    const example = known[0] === undefined ? "200g" : `반 ${known[0]}`;
    return {
      kind: "statement",
      text: `${name}${topicParticle(name)} 일부만 남기신 걸 정확히 계산하기 어려워요. 전체로 얼마나 드셨는지 알려주세요. (예: ${example})`,
    };
  }

  // The food has portions, just not in the counter that was said. Saying
  // which counters it does have turns "g으로 알려주세요" into something a
  // person can actually answer without a scale.
  if (question.reason === "unsupported_unit" && question.unit !== undefined) {
    const known = question.knownUnits ?? [];
    const alternative =
      known.length === 0
        ? "g"
        : `g이나 ${known.join("·")}`;
    const last = known.at(-1) ?? "g";
    return {
      kind: "statement",
      text: `${name}${topicParticle(name)} 찾았어요. ${question.unit} 단위 무게는 몰라서, ${alternative}${directionParticle(last)} 알려주세요.`,
    };
  }

  return {
    kind: "statement",
    text: `${name}${topicParticle(name)} 찾았어요. 얼마나 드셨는지 g이나 ml로 알려주세요.`,
  };
}

/** "케이크 1조각(15:10) 기록을 700kcal로 바꿀까요?" */
function describeChange(
  target: { name: string; amount?: string; consumedAt?: string },
  replacement: { name: string; amount?: string; calories: number },
): string {
  const time = target.consumedAt === undefined ? null : clockTimeOf(target.consumedAt);
  const entry = `${entryLabel(target)}${time === null ? "" : `(${time})`} 기록`;
  const kcal = `${numberFormat.format(replacement.calories)}kcal`;
  const sameFood = replacement.name === target.name;
  const sameAmount = replacement.amount === target.amount;
  const becomes = sameFood
    ? sameAmount || replacement.amount === undefined
      ? kcal
      : `${replacement.amount} ${kcal}`
    : `${entryLabel(replacement)} ${kcal}`;
  return `${entry}을 ${becomes}로 바꿀까요?`;
}

/** The amount they gave could not be read as one. */
export function describeUnreadableAmount(): Reply {
  return {
    kind: "statement",
    text: "양을 알아듣지 못했어요. 200ml처럼 알려주세요.",
  };
}

export function describeCancelled(mode: "add" | "modify" = "add"): Reply {
  return {
    kind: "statement",
    text:
      mode === "modify"
        ? "알겠어요. 그대로 둘게요."
        : "알겠어요. 기록하지 않을게요.",
  };
}

/** "떠먹는 요거트 200g" — how an entry is named back to the user. */
function entryLabel(entry: { name: string; amount?: string }): string {
  return entry.amount === undefined ? entry.name : `${entry.name} ${entry.amount}`;
}

function totalsAfterChange(summary: DailySummary): string[] {
  const lines = [`오늘 ${numberFormat.format(summary.consumedCalories)} kcal 먹었어요.`];
  if (summary.remainingCalories !== null) {
    lines.push(
      summary.remainingCalories >= 0
        ? `${numberFormat.format(summary.remainingCalories)} kcal 남았어요.`
        : `${numberFormat.format(-summary.remainingCalories)} kcal 넘었어요.`,
    );
  }
  return lines;
}

/**
 * Said after an item is taken off the log, with the totals already
 * recalculated from storage. Names the amount too: a delete is the change a
 * user is least likely to notice, so the reply says exactly what went.
 */
export function describeDeleted(
  entry: { name: string; amount?: string },
  summary: DailySummary,
): Reply {
  const label = entryLabel(entry);
  return {
    kind: "question",
    text: [`${label}${objectParticle(label)} 지웠어요.`, ...totalsAfterChange(summary)].join(" "),
    // A delete takes one tap on a small ×, so it is undone in one tap too —
    // cheaper for everyone than asking "지울까요?" on every deliberate one.
    options: [{ id: UNDO_DELETE, label: "되돌리기" }],
  };
}

/** The option id that undoes the last delete. */
export const UNDO_DELETE = "undo_delete";

/** Said after an undo, with the totals re-read from storage. */
export function describeRestored(
  entry: { name: string; amount?: string },
  summary: DailySummary,
): Reply {
  const label = entryLabel(entry);
  return {
    kind: "statement",
    text: [`${label}${objectParticle(label)} 되돌렸어요.`, ...totalsAfterChange(summary)].join(" "),
  };
}

/**
 * Said after an item is re-priced: what it was and what it is now, then the
 * totals. A correction rewrites something the user already saw, so the reply
 * shows both sides rather than trusting them to spot the changed row.
 *
 * An arrow instead of particles: "200g을" / "200g으로" depends on how the
 * unit is read aloud, and the arrow reads the same either way.
 */
export function describeModified(
  before: { name: string; amount?: string; calories: number },
  after: { name: string; amount?: string; calories: number },
  summary: DailySummary,
  /** Foods the same sentence added beside the correction. */
  added: { name: string; amount?: string }[] = [],
  /** Foods left out because their calories were not known. */
  skipped: string[] = [],
): Reply {
  const change = `${entryLabel(before)} → ${entryLabel(after)}`;
  const calories =
    before.calories === after.calories
      ? ""
      : ` (${numberFormat.format(before.calories)} → ${numberFormat.format(after.calories)} kcal)`;
  const also =
    added.length === 0 ? [] : [`${listNames(added.map(entryLabel))}도 기록했어요.`];
  const left = skipped.length === 0 ? [] : [`${unknownSubject(skipped)} 빼고 기록했어요.`];
  return {
    kind: "statement",
    text: [`바꿨어요: ${change}${calories}.`, ...also, ...left, ...totalsAfterChange(summary)].join(" "),
  };
}

/**
 * Asked when a correction was understood as being about a food, but how much
 * of it could not be read from the sentence.
 *
 * Deliberately the same shape of question as the add pipeline's — the user
 * should not be able to tell that one came from a parser limit and the other
 * from missing data. Both are "we know the food, tell us the amount".
 */
export function describeAskAmount(name: string): Reply {
  return {
    kind: "statement",
    text: `${name}${objectParticle(name)} 얼마나 드셨는지 g이나 ml로 알려주세요.`,
  };
}

/** A correction that asks for exactly what is already stored. */
export function describeAlreadyLogged(entry: { name: string; amount?: string }): Reply {
  const label = entryLabel(entry);
  return { kind: "statement", text: `이미 ${label}${directionParticle(label)} 기록돼 있어요.` };
}

/** The entry the judge pointed at is no longer on the day. */
export function describeTargetGone(): Reply {
  return { kind: "statement", text: "그 기록을 찾지 못했어요." };
}

export function describeAddFailure(): Reply {
  return {
    kind: "statement",
    text: "지금은 기록하기 어려워요. 다시 시도해주세요.",
  };
}
