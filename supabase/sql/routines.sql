-- 日付ごとにチェックできるルーティンと、その実施履歴
-- 作成前に、SQL Editorでこのファイルを一度実行してください。

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 100),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (id, user_id)
);

create table if not exists public.routine_checks (
  user_id uuid not null references auth.users(id) on delete cascade,
  routine_id uuid not null,
  entry_date date not null,
  checked_at timestamptz not null default now(),
  primary key (user_id, routine_id, entry_date),
  constraint routine_checks_owned_routine_fk
    foreign key (routine_id, user_id)
    references public.routines (id, user_id)
    on delete cascade
);

create index if not exists routine_checks_user_date_idx
  on public.routine_checks (user_id, entry_date);

alter table public.routines enable row level security;
alter table public.routine_checks enable row level security;
grant select, insert, update, delete on public.routines to authenticated;
grant select, insert, update, delete on public.routine_checks to authenticated;

drop policy if exists "Users manage own routines" on public.routines;
create policy "Users manage own routines"
  on public.routines for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users manage own routine checks" on public.routine_checks;
create policy "Users manage own routine checks"
  on public.routine_checks for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
