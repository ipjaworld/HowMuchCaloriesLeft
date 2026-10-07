// Disposable, in-memory PostgreSQL validation. No network or real project keys.
// Pass the absolute path to @electric-sql/pglite/dist/index.js as argv[2].
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
const { PGlite } = await import(pathToFileURL(resolve(process.argv[2])).href);
const db = new PGlite();
let passed = 0;
const test = async (name, action) => { await action(); passed++; console.log(`ok ${passed}: ${name}`); };
const scalar = async (sql, params = []) => Object.values((await db.query(sql, params)).rows[0])[0];
async function as(role, user, session, action) {
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, sub: user, session_id: session })]);
  await db.exec(`set role ${role}`);
  try { return await action(); } finally { await db.exec("reset role"); }
}
const service = (action) => as("service_role", undefined, undefined, action);
const receive = (providerId) => service(() => db.query("select public.receive_kakao_unlink($1)", [providerId]));
const processJobs = () => db.exec("select private.process_kakao_unlinks()");
async function seed(providerId, google = false) {
  const user = randomUUID(), identity = randomUUID(), session = randomUUID();
  await db.query("insert into auth.users(id,raw_app_meta_data) values($1,'{}')", [user]);
  await db.query("insert into auth.identities(id,user_id,provider,provider_id,last_sign_in_at) values($1,$2,'kakao',$3,now()-interval '1 day')", [identity,user,providerId]);
  if (google) await db.query("insert into auth.identities(id,user_id,provider,provider_id,last_sign_in_at) values($1,$2,'google',$3,now())", [randomUUID(),user,`google-${providerId}`]);
  await db.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,now()-interval '1 day')", [session,user]);
  await db.query("insert into public.account_data(user_id,data,consent_version) values($1,$2,'test')", [user,JSON.stringify({records:[],goals:[],turns:[],meta:{}})]);
  await db.query("insert into public.account_profiles(user_id,profile,consent_version) values($1,'{}','test')", [user]);
  return { user,identity,session,providerId };
}
async function freshSession(account, freshIdentity = true) {
  account.session = randomUUID();
  await db.query("insert into auth.sessions(id,user_id,created_at) values($1,$2,clock_timestamp())", [account.session,account.user]);
  if (freshIdentity) await db.query("update auth.identities set last_sign_in_at=clock_timestamp() where id=$1", [account.identity]);
}
const disconnectedAt = (account) => scalar("select disconnected_at::text from private.account_recovery where user_id=$1", [account.user]);
const restore = async (account, profile, at) => as("authenticated",account.user,account.session, () =>
  db.query("select public.restore_my_account($1,$2)", [at, profile]));

try {
  // Minimal Auth fixture schema, with the real PostgreSQL ownership/RLS engine.
  // pg_cron is stubbed only for scheduling; functions are executed explicitly.
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema cron;
    create function cron.schedule(text,text,text) returns bigint language sql as 'select 1::bigint';
    create table auth.users(id uuid primary key,raw_app_meta_data jsonb);
    create table auth.identities(id uuid primary key,user_id uuid references auth.users on delete cascade,
      provider text,provider_id text,last_sign_in_at timestamptz,unique(provider,provider_id));
    create table auth.sessions(id uuid primary key,user_id uuid references auth.users on delete cascade,
      created_at timestamptz,not_after timestamptz);
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
    grant usage on schema auth to authenticated,anon,service_role;
  `);
  for (const name of ["20261007031403_account_storage.sql", "20261007032030_optional_profile_storage.sql", "20261007040148_kakao_unlink_cleanup.sql"]) {
    const sql = await readFile(new URL(`../migrations/${name}`, import.meta.url), "utf8");
    await db.exec(sql.replace("create extension if not exists pg_cron;", ""));
  }
  const solo = await seed("111"), multi = await seed("222",true), other = await seed("333");
  await test("default-off switch refuses intake", async () => {
    await assert.rejects(receive(solo.providerId), /not enabled/);
    assert.equal(await scalar("select count(*)::int from private.kakao_unlink_jobs"), 0);
  });
  await db.exec("update private.account_lifecycle_settings set enabled=true");
  await test("queued unlink immediately blocks both record tables", async () => {
    await receive(solo.providerId);
    await as("authenticated",solo.user,solo.session,async () => {
      assert.equal(await scalar("select count(*)::int from public.account_data"),0);
      assert.equal(await scalar("select count(*)::int from public.account_profiles"),0);
      await assert.rejects(db.query("insert into public.account_data(user_id,data,consent_version) values($1,$2,'test')",[solo.user,'{"records":[],"goals":[],"turns":[],"meta":{}}']), /row-level security/);
    });
  });
  await test("sole Kakao account retains records for exactly 168 hours and loses sessions",async () => {
    await processJobs();
    assert.equal(await scalar("select count(*)::int from auth.users where id=$1",[solo.user]),1);
    assert.equal(await scalar("select count(*)::int from public.account_data where user_id=$1",[solo.user]),1);
    assert.equal(await scalar("select count(*)::int from auth.sessions where user_id=$1",[solo.user]),0);
    assert.equal(await scalar("select delete_after-disconnected_at=interval '168 hours' from private.account_recovery where user_id=$1",[solo.user]),true);
  });
  const originalAt = await disconnectedAt(solo);
  await test("duplicate intake does not extend the recovery deadline",async () => {
    await receive(solo.providerId); await processJobs();
    assert.equal(await disconnectedAt(solo),originalAt);
  });
  await test("revoked sessions and non-Kakao reauthentication cannot recover",async () => {
    await assert.rejects(restore(solo,true,originalAt), /fresh Kakao/);
    await freshSession(solo,false);
    await assert.rejects(restore(solo,true,originalAt), /fresh Kakao/);
  });
  await test("fresh matching identity needs the current recovery generation",async () => {
    await freshSession(solo);
    await assert.rejects(restore(solo,true,"2020-01-01T00:00:00Z"), /recovery unavailable/);
  });
  await test("explicit recovery preserves records and omits profile without renewed consent",async () => {
    await restore(solo,false,originalAt);
    assert.equal(await scalar("select count(*)::int from private.account_recovery where user_id=$1",[solo.user]),0);
    assert.equal(await scalar("select count(*)::int from public.account_profiles where user_id=$1",[solo.user]),0);
    await as("authenticated",solo.user,solo.session,async () => {
      assert.equal(await scalar("select count(*)::int from public.account_data"),1);
      assert.equal(await scalar("select count(*)::int from public.account_data where user_id=$1",[other.user]),0);
    });
  });
  await test("linked Google account keeps records and removes only Kakao identity",async () => {
    await receive(multi.providerId); await processJobs();
    assert.equal(await scalar("select count(*)::int from public.account_data where user_id=$1",[multi.user]),1);
    assert.equal(await scalar("select count(*)::int from auth.identities where user_id=$1 and provider='kakao'",[multi.user]),0);
    assert.equal(await scalar("select count(*)::int from auth.identities where user_id=$1 and provider='google'",[multi.user]),1);
    assert.equal(await scalar("select count(*)::int from private.account_recovery where user_id=$1",[multi.user]),0);
    assert.equal(await scalar("select count(*)::int from auth.sessions where user_id=$1",[multi.user]),0);
  });
  const expired = await seed("444");
  await receive(expired.providerId); await processJobs();
  await db.query("update private.account_recovery set disconnected_at=now()-interval '169 hours',delete_after=now()-interval '1 hour' where user_id=$1",[expired.user]);
  await freshSession(expired);
  await test("expired grace refuses recovery even before the cron deletes it",async () => {
    await assert.rejects(restore(expired,true,await disconnectedAt(expired)), /recovery unavailable/);
    await as("authenticated",expired.user,expired.session,async () => {
      assert.equal((await scalar("select public.my_account_recovery()")).state,"expired");
      assert.equal(await scalar("select count(*)::int from public.account_data"),0);
    });
  });
  await test("purge is off by default and deletes only expired suspended accounts when enabled",async () => {
    await db.exec("update private.account_lifecycle_settings set enabled=false; select private.purge_expired_accounts()");
    assert.equal(await scalar("select count(*)::int from auth.users where id=$1",[expired.user]),1);
    await db.exec("update private.account_lifecycle_settings set enabled=true; select private.purge_expired_accounts()");
    assert.equal(await scalar("select count(*)::int from auth.users where id=$1",[expired.user]),0);
    assert.equal(await scalar("select count(*)::int from public.account_data where user_id=$1",[expired.user]),0);
    assert.equal(await scalar("select count(*)::int from public.account_profiles where user_id=$1",[expired.user]),0);
    assert.equal(await scalar("select count(*)::int from auth.users where id=$1",[other.user]),1);
  });
  const withProfile = await seed("555");
  await receive(withProfile.providerId); await processJobs(); await freshSession(withProfile);
  await test("optional renewed profile consent preserves the existing profile",async () => {
    await restore(withProfile,true,await disconnectedAt(withProfile));
    assert.equal(await scalar("select count(*)::int from public.account_profiles where user_id=$1",[withProfile.user]),1);
  });
  await test("a login linked during grace prevents account deletion at expiry",async () => {
    const lateLinked = await seed("666");
    await receive(lateLinked.providerId); await processJobs();
    await db.query("insert into auth.identities(id,user_id,provider,provider_id,last_sign_in_at) values($1,$2,'google','late-google',now())",[randomUUID(),lateLinked.user]);
    await db.query("update private.account_recovery set disconnected_at=now()-interval '169 hours',delete_after=now()-interval '1 hour' where user_id=$1",[lateLinked.user]);
    await db.exec("select private.purge_expired_accounts()");
    assert.equal(await scalar("select count(*)::int from public.account_data where user_id=$1",[lateLinked.user]),1);
    assert.equal(await scalar("select count(*)::int from private.account_recovery where user_id=$1",[lateLinked.user]),0);
    assert.equal(await scalar("select count(*)::int from auth.identities where user_id=$1 and provider='kakao'",[lateLinked.user]),0);
  });
  await test("explicit account deletion remains immediate during grace",async () => {
    await receive(other.providerId); await processJobs(); await freshSession(other);
    await as("authenticated",other.user,other.session,() => db.exec("select public.delete_my_account()"));
    assert.equal(await scalar("select count(*)::int from auth.users where id=$1",[other.user]),0);
  });
  await test("ordinary users cannot enqueue, run cleanup, or read private recovery rows",async () => {
    await as("authenticated",solo.user,solo.session,async () => {
      await assert.rejects(db.exec("select public.receive_kakao_unlink('111')"), /permission denied/);
      await assert.rejects(db.exec("select private.process_kakao_unlinks()"), /permission denied/);
      await assert.rejects(db.exec("select private.purge_expired_accounts()"), /permission denied/);
      await assert.rejects(db.exec("select * from private.account_recovery"), /permission denied/);
    });
    await as("anon",undefined,undefined,() => assert.rejects(db.exec("select public.my_account_recovery()"), /permission denied/));
  });
  console.log(`${passed} PostgreSQL lifecycle checks passed (disposable in-memory database).`);
} finally { await db.close(); }
