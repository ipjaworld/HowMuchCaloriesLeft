// No real database, credentials or backups. Run with node scripts/ops/backup-retention.test.mjs.
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const tempRoot = resolve(tmpdir());
const fixture = mkdtempSync(join(tempRoot, "hmcl-backup-test-"));
const bash = process.env.BASH_BIN ?? (process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash");
const shellPath = (value) => value.replaceAll("\\", "/").replace(/^([A-Za-z]):/, (_, drive) => `/${drive.toLowerCase()}`);
let passed = 0;
const test = (name, action) => { action(); console.log(`ok ${++passed}: ${name}`); };
const run = (dir, args = [], keep = "3") => {
  const result = spawnSync(bash, [shellPath(join(root, "scripts/ops/backup-account-db.sh")), ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, BACKUP_DIR: shellPath(dir), BACKUP_KEEP: keep, SUPABASE_DB_URL: "" },
  });
  if (result.error) throw result.error;
  return result;
};
const nameAt = (days) => `calories-account-${new Date(Date.now() - days * 86400000).toISOString().replaceAll(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}.sql.gpg`;
try {
  const dir = join(fixture, "backup with spaces");
  mkdirSync(dir);
  const names = [0, 1, 2, 3, 100].map(nameAt);
  for (const name of names) writeFileSync(join(dir, name), "fixture");
  writeFileSync(join(dir, "unrelated.sql.gpg"), "keep");
  test("dry run reports deletions but changes no files", () => {
    const r = run(dir, ["--prune-only", "--dry-run"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /would delete/);
    assert.equal(readdirSync(dir).length, 6);
  });
  test("cleanup keeps newest three and preserves unrelated files", () => {
    const r = run(dir, ["--prune-only"]);
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(readdirSync(dir).sort(), [...names.slice(0, 3), "unrelated.sql.gpg"].sort());
  });
  test("an expired sole backup is removed even when fewer than three exist", () => {
    const expired = join(fixture, "expired"); mkdirSync(expired);
    writeFileSync(join(expired, nameAt(90)), "fixture");
    assert.equal(run(expired, ["--prune-only"]).status, 0);
    assert.equal(readdirSync(expired).length, 0);
  });
  test("empty directory succeeds", () => {
    const empty = join(fixture, "empty"); mkdirSync(empty);
    assert.equal(run(empty, ["--prune-only"]).status, 0);
  });
  test("dry run does not create missing directories", () => {
    const missing = join(fixture, "missing");
    assert.equal(run(missing, ["--dry-run"]).status, 0);
    assert.equal(existsSync(missing), false);
  });
  test("repository destination is rejected without creating it", () => {
    const inside = join(root, "backup-guard-test-must-not-exist");
    assert.equal(existsSync(inside), false);
    assert.notEqual(run(inside, ["--prune-only"]).status, 0);
    assert.equal(existsSync(inside), false);
  });
  test("policy expansion and unknown options are rejected", () => {
    assert.notEqual(run(dir, ["--prune-only"], "4").status, 0);
    assert.notEqual(run(dir, ["--unknown"]).status, 0);
  });
  test("missing DB URL fails without deleting existing backups", () => {
    const before = readdirSync(dir);
    assert.notEqual(run(dir).status, 0);
    assert.deepEqual(readdirSync(dir), before);
  });
  console.log(`${passed} backup retention checks passed (temporary fixtures only).`);
} finally {
  // Resolve and constrain the recursive cleanup to this test's unique temp folder.
  assert.equal(dirname(resolve(fixture)), tempRoot);
  assert.ok(basename(fixture).startsWith("hmcl-backup-test-"));
  rmSync(fixture, { recursive: true, force: true });
}
