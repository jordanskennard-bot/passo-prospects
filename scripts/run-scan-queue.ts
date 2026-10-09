// The Mac runner for the "Run research" queue. A fallback since research moved
// to GitHub Actions (scripts/run-scan-request.ts): it picks up anything the
// website could not dispatch, or that is still queued when it next runs.
//
//   npm run scan-queue
//
// Run every five minutes by launchd (scripts/launchd/com.passo.scan-queue.plist)
// if loaded. Each pass writes the heartbeat, claims up to three queued requests
// oldest first, and processes each through lib/scan-queue-runner.ts: the same
// gate, run and finish as the Action. A lock file stops two passes overlapping.

import { appendFileSync, closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createSupabaseServiceClient } from "../lib/supabase/service.ts";
import { MAX_CLAIMS_PER_RUN, RUNNER_ID } from "../lib/scan-requests.ts";
import { claimOldest, processClaimed, spawnClaude, writeHeartbeat } from "../lib/scan-queue-runner.ts";

const LOG_PATH = join(homedir(), "Library", "Logs", "passo-scan-queue.log");
const LOCK_PATH = join(tmpdir(), "passo-scan-queue.lock");
const CLAUDE_BIN = process.env.CLAUDE_BIN ?? join(homedir(), ".local", "bin", "claude");

function append(text: string) {
  try {
    appendFileSync(LOG_PATH, text);
  } catch {
    // The log is a convenience; a failure to write it must not stop a run.
  }
}

function log(line: string) {
  const stamped = `${new Date().toISOString()}  ${line}`;
  console.log(stamped);
  append(`${stamped}\n`);
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

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Fall through: the service client names the missing variables.
  }
  try {
    mkdirSync(join(homedir(), "Library", "Logs"), { recursive: true });
  } catch {
    // See append().
  }

  if (!takeLock()) {
    log("Another scan-queue pass is still running. Leaving it to finish.");
    return;
  }

  try {
    const db = createSupabaseServiceClient();
    await writeHeartbeat(db, RUNNER_ID);

    const claimed = await claimOldest(db, MAX_CLAIMS_PER_RUN);
    if (claimed.length === 0) {
      log("Heartbeat written. Nothing queued.");
      return;
    }
    log(`Heartbeat written. Claimed ${claimed.length} request${claimed.length === 1 ? "" : "s"}.`);

    // One at a time, start to finish.
    for (const request of claimed) {
      await processClaimed(db, request, {
        log,
        runClaude: (args) => spawnClaude(CLAUDE_BIN, args, append),
      });
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
