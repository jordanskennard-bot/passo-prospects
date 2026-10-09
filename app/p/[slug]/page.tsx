import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOperator } from "@/lib/session";
import {
  getProspectBySlug,
  hasProspectPage,
  latestScanRequest,
  listEmails,
  listNotes,
  listReports,
  runnerLastSeen,
  STATUS_LABELS,
  trackerHrefFromParam,
  type EmailRow,
  type Prospect,
} from "@/lib/prospects";
import { reportPayloadSchema } from "@/lib/report-schema";
import { ReportView } from "../ReportView";
import { NotesSection } from "../NotesSection";
import { ResearchControls } from "../ResearchControls";
import { isRunnerOnline, researchButtonLabel } from "@/lib/scan-requests";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return { title: `${slug} · Passo prospects`, robots: { index: false, follow: false } };
}

// Stands in for a value the spreadsheet left blank. A middle dot, never a dash.
const EMPTY = "·";

const ukDate = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
    : null;

export default async function ProspectPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ v?: string; from?: string }>;
}) {
  await requireOperator();

  const [{ slug }, { v, from }] = await Promise.all([params, searchParams]);
  const prospect = await getProspectBySlug(slug);
  if (!prospect) notFound();

  const reports = await listReports(prospect.id);
  // Approval is what creates the page: 'new' has none, and an archived
  // prospect keeps its page only if a report was ever written for it.
  if (!hasProspectPage(prospect.status, reports.length > 0)) notFound();

  const [emails, notes, scanRequest, lastSeen] = await Promise.all([
    listEmails(prospect.id),
    listNotes(prospect.id),
    latestScanRequest(prospect.id),
    runnerLastSeen(),
  ]);
  const emailAnchors = Object.fromEntries((emails ?? []).map((e) => [e.message_id, `email-${e.id}`]));
  const requested = v ? reports.find((r) => String(r.version) === v) : undefined;
  const report = requested ?? reports[0];

  // Rebuilt from known filters only, then carried on version links.
  const backHref = trackerHrefFromParam(from);
  const fromParam = backHref === "/" ? "" : `&from=${encodeURIComponent(backHref.slice(2))}`;

  return (
    <main className="page reading">
      {/* ─── 1. Header ─────────────────────────────────────────────────── */}
      <Link href={backHref} className="label" style={{ textDecoration: "none" }}>
        ← Back to tracker
      </Link>
      <div className="masthead" style={{ flexWrap: "wrap", gap: "var(--s-3)" }}>
        <h1 style={{ marginTop: "var(--s-2)", overflowWrap: "anywhere" }}>{prospect.brand}</h1>
        <span className={`pill pill-${prospect.status}`}>{STATUS_LABELS[prospect.status]}</span>
      </div>
      <Header prospect={prospect} />

      {/* ─── 2. Snapshot from the spreadsheet ─────────────────────────── */}
      <Snapshot prospect={prospect} />

      {/* ─── 3. Research ───────────────────────────────────────────────── */}
      <section className="section" id="research">
        <span className="label">Research</span>
        {scanRequest === undefined ? (
          researchButtonLabel(prospect.status) ? (
            <div className="panel panel-sunken" style={{ marginBottom: "var(--s-4)" }}>
              <p style={{ margin: 0 }}>
                Run research will appear here once migration <code>005_scan_requests.sql</code> is applied.
              </p>
            </div>
          ) : null
        ) : researchButtonLabel(prospect.status) || scanRequest ? (
          <div style={{ marginBottom: "var(--s-4)" }}>
            <ResearchControls
              prospectId={prospect.id}
              slug={prospect.slug}
              status={prospect.status}
              request={scanRequest}
              runnerOnline={isRunnerOnline(lastSeen)}
              versionHrefSuffix={fromParam}
            />
          </div>
        ) : null}
        {report ? (
          <ReportRendered report={report} />
        ) : (
          <ResearchState status={prospect.status} brand={prospect.brand} />
        )}
      </section>

      {/* ─── 4. Notes and emails ───────────────────────────────────────── */}
      {notes ? (
        <NotesSection prospectId={prospect.id} notes={notes} emailAnchors={emailAnchors} />
      ) : (
        <Pending id="notes" title="Notes" what="Notes for this prospect" migration="004_prospect_notes.sql" />
      )}
      {emails ? (
        <EmailList emails={emails} />
      ) : (
        <Pending id="emails" title="Emails" what="Emails to and from this prospect" migration="003_outreach_statuses.sql" />
      )}

      {/* ─── 5. Version history ────────────────────────────────────────── */}
      {reports.length > 0 ? (
        <section className="section" id="versions">
          <span className="label">Version history</span>
          <h2>Every run is kept</h2>
          <ol className="sources">
            {reports.map((r) => {
              const isCurrent = report !== undefined && r.version === report.version;
              return (
                <li key={r.id}>
                  <Link href={`/p/${slug}?v=${r.version}${fromParam}`}>Version {r.version}</Link>
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

function Header({ prospect }: { prospect: Prospect }) {
  const facts = [
    prospect.domain ? (
      <a key="domain" href={`https://${prospect.domain}`} target="_blank" rel="noopener noreferrer">
        {prospect.domain}
      </a>
    ) : null,
    prospect.town,
    prospect.category,
  ].filter(Boolean);

  return (
    <>
      <p className="label" style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2) var(--s-3)", overflowWrap: "anywhere" }}>
        {facts.map((fact, i) => (
          <span key={i}>{fact}</span>
        ))}
      </p>
      <p className="label" style={{ display: "flex", flexWrap: "wrap", gap: "var(--s-2) var(--s-4)" }}>
        <span>Approved {ukDate(prospect.approved_at) ?? EMPTY}</span>
        <span>Built {ukDate(prospect.built_at) ?? EMPTY}</span>
      </p>
    </>
  );
}

function Snapshot({ prospect }: { prospect: Prospect }) {
  return (
    <section className="section" id="snapshot">
      <span className="label">Snapshot from the spreadsheet</span>
      <div className="figure-grid">
        <div className="figure">
          <span className="label">Platform</span>
          <span style={{ fontSize: 18 }}>{prospect.platform ?? EMPTY}</span>
        </div>
        <div className="figure">
          <span className="label">Budget status</span>
          <span style={{ fontSize: 18 }}>{prospect.budget_status ?? EMPTY}</span>
        </div>
        <div className="figure">
          <span className="label">Speed score</span>
          <span className="value num">{prospect.speed_score ?? EMPTY}</span>
          <span className="label">of 33</span>
        </div>
        <div className="figure">
          <span className="label">Value score</span>
          {prospect.value_score !== null ? (
            <>
              <span className="value num">{prospect.value_score}</span>
              <span className="label">of 30</span>
            </>
          ) : (
            <span style={{ fontSize: 18 }}>{prospect.value_score_label ?? EMPTY}</span>
          )}
        </div>
      </div>
      <div className="panel" style={{ marginTop: "var(--s-4)" }}>
        <span className="label">Paid media status</span>
        <p style={{ margin: "var(--s-1) 0 var(--s-3)" }}>{prospect.paid_media_status ?? EMPTY}</p>
        <span className="label">Lead with</span>
        <p style={{ margin: "var(--s-1) 0 0" }}>{prospect.provable_problem ?? EMPTY}</p>
      </div>
    </section>
  );
}

/** What the research section says when there is no report yet. */
function ResearchState({ status, brand }: { status: string; brand: string }) {
  const MESSAGES: Record<string, string> = {
    approved: "Queued for research. Run /scope-prospects.",
    researching: "Research in progress.",
    built: `${brand} is marked built but has no report, which should not happen. Re-run the prospect.`,
    message_sent: `${brand} has been emailed, but there is no report for them on file.`,
    response_received: `${brand} has replied, but there is no report for them on file.`,
  };
  return (
    <div className="panel">
      <p style={{ margin: 0 }}>{MESSAGES[status] ?? "No research on file."}</p>
    </div>
  );
}

/** A marked place for a section whose table does not exist yet. */
function Pending({ id, title, what, migration }: { id: string; title: string; what: string; migration: string }) {
  return (
    <section className="section" id={id}>
      <span className="label">{title}</span>
      <h2>{title}</h2>
      <div className="panel panel-sunken">
        <p style={{ margin: 0 }}>
          {what} will appear here once migration <code>{migration}</code> is applied.
        </p>
      </div>
    </section>
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

/** What the email scanner matched to this prospect: our sends and their replies. */
function EmailList({ emails }: { emails: EmailRow[] }) {
  return (
    <section className="section" id="emails">
      <span className="label">Outreach</span>
      <h2>Emails</h2>
      {emails.length === 0 ? (
        <p className="label">
          No emails to or from this prospect have been found yet. The daily scan records
          them here.
        </p>
      ) : (
        <ol className="sources">
          {emails.map((email) => (
            <li key={email.id} id={`email-${email.id}`}>
              <span className={`pill ${email.direction === "sent" ? "pill-message_sent" : "pill-response_received"}`}>
                {email.direction}
              </span>{" "}
              {email.subject ?? "(no subject)"}
              <div className="label" style={{ marginTop: 2 }}>
                {new Date(email.sent_at).toLocaleString("en-GB", {
                  day: "numeric", month: "long", year: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
                {"  ·  "}
                {email.direction === "sent" ? `To ${email.to_address}` : `From ${email.from_address}`}
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
