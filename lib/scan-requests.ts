// The "Run research" queue: constants and rules shared by the prospect page,
// the server action and the runner on the Mac. No Next.js imports.
// Mirrors supabase/migrations/005_scan_requests.sql.

export const SCAN_STATES = ["queued", "running", "done", "failed"] as const;
export type ScanState = (typeof SCAN_STATES)[number];

export type ScanRequestRow = {
  id: string;
  prospect_id: string;
  state: ScanState;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  report_version: number | null;
  /** The GitHub Actions run that took this request (migration 006). Null for the Mac runner. */
  run_url?: string | null;
};

/** The Mac runner's row in runner_heartbeat (written each pass; the page no longer shows it). */
export const RUNNER_ID = "jordan-mac";
/** Most requests one runner pass will take on. */
export const MAX_CLAIMS_PER_RUN = 3;
export const RUN_TIMEOUT_MS = 20 * 60 * 1000;
/** How often the page refreshes while a request is active. */
export const ACTIVE_REFRESH_MS = 15 * 1000;

export const NO_LONGER_APPROVED = "No longer approved";

// ─── GitHub Actions ─────────────────────────────────────────────────────────
export const GITHUB_REPO = "jordanskennard-bot/passo-prospects";
export const GITHUB_WORKFLOW = "scope-prospect.yml";
export const GITHUB_REF = "main";
/** Where to look before a run has claimed the request and recorded its own URL. */
export const GITHUB_WORKFLOW_RUNS_URL = `https://github.com/${GITHUB_REPO}/actions/workflows/${GITHUB_WORKFLOW}`;

/** scan_requests ids are UUIDs. Anything else is refused before it reaches a query. */
export function isRequestId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Null if Claude Code can authenticate: a subscription token from
 * `claude setup-token` (CLAUDE_CODE_OAUTH_TOKEN) or an API key. Otherwise the
 * reason, recorded on the request.
 */
export function claudeCredentialProblem(env: Record<string, string | undefined>): string | null {
  if (env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || env.ANTHROPIC_API_KEY?.trim()) return null;
  return "No Claude credentials: add CLAUDE_CODE_OAUTH_TOKEN or ANTHROPIC_API_KEY to the repository's Actions secrets.";
}

/**
 * The button the page offers, if any. Only an approved prospect can be
 * researched; a built one is moved back to approved first, as the tracker's
 * Rerun does. Every other status gets no button.
 */
export function researchButtonLabel(status: string): "Run research" | "Re-run research" | null {
  if (status === "approved") return "Run research";
  if (status === "built") return "Re-run research";
  return null;
}

export function isActive(request: Pick<ScanRequestRow, "state"> | null | undefined): boolean {
  return request?.state === "queued" || request?.state === "running";
}

/**
 * How a run ended, judged only from the database afterwards: done if the
 * prospect is now built with a newer report than before, failed otherwise.
 */
export function judgeRun(input: {
  statusAfter: string | null;
  versionBefore: number;
  versionAfter: number;
}): { state: "done"; reportVersion: number } | { state: "failed" } {
  if (input.statusAfter === "built" && input.versionAfter > input.versionBefore) {
    return { state: "done", reportVersion: input.versionAfter };
  }
  return { state: "failed" };
}

/** The last few lines of output, for the error column. */
export function tailForError(output: string, lines = 15, maxChars = 2000): string {
  const tail = output.trimEnd().split("\n").slice(-lines).join("\n");
  return tail.length > maxChars ? tail.slice(-maxChars) : tail || "No output.";
}
