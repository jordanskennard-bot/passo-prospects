// Work through the "Run research" queue on this Mac.
//
//   npm run scan-queue
//
// Run every five minutes by launchd (scripts/launchd/com.passo.scan-queue.plist).
// Each pass:
//   1. Writes the heartbeat, so the prospect page can say the runner is online.
//   2. Claims up to three queued requests, oldest first, one conditional update
//      per row (state queued -> running), so no request is ever claimed twice.
//   3. For each, re-checks that the prospect is 'approved' at that moment. If
//      not, the request fails "No longer approved" and nothing runs.
//   4. Runs Claude Code headless, /scope-prospects <slug>, restricted to the
//      tools that skill needs (lib/scan-runner-args.ts), with a 20 minute limit.
//   5. Marks the request done if the prospect is now built with a newer report,
//      otherwise failed with the last lines of output.
//
// The approval gate never weakens here: this is a fourth check on top of the
// skill's own gate and claim(), never a replacement for them.

import { spawn } from "node:child_process";
import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createSupabaseServiceClient } from "../lib/supabase/service.ts";
import {
  judgeRun,
  MAX_CLAIMS_PER_RUN,
  NO_LONGER_APPROVED,
  RUN_TIMEOUT_MS,
  RUNNER_ID,
  tailForError,
  type ScanRequestRow,
} from "../lib/scan-requests.ts";
import { buildClaudeArgs, PAYLOAD_DIR } from "../lib/scan-runner-args.ts";

const LOG_PATH = join(homedir(), "Library", "Logs", "passo-scan-queue.log");
const LOCK_PATH = join(tmpdir(), "passo-scan-queue.lock");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? join(homedir(), ".local", "bin", "claude");

function log(line: string) {
  const stamped = `${new Date().toISOString()}  ${line}`;
  console.log(stamped);
  try {
    appendFileSync(LOG_PATH, `${stamped}\n`);
  } catch {
    // The log is a convenience; a failure to write it must not stop a run.
  }
}

// ─── Lock: two passes never overlap ───────────────────────────────────────
function takeLock(): boolean {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(LOCK_PATH, "wx");
      writeSync(fd, String(process.pid));
      closeSync(fd);
      return true;
    } catch {
      // Held. If the holder is gone (crash, reboot), clear it once and retry.
      let pid = NaN;
      try {
        pid = Number(readFileSync(LOCK_PATH, "utf8").trim());
      } catch {
        // Unreadable: treat as held.
      }
      let alive = false;
      if (Number.isInteger(pid) && pid > 0) {
        try {
          process.kill(pid, 0);
          alive = true;
        } catch {
          alive = false;
        }
      }
      if (alive) return false;
      try {
        unlinkSync(LOCK_PATH);
      } catch {
        return false;
      }
    }
  }
  return false;
}

function releaseLock() {
  try {
    if (readFileSync(LOCK_PATH, "utf8").trim() === String(process.pid)) unlinkSync(LOCK_PATH);
  } catch {
    // Already gone.
  }
}

// ─── One headless run ─────────────────────────────────────────────────────
function runClaude(args: string[]): Promise<{ output: string; timedOut: boolean; code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(CLAUDE_BIN, args, { cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const capture = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      output += text;
      try {
        appendFileSync(LOG_PATH, text);
      } catch {
        // See log().
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 10_000).unref();
    }, RUN_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ output: `${output}\nCould not start Claude Code at ${CLAUDE_BIN}: ${error.message}`, timedOut, code: null });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ output, timedOut, code });
    });
  });
}

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Fall through: the service client names the missing variables.
  }
  try {
    mkdirSync(join(homedir(), "Library", "Logs"), { recursive: true });
  } catch {
    // See log().
  }

  if (!takeLock()) {
    log("Another scan-queue pass is still running. Leaving it to finish.");
    return;
  }

  try {
    const db = createSupabaseServiceClient();

    // 1. Heartbeat first, so the page is right even if nothing is queued.
    const beat = await db
      .from("runner_heartbeat")
      .upsert({ id: RUNNER_ID, last_seen_at: new Date().toISOString() }, { onConflict: "id" });
    if (beat.error) throw new Error(`Could not write the heartbeat: ${beat.error.message}`);

    // 2. Claim, oldest first. Each update is conditional on state 'queued',
    // so a row another pass has already taken is skipped, never taken twice.
    const { data: queued, error: queueError } = await db
      .from("scan_requests")
      .select("id")
      .eq("state", "queued")
      .order("requested_at", { ascending: true })
      .limit(MAX_CLAIMS_PER_RUN);
    if (queueError) throw new Error(`Could not read the queue: ${queueError.message}`);

    const claimed: ScanRequestRow[] = [];
    for (const { id } of queued ?? []) {
      const { data, error } = await db
        .from("scan_requests")
        .update({ state: "running", started_at: new Date().toISOString() })
        .eq("id", id)
        .eq("state", "queued")
        .select("*");
      if (error) throw new Error(`Could not claim request ${id}: ${error.message}`);
      if (data && data.length === 1) claimed.push(data[0] as ScanRequestRow);
    }
    if (claimed.length === 0) {
      log("Heartbeat written. Nothing queued.");
      return;
    }
    log(`Heartbeat written. Claimed ${claimed.length} request${claimed.length === 1 ? "" : "s"}.`);

    const finish = async (requestId: string, patch: { state: "done" | "failed"; error?: string; report_version?: number }) => {
      const { error } = await db
        .from("scan_requests")
        .update({ ...patch, finished_at: new Date().toISOString() })
        .eq("id", requestId)
        .eq("state", "running");
      if (error) log(`  Could not record the outcome of ${requestId}: ${error.message}`);
    };

    // 3 to 5, one request at a time, start to finish.
    for (const request of claimed) {
      const { data: prospect, error: prospectError } = await db
        .from("prospects")
        .select("id, slug, brand, domain, status")
        .eq("id", request.prospect_id)
        .maybeSingle();
      if (prospectError || !prospect) {
        await finish(request.id, { state: "failed", error: prospectError?.message ?? "Prospect not found." });
        log(`  ${request.id}: failed, prospect not found.`);
        continue;
      }

      // The gate, at the moment of claiming. Nothing below runs otherwise.
      if (prospect.status !== "approved") {
        await finish(request.id, { state: "failed", error: NO_LONGER_APPROVED });
        log(`  ${prospect.brand}: failed, ${NO_LONGER_APPROVED.toLowerCase()} (status ${prospect.status}). Nothing was run.`);
        continue;
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
        await finish(request.id, { state: "failed", error: (error as Error).message });
        log(`  ${prospect.brand}: failed, ${(error as Error).message}`);
        continue;
      }
      mkdirSync(PAYLOAD_DIR, { recursive: true });

      log(`  ${prospect.brand}: running /scope-prospects ${prospect.slug}`);
      const run = await runClaude(args);

      const { data: after } = await db.from("prospects").select("status").eq("id", prospect.id).maybeSingle();
      const statusAfter = (after?.status as string | undefined) ?? null;
      const verdict = judgeRun({ statusAfter, versionBefore, versionAfter: await latestVersion() });

      if (verdict.state === "done") {
        await finish(request.id, { state: "done", report_version: verdict.reportVersion });
        log(`  ${prospect.brand}: done, report version ${verdict.reportVersion}.`);
        continue;
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
      await finish(request.id, { state: "failed", error: `${why}${tailForError(run.output)}${note}` });
      log(`  ${prospect.brand}: failed${run.timedOut ? " (timed out)" : ""}, status now ${statusAfter}.`);
    }
  } finally {
    releaseLock();
  }
}

main().catch((error: unknown) => {
  log(`scan-queue failed: ${error instanceof Error ? error.message : String(error)}`);
  releaseLock();
  process.exitCode = 1;
});
