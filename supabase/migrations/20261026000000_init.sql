-- FitCode Nutrition demo — initial schema, RLS, AI usage cap, summary view.
-- Apply with: supabase db push   (or paste into the Supabase SQL editor once)

-- ============================================================
-- 1. Gym-local date (Postgres current_date is UTC on Supabase)
-- ============================================================
create or replace function public.today_local() returns date
language sql stable as $$ select (now() at time zone 'America/Chicago')::date $$;

-- ============================================================
-- 2. Tables
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  full_name text not null default '',
  role text not null default 'member' check (role in ('member','admin')),
  created_at timestamptz not null default now()
);

create table public.macro_plans (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  calories int check (calories >= 0),
  protein_g int check (protein_g >= 0),
  carbs_g int check (carbs_g >= 0),
  fat_g int check (fat_g >= 0),
  created_at timestamptz not null default now()
);

create table public.meal_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  logged_on date not null default public.today_local(),
  food text not null check (length(food) between 1 and 120),
  amount numeric not null check (amount > 0),
  unit text not null check (unit in ('oz','hand_portion')),
  protein_g numeric check (protein_g >= 0),
  carbs_g numeric check (carbs_g >= 0),
  fat_g numeric check (fat_g >= 0),
  created_at timestamptz not null default now()
);

create table public.daily_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  logged_on date not null default public.today_local(),
  weight_lb numeric check (weight_lb > 0),
  water_oz numeric check (water_oz >= 0),
  unique (user_id, logged_on)
);

create table public.meal_plans (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  plan jsonb not null,
  created_at timestamptz not null default now()
);

create table public.ai_usage (
  user_id uuid not null references auth.users on delete cascade,
  used_on date not null default public.today_local(),
  calls int not null default 0,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  primary key (user_id, used_on)
);

create index on public.meal_logs   (user_id, logged_on);
create index on public.daily_logs  (user_id, logged_on);
create index on public.macro_plans (user_id, created_at desc);
create index on public.meal_plans  (user_id, created_at desc);
create index on public.ai_usage    (used_on);

-- ============================================================
-- 3. Profile row on sign-up
-- ============================================================
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, full_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'full_name', ''), 80));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- 4. Row-level security
-- ============================================================
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles where id = auth.uid() and role = 'admin');
$$;

-- Same four policies on every member-owned table.
do $$
declare t text;
begin
  foreach t in array array['macro_plans','meal_logs','daily_logs','meal_plans'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy "own rows: read" on public.%I for select to authenticated
                     using (user_id = (select auth.uid()) or (select public.is_admin()))$p$, t);
    execute format($p$create policy "own rows: insert" on public.%I for insert to authenticated
                     with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "own rows: update" on public.%I for update to authenticated
                     using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))$p$, t);
    execute format($p$create policy "own rows: delete" on public.%I for delete to authenticated
                     using (user_id = (select auth.uid()))$p$, t);
  end loop;
end $$;

-- Profiles: read own (admin reads all); update own name only.
alter table public.profiles enable row level security;
create policy "profile: read" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));
create policy "profile: update own" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Supabase grants table-wide UPDATE to `authenticated` by default, and a column-level
-- revoke does not override a table-level grant. Revoke table-wide, grant back name only,
-- so a member can never set role = 'admin'. Inserts/deletes come from the trigger / cascade.
revoke insert, update, delete on public.profiles from authenticated, anon;
grant  update (full_name) on public.profiles to authenticated;

-- ai_usage: members read their own counter; writes only via the functions below.
alter table public.ai_usage enable row level security;
create policy "usage: read own" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));
revoke insert, update, delete on public.ai_usage from authenticated, anon;

-- Nothing for anonymous visitors.
revoke all on public.profiles, public.macro_plans, public.meal_logs, public.daily_logs,
              public.meal_plans, public.ai_usage from anon;

-- ============================================================
-- 5. AI daily cap
-- ============================================================
-- Atomically claims one AI call for the caller. Returns false at either limit.
create or replace function public.claim_ai_call(member_limit int, global_limit int)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  d   date := public.today_local();
  n   int;
begin
  if uid is null then return false; end if;
  -- Serialize today's claims so the global total can't be raced.
  perform pg_advisory_xact_lock(hashtext('ai_usage_' || d::text));
  if (select coalesce(sum(calls), 0) from ai_usage where used_on = d) >= global_limit then
    return false;
  end if;
  insert into ai_usage (user_id, used_on, calls) values (uid, d, 1)
  on conflict (user_id, used_on)
    do update set calls = ai_usage.calls + 1
    where ai_usage.calls < member_limit
  returning calls into n;
  return n is not null;
end $$;

create or replace function public.record_ai_tokens(in_tok int, out_tok int)
returns void language sql security definer set search_path = public as $$
  update ai_usage set input_tokens  = input_tokens  + greatest(in_tok, 0),
                      output_tokens = output_tokens + greatest(out_tok, 0)
  where user_id = auth.uid() and used_on = public.today_local();
$$;

revoke execute on function public.claim_ai_call(int,int), public.record_ai_tokens(int,int) from public, anon;
grant  execute on function public.claim_ai_call(int,int), public.record_ai_tokens(int,int) to authenticated;

-- ============================================================
-- 6. Owner's summary view (read in the Supabase dashboard)
-- ============================================================
create or replace function public.current_streak(uid uuid) returns int
language sql stable set search_path = public as $$
  with d as (select distinct logged_on from meal_logs where user_id = uid),
       g as (select logged_on,
                    logged_on - (row_number() over (order by logged_on))::int as grp
             from d),
       isl as (select max(logged_on) as last_day, count(*)::int as len from g group by grp)
  select coalesce((select len from isl
                   where last_day >= today_local() - 1
                   order by last_day desc limit 1), 0);
$$;

create or replace view public.member_summary with (security_invoker = true) as
select
  p.id,
  p.full_name,
  today_local() - (select max(logged_on) from meal_logs where user_id = p.id) as days_since_last_log,
  public.current_streak(p.id)                                               as current_streak,
  (select round(avg(day_protein), 1) from (
      select sum(protein_g) as day_protein from meal_logs
      where user_id = p.id and logged_on >= today_local() - 6
      group by logged_on) t)                                                as avg_protein_7d_logged_days,
  (select protein_g from macro_plans where user_id = p.id
     order by created_at desc limit 1)                                      as protein_target,
  (select weight_lb from daily_logs where user_id = p.id and weight_lb is not null
     order by logged_on desc limit 1)                                       as latest_weight
from profiles p
where p.role = 'member';

-- Dashboard-only: not reachable through the public API.
revoke all on public.member_summary from anon, authenticated;
