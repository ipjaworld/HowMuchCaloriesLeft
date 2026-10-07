-- Bad client-owned rows must not stop retention for every account.
create function private.retained_account_turns(turns jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(t),'[]'::jsonb) from jsonb_array_elements(turns) t
 where case when pg_catalog.pg_input_is_valid(t->>'at','timestamp with time zone') then
  (t->>'at')::timestamptz >= (((now() at time zone 'Asia/Seoul')::date-29)::timestamp at time zone 'Asia/Seoul')
  and (t->>'at')::timestamptz < (((now() at time zone 'Asia/Seoul')::date+1)::timestamp at time zone 'Asia/Seoul')
 else false end;
$$;
revoke all on function private.retained_account_turns(jsonb) from public,anon,authenticated;
select cron.schedule('hmcl-conversation-retention','0 15 * * *',$job$
 update public.account_data set data=jsonb_set(data,'{turns}',private.retained_account_turns(data->'turns')),revision=revision+1
 where data->'turns' is distinct from private.retained_account_turns(data->'turns');
$job$);
