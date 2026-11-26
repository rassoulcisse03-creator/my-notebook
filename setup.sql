-- setup.sql — private notes table with owner-only Row Level Security
-- Run once in the Supabase dashboard → SQL Editor (after review).
-- Non-destructive: no DROP, DELETE or TRUNCATE. Re-running it is safe:
-- existing table, index and policies are left untouched.

begin;

-- 1. Table -------------------------------------------------------------------
create table if not exists public.notes (
  id          uuid        primary key default gen_random_uuid(),
  owner_id    uuid        not null default auth.uid()
                          references auth.users (id) on delete cascade,
  body        text        not null
                          check (char_length(body) between 1 and 10000),
  created_at  timestamptz not null default now()
);

create index if not exists notes_owner_id_idx on public.notes (owner_id);

-- 2. Privileges --------------------------------------------------------------
-- Supabase's default privileges give anon and authenticated ALL on new tables
-- (including TRUNCATE, which RLS does not filter). Reset, then grant CRUD only.
revoke all on table public.notes from public, anon, authenticated;
grant select, insert, update, delete on table public.notes to authenticated;

-- 3. Row Level Security ------------------------------------------------------
alter table public.notes enable row level security;

-- One policy per command, all scoped to the authenticated role.
-- Created only if missing, so nothing is ever dropped.
do $$
begin
  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'notes'
                   and policyname = 'notes_select_own') then
    create policy "notes_select_own"
      on public.notes for select
      to authenticated
      using ((select auth.uid()) = owner_id);
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'notes'
                   and policyname = 'notes_insert_own') then
    create policy "notes_insert_own"
      on public.notes for insert
      to authenticated
      with check ((select auth.uid()) = owner_id);
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'notes'
                   and policyname = 'notes_update_own') then
    create policy "notes_update_own"
      on public.notes for update
      to authenticated
      using ((select auth.uid()) = owner_id)        -- which rows you may target
      with check ((select auth.uid()) = owner_id);  -- what the row may become
  end if;

  if not exists (select 1 from pg_policies
                 where schemaname = 'public' and tablename = 'notes'
                   and policyname = 'notes_delete_own') then
    create policy "notes_delete_own"
      on public.notes for delete
      to authenticated
      using ((select auth.uid()) = owner_id);
  end if;
end
$$;

commit;
