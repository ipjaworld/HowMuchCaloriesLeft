import { describe, expect, it, vi } from "vitest";
import { createMfdsClient } from "./client";

/** A fake API: `pages` rows per page, `total` overall. No network. */
function fakeFetch(total: number, perPage = 100) {
  return vi.fn(async (url: string | URL | Request) => {
    const pageNo = Number(new URL(String(url)).searchParams.get("pageNo"));
    const start = (pageNo - 1) * perPage;
    const items = Array.from({ length: Math.max(0, Math.min(perPage, total - start)) }, (_, i) => ({
      FOOD_CD: `R000-${String(start + i).padStart(9, "0")}-0000`,
      FOOD_NM_KR: "우유",
    }));
    return new Response(
      JSON.stringify({
        header: { resultCode: "00", resultMsg: "NORMAL" },
        body: { totalCount: total, items },
      }),
    );
  });
}

describe("MFDS client paging", () => {
  it("pages to the end when nothing stops it", async () => {
    const fetchImpl = fakeFetch(250);
    const client = createMfdsClient({ apiKey: "k", fetchImpl: fetchImpl as typeof fetch });
    const rows = await client.searchByName("우유");
    expect(rows).toHaveLength(250);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("stops once the page holding the wanted row has been read", async () => {
    const fetchImpl = fakeFetch(2809);
    const client = createMfdsClient({ apiKey: "k", fetchImpl: fetchImpl as typeof fetch });
    const wanted = "R000-000000150-0000";
    const rows = await client.searchByName("우유", { stopWhen: (row) => row.FOOD_CD === wanted });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(rows.some((row) => row.FOOD_CD === wanted)).toBe(true);
  });

  it("reaches a row on page 28 of a 2,809-row search", async () => {
    // The plain milk row sits there; the old 20-page cap never saw it.
    const fetchImpl = fakeFetch(2809);
    const client = createMfdsClient({ apiKey: "k", fetchImpl: fetchImpl as typeof fetch });
    const wanted = "R000-000002750-0000";
    const rows = await client.searchByName("우유", { stopWhen: (row) => row.FOOD_CD === wanted });
    expect(rows.some((row) => row.FOOD_CD === wanted)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(28);
  });
});
