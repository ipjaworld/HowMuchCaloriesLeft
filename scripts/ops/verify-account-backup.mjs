// Local-only restore drill. Never accepts a database URL or contacts production.
// node scripts/ops/verify-account-backup.mjs <backup.sql.gpg> <official-auth-migrations-dir>
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const [backup, authDir] = process.argv.slice(2);
assert.ok(backup?.endsWith(".sql.gpg") && authDir, "Supply encrypted backup and official Auth migrations directory");
const image = "sha256:b8faeff7712663c2773a190181e1246e37e364b887611c04658c28b44e2408fe";
const container = `hmcl-restore-check-${randomUUID()}`;
const gpg = process.env.GPG_BIN ?? (process.platform === "win32" ? "C:/Program Files/Git/usr/bin/gpg.exe" : "gpg");
const label = "hmcl.backup-restore-check";
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^(PG|SUPABASE_|DATABASE_URL|HMCL_DB_PASSWORD)/.test(key)) delete env[key];
function call(command, args, input) {
  const r = spawnSync(command, args, { input, encoding: "utf8", env, maxBuffer: 64 * 1024 * 1024, timeout: 60000 });
  if (r.error) throw new Error(`Could not run ${command}: ${r.error.code ?? "execution error"}`);
  return r;
}
function docker(args, input) {
  const r = call("docker", args, input);
  if (r.status !== 0) throw new Error(`Docker operation failed: ${args[0]} (details suppressed to protect backup contents)`);
  return r.stdout;
}
function query(sql, allowFailure = false) {
  const r = call("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-U", "postgres", "-d", "hmcl_restore"], sql);
  if (allowFailure) return r;
  if (r.status !== 0) throw new Error(`Local SQL failed (${r.stderr.match(/ERROR:\s*([A-Z0-9]{5})/)?.[1] ?? "unknown SQLSTATE"}); private SQL output suppressed`);
  return r.stdout.trimEnd();
}
const hash = (text) => createHash("sha256").update(text).digest("hex");
const rowLines = (text) => text.trimEnd().split("\n").filter(Boolean).sort();
let started = false;
let stage = "container startup";
try {
  const context = docker(["context", "show"]).trim();
  const endpoint = env.DOCKER_HOST ?? docker(["context", "inspect", context, "--format", "{{.Endpoints.docker.Host}}"] ).trim();
  assert.match(endpoint, /^(npipe:\/\/|unix:\/)/, "Only a local Docker socket is allowed");
  docker(["run", "--detach", "--pull", "never", "--name", container, "--label", `${label}=true`, "--network", "none", "--log-driver", "none", "--tmpfs", "/var/lib/postgresql/data:rw", "--tmpfs", "/tmp:rw", "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_DB=hmcl_restore", image]);
  started = true;
  const info = JSON.parse(docker(["inspect", container]))[0];
  assert.equal(info.HostConfig.NetworkMode, "none");
  assert.equal(Object.keys(info.HostConfig.PortBindings ?? {}).length, 0);
  assert.ok(info.HostConfig.Tmpfs["/var/lib/postgresql/data"]);
  assert.equal(info.HostConfig.LogConfig.Type, "none");
  console.log("PASS isolation: no network, no published ports, database on tmpfs, container logs disabled");
  for (let n = 0; n < 40; n++) {
    const ready = call("docker", ["exec", container, "pg_isready", "-U", "postgres", "-d", "hmcl_restore"]);
    if (ready.status === 0) break;
    if (n === 39) throw new Error("Local PostgreSQL did not become ready");
    await new Promise((r) => setTimeout(r, 500));
  }
  stage = "schema bootstrap";
  query(`create role anon; create role authenticated; create role service_role;
    create schema auth; create extension if not exists pgcrypto; create extension if not exists "uuid-ossp";
    create schema cron; create table cron.local_jobs(name text primary key, schedule text, command text);
    create function cron.schedule(text,text,text) returns bigint language plpgsql as $$begin
      insert into cron.local_jobs values($1,$2,$3) on conflict(name) do update set schedule=$2, command=$3;
      return 1; end$$;`);
  const authFiles = readdirSync(authDir).filter((name) => name.endsWith(".up.sql")).sort();
  assert.ok(authFiles.includes("00_init_auth_schema.up.sql"));
  for (const name of authFiles) {
    stage = `Auth schema ${name}`;
    const sql = readFileSync(resolve(authDir, name), "utf8").replace(/{{\s*index \.Options "Namespace"\s*}}/g, "auth");
    assert.ok(!sql.includes("{{"), "Unsupported Auth SQL template");
    query(`set search_path=auth,public;\n${sql}`);
  }
  console.log(`PASS official Auth schema: ${authFiles.length} migrations`);
  // Only the three app migrations present when this backup was taken.
  const appFiles = ["20261007031403_account_storage.sql", "20261007032030_optional_profile_storage.sql", "20261007032222_resilient_conversation_retention.sql"];
  for (const name of appFiles) {
    stage = `app schema ${name}`;
    const sql = readFileSync(resolve(root, "supabase/migrations", name), "utf8");
    query(sql.replace("create extension if not exists pg_cron;", ""));
  }
  console.log("PASS app schema: three deployed migrations, cron registration stubbed (no scheduled execution)");
  stage = "decryption";
  const decrypted = call(gpg, ["--batch", "--pinentry-mode", "error", "--decrypt", resolve(backup)]);
  if (decrypted.status !== 0) throw new Error("GPG needs the backup passphrase entered locally; no plaintext was saved");
  const dump = decrypted.stdout.replaceAll("\r\n", "\n");
  const blocks = [...dump.matchAll(/^COPY ([\w.]+) \(([^\n]+)\) FROM stdin;\n([\s\S]*?)^\\\.$/gm)];
  const tables = ["auth.users", "auth.identities", "public.account_data", "public.account_profiles"];
  assert.deepEqual(blocks.map((m) => m[1]).sort(), [...tables].sort(), "Unexpected backup table set; review before restoring");
  assert.ok(!/^CREATE TABLE/m.test(dump), "Expected a data-only backup");
  stage = "restore in one transaction";
  const restore = call("docker", ["exec", "-i", container, "psql", "-X", "-q", "--single-transaction", "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-U", "postgres", "-d", "hmcl_restore"], dump);
  if (restore.status !== 0) throw new Error(`Restore failed (${restore.stderr.match(/ERROR:\s*([A-Z0-9]{5})/)?.[1] ?? "unknown SQLSTATE"}); private error details suppressed`);
  console.log("PASS restore: original dump imported, constraints and foreign keys enabled");
  stage = "round-trip content comparison";
  for (const block of blocks) {
    const [, table, columns, rows] = block;
    assert.match(columns, /^[a-z_, ]+$/);
    const actual = query(`set timezone='UTC'; COPY (SELECT ${columns} FROM ${table}) TO STDOUT;`);
    assert.equal(hash(rowLines(actual).join("\n")), hash(rowLines(rows).join("\n")), `Content mismatch in ${table}`);
    console.log(`PASS ${table}: ${rowLines(rows).length} rows, all backed-up columns match`);
  }
  stage = "data relationships and RLS";
  assert.equal(query(`select (select count(*) from auth.identities i left join auth.users u on u.id=i.user_id where u.id is null)
    +(select count(*) from public.account_data a left join auth.users u on u.id=a.user_id where u.id is null)
    +(select count(*) from public.account_profiles a left join auth.users u on u.id=a.user_id where u.id is null);`), "0");
  assert.equal(query("select count(*) from auth.sessions;"), "0");
  const ids = query("select id from auth.users order by id;").split("\n");
  for (const id of ids) {
    assert.match(id, /^[0-9a-f-]{36}$/);
    for (const table of ["public.account_data", "public.account_profiles"]) {
      const expected = query(`select count(*) from ${table} where user_id='${id}';`);
      const visible = query(`begin; set local role authenticated; set local "request.jwt.claim.sub"='${id}'; select count(*) from ${table}; rollback;`);
      assert.equal(visible, expected, `RLS visibility mismatch: ${table}`);
      const other = query(`begin; set local role authenticated; set local "request.jwt.claim.sub"='${id}'; with changed as (update ${table} set revision=revision+1 where user_id<>'${id}' returning user_id) select count(*) from changed; rollback;`);
      assert.equal(other, "0", `RLS cross-account write allowed: ${table}`);
    }
  }
  const anonymous = query("set role anon; select count(*) from public.account_data;", true);
  assert.notEqual(anonymous.status, 0);
  assert.match(anonymous.stderr, /42501/);
  console.log("PASS relationships: no orphan rows; sessions intentionally absent");
  console.log("PASS RLS: own-account visibility, cross-account update blocked, anonymous read denied");
  console.log("RESTORE_VERIFIED (database/data scope; OAuth and live cron not tested)");
} catch (error) {
  console.error(`FAIL at ${stage}: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (started) {
    const info = JSON.parse(docker(["inspect", container]))[0];
    assert.equal(info.Name, `/${container}`);
    assert.equal(info.Config.Labels[label], "true");
    docker(["rm", "--force", "--volumes", container]);
    const remaining = docker(["ps", "--all", "--filter", `name=${container}`, "--format", "{{.Names}}"]);
    assert.equal(remaining.trim(), "");
    console.log("PASS cleanup: this drill's container and temporary database removed; encrypted backup preserved");
  }
}
