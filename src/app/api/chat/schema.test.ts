import { describe, expect, it } from "vitest";
import { MAX_MESSAGE_LENGTH, MAX_RECENT_ITEMS, chatRequestSchema } from "./schema";

function validRequest(overrides: Record<string, unknown> = {}) {
  return {
    message: "갈비탕 먹었어",
    now: "2026-09-20T13:20:00+09:00",
    dailyGoalCalories: 2100,
    recentItems: [
      {
        id: "i-galbitang",
        name: "갈비탕",
        calories: 650,
        mealType: "lunch",
        consumedAt: "2026-09-20T12:40:00+09:00",
      },
    ],
    ...overrides,
  };
}

describe("chat request schema", () => {
  it("accepts a well-formed request", () => {
    const parsed = chatRequestSchema.safeParse(validRequest());
    expect(parsed.success).toBe(true);
  });

  it("accepts a day with no entries and no goal", () => {
    const parsed = chatRequestSchema.safeParse(
      validRequest({ recentItems: [], dailyGoalCalories: null }),
    );
    expect(parsed.success).toBe(true);
  });

  it("trims the message", () => {
    const parsed = chatRequestSchema.parse(
      validRequest({ message: "  갈비탕 먹었어  " }),
    );
    expect(parsed.message).toBe("갈비탕 먹었어");
  });

  describe("message", () => {
    it.each(["", "   "])("rejects an empty message (%j)", (message) => {
      expect(chatRequestSchema.safeParse(validRequest({ message })).success).toBe(
        false,
      );
    });

    it("rejects a message past the length cap", () => {
      const message = "가".repeat(MAX_MESSAGE_LENGTH + 1);
      expect(chatRequestSchema.safeParse(validRequest({ message })).success).toBe(
        false,
      );
    });

    it("accepts a message exactly at the cap", () => {
      const message = "가".repeat(MAX_MESSAGE_LENGTH);
      expect(chatRequestSchema.safeParse(validRequest({ message })).success).toBe(
        true,
      );
    });

    it("rejects a non-string message", () => {
      expect(chatRequestSchema.safeParse(validRequest({ message: 42 })).success).toBe(
        false,
      );
    });
  });

  describe("now", () => {
    it.each(["점심때쯤", "", "2026-13-45T99:00:00Z"])(
      "rejects %j",
      (now) => {
        expect(chatRequestSchema.safeParse(validRequest({ now })).success).toBe(
          false,
        );
      },
    );
  });

  describe("dailyGoalCalories", () => {
    it("rejects a non-integer", () => {
      expect(
        chatRequestSchema.safeParse(validRequest({ dailyGoalCalories: 2100.5 }))
          .success,
      ).toBe(false);
    });

    it("rejects zero and negatives", () => {
      expect(
        chatRequestSchema.safeParse(validRequest({ dailyGoalCalories: 0 })).success,
      ).toBe(false);
      expect(
        chatRequestSchema.safeParse(validRequest({ dailyGoalCalories: -100 }))
          .success,
      ).toBe(false);
    });
  });

  describe("recentItems", () => {
    it("rejects a malformed entry", () => {
      const parsed = chatRequestSchema.safeParse(
        validRequest({ recentItems: [{ id: "x" }] }),
      );
      expect(parsed.success).toBe(false);
    });

    it("rejects an entry whose calories are not a usable number", () => {
      for (const calories of [Number.NaN, -1, 1e9, "650"]) {
        const parsed = chatRequestSchema.safeParse(
          validRequest({
            recentItems: [
              {
                id: "i",
                name: "갈비탕",
                calories,
                consumedAt: "2026-09-20T12:40:00+09:00",
              },
            ],
          }),
        );
        expect(parsed.success, `calories=${String(calories)}`).toBe(false);
      }
    });

    it("rejects an unknown meal type", () => {
      const parsed = chatRequestSchema.safeParse(
        validRequest({
          recentItems: [
            {
              id: "i",
              name: "갈비탕",
              calories: 650,
              mealType: "brunch",
              consumedAt: "2026-09-20T12:40:00+09:00",
            },
          ],
        }),
      );
      expect(parsed.success).toBe(false);
    });

    it("rejects a list that is not an array", () => {
      expect(
        chatRequestSchema.safeParse(validRequest({ recentItems: {} })).success,
      ).toBe(false);
    });

    it("rejects more entries than one day could plausibly hold", () => {
      const item = {
        id: "i",
        name: "갈비탕",
        calories: 650,
        consumedAt: "2026-09-20T12:40:00+09:00",
      };
      const parsed = chatRequestSchema.safeParse(
        validRequest({
          recentItems: Array.from({ length: MAX_RECENT_ITEMS + 1 }, () => item),
        }),
      );
      expect(parsed.success).toBe(false);
    });
  });
});
