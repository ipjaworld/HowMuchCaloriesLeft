#!/usr/bin/env node
/**
 * Prints the foods users reported as missing, most reported first.
 *
 *   UPSTASH_REDIS_REST_URL=... UPSTASH_REDIS_REST_TOKEN=... node scripts/ops/list-food-reports.mjs [limit]
 *
 * (KV_REST_API_URL / KV_REST_API_TOKEN are read too.) Read-only: it removes
 * nothing. To drop a name once it has been added or declined:
 *
 *   node scripts/ops/list-food-reports.mjs --remove "파김치"
 *
 * The token is read from the environment and never printed.
 */

const url = (process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL ?? "").replace(/\/+$/, "");
const token = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN ?? "";
if (url === "" || token === "") {
  console.error("UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required.");
  process.exit(1);
}

const COUNTS = "hmcl:food-reports:count";
const LAST = "hmcl:food-reports:last";

async function run(commands) {
  const response = await fetch(`${url}/multi-exec`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(commands),
  });
  if (!response.ok) throw new Error(`store answered ${response.status}`);
  const body = await response.json();
  const failed = body.find((entry) => "error" in entry);
  if (failed) throw new Error(failed.error);
  return body.map((entry) => entry.result);
}

const args = process.argv.slice(2);
if (args[0] === "--remove") {
  const name = args[1];
  if (!name) {
    console.error('Usage: --remove "<name>"');
    process.exit(1);
  }
  const [removed] = await run([["ZREM", COUNTS, name], ["HDEL", LAST, name]]);
  console.log(removed === 1 ? `removed: ${name}` : `not in the list: ${name}`);
} else {
  const limit = Math.max(1, Number(args[0] ?? 100) || 100);
  const [flat, last] = await run([["ZREVRANGE", COUNTS, "0", String(limit - 1), "WITHSCORES"], ["HGETALL", LAST]]);
  const lastDay = new Map();
  for (let i = 0; i + 1 < last.length; i += 2) lastDay.set(last[i], last[i + 1]);
  if (flat.length === 0) console.log("No reports yet.");
  for (let i = 0; i + 1 < flat.length; i += 2)
    console.log(`${String(flat[i + 1]).padStart(4)}  ${lastDay.get(flat[i]) ?? "          "}  ${flat[i]}`);
}
