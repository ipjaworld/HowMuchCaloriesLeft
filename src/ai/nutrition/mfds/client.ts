import { z } from "zod";

/**
 * The MFDS (식품의약품안전처) food-nutrition open API, as it actually
 * responds — every field name here was read off a live response, not off the
 * portal's documentation.
 *
 *   GET {endpoint}/getFoodNtrCpntDbInq03
 *       ?serviceKey=...&pageNo=1&numOfRows=100&type=json&FOOD_NM_KR=갈비탕
 *
 * Two things about the shape are worth knowing before reading `importer.ts`:
 *
 *   - Nutrients arrive as `AMT_NUM1`..`AMT_NUM157`, numbered rather than
 *     named. Only `AMT_NUM1` (energy) is read here, and the importer proves
 *     that reading against the other macros rather than trusting it.
 *   - `FOOD_NM_KR` search is a *substring* match over 331,212 rows, so it
 *     returns dangerous neighbours: "커피" matches 커피번 at 389 kcal/100 g.
 *     Nothing in this project selects a food by search alone.
 */

const headerSchema = z.object({
  resultCode: z.string(),
  resultMsg: z.string(),
});

/**
 * Only the fields this project reads are named. Everything else on the row is
 * kept as unknown so a response can be logged whole when something looks off.
 */
export const mfdsRowSchema = z
  .object({
    FOOD_CD: z.string().min(1),
    FOOD_NM_KR: z.string().min(1),
    /** 음식 · 가공식품 · 원재료성 */
    DB_GRP_NM: z.string().nullish(),
    /** 품목대표 · 상용제품 · 외식 */
    DB_CLASS_NM: z.string().nullish(),
    FOOD_CAT1_NM: z.string().nullish(),
    /** The basis every AMT_NUM is measured against: "100g" or "100mL". */
    SERVING_SIZE: z.string().nullish(),
    /** Energy. Verified as kcal per `SERVING_SIZE` — see `importer.ts`. */
    AMT_NUM1: z.string().nullish(),
    /** Protein, fat and carbohydrate, used only to check `AMT_NUM1`. */
    AMT_NUM3: z.string().nullish(),
    AMT_NUM4: z.string().nullish(),
    AMT_NUM6: z.string().nullish(),
    /** Total weight of the food as served, e.g. "670.000g" for a 갈비탕. */
    Z10500: z.string().nullish(),
    /** Label serving size on a packaged product, e.g. "210g". */
    NUTRI_AMOUNT_SERVING: z.string().nullish(),
    /** 분석 · 수집 · 산출 — how the figures were produced. */
    CRT_MTH_NM: z.string().nullish(),
    RESEARCH_YMD: z.string().nullish(),
    UPDATE_DATE: z.string().nullish(),
  })
  .loose();

export type MfdsRow = z.infer<typeof mfdsRowSchema>;

const responseSchema = z.object({
  header: headerSchema,
  body: z
    .object({
      pageNo: z.number().nullish(),
      totalCount: z.number().nullish(),
      numOfRows: z.number().nullish(),
      items: z.array(mfdsRowSchema).nullish(),
    })
    .nullish(),
});

export type MfdsClientOptions = {
  apiKey: string;
  endpoint?: string;
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
};

const DEFAULT_ENDPOINT = "https://apis.data.go.kr/1471000/FoodNtrCpntDbInfo03";
const OPERATION = "getFoodNtrCpntDbInq03";

/** The API's own cap per request. */
const MAX_ROWS_PER_PAGE = 100;

/** Refuses to page forever if `totalCount` and the rows ever disagree. */
const MAX_PAGES = 20;

export class MfdsError extends Error {}

/**
 * Never let the key reach a log line, an error message or a thrown stack —
 * the URL carries it as a query parameter, so any message built from the URL
 * has to go through here first.
 */
function redact(text: string, apiKey: string): string {
  return text
    .split(encodeURIComponent(apiKey))
    .join("[REDACTED]")
    .split(apiKey)
    .join("[REDACTED]");
}

export type MfdsClient = {
  /** Every row whose `FOOD_NM_KR` contains `name`. */
  searchByName(name: string): Promise<MfdsRow[]>;
};

export function createMfdsClient({
  apiKey,
  endpoint = DEFAULT_ENDPOINT,
  fetchImpl = fetch,
}: MfdsClientOptions): MfdsClient {
  async function fetchPage(name: string, pageNo: number) {
    const params = new URLSearchParams({
      serviceKey: apiKey,
      pageNo: String(pageNo),
      numOfRows: String(MAX_ROWS_PER_PAGE),
      type: "json",
      FOOD_NM_KR: name,
    });
    const url = `${endpoint}/${OPERATION}?${params.toString()}`;

    let response: Response;
    try {
      response = await fetchImpl(url);
    } catch (cause) {
      throw new MfdsError(
        redact(`MFDS request failed for "${name}": ${String(cause)}`, apiKey),
      );
    }

    if (!response.ok) {
      throw new MfdsError(
        `MFDS returned HTTP ${response.status} for "${name}"`,
      );
    }

    const text = await response.text();

    // A rejected key comes back as an XML error page with a 200, so the
    // JSON parse is where that surfaces.
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new MfdsError(
        redact(
          `MFDS returned a non-JSON body for "${name}": ${text.slice(0, 200)}`,
          apiKey,
        ),
      );
    }

    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new MfdsError(`MFDS response did not match the expected shape for "${name}"`);
    }

    if (parsed.data.header.resultCode !== "00") {
      throw new MfdsError(
        `MFDS refused the request for "${name}": ${parsed.data.header.resultMsg}`,
      );
    }

    return {
      rows: parsed.data.body?.items ?? [],
      totalCount: parsed.data.body?.totalCount ?? 0,
    };
  }

  return {
    async searchByName(name: string): Promise<MfdsRow[]> {
      const collected: MfdsRow[] = [];

      for (let pageNo = 1; pageNo <= MAX_PAGES; pageNo++) {
        const { rows, totalCount } = await fetchPage(name, pageNo);
        collected.push(...rows);

        if (rows.length === 0 || collected.length >= totalCount) break;
      }

      return collected;
    },
  };
}
