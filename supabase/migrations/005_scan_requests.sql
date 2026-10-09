-- ───────────────────────────────────────────────────────────────────────────
-- A queue for "Run research" on the prospect page, and a heartbeat from the
-- runner on Jordan's Mac that works through it.
--
-- public.scan_requests: one row per request. The page inserts 'queued'; the
-- runner (scripts/run-scan-queue.ts, service role) claims it as 'running' and
-- finishes it as 'done' (with the report version it produced) or 'failed'
-- (with the reason). A partial unique index allows at most one queued or
-- running request per prospect.
--
-- public.runner_heartbeat: one row per runner, touched on every run, so the
-- page can say whether research will start soon.
--
-- The approval gate is not here and does not move: the runner re-checks that
-- the prospect is 'approved' when it claims a request, and /scope-prospects
-- checks again before it touches anything. Nothing else is altered.
-- ───────────────────────────────────────────────────────────────────────────

create table if not exists public.scan_requests (
  id             uuid primary key default gen_random_uuid(),
  prospect_id    uuid not null references public.prospects (id) on delete cascade,
  state          text not null default 'queued'
                   check (state in ('queued', 'running', 'done', 'failed')),
  requested_at   timestamptz not null default now(),
  started_at     timestamptz,
  finished_at    timestamptz,
  error          text,
  report_version integer check (report_version is null or report_version > 0)
);

-- One active request per prospect.
create unique index if not exists scan_requests_one_active_idx
  on public.scan_requests (prospect_id)
  where state in ('queued', 'running');

create index if not exists scan_requests_queue_idx
  on public.scan_requests (requested_at)
  where state = 'queued';

create index if not exists scan_requests_prospect_idx
  on public.scan_requests (prospect_id, requested_at desc);

create table if not exists public.runner_heartbeat (
  id           text primary key,
  last_seen_at timestamptz not null default now()
);

-- ─── Row level security ────────────────────────────────────────────────────
-- Same pattern as 001: default-deny, forced, operator-only, nothing for anon.
-- The runner uses the service role, which bypasses RLS.
alter table public.scan_requests    enable row level security;
alter table public.scan_requests    force row level security;
alter table public.runner_heartbeat enable row level security;
alter table public.runner_heartbeat force row level security;

drop policy if exists scan_requests_operator_all on public.scan_requests;
create policy scan_requests_operator_all
  on public.scan_requests
  for all
  to authenticated
  using (public.prospects_is_operator())
  with check (public.prospects_is_operator());

drop policy if exists runner_heartbeat_operator_all on public.runner_heartbeat;
create policy runner_heartbeat_operator_all
  on public.runner_heartbeat
  for all
  to authenticated
  using (public.prospects_is_operator())
  with check (public.prospects_is_operator());

revoke all on public.scan_requests    from anon;
revoke all on public.runner_heartbeat from anon;

grant select, insert, update, delete on public.scan_requests    to authenticated;
grant select, insert, update, delete on public.runner_heartbeat to authenticated;

notify pgrst, 'reload schema';
