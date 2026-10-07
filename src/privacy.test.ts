import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { chatRequestSchema } from "@/app/api/chat/schema";
import { buildChatRequest } from "@/components/chatRequest";
import type { MealRecord } from "@/domain/meal";

/**
 * Calculator inputs remain local by default. Only the dedicated, separately
 * consented account profile route may receive them. Food judgment and record
 * import never carry a profile. Behavioral consent checks live in route and
 * repository tests; these checks guard the module and request boundaries.
 */

const SRC = join(__dirname);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const PROFILE_FIELDS = ["weightKg", "heightCm", "age", "sex", "activityLevel", "goalMode"];

const RECORD: MealRecord = {
  id: "r1",
  consumedAt: "2026-09-27T03:00:00.000Z",
  sourceText: "삶은 달걀 두 개",
  items: [
    {
      id: "i1",
      name: "삶은 달걀",
      amount: "두 개",
      calories: 150,
      caloriesEstimated: true,
      portionNote: "1개 50g 기준 · 주달래, Korean Clin Diabetes J 2010",
    },
  ],
  createdAt: "2026-09-27T03:00:00.000Z",
  updatedAt: "2026-09-27T03:00:00.000Z",
};

describe("the /api/chat request carries no profile", () => {
  it("is built from exactly four fields", () => {
    const body = buildChatRequest({
      message: "삶은 달걀 두 개 먹었어",
      now: new Date("2026-09-27T03:00:00.000Z"),
      dailyGoalCalories: 1690,
      records: [RECORD],
    });
    expect(Object.keys(body).sort()).toEqual(
      ["dailyGoalCalories", "message", "now", "recentItems"].sort(),
    );
    const serialized = JSON.stringify(body);
    for (const field of PROFILE_FIELDS) expect(serialized).not.toContain(`"${field}"`);
  });

  it("is dropped by the server schema even if a client tried to send it", () => {
    const parsed = chatRequestSchema.parse({
      message: "갈비탕",
      now: "2026-09-27T03:00:00.000Z",
      dailyGoalCalories: 1690,
      recentItems: [],
      profile: { weightKg: 60, heightCm: 165, age: 30 },
      weightKg: 60,
    });
    expect(parsed).not.toHaveProperty("profile");
    expect(parsed).not.toHaveProperty("weightKg");
  });

  it("does not send a stored item's portion note either", () => {
    const body = buildChatRequest({
      message: "x",
      now: new Date(),
      dailyGoalCalories: null,
      records: [RECORD],
    });
    expect(body.recentItems[0]).not.toHaveProperty("portionNote");
  });
});

/**
 * Every module a server route can reach, following `@/` and relative imports
 * from each `route.ts`. Type-only imports are followed too: if a route could
 * even *name* the profile type, something is wired wrong.
 */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || seen.has(file)) continue;
    seen.add(file);

    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/from\s+"([^"]+)"/g)) {
      const specifier = match[1] ?? "";
      const base = specifier.startsWith("@/")
        ? join(SRC, specifier.slice(2))
        : specifier.startsWith(".")
          ? join(file, "..", specifier)
          : null;
      if (base === null) continue;
      for (const candidate of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
        try {
          if (statSync(candidate).isFile()) {
            queue.push(candidate);
            break;
          }
        } catch {
          // Not this extension.
        }
      }
    }
  }
  return seen;
}

describe("only the consent-gated profile route can touch profile types", () => {
  const routes = sourceFiles(join(SRC, "app", "api")).filter((file) =>
    file.endsWith("route.ts"),
  );

  it("finds the judgment and account routes", () => {
    expect(routes.length).toBeGreaterThanOrEqual(7);
  });

  it("cannot reach a profile module from other routes, even as a type", () => {
    for (const route of routes) {
      const reachable = [...reachableFrom(route)].map((file) =>
        relative(SRC, file).replaceAll("\\", "/"),
      );
      // Sanity: the walk really follows imports.
      expect(reachable.length).toBeGreaterThanOrEqual(3);
      if(relative(SRC,route).replaceAll("\\", "/")!=="app/api/account/profile/route.ts") expect(reachable, relative(SRC, route)).not.toContain("domain/dietProfile.ts");
      expect(reachable, relative(SRC, route)).not.toContain(
        "infrastructure/localStorageDietProfileRepository.ts",
      );
      expect(reachable, relative(SRC, route)).not.toContain("application/calculatedGoal.ts");
    }
  });

  it("reads the local profile only in the calculator and explicit opt-in panel", () => {
    const readers = sourceFiles(SRC).filter((file) =>
      readFileSync(file, "utf8").includes("localStorageDietProfileRepository"),
    );
    expect(readers.map((file) => relative(SRC, file).replaceAll("\\", "/"))).toEqual([
      "components/AccountProfilePanel.tsx",
      "components/TodayScreen.tsx",
    ]);
  });
});

describe("there is nowhere else for it to go", () => {
  it("ships no analytics or tracking dependency", () => {
    const pkg = JSON.parse(readFileSync(join(SRC, "..", "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(
      ["@supabase/ssr", "@supabase/supabase-js", "@typesafe-ai/sdk", "next", "react", "react-dom", "zod"].sort(),
    );
  });

  it("calls no analytics endpoint from source", () => {
    const pattern = /gtag\(|google-analytics|posthog|mixpanel|amplitude|@vercel\/analytics|sendBeacon/;
    for (const file of sourceFiles(SRC)) {
      expect(readFileSync(file, "utf8"), relative(SRC, file)).not.toMatch(pattern);
    }
  });

  it("fetches only the app's own judgment and account routes from the client", () => {
    const fetched = sourceFiles(join(SRC, "components")).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/fetch\(\s*"([^"]+)"/g)].map((m) => m[1]),
    );
    expect([...new Set(fetched)].sort()).toEqual(["/api/account", "/api/account/profile", "/api/chat", "/api/resolve"]);
  });
});
