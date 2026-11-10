import { z } from "zod";

/**
 * What a photo is allowed to turn into: a sentence the user confirms.
 *
 * The model that looks at the photo names foods and says roughly how much.
 * It decides nothing else. Calories come from the dataset and the arithmetic
 * that typed text already goes through (D01), so anything in a reading that
 * looks like an energy figure is dropped here rather than passed on: the chat
 * route honours a stated kcal, and a figure the model made up must never
 * arrive there looking like one the user stated.
 */

/** The shape asked of the model. Bounds are enforced below, not in the schema. */
export const photoReadingSchema = z.object({
  kind: z.enum(["food", "not_food", "unreadable"]),
  items: z.array(z.object({ name: z.string(), amount: z.string() })),
});

export type PhotoReading = z.infer<typeof photoReadingSchema>;

export type PhotoResult =
  | { kind: "food"; sentence: string; count: number }
  | { kind: "not_food" }
  | { kind: "unreadable" };

export const PHOTO_MAX_BYTES = 1_500_000;
export const PHOTO_MAX_ITEMS = 8;
const NAME_MAX = 30;
const AMOUNT_MAX = 20;

/** Energy and nutrient figures: not the photo's to give. */
const NUTRITION = /kcal|㎉|칼로리|열량|calorie|탄수화물|단백질|지방/i;

/** One line, no separators the sentence itself uses. */
function tidy(text: string): string {
  return text.replace(/[\s,，、;·]+/g, " ").trim();
}

export function photoResult(reading: PhotoReading): PhotoResult {
  if (reading.kind !== "food") return { kind: reading.kind };

  const seen = new Set<string>();
  const parts: string[] = [];
  for (const item of reading.items) {
    const name = tidy(item.name);
    if (name === "" || name.length > NAME_MAX || NUTRITION.test(name)) continue;
    const rawAmount = tidy(item.amount);
    const amount = rawAmount.length > AMOUNT_MAX || NUTRITION.test(rawAmount) ? "" : rawAmount;
    const part = amount === "" ? name : `${name} ${amount}`;
    if (seen.has(part)) continue;
    seen.add(part);
    parts.push(part);
    if (parts.length === PHOTO_MAX_ITEMS) break;
  }

  // "Food" with nothing usable in it is a photo that could not be read.
  if (parts.length === 0) return { kind: "unreadable" };
  return { kind: "food", sentence: parts.join(", "), count: parts.length };
}

/** JPEG only: the browser re-encodes every photo to one before sending it. */
export function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
