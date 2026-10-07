-- Only trusted Kakao webhooks may enqueue work. No provider keys or payloads
-- are stored here. Failed cleanup retains only the identity UUID for retry.
create table private.kakao_unlink_jobs (
 identity_id uuid primary key,
 user_id uuid not null,
 received_at timestamptz not null default now(),
 attempts integer not null default 0,
 last_error_code text
);
alter table private.kakao_unlink_jobs enable row level security;
create index kakao_unlink_jobs_user_id_idx on private.kakao_unlink_jobs(user_id);
revoke all on private.kakao_unlink_jobs from public,anon,authenticated,service_role;

create function private.process_kakao_unlinks() returns void
language plpgsql security definer set search_path='' as $$
declare job record; remaining_providers jsonb;
begin
 for job in select * from private.kakao_unlink_jobs order by received_at
 limit 100 for update skip locked loop
  begin
   -- Lock the user before inspecting identities; FK inserts cannot race this.
   perform 1 from auth.users where id=job.user_id for update;
   if exists(select 1 from auth.identities where id=job.identity_id
             and user_id=job.user_id and provider='kakao') then
    delete from auth.sessions where user_id=job.user_id;
    if exists(select 1 from auth.identities where user_id=job.user_id
              and id<>job.identity_id) then
     delete from auth.identities where id=job.identity_id and provider='kakao';
     select jsonb_agg(distinct provider order by provider) into remaining_providers
      from auth.identities where user_id=job.user_id;
     update auth.users set raw_app_meta_data=
      jsonb_set(jsonb_set(coalesce(raw_app_meta_data,'{}'::jsonb),
        '{providers}',remaining_providers),'{provider}',remaining_providers->0)
      where id=job.user_id;
    else
     delete from auth.users where id=job.user_id;
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
 if provider_user_id is null or provider_user_id !~ '^[0-9]{1,32}$' then
  raise exception 'invalid provider ID' using errcode='22023';
 end if;
 insert into private.kakao_unlink_jobs(identity_id,user_id)
  select id,user_id from auth.identities
  where provider='kakao' and provider_id=provider_user_id
  on conflict(identity_id) do nothing;
 -- Best effort now, durable retry on a DB cleanup error.
 perform private.process_kakao_unlinks();
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
 ) and not exists(select 1 from private.kakao_unlink_jobs j where j.user_id=auth.uid());
$$;
revoke all on function private.account_session_active() from public,anon;
grant execute on function private.account_session_active() to authenticated;
create policy active_account_session on public.account_data as restrictive
 for all to authenticated using((select private.account_session_active()))
 with check((select private.account_session_active()));
create policy active_profile_session on public.account_profiles as restrictive
 for all to authenticated using((select private.account_session_active()))
 with check((select private.account_session_active()));
