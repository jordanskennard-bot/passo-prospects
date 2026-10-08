-- ───────────────────────────────────────────────────────────────────────────
-- Allow prospects added by hand in the tracker, alongside the three
-- spreadsheet tabs.
--
-- Migration 001 declared the source_tab check inline on the column, so
-- Postgres gave it a generated name. Rather than trust that name, this finds
-- whichever check constraint on public.prospects references source_tab and
-- drops that, then adds the replacement under an explicit name so any future
-- migration can address it directly.
--
-- Adds one value to one constraint. No data is read, written or deleted, and
-- every existing row already satisfies the new constraint.
-- ───────────────────────────────────────────────────────────────────────────

do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'prospects'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) ilike '%source_tab%'
  limit 1;

  if constraint_name is not null then
    execute format(
      'alter table public.prospects drop constraint %I', constraint_name
    );
    raise notice 'Dropped existing source_tab check constraint: %', constraint_name;
  else
    raise notice 'No existing source_tab check constraint found, adding a new one.';
  end if;
end;
$$;

alter table public.prospects
  add constraint prospects_source_tab_check
  check (source_tab in (
    'prospects',
    'checked_not_shopify',
    'blocked_by_bot_protection',
    'manual'
  ));

comment on column public.prospects.source_tab is
  'Which tab of the spreadsheet this row came from, or ''manual'' when it was added by hand in the tracker. The seed only ever writes the three spreadsheet values, so manual rows are never touched by a re-seed.';

notify pgrst, 'reload schema';
