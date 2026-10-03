import { readFileSync } from "node:fs";
import { it } from "vitest";
import { KOREAN_FOODS, koreanFoodResolver } from "@/ai/nutrition/koreanFoods";
import {
  representativeNamesFrom,
  scoreModifierCases,
  summarize,
  type ModifierCase,
  type ScoredCase,
} from "@/application/modifierCoverage";

/**
 * Words in front of a food name — `fixtures/food-modifier-cases.json`.
 *
 *   pnpm eval:food-modifiers
 *
 * Offline: the parser and the dataset matcher only, no Jev. Accuracy and
 * question burden are printed side by side, per group, and never added to
 * the food-input corpus (`eval:food-coverage`).
 */

const FIXTURES = ["fixtures/food-modifier-cases.json", "fixtures/food-modifier-boundary-cases.json"];
const load = (path: string) => (JSON.parse(readFileSync(path, "utf8")) as { cases: ModifierCase[] }).cases;

function describe(item: ScoredCase): string {
  const o = item.outcome;
  switch (o.kind) {
    case "exact":
      return `기록 ${o.entry}${o.amount === undefined ? "" : ` ${o.amount}`}`;
    case "representative":
      return `대표값 ${o.entry}${o.amount === undefined ? "" : ` ${o.amount}`}`;
    case "choose":
      return `고르기 ${o.candidates.join("/")}`;
    case "amount":
      return `양 질문 ${o.entries.join("/")}`;
    case "kcal":
      return `kcal 질문 "${o.label ?? "(이름 없음)"}"${o.amount === undefined ? "" : ` ${o.amount}`}`;
    case "dropped":
      return "누락";
  }
}

function line(label: string, scored: ScoredCase[]): string {
  const s = summarize(scored);
  return `  ${label.padEnd(13)} 정확 ${String(s.correct).padStart(2)}/${String(s.total).padEnd(2)} · 기존 한계(허용) ${s.withinLimit} · 기록 ${s.exact} · 대표값 ${s.representative} · 고르기 ${s.choose} · 양 ${s.amount} · kcal ${s.kcal} · 필요 ${s.needed} · 불필요 ${s.unnecessary} · 잘못된 자동기록 ${s.wrongAuto} · 누락 ${s.dropped} · 짝 불일치 ${s.inconsistent} · 다른 구절 질문 ${s.extraQuestions}`;
}

it("food modifiers", async () => {
  const out: string[] = [];
  for (const path of FIXTURES) {
    const cases = load(path);
    const scored = await scoreModifierCases(cases, koreanFoodResolver, representativeNamesFrom(KOREAN_FOODS));
    out.push("", `음식 수식어 — ${path} (Jev 미사용, 다른 fixture·food-input corpus와 분모 분리)`, line("전체", scored));
    for (const group of [...new Set(cases.map((item) => item.group))]) {
      out.push(line(group, scored.filter((item) => item.case.group === group)));
    }
    out.push("", "case별");
    for (const item of scored) {
      const flags = [
        item.correct ? "" : item.withinLimit ? "기존 한계(허용)" : "✗",
        item.wrongAuto ? "잘못된자동기록" : "",
        item.unnecessary ? "불필요" : "",
        item.inconsistent ? `짝불일치(${item.case.pairOf})` : "",
        item.extraQuestions > 0 ? `다른구절질문 ${item.extraQuestions}` : "",
      ].filter((flag) => flag !== "").join(" ");
      out.push(`  ${item.case.id.padEnd(5)} ${item.case.input.padEnd(24)} → ${describe(item)}${flags === "" ? "" : `   ${flags}`}`);
    }
  }
  console.log(out.join("\n"));
});
