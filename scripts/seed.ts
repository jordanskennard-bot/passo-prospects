// Import Passo_Yorkshire_Prospects_v2.xlsx into the prospects table.
//
// Safe to re-run. Spreadsheet fields are updated in place; tracker state
// (status, approved_at, built_at, notes) is never written, so re-seeding after
// an approval cannot un-approve anything. That property comes from the upsert
// payload simply not containing those columns, so ON CONFLICT DO UPDATE leaves
// them alone.
//
//   node --experimental-strip-types scripts/seed.ts [--dry-run] [--file <path>]
//
// --dry-run parses and reports without touching the database, which needs no
// credentials.

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { existsSync } from "node:fs";
import { parseSpreadsheet, type ProspectRow } from "./parse-spreadsheet.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_FILE = resolve(HERE, "../data/Passo_Yorkshire_Prospects_v2.xlsx");

const TAB_LABELS: Record<string, string> = {
  prospects: "Prospects",
  checked_not_shopify: "Checked not Shopify",
  blocked_by_bot_protection: "Blocked by bot protection",
};

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : null;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const file = arg("--file") ?? DEFAULT_FILE;

  if (!existsSync(file)) {
    throw new Error(
      `Spreadsheet not found at ${file}\n` +
        `Pass --file <path>, or copy the sheet to data/Passo_Yorkshire_Prospects_v2.xlsx`,
    );
  }

  console.log(`Reading ${file}\n`);
  const parsed = parseSpreadsheet(file);

  // ─── Row count per source tab. ───────────────────────────────────────────
  console.log("Row count per source tab");
  let total = 0;
  for (const [tab, count] of Object.entries(parsed.counts)) {
    console.log(`  ${(TAB_LABELS[tab] ?? tab).padEnd(28)} ${String(count).padStart(3)}`);
    total += count;
  }
  console.log(`  ${"".padEnd(28)} ---`);
  console.log(`  ${"total prospects".padEnd(28)} ${String(total).padStart(3)}\n`);

  const shortlisted = parsed.rows.filter((r) => r.shortlist_rank !== null);
  console.log(`Phase 1 shortlist merged onto ${shortlisted.length} prospects`);
  if (parsed.researchedOn) console.log(`Sheet research date: ${parsed.researchedOn}`);

  // ─── Anything the parser could not account for. ──────────────────────────
  if (parsed.unmatchedShortlist.length) {
    console.warn(
      `\nWarning: ${parsed.unmatchedShortlist.length} shortlist entries matched no prospect:`,
    );
    for (const brand of parsed.unmatchedShortlist) console.warn(`  ${brand}`);
  }
  if (parsed.duplicateBrands.length) {
    console.warn(`\nWarning: brands seen on more than one tab, first tab kept:`);
    for (const brand of parsed.duplicateBrands) console.warn(`  ${brand}`);
  }
  if (parsed.unmappedHeaders.length) {
    console.warn(`\nWarning: columns present in the sheet but not imported:`);
    for (const { sheet, headers } of parsed.unmappedHeaders) {
      console.warn(`  ${sheet}: ${headers.join(", ")}`);
    }
  }

  if (dryRun) {
    console.log("\n--dry-run: nothing written. Sample row:");
    const sample = parsed.rows.find((r) => r.slug === "brew-york") ?? parsed.rows[0];
    console.log(JSON.stringify(sample, null, 2));
    return;
  }

  // ─── Write. ──────────────────────────────────────────────────────────────
  const { createSupabaseServiceClient } = await import("../lib/supabase/service.ts");
  const supabase = createSupabaseServiceClient();

  const before = await supabase
    .from("prospects")
    .select("slug, status", { count: "exact" });
  if (before.error) throw new Error(`Could not read prospects: ${before.error.message}`);

  const existing = new Map((before.data ?? []).map((r) => [r.slug as string, r.status as string]));
  const approvedBefore = [...existing.values()].filter((s) => s !== "new").length;

  // Chunked so a large sheet cannot exceed the request size limit.
  const CHUNK = 100;
  let written = 0;
  for (let i = 0; i < parsed.rows.length; i += CHUNK) {
    const chunk: ProspectRow[] = parsed.rows.slice(i, i + CHUNK);
    const { error } = await supabase
      .from("prospects")
      .upsert(chunk, { onConflict: "slug", ignoreDuplicates: false });
    if (error) throw new Error(`Upsert failed at row ${i}: ${error.message}`);
    written += chunk.length;
  }

  const after = await supabase.from("prospects").select("slug, status");
  if (after.error) throw new Error(`Could not verify: ${after.error.message}`);
  const approvedAfter = (after.data ?? []).filter((r) => r.status !== "new").length;

  const inserted = parsed.rows.filter((r) => !existing.has(r.slug)).length;
  console.log(
    `\nWrote ${written} rows: ${inserted} new, ${written - inserted} updated in place.`,
  );
  console.log(
    `Tracker state preserved: ${approvedBefore} rows were off 'new' before, ${approvedAfter} after.`,
  );
  if (approvedAfter < approvedBefore) {
    throw new Error(
      "Tracker state regressed. The seed must never reset an approval. Investigate before trusting this run.",
    );
  }
}

main().catch((error: unknown) => {
  console.error(`\nSeed failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
