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
};

/** The runner's row in runner_heartbeat. */
export const RUNNER_ID = "jordan-mac";
export const RUNNER_ONLINE_MINUTES = 10;
export const RUNNER_OFFLINE_MESSAGE =
  "Runner offline: research will start when Jordan's Mac is awake.";

/** Most requests one runner pass will take on. */
export const MAX_CLAIMS_PER_RUN = 3;
export const RUN_TIMEOUT_MS = 20 * 60 * 1000;
/** How often the page refreshes while a request is active. */
export const ACTIVE_REFRESH_MS = 15 * 1000;

export const NO_LONGER_APPROVED = "No longer approved";

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

export function isRunnerOnline(lastSeenAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!lastSeenAt) return false;
  const seen = new Date(lastSeenAt).getTime();
  if (Number.isNaN(seen)) return false;
  return now.getTime() - seen <= RUNNER_ONLINE_MINUTES * 60 * 1000;
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
