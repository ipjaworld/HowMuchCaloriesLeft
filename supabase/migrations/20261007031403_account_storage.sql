-- Bounded per-account document with optimistic concurrency for atomic imports.
create table public.account_data (
 user_id uuid primary key references auth.users(id) on delete cascade,
 data jsonb not null, revision bigint not null default 0 check(revision>=0),
 consent_version text not null, consent_at timestamptz not null default now(),
 constraint bounded_data check(octet_length(data::text)<=4000000),
 constraint account_shape check(jsonb_typeof(data)='object' and data ?& array['records','goals','turns','meta'] and data-array['records','goals','turns','meta']='{}'::jsonb and jsonb_typeof(data->'records')='array' and jsonb_typeof(data->'goals')='array' and jsonb_typeof(data->'turns')='array' and jsonb_typeof(data->'meta')='object')
);
alter table public.account_data enable row level security;
revoke all on public.account_data from anon,authenticated;
grant select,insert,update on public.account_data to authenticated;
create policy own_account on public.account_data for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;
-- No supplied ID; an active caller session is mandatory. Auth deletion cascades.
create function private.delete_my_account() returns void language plpgsql security definer set search_path='' as $$
declare caller uuid:=auth.uid();
begin
 if caller is null then raise exception 'authentication required'; end if;
 if not exists(select 1 from auth.sessions where user_id=caller and id=(auth.jwt()->>'session_id')::uuid) then raise exception 'active session required'; end if;
 delete from auth.users where id=caller;
end; $$;
revoke all on function private.delete_my_account() from public,anon;
grant execute on function private.delete_my_account() to authenticated;
create function public.delete_my_account() returns void language sql security invoker set search_path='' as $$ select private.delete_my_account(); $$;
revoke all on function public.delete_my_account() from public,anon;
grant execute on function public.delete_my_account() to authenticated;
create extension if not exists pg_cron;
select cron.schedule('hmcl-conversation-retention','0 15 * * *',$job$
 update public.account_data a set data=jsonb_set(a.data,'{turns}',coalesce((select jsonb_agg(t) from jsonb_array_elements(a.data->'turns') t where (t->>'at')::timestamptz >= (((now() at time zone 'Asia/Seoul')::date-29)::timestamp at time zone 'Asia/Seoul') and (t->>'at')::timestamptz < (((now() at time zone 'Asia/Seoul')::date+1)::timestamp at time zone 'Asia/Seoul')),'[]'::jsonb)),revision=revision+1 where exists(select 1 from jsonb_array_elements(a.data->'turns') t where (t->>'at')::timestamptz < (((now() at time zone 'Asia/Seoul')::date-29)::timestamp at time zone 'Asia/Seoul'));
$job$);
