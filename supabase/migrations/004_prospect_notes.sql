-- ───────────────────────────────────────────────────────────────────────────
-- A notes log for each prospect.
--
-- public.prospect_notes holds one row per note. A note is either typed in the
-- tracker (source 'manual') or drawn from a prospect's reply by
-- scripts/scan-email.ts (source 'email', with source_message_id pointing at the
-- reply in prospect_emails). Unique (source_message_id, body) keeps a re-scan
-- from adding the same note twice; manual notes have a null message id, so
-- Postgres never treats two of them as duplicates.
--
-- Any existing prospects.notes text is copied in as an 'other' / 'manual' note.
-- The column itself is kept. Nothing else is altered.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.prospect_notes (
  id                uuid primary key default gen_random_uuid(),
  prospect_id       uuid not null references public.prospects (id) on delete cascade,
  category          text not null check (category in (
                      'learned', 'looking_for', 'challenge', 'objection', 'next_step', 'other'
                    )),
  body              text not null check (length(btrim(body)) > 0),
  source            text not null check (source in ('manual', 'email')),
  source_message_id text references public.prospect_emails (message_id) on delete cascade,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  -- An email note always names its email; a manual note never does.
  constraint prospect_notes_source_message_check
    check ((source = 'email') = (source_message_id is not null)),
  constraint prospect_notes_message_body_key
    unique (source_message_id, body)
);

create index if not exists prospect_notes_prospect_idx
  on public.prospect_notes (prospect_id, created_at desc);

comment on table public.prospect_notes is
  'Notes per prospect. source manual: typed in the tracker. source email: drawn from a reply by scripts/scan-email.ts, which only ever inserts.';

-- updated_at: reuses the function from 001, unchanged.
drop trigger if exists prospect_notes_touch_updated_at on public.prospect_notes;
create trigger prospect_notes_touch_updated_at
  before update on public.prospect_notes
  for each row execute function public.prospects_touch_updated_at();

-- ─── Row level security ────────────────────────────────────────────────────
-- Same pattern as 001: default-deny, forced, operator-only, nothing for anon.
alter table public.prospect_notes enable row level security;
alter table public.prospect_notes force row level security;

drop policy if exists prospect_notes_operator_all on public.prospect_notes;
create policy prospect_notes_operator_all
  on public.prospect_notes
  for all
  to authenticated
  using (public.prospects_is_operator())
  with check (public.prospects_is_operator());

revoke all on public.prospect_notes from anon;
grant select, insert, update, delete on public.prospect_notes to authenticated;

-- ─── Existing notes ────────────────────────────────────────────────────────
-- Copied once. The not-exists guard makes a second run of this file a no-op.
insert into public.prospect_notes (prospect_id, category, body, source, created_at, updated_at)
select p.id, 'other', btrim(p.notes), 'manual', p.updated_at, p.updated_at
from public.prospects p
where nullif(btrim(p.notes), '') is not null
  and not exists (
    select 1
    from public.prospect_notes n
    where n.prospect_id = p.id
      and n.source = 'manual'
      and n.body = btrim(p.notes)
  );

notify pgrst, 'reload schema';
