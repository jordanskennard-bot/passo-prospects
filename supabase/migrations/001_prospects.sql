-- ───────────────────────────────────────────────────────────────────────────
-- Passo prospect scoping — private tracker tables.
--
-- Two tables, both locked to a single operator by RLS. The agent writes with
-- the service role key, which bypasses RLS by design; everything reaching the
-- browser goes through the anon key and is therefore subject to the policies
-- below.
--
-- Scope note: this migration adds new tables, a new enum-by-check, one helper
-- function and one trigger. It does not alter any existing Passo table.
-- ───────────────────────────────────────────────────────────────────────────

-- ─── Allow-list ────────────────────────────────────────────────────────────
-- The single authorised operator. Checked against the verified `email` claim
-- in the request JWT, so it holds for every policy below without needing the
-- user's uuid to be known ahead of their first magic-link sign-in.
--
-- IMPORTANT: this list is duplicated in lib/auth.ts as ALLOWED_EMAILS, which
-- gates the application layer. Changing who may use this site means editing
-- BOTH places. The duplication is deliberate: a single point of failure in
-- either layer should not open the other.
create or replace function public.prospects_is_operator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select lower(coalesce(
           nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email',
           ''
         )) = 'jordan@passoagency.com'
$$;

comment on function public.prospects_is_operator() is
  'True only for the single allow-listed prospect-tracker operator. Mirrored by ALLOWED_EMAILS in lib/auth.ts.';

-- ─── prospects ─────────────────────────────────────────────────────────────
create table if not exists public.prospects (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  brand       text not null,
  domain      text,
  town        text,

  -- Which tab of Passo_Yorkshire_Prospects_v2.xlsx this row came from.
  source_tab  text not null check (source_tab in (
                'prospects', 'checked_not_shopify', 'blocked_by_bot_protection'
              )),

  -- ─── Spreadsheet fields, Prospects tab ───────────────────────────────────
  drive_from_york   text,
  category          text,
  alcohol           boolean,
  commercial_model  text,
  budget_status     text,
  platform          text,
  -- SKUs is mostly an integer but the sheet also carries values like '244+'.
  -- Keep the raw string and a best-effort number beside it.
  skus              integer,
  skus_raw          text,
  esp               text,
  reviews           text,
  subscription      text,
  martech_detected  text,
  paid_media_status text,
  provable_problem  text,

  -- ─── Phase 1 scoring (speed to first client). Max 33. ────────────────────
  p1_decision_speed    numeric,
  p1_provable_problem  numeric,
  p1_live_media        numeric,
  p1_proximity         numeric,
  p1_category_fit      numeric,
  speed_score          numeric,

  -- ─── Phase 2 scoring (client value). Max 30. ─────────────────────────────
  -- 'P2 Ability to pay' is blank for every row in v2 of the sheet, so the
  -- sheet's VALUE SCORE formula resolves to the text 'Pending pay data'
  -- rather than a number. value_score holds the number when there is one;
  -- value_score_label holds the sheet's text when there is not.
  p2_ability_to_pay  numeric,
  p2_paid_activity   numeric,
  p2_scale           numeric,
  p2_winnability     numeric,
  p2_stack_gaps      numeric,
  value_score        numeric,
  value_score_label  text,

  -- The sheet's own two tracking columns, kept distinct from `status` below.
  sheet_status  text,
  next_action   text,

  -- ─── Phase 1 shortlist tab, merged on brand ──────────────────────────────
  shortlist_rank         integer,
  shortlist_why          text,
  shortlist_opening_line text,
  shortlist_known_risk   text,

  -- 'Note' (checked_not_shopify) or 'What we saw' (blocked_by_bot_protection).
  source_note text,

  -- ─── Tracker state. Owned by the operator, never written by the seed. ────
  status      text not null default 'new' check (status in (
                'new', 'approved', 'researching', 'built', 'archived'
              )),
  approved_at timestamptz,
  built_at    timestamptz,
  notes       text,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on column public.prospects.status is
  'Tracker state. Nothing is researched until this reads approved. The seed script never writes this column.';
comment on column public.prospects.skus_raw is
  'Verbatim SKUs cell. Blank in the sheet means the endpoint was unavailable, not that the catalogue is small.';

create index if not exists prospects_status_idx     on public.prospects (status);
create index if not exists prospects_source_tab_idx on public.prospects (source_tab);
create index if not exists prospects_speed_idx      on public.prospects (speed_score desc nulls last);

-- ─── prospect_reports ──────────────────────────────────────────────────────
-- Every version is kept. The prospect page renders the highest version.
create table if not exists public.prospect_reports (
  id          uuid primary key default gen_random_uuid(),
  prospect_id uuid not null references public.prospects (id) on delete cascade,
  version     integer not null check (version > 0),
  payload     jsonb not null,
  sources     jsonb not null default '[]'::jsonb,
  created_at  timestamptz not null default now(),
  unique (prospect_id, version)
);

create index if not exists prospect_reports_latest_idx
  on public.prospect_reports (prospect_id, version desc);

-- ─── updated_at ────────────────────────────────────────────────────────────
create or replace function public.prospects_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists prospects_touch_updated_at on public.prospects;
create trigger prospects_touch_updated_at
  before update on public.prospects
  for each row execute function public.prospects_touch_updated_at();

-- ─── Row level security ────────────────────────────────────────────────────
-- Default-deny: RLS on, and the only policies granted are to the single
-- allow-listed operator. An authenticated Supabase user with any other email
-- sees zero rows and cannot write, regardless of what the UI allows.
alter table public.prospects        enable row level security;
alter table public.prospect_reports enable row level security;

-- Belt and braces: force RLS so even a table owner connecting over PostgREST
-- is subject to the policies.
alter table public.prospects        force row level security;
alter table public.prospect_reports force row level security;

drop policy if exists prospects_operator_all on public.prospects;
create policy prospects_operator_all
  on public.prospects
  for all
  to authenticated
  using (public.prospects_is_operator())
  with check (public.prospects_is_operator());

drop policy if exists prospect_reports_operator_all on public.prospect_reports;
create policy prospect_reports_operator_all
  on public.prospect_reports
  for all
  to authenticated
  using (public.prospects_is_operator())
  with check (public.prospects_is_operator());

-- The anon role gets nothing at all. No policy means no access under RLS,
-- but revoke the grants too so an unauthenticated request fails early.
revoke all on public.prospects        from anon;
revoke all on public.prospect_reports from anon;

grant select, insert, update, delete on public.prospects        to authenticated;
grant select, insert, update, delete on public.prospect_reports to authenticated;

notify pgrst, 'reload schema';
