create table public.account_profiles (
 user_id uuid primary key references auth.users(id) on delete cascade,
 profile jsonb,
 revision bigint not null default 0 check(revision>=0),
 consent_version text not null,
 consent_at timestamptz not null default now(),
 constraint bounded_profile check (profile is null or (jsonb_typeof(profile)='object' and octet_length(profile::text)<2000 and profile-array['weightKg','heightCm','age','sex','activityLevel','goalMode','updatedAt']='{}'::jsonb))
);
alter table public.account_profiles enable row level security;
revoke all on public.account_profiles from anon,authenticated;
grant select,insert,update,delete on public.account_profiles to authenticated;
create policy own_profile on public.account_profiles for all to authenticated using((select auth.uid())=user_id) with check((select auth.uid())=user_id);
