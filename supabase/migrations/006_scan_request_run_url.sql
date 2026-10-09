-- ───────────────────────────────────────────────────────────────────────────
-- Research runs move to GitHub Actions. Each request records the URL of the
-- Actions run that took it, so the prospect page can link to it. Null for
-- requests handled by the Mac runner, and until a run claims the request.
--
-- One nullable column on public.scan_requests. Nothing else is altered; the
-- table's existing RLS policy already covers the new column.
-- ───────────────────────────────────────────────────────────────────────────

alter table public.scan_requests
  add column if not exists run_url text
    check (run_url is null or run_url like 'https://github.com/%');

notify pgrst, 'reload schema';
