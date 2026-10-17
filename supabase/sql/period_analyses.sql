-- 期間分析の保存先（ユーザーごとに分離）
create table if not exists public.period_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  report text not null,
  updated_at timestamptz not null default now(),
  constraint period_analyses_dates_valid check (end_date >= start_date),
  constraint period_analyses_user_dates_unique unique (user_id, start_date, end_date)
);
alter table public.period_analyses enable row level security;
grant select, insert, update, delete on public.period_analyses to authenticated;
drop policy if exists "Users manage own period analyses" on public.period_analyses;
create policy "Users manage own period analyses"
  on public.period_analyses
  for all
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
