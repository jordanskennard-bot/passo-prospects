import { createSupabaseServerClient } from "./supabase/server";

export const PROSPECT_STATUSES = [
  "new",
  "approved",
  "researching",
  "built",
  "archived",
] as const;
export type ProspectStatus = (typeof PROSPECT_STATUSES)[number];

export const SOURCE_TABS = [
  "prospects",
  "checked_not_shopify",
  "blocked_by_bot_protection",
] as const;
export type SourceTab = (typeof SOURCE_TABS)[number];

export const SOURCE_TAB_LABELS: Record<SourceTab, string> = {
  prospects: "Prospects",
  checked_not_shopify: "Checked not Shopify",
  blocked_by_bot_protection: "Blocked by bot protection",
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
