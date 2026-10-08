// The approval gate and the report writer for /scope-prospects.
//
// Every command that could start work on a prospect checks the gate first, in
// the database rather than in the skill's prose. An unapproved prospect cannot
// be claimed, so the agent cannot research one even if it is asked to.
//
//   node --experimental-strip-types scripts/agent/prospects.ts <command> [args]
//
//     list-approved [--brand "Brew York"]   what may be worked on
//     sheet-findings <slug>                 the spreadsheet's existing findings
//     claim <slug>                          approved -> researching
//     release <slug> [reason]               researching -> approved, on failure
//     write-report <slug> <payload.json>    validate, insert a version, set built

import { readFileSync } from "node:fs";
import { createSupabaseServiceClient } from "../../lib/supabase/service.ts";
import { parseReportPayload, danglingSourceRefs } from "../../lib/report-schema.ts";

type Row = Record<string, unknown>;

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

// Created on first use, so a usage error reports itself rather than being
// buried under a missing-environment-variable failure.
let client: ReturnType<typeof createSupabaseServiceClient> | null = null;
const db = () => (client ??= createSupabaseServiceClient());

async function findBySlugOrBrand(needle: string): Promise<Row | null> {
  const bySlug = await db().from("prospects").select("*").eq("slug", needle).maybeSingle();
  if (bySlug.error) die(bySlug.error.message);
  if (bySlug.data) return bySlug.data as Row;

  const byBrand = await db().from("prospects").select("*").ilike("brand", needle);
  if (byBrand.error) die(byBrand.error.message);
  const matches = (byBrand.data ?? []) as Row[];
  if (matches.length > 1) {
    die(
      `"${needle}" matches ${matches.length} prospects: ` +
        `${matches.map((m) => m.slug).join(", ")}. Name one by slug.`,
    );
  }
  return matches[0] ?? null;
}

// ─── list-approved ──────────────────────────────────────────────────────────
// With no --brand this is the work queue. With --brand it is the gate: a
// prospect that is not approved produces a non-zero exit and a message saying
// what to do about it, so the skill stops rather than carrying on.
async function listApproved(brand: string | null): Promise<void> {
  if (brand) {
    const prospect = await findBySlugOrBrand(brand);
    if (!prospect) {
      die(
        `No prospect matches "${brand}". Check the tracker, or run the seed script if the ` +
          `spreadsheet has not been imported.`,
      );
    }
    const status = prospect.status as string;
    if (status !== "approved") {
      die(
        `${prospect.brand} is "${status}", not approved. Nothing will be researched.\n` +
          `Approve ${prospect.brand} in the tracker first, then run this again.`,
      );
    }
    console.log(JSON.stringify([prospect], null, 2));
    return;
  }

  const { data, error } = await db()
    .from("prospects")
    .select("*")
    .eq("status", "approved")
    .order("shortlist_rank", { ascending: true, nullsFirst: false })
    .order("speed_score", { ascending: false, nullsFirst: false });
  if (error) die(error.message);

  const rows = (data ?? []) as Row[];
  if (rows.length === 0) {
    console.log("[]");
    console.error(
      "Nothing is approved, so there is nothing to research. Approve a prospect in the tracker first.",
    );
    return;
  }
  console.log(JSON.stringify(rows, null, 2));
}

// ─── sheet-findings ─────────────────────────────────────────────────────────
// The 21 September pass already established a lot. Re-deriving it wastes a
// fetch and risks contradicting it, so the agent reads it first.
async function sheetFindings(needle: string): Promise<void> {
  const prospect = await findBySlugOrBrand(needle);
  if (!prospect) die(`No prospect matches "${needle}".`);

  const keys = [
    "brand", "domain", "town", "drive_from_york", "category", "alcohol",
    "commercial_model", "budget_status", "platform", "skus_raw", "esp", "reviews",
    "subscription", "martech_detected", "paid_media_status", "provable_problem",
    "speed_score", "value_score", "value_score_label", "shortlist_rank",
    "shortlist_why", "shortlist_opening_line", "shortlist_known_risk",
    "source_tab", "source_note", "status", "notes",
  ];
  const subset: Row = {};
  for (const key of keys) subset[key] = prospect[key] ?? null;
  console.log(JSON.stringify(subset, null, 2));
}

// ─── claim / release ────────────────────────────────────────────────────────
async function claim(needle: string): Promise<void> {
  const prospect = await findBySlugOrBrand(needle);
  if (!prospect) die(`No prospect matches "${needle}".`);

  const status = prospect.status as string;
  if (status !== "approved") {
    die(
      status === "researching"
        ? `${prospect.brand} is already being researched. If a previous run died, release it first.`
        : `${prospect.brand} is "${status}", not approved. Approve it in the tracker first.`,
    );
  }

  // Conditional on the status we read, so two runs cannot both claim the row.
  const { data, error } = await db()
    .from("prospects")
    .update({ status: "researching" })
    .eq("id", prospect.id as string)
    .eq("status", "approved")
    .select("id");
  if (error) die(error.message);
  if (!data || data.length === 0) {
    die(`${prospect.brand} was claimed by another run a moment ago. Nothing done.`);
  }
  console.log(`Claimed ${prospect.brand}, status researching.`);
}

async function release(needle: string, reason: string | null): Promise<void> {
  const prospect = await findBySlugOrBrand(needle);
  if (!prospect) die(`No prospect matches "${needle}".`);
  const { error } = await db()
    .from("prospects")
    .update({ status: "approved" })
    .eq("id", prospect.id as string)
    .eq("status", "researching");
  if (error) die(error.message);
  console.log(
    `Released ${prospect.brand} back to approved.${reason ? ` Reason: ${reason}` : ""}`,
  );
}

// ─── write-report ───────────────────────────────────────────────────────────
async function writeReport(needle: string, payloadPath: string): Promise<void> {
  const prospect = await findBySlugOrBrand(needle);
  if (!prospect) die(`No prospect matches "${needle}".`);

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(payloadPath, "utf8"));
  } catch (error) {
    die(`Could not read ${payloadPath}: ${error instanceof Error ? error.message : error}`);
  }

  // Validated before anything is written, so a malformed payload never lands.
  const payload = parseReportPayload(raw);

  if (payload.slug !== prospect.slug) {
    die(
      `Payload slug "${payload.slug}" does not match prospect "${prospect.slug}". ` +
        `Refusing to file a report against the wrong company.`,
    );
  }

  const dangling = danglingSourceRefs(payload);
  if (dangling.length > 0) {
    die(
      `Payload cites sources that are not in its sources table: ${dangling.join(", ")}. ` +
        `Every claim must be traceable, so nothing was written.`,
    );
  }

  const { data: latest, error: versionError } = await db()
    .from("prospect_reports")
    .select("version")
    .eq("prospect_id", prospect.id as string)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (versionError) die(versionError.message);

  const version = ((latest?.version as number | undefined) ?? 0) + 1;

  const { error: insertError } = await db().from("prospect_reports").insert({
    prospect_id: prospect.id as string,
    version,
    payload,
    sources: payload.sources,
  });
  if (insertError) die(insertError.message);

  const { error: statusError } = await db()
    .from("prospects")
    .update({ status: "built", built_at: new Date().toISOString() })
    .eq("id", prospect.id as string);
  if (statusError) die(statusError.message);

  const gaps =
    payload.summary.gaps.length + payload.diagnostics.gaps.length +
    payload.ad_activity.gaps.length + payload.business_health.gaps.length +
    payload.pitch_pack.gaps.length;

  // The one-line summary the skill prints per prospect.
  console.log(
    `${payload.brand}: version ${version} written, ${payload.sources.length} sources, ` +
      `${gaps} gap${gaps === 1 ? "" : "s"} recorded, status built. /p/${payload.slug}`,
  );
}

// ─── dispatch ───────────────────────────────────────────────────────────────
const [command, ...rest] = process.argv.slice(2);
const brandFlag = rest.indexOf("--brand");
const brand = brandFlag >= 0 ? (rest[brandFlag + 1] ?? null) : null;
const positional = rest.filter((a, i) => !a.startsWith("--") && i !== brandFlag + 1);

try {
  switch (command) {
    case "list-approved":
      await listApproved(brand);
      break;
    case "sheet-findings":
      await sheetFindings(positional[0] ?? die("Usage: sheet-findings <slug>"));
      break;
    case "claim":
      await claim(positional[0] ?? die("Usage: claim <slug>"));
      break;
    case "release":
      await release(positional[0] ?? die("Usage: release <slug> [reason]"), positional[1] ?? null);
      break;
    case "write-report":
      await writeReport(
        positional[0] ?? die("Usage: write-report <slug> <payload.json>"),
        positional[1] ?? die("Usage: write-report <slug> <payload.json>"),
      );
      break;
    default:
      die(
        "Commands: list-approved [--brand X], sheet-findings <slug>, claim <slug>, " +
          "release <slug> [reason], write-report <slug> <payload.json>",
      );
  }
} catch (error) {
  // A readable line, not a stack trace: the agent reads this output.
  die(error instanceof Error ? error.message : String(error));
}
