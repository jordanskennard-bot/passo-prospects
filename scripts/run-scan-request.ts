// The GitHub Actions runner for one "Run research" request.
//
//   node --experimental-strip-types scripts/run-scan-request.ts <request_id>
//
// Run by .github/workflows/scope-prospect.yml, which the website dispatches
// when it queues a request. Claims that one request (queued -> running,
// recording this run's URL), then processes it through lib/scan-queue-runner.ts:
// the same gate, run and finish as the Mac runner. If the request is no longer
// queued (the Mac runner took it, or it was already handled), it does nothing.
//
// Environment, from repository secrets: NEXT_PUBLIC_SUPABASE_URL,
// SUPABASE_SERVICE_ROLE_KEY, COMPANIES_HOUSE_API_KEY, and one of
// CLAUDE_CODE_OAUTH_TOKEN (a Claude subscription, from `claude setup-token`) or
// ANTHROPIC_API_KEY. None of them is ever printed.

import { createSupabaseServiceClient } from "../lib/supabase/service.ts";
import { claimById, processClaimed, spawnClaude } from "../lib/scan-queue-runner.ts";
import { claudeCredentialProblem, isRequestId } from "../lib/scan-requests.ts";

const log = (line: string) => console.log(`${new Date().toISOString()}  ${line}`);

async function main() {
  const requestId = process.argv[2] ?? "";
  if (!isRequestId(requestId)) {
    log(`Not a request id: ${JSON.stringify(requestId)}. Nothing was claimed.`);
    process.exitCode = 1;
    return;
  }
  const runUrl = process.env.RUN_URL?.startsWith("https://github.com/") ? process.env.RUN_URL : null;

  const db = createSupabaseServiceClient();
  const request = await claimById(db, requestId, runUrl);
  if (!request) {
    log(`Request ${requestId} is not queued (already taken or finished). Nothing to do.`);
    return;
  }
  log(`Claimed request ${requestId}.`);

  const outcome = await processClaimed(db, request, {
    log,
    // Checked only after the gate, so an unapproved prospect fails as such.
    preflight: () => claudeCredentialProblem(process.env),
    runClaude: (args) => spawnClaude(process.env.CLAUDE_BIN ?? "claude", args, (text) => process.stdout.write(text)),
  });
  log(`Request ${requestId}: ${outcome}.`);
  // A failed request is a recorded outcome, not a broken workflow; the
  // website shows the reason. Only an error above fails the job.
}

main().catch((error: unknown) => {
  log(`run-scan-request failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
