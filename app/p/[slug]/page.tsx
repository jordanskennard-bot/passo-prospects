import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/session";
import { getProspectBySlug, listReports } from "@/lib/prospects";
import { reportPayloadSchema } from "@/lib/report-schema";
import { ReportView } from "../ReportView";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${slug} · Passo prospects`, robots: { index: false, follow: false } };
}

export default async function ProspectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ v?: string }>;
}) {
  await requireOperator();

  const [{ slug }, { v }] = await Promise.all([params, searchParams]);
  const prospect = await getProspectBySlug(slug);
  if (!prospect) notFound();

  const reports = await listReports(prospect.id);
  const requested = v ? reports.find((r) => String(r.version) === v) : undefined;
  const report = requested ?? reports[0];

  return (
    <main className="page reading">
      <div className="masthead">
        <div>
          <Link href="/" className="label" style={{ textDecoration: "none" }}>
            ← Tracker
          </Link>
          <h1 style={{ marginTop: "var(--s-2)" }}>{prospect.brand}</h1>
        </div>
        <span className={`pill pill-${prospect.status}`}>{prospect.status}</span>
      </div>

      <p className="label">
        {[prospect.domain, prospect.town, prospect.category].filter(Boolean).join("  ·  ")}
      </p>

      {report ? (
        <ReportRendered report={report} />
      ) : (
        <NoReportYet status={prospect.status} brand={prospect.brand} />
      )}

      {/* ─── Version history ───────────────────────────────────────────── */}
      {reports.length > 0 ? (
        <section className="section" id="versions">
          <span className="label">Version history</span>
          <h2>Every run is kept</h2>
          <ol className="sources">
            {reports.map((r) => {
              const isCurrent = report !== undefined && r.version === report.version;
              return (
                <li key={r.id}>
                  <Link href={`/p/${slug}?v=${r.version}`}>Version {r.version}</Link>
                  {isCurrent ? (
                    <span className="label" style={{ marginLeft: "var(--s-2)" }}>
                      Showing
                    </span>
                  ) : null}
                  <div className="label" style={{ marginTop: 2 }}>
                    {new Date(r.created_at).toLocaleString("en-GB", {
                      day: "numeric", month: "long", year: "numeric",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
    </main>
  );
}

/**
 * Payloads are validated on the way in, but a schema change can leave an older
 * row unreadable. Rather than crash the page, say so plainly: the row is still
 * there and still inspectable in the database.
 */
function ReportRendered({
  report,
}: {
  report: { version: number; payload: unknown; created_at: string };
}) {
  const parsed = reportPayloadSchema.safeParse(report.payload);

  if (!parsed.success) {
    return (
      <div className="panel">
        <span className="label">Version {report.version}</span>
        <p style={{ margin: "var(--s-2) 0 0" }}>
          This report was written against an older payload shape and cannot be rendered by
          the current schema. The stored row is untouched. Re-run the prospect to produce a
          version this page can read.
        </p>
        <p className="label" style={{ marginTop: "var(--s-3)" }}>
          {parsed.error.issues
            .slice(0, 4)
            .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
            .join("  ·  ")}
        </p>
      </div>
    );
  }

  return <ReportView payload={parsed.data} />;
}

function NoReportYet({ status, brand }: { status: string; brand: string }) {
  const MESSAGES: Record<string, string> = {
    new: `${brand} has not been approved yet. Approve them on the tracker and the agent will pick them up on its next run.`,
    approved: `${brand} is approved and waiting. Run /scope-prospects to research them.`,
    researching: `A run is in flight for ${brand}. The report appears here when it finishes.`,
    archived: `${brand} is archived. Approve them again to put them back in the queue.`,
    built: `${brand} is marked built but has no report rows, which should not happen. Re-run the prospect.`,
  };
  return (
    <div className="panel">
      <p style={{ margin: 0 }}>{MESSAGES[status] ?? MESSAGES.new}</p>
    </div>
  );
}
