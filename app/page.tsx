import Link from "next/link";
import { requireOperator } from "@/lib/session";
import {
  listProspects,
  countsByStatus,
  parseTrackerQuery,
  PROSPECT_STATUSES,
  SOURCE_TABS,
  SOURCE_TAB_LABELS,
  type SortKey,
  type TrackerQuery,
} from "@/lib/prospects";
import { RowActions } from "./RowActions";

export const metadata = { title: "Prospect tracker · Passo" };

// Stands in for a cell the spreadsheet left blank. A middle dot, never a dash.
const EMPTY = "·";

const COLUMNS: { key: SortKey | null; label: string; align?: "right" }[] = [
  { key: "brand", label: "Brand" },
  { key: "town", label: "Town" },
  { key: "category", label: "Category" },
  { key: null, label: "Platform" },
  { key: null, label: "Budget" },
  { key: "speed_score", label: "Speed", align: "right" },
  { key: "value_score", label: "Value", align: "right" },
  { key: "status", label: "Status" },
  { key: null, label: "Actions" },
];

/** Build a tracker URL preserving the filters already applied. */
function href(query: TrackerQuery, patch: Partial<Record<string, string>>): string {
  const params = new URLSearchParams();
  params.set("sort", query.sort);
  params.set("dir", query.direction);
  if (query.status !== "all") params.set("status", query.status);
  if (query.sourceTab !== "all") params.set("tab", query.sourceTab);
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined || value === "all") params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  return text ? `/?${text}` : "/";
}

export default async function TrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireOperator();

  const raw = await searchParams;
  const flat: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(raw)) {
    flat[key] = Array.isArray(value) ? value[0] : value;
  }
  const query = parseTrackerQuery(flat);

  const [prospects, counts] = await Promise.all([listProspects(query), countsByStatus()]);
  const total = Object.values(counts).reduce((sum, n) => sum + n, 0);

  return (
    <main className="page">
      <div className="masthead">
        <h1>Prospect tracker</h1>
        <form action="/auth/signout" method="post">
          <button type="submit" className="btn btn-quiet">Sign out</button>
        </form>
      </div>

      <p className="reading">
        Nothing is researched until it is approved here. Approving a prospect puts it in
        the queue for <code>/scope-prospects</code>; the agent reads this table and will
        not touch anything else.
      </p>

      {/* ─── Filters ──────────────────────────────────────────────────── */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-5)", margin: "var(--s-6) 0 var(--s-4)" }}>
        <div>
          <span className="label" style={{ display: "block", marginBottom: "var(--s-2)" }}>
            Status
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)" }}>
            <FilterLink href={href(query, { status: "all" })} active={query.status === "all"}>
              All {total}
            </FilterLink>
            {PROSPECT_STATUSES.map((status) => (
              <FilterLink
                key={status}
                href={href(query, { status })}
                active={query.status === status}
              >
                {status} {counts[status] ?? 0}
              </FilterLink>
            ))}
          </div>
        </div>

        <div>
          <span className="label" style={{ display: "block", marginBottom: "var(--s-2)" }}>
            Source tab
          </span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2)" }}>
            <FilterLink href={href(query, { tab: "all" })} active={query.sourceTab === "all"}>
              All
            </FilterLink>
            {SOURCE_TABS.map((tab) => (
              <FilterLink key={tab} href={href(query, { tab })} active={query.sourceTab === tab}>
                {SOURCE_TAB_LABELS[tab]}
              </FilterLink>
            ))}
          </div>
        </div>
      </div>

      {prospects.length === 0 ? (
        <div className="panel">
          <p style={{ margin: 0 }}>
            {total === 0
              ? "No prospects yet. Run the seed script to import the spreadsheet."
              : "No prospects match these filters."}
          </p>
        </div>
      ) : (
        <div className="table-scroll">
          <table className="tracker">
            <thead>
              <tr>
                {COLUMNS.map((column) => (
                  <th key={column.label} style={column.align === "right" ? { textAlign: "right" } : undefined}>
                    {column.key ? (
                      <Link
                        href={href(query, {
                          sort: column.key,
                          dir:
                            query.sort === column.key && query.direction === "desc"
                              ? "asc"
                              : "desc",
                        })}
                      >
                        {column.label}
                        {query.sort === column.key ? (query.direction === "desc" ? " ↓" : " ↑") : ""}
                      </Link>
                    ) : (
                      column.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {prospects.map((p) => (
                <tr key={p.id}>
                  <td>
                    <strong style={{ fontWeight: 500 }}>
                      {p.status === "built" ? <Link href={`/p/${p.slug}`}>{p.brand}</Link> : p.brand}
                    </strong>
                    {p.shortlist_rank ? (
                      <span className="label" style={{ marginLeft: "var(--s-2)", color: "var(--rosa)" }}>
                        #{p.shortlist_rank}
                      </span>
                    ) : null}
                    {p.domain ? (
                      <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{p.domain}</div>
                    ) : null}
                  </td>
                  <td>
                    {p.town ?? EMPTY}
                    {p.drive_from_york ? (
                      <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{p.drive_from_york}</div>
                    ) : null}
                  </td>
                  <td>{p.category ?? EMPTY}</td>
                  <td>{p.platform ?? EMPTY}</td>
                  <td>{p.budget_status ?? EMPTY}</td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {p.speed_score ?? EMPTY}
                  </td>
                  <td className="num" style={{ textAlign: "right" }}>
                    {p.value_score ?? (
                      <span style={{ fontSize: 12, color: "var(--ink-4)" }}>
                        {p.value_score_label ?? EMPTY}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`pill pill-${p.status}`}>{p.status}</span>
                  </td>
                  <td>
                    <RowActions prospectId={p.id} brand={p.brand} status={p.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <hr className="rule" />
      <p className="label">
        Showing {prospects.length} of {total}. Scores are from the spreadsheet, researched
        21 September 2026. Value score reads pending until ability to pay is filled in.
      </p>
    </main>
  );
}

function FilterLink({
  href: target,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={target}
      className="pill"
      style={
        active
          ? { borderColor: "var(--ink)", color: "var(--ink)", textDecoration: "none" }
          : { textDecoration: "none" }
      }
    >
      {children}
    </Link>
  );
}
