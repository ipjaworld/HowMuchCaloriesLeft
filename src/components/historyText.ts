import { addDays } from "@/domain/date";
import type { DayHistory } from "@/domain/history";
import { isConversationDate } from "@/domain/conversation";

export function describeConversationRetention(date: string, today: string): string {
  return isConversationDate(date, today) ? "아직 보관된 대화가 없어요." : "대화는 30일까지 보관해요.";
}

export function describeMissingConversationRecord(): string {
  return "이 기록은 현재 목록에 없어요. 당시 내용은 위 답장에서 확인할 수 있어요.";
}

/**
 * How a past day reads. The domain says `difference: -372, outcome: "under"`;
 * this says "목표보다 372 kcal 적게 기록".
 *
 * House style for looking back: the numbers, plainly. No 성공/실패, no
 * praise, no warning — history is for remembering how a day went, not for
 * grading it. "적게 기록" rather than "덜 먹었어요" because the app only knows
 * what was logged, not what was eaten.
 */

const numberFormat = new Intl.NumberFormat("ko-KR");
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

/** "9월 27일 (토)", or 오늘 / 어제 for the two days people think of by name. */
export function describeHistoryDate(date: string, today: string): string {
  if (date === today) return "오늘";
  if (date === addDays(today, -1)) return "어제";

  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] ?? "";
  const todayYear = Number(today.slice(0, 4));
  const prefix = year === todayYear ? "" : `${year}년 `;
  return `${prefix}${month}월 ${day}일 (${weekday})`;
}

export type HistoryDayText = {
  /** "1,878 / 2,250 kcal", "620 kcal", or null for an empty day. */
  figures: string | null;
  /** "목표보다 372 kcal 적게 기록", "60 kcal 초과", "기록 없음". */
  note: string;
  /** "5건", or null for an empty day. */
  count: string | null;
  /** Only an over day is set apart, in the same accent Today uses. */
  isOver: boolean;
};

export function describeHistoryDay(day: DayHistory): HistoryDayText {
  if (day.outcome === "no_record") {
    return { figures: null, note: "기록 없음", count: null, isOver: false };
  }

  const consumed = numberFormat.format(day.consumedCalories);
  const count = `${day.itemCount}건`;

  if (day.calorieTarget === null || day.difference === null) {
    return { figures: `${consumed} kcal`, note: "목표 정하기 전", count, isOver: false };
  }

  const figures = `${consumed} / ${numberFormat.format(day.calorieTarget)} kcal`;
  const gap = numberFormat.format(Math.abs(day.difference));

  switch (day.outcome) {
    case "under":
      return { figures, note: `목표보다 ${gap} kcal 적게 기록`, count, isOver: false };
    case "exact":
      return { figures, note: "목표와 같아요", count, isOver: false };
    default:
      return { figures, note: `${gap} kcal 초과`, count, isOver: true };
  }
}
