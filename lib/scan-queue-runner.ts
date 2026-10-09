// The research queue's claim, gate, run and finish, shared by the two runners:
// scripts/run-scan-queue.ts on the Mac (claims the oldest queued requests) and
// scripts/run-scan-request.ts in GitHub Actions (claims one request by id).
//
// The approval gate lives in processClaimed(): a prospect that is not
// 'approved' at the moment its request is processed fails "No longer approved"
// and nothing is run or written. That is a check on top of /scope-prospects'
// own gate and claim(), never instead of them.

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  judgeRun,
  NO_LONGER_APPROVED,
  RUN_TIMEOUT_MS,
  tailForError,
  type ScanRequestRow,
} from "./scan-requests.ts";
import { buildClaudeArgs, PAYLOAD_DIR } from "./scan-runner-args.ts";

type Log = (line: string) => void;

const REQUEST_COLUMNS = "id, prospect_id, state, requested_at, started_at, finished_at, error, report_version";

export async function writeHeartbeat(db: SupabaseClient, runnerId: string): Promise<void> {
  const { error } = await db
    .from("runner_heartbeat")
    .upsert({ id: runnerId, last_seen_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(`Could not write the heartbeat: ${error.message}`);
}

/**
 * Claim one request by id: queued -> running, conditional on it still being
 * queued, so a request already taken by the other runner is never taken twice.
 */
export async function claimById(
  db: SupabaseClient,
  requestId: string,
  runUrl: string | null = null,
): Promise<ScanRequestRow | null> {
  const patch: Record<string, unknown> = { state: "running", started_at: new Date().toISOString() };
  if (runUrl) patch.run_url = runUrl;
  const { data, error } = await db
    .from("scan_requests")
    .update(patch)
    .eq("id", requestId)
    .eq("state", "queued")
    .select(REQUEST_COLUMNS);
  if (error) throw new Error(`Could not claim request ${requestId}: ${error.message}`);
  return data && data.length === 1 ? (data[0] as ScanRequestRow) : null;
}

/** Claim up to `max` queued requests, oldest first, one conditional update each. */
export async function claimOldest(db: SupabaseClient, max: number): Promise<ScanRequestRow[]> {
  const { data: queued, error } = await db
    .from("scan_requests")
    .select("id")
    .eq("state", "queued")
    .order("requested_at", { ascending: true })
    .limit(max);
  if (error) throw new Error(`Could not read the queue: ${error.message}`);
  const claimed: ScanRequestRow[] = [];
  for (const { id } of queued ?? []) {
    const row = await claimById(db, id);
    if (row) claimed.push(row);
  }
  return claimed;
}

async function finish(
  db: SupabaseClient,
  requestId: string,
  patch: { state: "done" | "failed"; error?: string; report_version?: number },
  log: Log,
) {
  const { error } = await db
    .from("scan_requests")
    .update({ ...patch, finished_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("state", "running");
  if (error) log(`  Could not record the outcome of ${requestId}: ${error.message}`);
}

export type ClaudeRun = { output: string; timedOut: boolean };

export type ProcessDeps = {
  log: Log;
  /** Runs Claude Code with these arguments from the repository root. */
  runClaude: (args: string[]) => Promise<ClaudeRun>;
  /**
   * Checked after the gate and before anything runs. Returns a reason to fail
   * (for example, no Claude credentials) or null to go ahead.
   */
  preflight?: () => string | null;
};

/** Gate, run and finish one claimed request. Returns how it ended. */
export async function processClaimed(
  db: SupabaseClient,
  request: ScanRequestRow,
  deps: ProcessDeps,
): Promise<"done" | "failed"> {
  const { log } = deps;
  const { data: prospect, error: prospectError } = await db
    .from("prospects")
    .select("id, slug, brand, domain, status")
    .eq("id", request.prospect_id)
    .maybeSingle();
  if (prospectError || !prospect) {
    await finish(db, request.id, { state: "failed", error: prospectError?.message ?? "Prospect not found." }, log);
    log(`  ${request.id}: failed, prospect not found.`);
    return "failed";
  }

  // The gate, at the moment of processing. Nothing below runs otherwise.
  if (prospect.status !== "approved") {
    await finish(db, request.id, { state: "failed", error: NO_LONGER_APPROVED }, log);
    log(`  ${prospect.brand}: failed, ${NO_LONGER_APPROVED.toLowerCase()} (status ${prospect.status}). Nothing was run.`);
    return "failed";
  }

  const notReady = deps.preflight?.() ?? null;
  if (notReady) {
    await finish(db, request.id, { state: "failed", error: notReady }, log);
    log(`  ${prospect.brand}: failed, ${notReady}`);
    return "failed";
  }

  const latestVersion = async () => {
    const { data } = await db
      .from("prospect_reports")
      .select("version")
      .eq("prospect_id", prospect.id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data?.version as number | undefined) ?? 0;
  };
  const versionBefore = await latestVersion();

  let args: string[];
  try {
    args = buildClaudeArgs({ slug: prospect.slug, domain: prospect.domain });
  } catch (error) {
    await finish(db, request.id, { state: "failed", error: (error as Error).message }, log);
    log(`  ${prospect.brand}: failed, ${(error as Error).message}`);
    return "failed";
  }

  mkdirSync(PAYLOAD_DIR, { recursive: true });
  log(`  ${prospect.brand}: running /scope-prospects ${prospect.slug}`);
  const run = await deps.runClaude(args);

  const { data: after } = await db.from("prospects").select("status").eq("id", prospect.id).maybeSingle();
  const statusAfter = (after?.status as string | undefined) ?? null;
  const verdict = judgeRun({ statusAfter, versionBefore, versionAfter: await latestVersion() });

  if (verdict.state === "done") {
    await finish(db, request.id, { state: "done", report_version: verdict.reportVersion }, log);
    log(`  ${prospect.brand}: done, report version ${verdict.reportVersion}.`);
    return "done";
  }

  // A run that died mid-research must not leave the prospect stuck.
  let note = "";
  if (statusAfter === "researching") {
    const { error } = await db
      .from("prospects")
      .update({ status: "approved" })
      .eq("id", prospect.id)
      .eq("status", "researching");
    note = error ? `\n(Could not release it: ${error.message})` : "\n(Released back to approved.)";
  }
  const why = run.timedOut ? `Timed out after ${RUN_TIMEOUT_MS / 60000} minutes.\n` : "";
  await finish(db, request.id, { state: "failed", error: `${why}${tailForError(run.output)}${note}` }, log);
  log(`  ${prospect.brand}: failed${run.timedOut ? " (timed out)" : ""}, status now ${statusAfter}.`);
  return "failed";
}

/** Spawn Claude Code with a hard time limit, streaming output to `onOutput`. */
export function spawnClaude(
  bin: string,
  args: string[],
  onOutput: (text: string) => void,
  timeoutMs = RUN_TIMEOUT_MS,
): Promise<ClaudeRun> {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const capture = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      onOutput(text);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ output: `${output}\nCould not start Claude Code at ${bin}: ${error.message}`, timedOut });
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ output, timedOut });
    });
  });
}

export { PAYLOAD_DIR };
