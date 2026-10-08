// Parsing Passo_Yorkshire_Prospects_v2.xlsx into prospect rows.
//
// Split out from seed.ts so the parse can be exercised without a database,
// and so the scope-prospects agent can read the sheet's own findings for a
// prospect it is about to research.

import { readFileSync } from "node:fs";
import * as XLSX from "xlsx";
// Shared with the tracker's add-prospect form, so a hand-added row gets the
// same slug the seed would have given it.
import { slugify } from "../lib/slug.ts";

export { slugify };

export type SourceTab =
  | "prospects"
  | "checked_not_shopify"
  | "blocked_by_bot_protection";

/** Exactly the columns the seed writes. Tracker state is deliberately absent. */
export type ProspectRow = {
  slug: string;
  brand: string;
  domain: string | null;
  town: string | null;
  source_tab: SourceTab;
  drive_from_york: string | null;
  category: string | null;
  alcohol: boolean | null;
  commercial_model: string | null;
  budget_status: string | null;
  platform: string | null;
  skus: number | null;
  skus_raw: string | null;
  esp: string | null;
  reviews: string | null;
  subscription: string | null;
  martech_detected: string | null;
  paid_media_status: string | null;
  provable_problem: string | null;
  p1_decision_speed: number | null;
  p1_provable_problem: number | null;
  p1_live_media: number | null;
  p1_proximity: number | null;
  p1_category_fit: number | null;
  speed_score: number | null;
  p2_ability_to_pay: number | null;
  p2_paid_activity: number | null;
  p2_scale: number | null;
  p2_winnability: number | null;
  p2_stack_gaps: number | null;
  value_score: number | null;
  value_score_label: string | null;
  sheet_status: string | null;
  next_action: string | null;
  shortlist_rank: number | null;
  shortlist_why: string | null;
  shortlist_opening_line: string | null;
  shortlist_known_risk: string | null;
  source_note: string | null;
};

/** Where each tab's header row sits, 1-indexed, and what we call that tab. */
const TABS: {
  sheet: string;
  headerRow: number;
  sourceTab: SourceTab | null;
}[] = [
  { sheet: "Prospects", headerRow: 4, sourceTab: "prospects" },
  { sheet: "Phase 1 shortlist", headerRow: 4, sourceTab: null },
  { sheet: "Checked not Shopify", headerRow: 4, sourceTab: "checked_not_shopify" },
  { sheet: "Blocked by bot protection", headerRow: 3, sourceTab: "blocked_by_bot_protection" },
];

/** A cell the sheet uses to mean "nothing here". */
function cell(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === "" || text === "-" || text === "\u2013" || text === "\u2014") return null;
  return text;
}

function num(value: unknown): number | null {
  const text = cell(value);
  if (text === null) return null;
  // Tolerates '244+' (→ 244) and '-83,324' (→ -83324).
  const match = text.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function yesNo(value: unknown): boolean | null {
  const text = cell(value)?.toLowerCase();
  if (text === "yes") return true;
  if (text === "no") return false;
  return null;
}



type RawRow = Record<string, unknown>;

/**
 * Read one tab as objects keyed by its real header row.
 *
 * Rows below the data are legend and footnote blocks: in Prospects they occupy
 * rows 34 to 39, in Phase 1 shortlist rows 12 to 16. They are filtered by
 * requiring the tab's key column rather than by row number, so the seed keeps
 * working when the sheet grows.
 */
function readTab(workbook: XLSX.WorkBook, sheet: string, headerRow: number): RawRow[] {
  const worksheet = workbook.Sheets[sheet];
  if (!worksheet) {
    throw new Error(
      `Sheet "${sheet}" not found. Found: ${workbook.SheetNames.join(", ")}`,
    );
  }
  // blankrows must stay true: these tabs carry a blank spacer row above the
  // header, and dropping it would shift every index out of step with the sheet.
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(worksheet, {
    header: 1,
    raw: true,
    blankrows: true,
    defval: null,
  });

  const headers = (matrix[headerRow - 1] ?? []).map((h) => cell(h));
  const lastCol = headers.reduce((last, h, i) => (h !== null ? i : last), -1);
  if (lastCol < 0) throw new Error(`Sheet "${sheet}" has no header at row ${headerRow}`);

  const out: RawRow[] = [];
  for (const raw of matrix.slice(headerRow)) {
    const row: RawRow = {};
    let anyValue = false;
    for (let i = 0; i <= lastCol; i++) {
      const key = headers[i];
      if (!key) continue;
      row[key] = raw?.[i] ?? null;
      if (cell(raw?.[i]) !== null) anyValue = true;
    }
    if (anyValue) out.push(row);
  }
  return out;
}

export type ParseResult = {
  rows: ProspectRow[];
  /** Data rows kept per tab, after legend and footnote blocks are dropped. */
  counts: Record<SourceTab, number>;
  /** Shortlist entries that matched no brand on the Prospects tab. */
  unmatchedShortlist: string[];
  /** Brands appearing on more than one tab, first tab wins. */
  duplicateBrands: string[];
  /** Headers present in the sheet that this parser does not map. */
  unmappedHeaders: { sheet: string; headers: string[] }[];
  researchedOn: string | null;
};

const MAPPED_HEADERS: Record<string, string[]> = {
  Prospects: [
    "Brand", "Domain", "Town", "Drive from York", "Category", "Alcohol",
    "Commercial model", "Budget status", "Platform", "SKUs", "ESP", "Reviews",
    "Subscription", "Martech detected", "Paid media status",
    "Provable problem to lead with", "P1 Decision speed", "P1 Provable problem",
    "P1 Live media", "P1 Proximity", "P1 Category fit", "SPEED SCORE",
    "P2 Ability to pay", "P2 Paid activity", "P2 Scale", "P2 Winnability",
    "P2 Stack gaps", "VALUE SCORE", "Status", "Next action",
  ],
  "Phase 1 shortlist": [
    "Rank", "Brand", "Speed score", "Why this one", "Opening line", "Known risk",
  ],
  "Checked not Shopify": ["Brand", "Domain", "Town", "Platform", "Note"],
  "Blocked by bot protection": ["Brand", "Domain", "Town", "What we saw"],
};

export function parseSpreadsheet(path: string): ParseResult {
  const unmappedHeaders: { sheet: string; headers: string[] }[] = [];
  const bySlug = new Map<string, ProspectRow>();
  const duplicateBrands: string[] = [];
  const counts: Record<SourceTab, number> = {
    prospects: 0,
    checked_not_shopify: 0,
    blocked_by_bot_protection: 0,
  };

  // The ESM build of xlsx exposes read() but not readFile(), so the bytes are
  // read here and the workbook is parsed once for every tab.
  const workbook = XLSX.read(readFileSync(path), { type: "buffer" });

  const tabData = new Map<string, RawRow[]>();
  for (const { sheet, headerRow } of TABS) {
    const rows = readTab(workbook, sheet, headerRow);
    tabData.set(sheet, rows);
    const seen = new Set<string>();
    for (const row of rows) for (const key of Object.keys(row)) seen.add(key);
    const extra = [...seen].filter((h) => !(MAPPED_HEADERS[sheet] ?? []).includes(h));
    if (extra.length) unmappedHeaders.push({ sheet, headers: extra });
  }

  const add = (row: ProspectRow) => {
    if (bySlug.has(row.slug)) {
      duplicateBrands.push(row.brand);
      return;
    }
    bySlug.set(row.slug, row);
    counts[row.source_tab] += 1;
  };

  const blank = (brand: string, sourceTab: SourceTab): ProspectRow => ({
    slug: slugify(brand), brand, domain: null, town: null, source_tab: sourceTab,
    drive_from_york: null, category: null, alcohol: null, commercial_model: null,
    budget_status: null, platform: null, skus: null, skus_raw: null, esp: null,
    reviews: null, subscription: null, martech_detected: null,
    paid_media_status: null, provable_problem: null, p1_decision_speed: null,
    p1_provable_problem: null, p1_live_media: null, p1_proximity: null,
    p1_category_fit: null, speed_score: null, p2_ability_to_pay: null,
    p2_paid_activity: null, p2_scale: null, p2_winnability: null,
    p2_stack_gaps: null, value_score: null, value_score_label: null,
    sheet_status: null, next_action: null, shortlist_rank: null,
    shortlist_why: null, shortlist_opening_line: null, shortlist_known_risk: null,
    source_note: null,
  });

  // ─── Prospects. A real row is one with both a brand and a domain; the
  // legend block below the data has a brand-column value but no domain. ─────
  for (const r of tabData.get("Prospects") ?? []) {
    const brand = cell(r["Brand"]);
    const domain = cell(r["Domain"]);
    if (!brand || !domain) continue;

    const valueScoreRaw = cell(r["VALUE SCORE"]);
    const valueScoreNum = valueScoreRaw !== null && /^-?[\d.,]+$/.test(valueScoreRaw)
      ? num(valueScoreRaw)
      : null;

    add({
      ...blank(brand, "prospects"),
      domain,
      town: cell(r["Town"]),
      drive_from_york: cell(r["Drive from York"]),
      category: cell(r["Category"]),
      alcohol: yesNo(r["Alcohol"]),
      commercial_model: cell(r["Commercial model"]),
      budget_status: cell(r["Budget status"]),
      platform: cell(r["Platform"]),
      skus: num(r["SKUs"]),
      skus_raw: cell(r["SKUs"]),
      esp: cell(r["ESP"]),
      reviews: cell(r["Reviews"]),
      subscription: cell(r["Subscription"]),
      martech_detected: cell(r["Martech detected"]),
      paid_media_status: cell(r["Paid media status"]),
      provable_problem: cell(r["Provable problem to lead with"]),
      p1_decision_speed: num(r["P1 Decision speed"]),
      p1_provable_problem: num(r["P1 Provable problem"]),
      p1_live_media: num(r["P1 Live media"]),
      p1_proximity: num(r["P1 Proximity"]),
      p1_category_fit: num(r["P1 Category fit"]),
      speed_score: num(r["SPEED SCORE"]),
      p2_ability_to_pay: num(r["P2 Ability to pay"]),
      p2_paid_activity: num(r["P2 Paid activity"]),
      p2_scale: num(r["P2 Scale"]),
      p2_winnability: num(r["P2 Winnability"]),
      p2_stack_gaps: num(r["P2 Stack gaps"]),
      value_score: valueScoreNum,
      // Keep the sheet's own words ('Pending pay data') when it is not a number.
      value_score_label: valueScoreNum === null ? valueScoreRaw : null,
      sheet_status: cell(r["Status"]),
      next_action: cell(r["Next action"]),
    });
  }

  // ─── Checked not Shopify, and Blocked by bot protection. ─────────────────
  for (const [sheet, sourceTab, noteKey] of [
    ["Checked not Shopify", "checked_not_shopify", "Note"],
    ["Blocked by bot protection", "blocked_by_bot_protection", "What we saw"],
  ] as const) {
    for (const r of tabData.get(sheet) ?? []) {
      const brand = cell(r["Brand"]);
      const domain = cell(r["Domain"]);
      if (!brand || !domain) continue;
      add({
        ...blank(brand, sourceTab),
        domain,
        town: cell(r["Town"]),
        platform: cell(r["Platform"]) ?? null,
        source_note: cell(r[noteKey]),
      });
    }
  }

  // ─── Phase 1 shortlist, merged onto the matching brand. ──────────────────
  const unmatchedShortlist: string[] = [];
  for (const r of tabData.get("Phase 1 shortlist") ?? []) {
    const brand = cell(r["Brand"]);
    const rank = num(r["Rank"]);
    if (!brand || rank === null) continue;
    const target = bySlug.get(slugify(brand));
    if (!target) {
      unmatchedShortlist.push(brand);
      continue;
    }
    target.shortlist_rank = rank;
    target.shortlist_why = cell(r["Why this one"]);
    target.shortlist_opening_line = cell(r["Opening line"]);
    target.shortlist_known_risk = cell(r["Known risk"]);
  }

  // The research date from the Method tab, for the consent caveat's provenance.
  let researchedOn: string | null = null;
  try {
    const method = readTab(workbook, "Method", 1);
    const text = JSON.stringify(method);
    const match = text.match(/(\d{1,2})\s+(\w+)\s+(20\d\d)/);
    if (match) {
      const parsed = new Date(`${match[1]} ${match[2]} ${match[3]} UTC`);
      if (!Number.isNaN(parsed.getTime())) {
        researchedOn = parsed.toISOString().slice(0, 10);
      }
    }
  } catch {
    // The Method tab is prose, not a table. A miss here is not worth failing on.
  }

  return {
    rows: [...bySlug.values()],
    counts,
    unmatchedShortlist,
    duplicateBrands,
    unmappedHeaders,
    researchedOn,
  };
}
