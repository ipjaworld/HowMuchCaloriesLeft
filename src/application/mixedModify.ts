import type { NutritionResolver } from "@/ai/nutrition/types";
import type { RecentItem } from "@/ai/judgment/types";
import {
  namesASubstitution,
  resolveAddParts,
  userStatedItem,
  type AddPart,
} from "./addFood";
import { correctionFor } from "./correction";

/**
 * What a correction resolves to, and what else the sentence reported eating.
 *
 * A correction is read as the plain phrase it boils down to — "떡볶이랑 튀김
 * 먹었는데 떡볶이는 반만" as "떡볶이 반만" — which is right for the entry
 * being corrected and silent about everything else in the sentence. Here the
 * 튀김 went missing: not stored, not asked about, and the user had no reason
 * to notice. So the whole sentence is also run through the add pipeline, and
 * any food it finds that is neither the corrected entry nor the correction
 * itself is carried as an addition.
 *
 * No new judgment and no new parsing: both readings are the existing ones,
 * and what is kept from the second is decided by name overlap alone.
 */

export type ModifyParts = {
  /** What the corrected entry becomes. */
  parts: AddPart[];
  /** Foods the sentence also reports, stored as new entries beside the correction. */
  extraParts: AddPart[];
};

const squash = (text: string) => text.replace(/\s+/g, "");

/** Dataset names a part points at, whatever its status. */
function namesOf(part: AddPart): string[] {
  switch (part.status) {
    case "resolved":
      return [part.item.name];
    case "ambiguous":
      return part.candidates.map((candidate) => candidate.name);
    case "unmeasurable":
      return part.entries.map((entry) => entry.name);
    case "unknown":
    case "skipped":
      return [];
  }
}

/** Whether a part is about the entry being corrected, by dataset name or by the words used. */
function isAboutTarget(part: AddPart, targetName: string): boolean {
  return (
    namesOf(part).includes(targetName) ||
    squash(part.phraseName).includes(squash(targetName))
  );
}

/**
 * Whether two parts are the same food said twice — the correction's reading
 * of a phrase and the add pipeline's reading of it. Overlap in either
 * direction counts, so "라면으로 바꿔줘" read as a scrap is still the 라면
 * the correction already has.
 */
function overlaps(a: AddPart, b: AddPart): boolean {
  const names = namesOf(b);
  if (namesOf(a).some((name) => names.includes(name))) return true;
  const phraseA = squash(a.phraseName);
  const phraseB = squash(b.phraseName);
  return phraseA.length > 0 && phraseB.length > 0 && (phraseA.includes(phraseB) || phraseB.includes(phraseA));
}

/**
 * Foods in `message` other than the corrected entry and the correction.
 *
 * Empty for a substitution — "떡볶이 말고 샐러드": the other food there *is*
 * the correction, and adding it as well would count it twice.
 */
export async function extraFoodsBeside(
  message: string,
  targetName: string,
  correction: AddPart[],
  resolver: NutritionResolver,
): Promise<AddPart[]> {
  if (namesASubstitution(message)) return [];
  const whole = await resolveAddParts(message, resolver);
  return whole.filter(
    (part) =>
      !isAboutTarget(part, targetName) &&
      !correction.some((corrected) => overlaps(corrected, part)),
  );
}

/**
 * A correction of `target`, looked up as the plain phrase it boils down to
 * — "떠먹는 요거트를 그릭 요거트로 바꾸고 싶어" as "그릭 요거트 200g" —
 * plus whatever else the sentence reported eating.
 */
export async function resolveModifyParts(
  message: string,
  target: RecentItem | undefined,
  resolver: NutritionResolver,
): Promise<ModifyParts> {
  if (target === undefined) {
    return { parts: await resolveAddParts(message, resolver), extraParts: [] };
  }

  const correction = correctionFor(message, target);
  const parts: AddPart[] =
    correction.kind === "calories"
      ? (() => {
          const item = userStatedItem(target.name, correction.calories);
          return [{ status: "resolved", phraseName: item.name, item }];
        })()
      : await resolveAddParts(correction.text, resolver);

  return {
    parts,
    extraParts: await extraFoodsBeside(message, target.name, parts, resolver),
  };
}
