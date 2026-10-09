// The exact Claude Code invocation for one queued research run. Pure, so the
// restrictions are pinned by tests rather than trusted to a reviewer.
//
// Non-interactive (-p) in dontAsk mode with no permission prompts: anything
// not on the allow list below is refused, never asked about. The allow list is
// what /scope-prospects needs and nothing more: its own node scripts, a JSON
// payload inside .scan-queue/, and web fetches to the prospect's own domain
// plus the four public sources the skill reads.

import { normaliseDomain } from "./outreach.ts";

/** Where the unattended run writes its report payload, inside the repo. */
export const PAYLOAD_DIR = ".scan-queue";

const SOURCE_DOMAINS = [
  "find-and-update.company-information.service.gov.uk",
  "api.company-information.service.gov.uk",
  "adstransparency.google.com",
  "www.facebook.com",
];

export function buildClaudeArgs(input: { slug: string; domain: string | null }): string[] {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(input.slug)) {
    throw new Error(`Refusing to run for an unexpected slug: ${JSON.stringify(input.slug)}`);
  }
  const domain = normaliseDomain(input.domain);
  const webDomains = [...(domain ? [domain, `www.${domain}`] : []), ...SOURCE_DOMAINS];

  const allowed = [
    "Bash(node --experimental-strip-types scripts/agent/prospects.ts *)",
    "Bash(node --experimental-strip-types scripts/agent/fingerprint.ts *)",
    // Companies House through the API: the key stays inside the script.
    "Bash(node --experimental-strip-types scripts/agent/companies-house.ts *)",
    "Bash(node --experimental-strip-types scripts/lint-copy.ts *)",
    // No Read rule: reads stay confined to the repository, the default here.
    // Edit rules govern every file-writing tool, Write included.
    `Edit(${PAYLOAD_DIR}/**)`,
    ...webDomains.map((d) => `WebFetch(domain:${d})`),
    "mcp__claude_ai_Meta__ads_library_search",
  ];

  const scope = [
    `You are running unattended, started by the research queue, for exactly one prospect: ${input.slug}.`,
    "Research only that prospect. Never list, claim, research or write a report for any other prospect.",
    `Save the report payload to ${PAYLOAD_DIR}/${input.slug}.json instead of /tmp, and pass that path to lint-copy and write-report.`,
    "No one can answer questions during this run. If the gate refuses, stop. If you cannot finish, release the prospect with a reason and stop.",
  ].join(" ");

  return [
    "-p",
    `/scope-prospects ${input.slug}`,
    "--permission-mode",
    "dontAsk",
    "--permission-prompts",
    "none",
    "--tools",
    "Bash,Read,Write,Edit,WebFetch,Skill",
    "--allowedTools",
    ...allowed,
    "--append-system-prompt",
    scope,
    "--no-session-persistence",
    "--output-format",
    "text",
  ];
}
