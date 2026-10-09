import { createSupabaseServerClient } from "./supabase/server";
import type { ProspectWriter, ProspectStub } from "./add-prospect";
import type { NoteRow } from "./notes";
import type { ScanRequestRow } from "./scan-requests";

export const PROSPECT_STATUSES = [
  "new",
  "approved",
  "researching",
  "built",
  // Set by scripts/scan-email.ts, forward only. Permitted by migration 003.
  "message_sent",
  "response_received",
  "archived",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const STATUS_LABELS: Record<ProspectStatus, string> = {
  new: "new",
  approved: "approved",
  researching: "researching",
  built: "built",
  message_sent: "message sent",
  response_received: "response received",
  archived: "archived",
};

/**
 * Statuses that have a prospect page. Approval is what creates the page: a
 * 'new' prospect has none, and an archived one keeps its page only if a report
 * was ever written for it (see hasProspectPage).
 */
export const PROSPECT_PAGE_STATUSES: readonly ProspectStatus[] = [
  "approved",
  "researching",
  "built",
  "message_sent",
  "response_received",
];

export function hasProspectPage(status: string, hasReport: boolean): boolean {
  if ((PROSPECT_PAGE_STATUSES as readonly string[]).includes(status)) return true;
  return status === "archived" && hasReport;
}

export const SOURCE_TABS = [
  "prospects",
  "checked_not_shopify",
  "blocked_by_bot_protection",
  // Added by hand in the tracker rather than imported. The seed only ever
  // writes the three spreadsheet values, so a manual row is never touched by a
  // re-seed. Permitted by migration 002.
  "manual",
] as const;
export type SourceTab = (typeof SOURCE_TABS)[number];

export const SOURCE_TAB_LABELS: Record<SourceTab, string> = {
  prospects: "Prospects",
  checked_not_shopify: "Checked not Shopify",
  blocked_by_bot_protection: "Blocked by bot protection",
  manual: "Added manually",
};

export type Prospect = {
  id: string;
  slug: string;
  brand: string;
  domain: string | null;
  town: string | null;
  source_tab: SourceTab;
  category: string | null;
  drive_from_york: string | null;
  platform: string | null;
  budget_status: string | null;
  paid_media_status: string | null;
  provable_problem: string | null;
  martech_detected: string | null;
  esp: string | null;
  reviews: string | null;
  subscription: string | null;
  commercial_model: string | null;
  alcohol: boolean | null;
  skus: number | null;
  skus_raw: string | null;
  speed_score: number | null;
  value_score: number | null;
  value_score_label: string | null;
  shortlist_rank: number | null;
  shortlist_why: string | null;
  shortlist_opening_line: string | null;
  shortlist_known_risk: string | null;
  source_note: string | null;
  status: ProspectStatus;
  approved_at: string | null;
  built_at: string | null;
  notes: string | null;
};

/** Columns the tracker needs. Narrow on purpose: the long prose columns are
 *  only read on the prospect page itself. */
const TRACKER_COLUMNS =
  "id, slug, brand, domain, town, source_tab, category, drive_from_york, platform, " +
  "budget_status, speed_score, value_score, value_score_label, shortlist_rank, " +
  "status, approved_at, built_at, provable_problem";

export type TrackerProspect = Pick<
  Prospect,
  | "id" | "slug" | "brand" | "domain" | "town" | "source_tab" | "category"
  | "drive_from_york" | "platform" | "budget_status" | "speed_score"
  | "value_score" | "value_score_label" | "shortlist_rank" | "status"
  | "approved_at" | "built_at" | "provable_problem"
>;

export const SORT_COLUMNS = {
  speed_score: "speed_score",
  value_score: "value_score",
  town: "town",
  category: "category",
  brand: "brand",
  status: "status",
} as const;
export type SortKey = keyof typeof SORT_COLUMNS;

export type TrackerQuery = {
  sort: SortKey;
  direction: "asc" | "desc";
  status: ProspectStatus | "all";
  sourceTab: SourceTab | "all";
};

export function parseTrackerQuery(params: Record<string, string | undefined>): TrackerQuery {
  const sort = (params.sort && params.sort in SORT_COLUMNS ? params.sort : "speed_score") as SortKey;
  const direction = params.dir === "asc" ? "asc" : "desc";
  const status =
    params.status && (PROSPECT_STATUSES as readonly string[]).includes(params.status)
      ? (params.status as ProspectStatus)
      : "all";
  const sourceTab =
    params.tab && (SOURCE_TABS as readonly string[]).includes(params.tab)
      ? (params.tab as SourceTab)
      : "all";
  return { sort, direction, status, sourceTab };
}

/** The query string for a tracker view, without the leading "?". */
export function trackerSearch(query: TrackerQuery, patch: Partial<Record<string, string>> = {}): string {
  const params = new URLSearchParams();
  params.set("sort", query.sort);
  params.set("dir", query.direction);
  if (query.status !== "all") params.set("status", query.status);
  if (query.sourceTab !== "all") params.set("tab", query.sourceTab);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "all") params.delete(key);
    else params.set(key, value);
  }
  return params.toString();
}

/** A tracker URL preserving the filters already applied. */
export function trackerHref(query: TrackerQuery, patch: Partial<Record<string, string>> = {}): string {
  const text = trackerSearch(query, patch);
  return text ? `/?${text}` : "/";
}

/**
 * The "Back to tracker" target from a prospect page's ?from= parameter. The
 * value is re-parsed and rebuilt, never echoed, so it can only ever produce a
 * tracker URL with known filters.
 */
export function trackerHrefFromParam(from: string | undefined): string {
  if (!from) return "/";
  const params = Object.fromEntries(new URLSearchParams(from));
  return trackerHref(parseTrackerQuery(params));
}

/** Ids of prospects with at least one report, for linking archived rows. */
export async function prospectIdsWithReports(): Promise<Set<string>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("prospect_reports").select("prospect_id");
  if (error) throw new Error(`Could not load reports: ${error.message}`);
  return new Set((data ?? []).map((r) => (r as { prospect_id: string }).prospect_id));
}

/** PostgREST's "no such table" (before a migration is applied). */
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

export async function listProspects(query: TrackerQuery): Promise<TrackerProspect[]> {
  const supabase = await createSupabaseServerClient();

  let builder = supabase.from("prospects").select(TRACKER_COLUMNS);
  if (query.status !== "all") builder = builder.eq("status", query.status);
  if (query.sourceTab !== "all") builder = builder.eq("source_tab", query.sourceTab);

  const { data, error } = await builder
    .order(SORT_COLUMNS[query.sort], {
      ascending: query.direction === "asc",
      nullsFirst: false,
    })
    // Stable tie-break so equal speed scores do not reshuffle between loads.
    .order("brand", { ascending: true });

  if (error) throw new Error(`Could not load prospects: ${error.message}`);
  return (data ?? []) as unknown as TrackerProspect[];
}

export async function countsByStatus(): Promise<Record<string, number>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("prospects").select("status");
  if (error) throw new Error(`Could not count prospects: ${error.message}`);
  const counts: Record<string, number> = {};
  for (const row of data ?? []) {
    const status = (row as { status: string }).status;
    counts[status] = (counts[status] ?? 0) + 1;
  }
  return counts;
}

export async function getProspectBySlug(slug: string): Promise<Prospect | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("prospects")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw new Error(`Could not load prospect: ${error.message}`);
  return (data as Prospect | null) ?? null;
}

export type ReportRow = {
  id: string;
  version: number;
  payload: unknown;
  sources: unknown;
  created_at: string;
};

export type EmailRow = {
  id: string;
  message_id: string;
  direction: "sent" | "received";
  sent_at: string;
  from_address: string;
  to_address: string;
  subject: string | null;
};

/**
 * Emails matched to this prospect by the scanner, oldest first, as a thread
 * reads. Null when the table does not exist yet (migration 003 not applied).
 */
export async function listEmails(prospectId: string): Promise<EmailRow[] | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("prospect_emails")
    .select("id, message_id, direction, sent_at, from_address, to_address, subject")
    .eq("prospect_id", prospectId)
    .order("sent_at", { ascending: true });
  if (isMissingTable(error)) return null;
  if (error) throw new Error(`Could not load emails: ${error.message}`);
  return (data ?? []) as EmailRow[];
}

/**
 * Every note for this prospect. Grouping and order are done by groupNotes().
 * Null when the table does not exist yet (migration 004 not applied).
 */
export async function listNotes(prospectId: string): Promise<NoteRow[] | null> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("prospect_notes")
    .select("id, prospect_id, category, body, source, source_message_id, created_at, updated_at")
    .eq("prospect_id", prospectId)
    .order("created_at", { ascending: false });
  if (isMissingTable(error)) return null;
  if (error) throw new Error(`Could not load notes: ${error.message}`);
  return (data ?? []) as NoteRow[];
}

/**
 * The most recent research request for this prospect. Undefined when the
 * table does not exist yet (migration 005 not applied), null when there is none.
 */
export async function latestScanRequest(prospectId: string): Promise<ScanRequestRow | null | undefined> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("scan_requests")
    // "*" rather than a column list, so the page still loads before migration 006 adds run_url.
    .select("*")
    .eq("prospect_id", prospectId)
    .order("requested_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (isMissingTable(error)) return undefined;
  if (error) throw new Error(`Could not load research requests: ${error.message}`);
  return (data as ScanRequestRow | null) ?? null;
}

/** Every version, newest first. The page renders [0] and lists the rest. */
export async function listReports(prospectId: string): Promise<ReportRow[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("prospect_reports")
    .select("id, version, payload, sources, created_at")
    .eq("prospect_id", prospectId)
    .order("version", { ascending: false });
  if (error) throw new Error(`Could not load reports: ${error.message}`);
  return (data ?? []) as ReportRow[];
}


// ─── Adding a prospect by hand ──────────────────────────────────────────────
// The logic lives in ./add-prospect, which has no Next.js imports so it can be
// tested directly. Re-exported here so callers have one place to look.

export {
  createProspect,
  type AddProspectInput,
  type NewProspectRow,
  type ProspectStub,
  type ProspectWriter,
  type CreateProspectResult,
} from "./add-prospect";

/** The real writer, over the operator's session so RLS still applies. */
export function supabaseProspectWriter(
  client: Awaited<ReturnType<typeof createSupabaseServerClient>>,
): ProspectWriter {
  const lookup = async (column: "slug" | "domain", value: string) => {
    const { data, error } = await client
      .from("prospects")
      .select("slug, brand, domain")
      .eq(column, value)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as ProspectStub | null) ?? null;
  };

  return {
    findBySlug: (slug) => lookup("slug", slug),
    findByDomain: (domain) => lookup("domain", domain),
    async insert(row) {
      const { error } = await client.from("prospects").insert(row);
      if (error) throw new Error(error.message);
    },
  };
}
