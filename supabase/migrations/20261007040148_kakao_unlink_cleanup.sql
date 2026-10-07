-- UNAPPLIED migration: recovery retention must be approved before enabling.
-- This switch gates webhook intake and scheduled deletion, not RLS protection.
create table private.account_lifecycle_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into private.account_lifecycle_settings default values;
alter table private.account_lifecycle_settings enable row level security;
revoke all on private.account_lifecycle_settings from public,anon,authenticated,service_role;

create table private.account_recovery (
 user_id uuid primary key references auth.users(id) on delete cascade,
 identity_id uuid not null,
 disconnected_at timestamptz not null,
 delete_after timestamptz not null,
 check(delete_after=disconnected_at+interval '168 hours')
);
create index account_recovery_expiry_idx on private.account_recovery(delete_after);
alter table private.account_recovery enable row level security;
revoke all on private.account_recovery from public,anon,authenticated,service_role;

-- A queued event immediately blocks record access, even before cron runs.
create table private.kakao_unlink_jobs (
 identity_id uuid primary key,
 user_id uuid not null references auth.users(id) on delete cascade,
 received_at timestamptz not null default now(),
 attempts integer not null default 0,
 last_error_code text
);
alter table private.kakao_unlink_jobs enable row level security;
create index kakao_unlink_jobs_user_id_idx on private.kakao_unlink_jobs(user_id);
revoke all on private.kakao_unlink_jobs from public,anon,authenticated,service_role;

create function private.detach_kakao_identity(target_user uuid, target_identity uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare remaining_providers jsonb;
begin
 delete from auth.sessions where user_id=target_user;
 delete from auth.identities where id=target_identity and user_id=target_user and provider='kakao';
 select jsonb_agg(distinct provider order by provider) into remaining_providers
  from auth.identities where user_id=target_user;
 update auth.users set raw_app_meta_data=
  jsonb_set(jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),
    '{providers}',remaining_providers),'{provider}',remaining_providers->0)
  where id=target_user;
 delete from private.account_recovery where user_id=target_user;
end; $$;
revoke all on function private.detach_kakao_identity(uuid,uuid) from public,anon,authenticated,service_role;

create function private.process_kakao_unlinks() returns void
language plpgsql security definer set search_path='' as $$
declare job record;
begin
 if not (select enabled from private.account_lifecycle_settings) then return; end if;
 for job in select * from private.kakao_unlink_jobs order by received_at
 limit 100 loop
  begin
   -- Lock the user before inspecting identities; FK inserts cannot race this.
   perform 1 from auth.users where id=job.user_id for update;
   perform 1 from private.kakao_unlink_jobs where identity_id=job.identity_id for update;
   if not found then continue; end if;
   if exists(select 1 from auth.identities where id=job.identity_id
             and user_id=job.user_id and provider='kakao') then
    delete from auth.sessions where user_id=job.user_id;
    if exists(select 1 from auth.identities where user_id=job.user_id
              and id<>job.identity_id) then
     perform private.detach_kakao_identity(job.user_id,job.identity_id);
    else
     -- Keep the original identity so fresh Kakao authentication resolves to
     -- this same account; email matching is never used for recovery.
     insert into private.account_recovery(user_id,identity_id,disconnected_at,delete_after)
      values(job.user_id,job.identity_id,job.received_at,job.received_at+interval '168 hours')
      on conflict(user_id) do nothing;
    end if;
   end if;
   delete from private.kakao_unlink_jobs where identity_id=job.identity_id;
  exception when others then
   update private.kakao_unlink_jobs set attempts=attempts+1,
    last_error_code=sqlstate where identity_id=job.identity_id;
  end;
 end loop;
end; $$;
revoke all on function private.process_kakao_unlinks() from public,anon,authenticated,service_role;

create function private.receive_kakao_unlink(provider_user_id text) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Machine-only endpoint: no end-user uid is accepted. Check the trusted
 -- gateway role as well as EXECUTE grants before touching auth data.
 if coalesce(auth.jwt()->>'role','')<>'service_role' then
  raise exception 'service role required' using errcode='42501';
 end if;
 if not (select enabled from private.account_lifecycle_settings) then
  raise exception 'lifecycle policy not enabled' using errcode='55000';
 end if;
 if provider_user_id is null or provider_user_id !~ '^[0-9]{1,32}$' then
  raise exception 'invalid provider ID' using errcode='22023';
 end if;
 insert into private.kakao_unlink_jobs(identity_id,user_id)
  select id,user_id from auth.identities
  where provider='kakao' and provider_id=provider_user_id
  on conflict(identity_id) do nothing;
 -- Acknowledge durable intake quickly; cron revokes sessions and removes
 -- only the Kakao identity when another verified login method remains.
end; $$;
revoke all on function private.receive_kakao_unlink(text) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.receive_kakao_unlink(text) to service_role;
create function public.receive_kakao_unlink(provider_user_id text) returns void
language sql security invoker set search_path='' as $$
 select private.receive_kakao_unlink(provider_user_id);
$$;
revoke all on function public.receive_kakao_unlink(text) from public,anon,authenticated;
grant execute on function public.receive_kakao_unlink(text) to service_role;
select cron.schedule('hmcl-kakao-unlink-retry','* * * * *',
 'select private.process_kakao_unlinks()');

-- A revoked refresh session must also stop still-unexpired access JWTs.
create function private.account_session_active() returns boolean
language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(
  select 1 from auth.sessions s where s.user_id=auth.uid()
   and s.id::text=auth.jwt()->>'session_id'
   and (s.not_after is null or s.not_after>now())
 ) and not exists(select 1 from private.kakao_unlink_jobs j where j.user_id=auth.uid())
 and not exists(select 1 from private.account_recovery r where r.user_id=auth.uid());
$$;
revoke all on function private.account_session_active() from public,anon;
grant execute on function private.account_session_active() to authenticated;
create policy active_account_session on public.account_data as restrictive
 for all to authenticated using((select private.account_session_active()))
 with check((select private.account_session_active()));

-- Safe status only: no meals/profile/provider IDs are exposed while suspended.
create function private.my_account_recovery() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare caller uuid:=auth.uid(); recovery private.account_recovery;
begin
 if caller is null or not exists(select 1 from auth.sessions where user_id=caller
  and id::text=auth.jwt()->>'session_id' and (not_after is null or not_after>now())) then
  raise exception 'active session required' using errcode='42501';
 end if;
 if exists(select 1 from private.kakao_unlink_jobs where user_id=caller) then
  return jsonb_build_object('state','pending');
 end if;
 select * into recovery from private.account_recovery where user_id=caller;
 if not found then return jsonb_build_object('state','active'); end if;
 return jsonb_build_object('state',case when recovery.delete_after<=now() then 'expired' else 'recoverable' end,
  'disconnectedAt',recovery.disconnected_at,'deleteAfter',recovery.delete_after);
end; $$;
revoke all on function private.my_account_recovery() from public,anon;
grant execute on function private.my_account_recovery() to authenticated;
create function public.my_account_recovery() returns jsonb
language sql security invoker set search_path='' as $$ select private.my_account_recovery(); $$;
revoke all on function public.my_account_recovery() from public,anon;
grant execute on function public.my_account_recovery() to authenticated;

create function private.restore_my_account(expected_disconnected_at timestamptz, restore_profile boolean)
returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid(); recovery private.account_recovery;
begin
 if caller is null then raise exception 'authentication required' using errcode='42501'; end if;
 -- All lifecycle writers lock user then lifecycle row, including the purge.
 perform 1 from auth.users where id=caller for update;
 select * into recovery from private.account_recovery where user_id=caller for update;
 if not found or expected_disconnected_at is distinct from recovery.disconnected_at
  or recovery.delete_after<=clock_timestamp() then
  raise exception 'recovery unavailable' using errcode='22023';
 end if;
 if exists(select 1 from private.kakao_unlink_jobs where user_id=caller)
  or not exists(select 1 from auth.sessions where user_id=caller
   and id::text=auth.jwt()->>'session_id' and created_at>recovery.disconnected_at
   and (not_after is null or not_after>now()))
  or not exists(select 1 from auth.identities where id=recovery.identity_id
   and user_id=caller and provider='kakao' and last_sign_in_at>recovery.disconnected_at) then
  raise exception 'fresh Kakao authentication required' using errcode='42501';
 end if;
 update public.account_data set consent_version='2026-10-07',consent_at=clock_timestamp(),revision=revision+1
  where user_id=caller;
 if restore_profile is true then
  update public.account_profiles set consent_version='2026-10-07',consent_at=clock_timestamp(),revision=revision+1
   where user_id=caller;
 else
  delete from public.account_profiles where user_id=caller;
 end if;
 delete from private.account_recovery where user_id=caller;
end; $$;
revoke all on function private.restore_my_account(timestamptz,boolean) from public,anon;
grant execute on function private.restore_my_account(timestamptz,boolean) to authenticated;
create function public.restore_my_account(expected_disconnected_at timestamptz, restore_profile boolean)
returns void language sql security invoker set search_path='' as $$
 select private.restore_my_account(expected_disconnected_at,restore_profile);
$$;
revoke all on function public.restore_my_account(timestamptz,boolean) from public,anon;
grant execute on function public.restore_my_account(timestamptz,boolean) to authenticated;

create function private.purge_expired_accounts() returns void
language plpgsql security definer set search_path='' as $$
declare target uuid; recovery private.account_recovery;
begin
 if not (select enabled from private.account_lifecycle_settings) then return; end if;
 for target in select user_id from private.account_recovery where delete_after<=now() limit 100 loop
  perform 1 from auth.users where id=target for update;
  select * into recovery from private.account_recovery where user_id=target and delete_after<=clock_timestamp() for update;
  if found then
   delete from auth.sessions where user_id=target;
   -- Re-check under the user lock: a subsequently linked login must not lose
   -- its records just because it was absent at the original webhook.
   if exists(select 1 from auth.identities where user_id=target and id<>recovery.identity_id) then
    perform private.detach_kakao_identity(target,recovery.identity_id);
   else
    delete from auth.users where id=target;
   end if;
  end if;
 end loop;
end; $$;
revoke all on function private.purge_expired_accounts() from public,anon,authenticated,service_role;
select cron.schedule('hmcl-account-recovery-expiry','* * * * *',
 'select private.purge_expired_accounts()');
create policy active_profile_session on public.account_profiles as restrictive
 for all to authenticated using((select private.account_session_active()))
 with check((select private.account_session_active()));
