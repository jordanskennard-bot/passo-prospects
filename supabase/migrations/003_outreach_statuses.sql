-- ───────────────────────────────────────────────────────────────────────────
-- Outreach statuses, and a log of the emails that set them.
--
-- 1. prospects.status gains two values after 'built': 'message_sent' (we have
--    emailed someone at the prospect's domain) and 'response_received' (they
--    replied to one of those emails). Set by scripts/scan-email.ts.
-- 2. public.prospect_emails records every matched message, one row per
--    Message-ID, so the scanner is idempotent and the prospect page can list
--    the thread.
--
-- Migration 001 declared the status check inline, so Postgres named it
-- prospects_status_check. As in 002, this does not trust the name: it drops
-- whichever check constraint on public.prospects covers the status column, and
-- adds the replacement under an explicit name.
--
-- No existing data is read, written or deleted, and every existing row already
-- satisfies the new constraint. Nothing else is altered.
-- ───────────────────────────────────────────────────────────────────────────

-- ─── prospects.status ──────────────────────────────────────────────────────
do $$
declare
  constraint_name text;
begin
  select con.conname
    into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any (con.conkey)
  where nsp.nspname = 'public'
    and rel.relname = 'prospects'
    and con.contype = 'c'
    and att.attname = 'status'
  limit 1;

  if constraint_name is not null then
    execute format(
      'alter table public.prospects drop constraint %I', constraint_name
    );
    raise notice 'Dropped existing status check constraint: %', constraint_name;
  else
    raise notice 'No existing status check constraint found, adding a new one.';
  end if;
end;
$$;

alter table public.prospects
  add constraint prospects_status_check
  check (status in (
    'new',
    'approved',
    'researching',
    'built',
    'message_sent',
    'response_received',
    'archived'
  ));

-- ─── prospect_emails ───────────────────────────────────────────────────────
-- One row per email matched to a prospect. message_id is the RFC 5322
-- Message-ID header, unique so a re-scan never records the same email twice.
create table if not exists public.prospect_emails (
  id           uuid primary key default gen_random_uuid(),
  prospect_id  uuid not null references public.prospects (id) on delete cascade,
  direction    text not null check (direction in ('sent', 'received')),
  message_id   text not null unique,
  in_reply_to  text,
  sent_at      timestamptz not null,
  from_address text not null,
  to_address   text not null,
  subject      text
);

create index if not exists prospect_emails_prospect_idx
  on public.prospect_emails (prospect_id, sent_at desc);

comment on table public.prospect_emails is
  'Emails matched to a prospect by scripts/scan-email.ts. Sent: to an address at the prospect''s domain. Received: a reply to one of those.';

-- ─── Row level security ────────────────────────────────────────────────────
-- Same pattern as 001: default-deny, forced, operator-only, nothing for anon.
alter table public.prospect_emails enable row level security;
alter table public.prospect_emails force row level security;

drop policy if exists prospect_emails_operator_all on public.prospect_emails;
create policy prospect_emails_operator_all
  on public.prospect_emails
  for all
  to authenticated
  using (public.prospects_is_operator())
  with check (public.prospects_is_operator());

revoke all on public.prospect_emails from anon;
grant select, insert, update, delete on public.prospect_emails to authenticated;

notify pgrst, 'reload schema';
