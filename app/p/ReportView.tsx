import type {
  AdPlatformActivity,
  Check,
  Gap,
  ReportPayload,
  Source,
} from "@/lib/report-schema";

// Stands in for a figure we did not establish. A middle dot, never a dash.
const EMPTY = "·";

const VERDICT_LABELS: Record<Check["verdict"], string> = {
  detected: "Detected",
  not_detected: "Not detected",
  inconclusive: "Inconclusive",
};

function gbp(value: number | null): string {
  if (value === null) return "Not found";
  const sign = value < 0 ? "-" : "";
  return `${sign}£${Math.abs(value).toLocaleString("en-GB")}`;
}

function ukDate(iso: string | null): string {
  if (!iso) return "Not found";
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function Gaps({ gaps }: { gaps: Gap[] }) {
  if (gaps.length === 0) return null;
  return (
    <>
      {gaps.map((gap, i) => (
        <div className="gap" key={i}>
          <strong style={{ fontWeight: 500, color: "var(--ink-2)" }}>
            Not established: {gap.what}.
          </strong>{" "}
          {gap.why}
        </div>
      ))}
    </>
  );
}

function SourceTags({ ids, sources }: { ids: string[]; sources: Source[] }) {
  if (ids.length === 0) return null;
  const numbered = ids
    .map((id) => ({ id, index: sources.findIndex((s) => s.id === id) }))
    .filter((entry) => entry.index >= 0);
  if (numbered.length === 0) return null;
  return (
    <span className="label" style={{ whiteSpace: "nowrap" }}>
      {numbered.map((entry, i) => (
        <span key={entry.id}>
          {i > 0 ? ", " : ""}
          <a href={`#source-${entry.id}`} style={{ textDecoration: "none" }}>
            [{entry.index + 1}]
          </a>
        </span>
      ))}
    </span>
  );
}

function CheckRow({ check, sources }: { check: Check; sources: Source[] }) {
  return (
    <div className="check">
      <div className="check-head">
        <strong style={{ fontWeight: 500 }}>{check.label}</strong>
        <span
          className="pill"
          style={
            check.verdict === "detected"
              ? { borderColor: "var(--ink-4)", color: "var(--ink-2)" }
              : { borderColor: "var(--rosa)", color: "var(--rosa)" }
          }
        >
          {VERDICT_LABELS[check.verdict]}
        </span>
        <SourceTags ids={check.sources} sources={sources} />
      </div>
      {check.evidence ? (
        <p style={{ margin: "var(--s-2) 0 0" }}>
          <span className="evidence">{check.evidence}</span>
        </p>
      ) : null}
      {check.caveat ? (
        <p style={{ margin: "var(--s-2) 0 0", fontSize: 14, color: "var(--ink-3)" }}>
          <em>{check.caveat}</em>
        </p>
      ) : null}
    </div>
  );
}

function AdPlatform({
  title,
  activity,
  sources,
}: {
  title: string;
  activity: AdPlatformActivity | null;
  sources: Source[];
}) {
  if (!activity) {
    return (
      <div className="panel panel-sunken">
        <span className="label">{title}</span>
        <p style={{ margin: "var(--s-2) 0 0" }}>Not checked on this run.</p>
      </div>
    );
  }
  const VERDICTS: Record<AdPlatformActivity["verdict"], string> = {
    active: "Running ads",
    inactive: "Ads present but inactive",
    none_found: "No ads found",
    inconclusive: "Could not tell",
  };
  return (
    <div className="panel panel-sunken">
      <div className="check-head">
        <span className="label">{title}</span>
        <span className="pill">{VERDICTS[activity.verdict]}</span>
        <SourceTags ids={activity.sources} sources={sources} />
      </div>
      {activity.active_ad_count !== null ? (
        <p style={{ margin: "var(--s-3) 0 0" }}>
          <span className="num" style={{ fontFamily: "var(--serif)", fontSize: 24 }}>
            {activity.active_ad_count}
          </span>{" "}
          <span className="label">active ads</span>
        </p>
      ) : null}
      {activity.longest_run ? (
        <p style={{ margin: "var(--s-2) 0 0", fontSize: 14 }}>
          <span className="label">Longest run</span> {activity.longest_run}
        </p>
      ) : null}
      {activity.summary ? <p style={{ margin: "var(--s-3) 0 0" }}>{activity.summary}</p> : null}
      {activity.creative_themes.length > 0 ? (
        <ul style={{ margin: "var(--s-2) 0 0", paddingLeft: "var(--s-5)", fontSize: 14 }}>
          {activity.creative_themes.map((theme, i) => (
            <li key={i} style={{ color: "var(--ink-2)" }}>{theme}</li>
          ))}
        </ul>
      ) : null}
      {activity.caveat ? (
        <p style={{ margin: "var(--s-3) 0 0", fontSize: 14, color: "var(--ink-3)" }}>
          <em>{activity.caveat}</em>
        </p>
      ) : null}
    </div>
  );
}

export function ReportView({ payload }: { payload: ReportPayload }) {
  const { summary, diagnostics, ad_activity, business_health, pitch_pack, sources } = payload;
  const ABILITY: Record<string, string> = {
    comfortable: "Comfortable",
    workable: "Workable",
    price_sensitive: "Price sensitive",
    unknown: "Unknown",
  };

  return (
    <>
      {/* ─── 1. Summary ─────────────────────────────────────────────────── */}
      <section className="section" id="summary">
        <span className="label">Summary</span>
        <h2>Who they are</h2>
        <p className="reading">{summary.who_they_are}</p>

        <h3 style={{ marginTop: "var(--s-5)" }}>Why they are on the list</h3>
        <p className="reading">{summary.why_on_the_list}</p>

        <div className="panel">
          <span className="label">Recommended next step</span>
          <p style={{ margin: "var(--s-2) 0 0", fontFamily: "var(--serif)", fontSize: 20, color: "var(--ink)" }}>
            {summary.recommended_next_step}
          </p>
        </div>

        <div className="figure-grid">
          <div className="figure">
            <span className="label">Speed score</span>
            <span className="value num">{summary.speed_score ?? EMPTY}</span>
            <span className="label">of 33</span>
          </div>
          <div className="figure">
            <span className="label">Value score</span>
            {summary.value_score !== null ? (
              <>
                <span className="value num">{summary.value_score}</span>
                <span className="label">of 30</span>
              </>
            ) : (
              <span style={{ fontSize: 15, color: "var(--ink-3)", display: "block", marginTop: 4 }}>
                {summary.value_score_label ?? "Not scored"}
              </span>
            )}
          </div>
        </div>
        <Gaps gaps={summary.gaps} />
      </section>

      {/* ─── 2. Outside-in diagnostics ───────────────────────────────────── */}
      <section className="section" id="diagnostics">
        <span className="label">Outside-in diagnostics</span>
        <h2>What their site tells us</h2>

        {diagnostics.headline_finding ? (
          <p className="reading" style={{ fontFamily: "var(--serif)", fontSize: 20, color: "var(--ink)" }}>
            {diagnostics.headline_finding}
          </p>
        ) : null}

        <div className="caveat">
          <em>{diagnostics.consent_caveat}</em>
        </div>

        <div className="panel">
          {diagnostics.platform ? (
            <CheckRow check={diagnostics.platform} sources={sources} />
          ) : null}
          {diagnostics.checks.map((check, i) => (
            <CheckRow key={i} check={check} sources={sources} />
          ))}
        </div>
        <Gaps gaps={diagnostics.gaps} />
      </section>

      {/* ─── 3. Ad activity ─────────────────────────────────────────────── */}
      <section className="section" id="ad-activity">
        <span className="label">Ad activity</span>
        <h2>What they are running</h2>
        <AdPlatform title="Meta Ad Library" activity={ad_activity.meta} sources={sources} />
        <AdPlatform
          title="Google Ads Transparency Center"
          activity={ad_activity.google}
          sources={sources}
        />
        <Gaps gaps={ad_activity.gaps} />
      </section>

      {/* ─── 4. Business health ─────────────────────────────────────────── */}
      <section className="section" id="business-health">
        <span className="label">Business health</span>
        <h2>{business_health.company_name ?? "Companies House"}</h2>

        <div className="figure-grid">
          <div className="figure">
            <span className="label">Company number</span>
            <span style={{ fontSize: 18 }} className="num">
              {business_health.company_number ?? "Not found"}
            </span>
          </div>
          <div className="figure">
            <span className="label">Incorporated</span>
            <span style={{ fontSize: 18 }}>{ukDate(business_health.incorporated_on)}</span>
          </div>
          <div className="figure">
            <span className="label">Status</span>
            <span style={{ fontSize: 18 }}>{business_health.company_status ?? "Not found"}</span>
          </div>
          <div className="figure">
            <span className="label">Accounts to</span>
            <span style={{ fontSize: 18 }}>{ukDate(business_health.latest_accounts_to)}</span>
          </div>
        </div>

        <div className="figure-grid">
          {([
            ["Net assets", business_health.net_assets_gbp],
            ["Net current liabilities", business_health.net_current_liabilities_gbp],
            ["Creditors", business_health.creditors_gbp],
          ] as const).map(([label, value]) => (
            <div className="figure" key={label}>
              <span className="label">{label}</span>
              <span className={`value num${value !== null && value < 0 ? " negative" : ""}`}>
                {gbp(value)}
              </span>
            </div>
          ))}
          <div className="figure">
            <span className="label">Employees</span>
            <span className="value num">{business_health.employees ?? EMPTY}</span>
          </div>
        </div>

        {business_health.officers.length > 0 ? (
          <div className="panel panel-sunken">
            <span className="label">Officers</span>
            <ul style={{ margin: "var(--s-2) 0 0", paddingLeft: "var(--s-5)" }}>
              {business_health.officers.map((officer, i) => (
                <li key={i} style={{ color: "var(--ink-2)" }}>
                  {officer.name}
                  {officer.role ? `, ${officer.role}` : ""}
                  {officer.appointed_on ? ` (appointed ${ukDate(officer.appointed_on)})` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div className="panel">
          <div className="check-head">
            <span className="label">Ability to pay</span>
            <span className="pill pill-approved">
              {ABILITY[business_health.ability_to_pay.read] ?? business_health.ability_to_pay.read}
            </span>
            <SourceTags ids={business_health.sources} sources={sources} />
          </div>
          <p style={{ margin: "var(--s-3) 0 0" }}>{business_health.ability_to_pay.reasoning}</p>
        </div>
        <Gaps gaps={business_health.gaps} />
      </section>

      {/* ─── 5. Pitch pack ──────────────────────────────────────────────── */}
      <section className="section" id="pitch-pack">
        <span className="label">Pitch pack</span>
        <h2>How to open</h2>

        <p className="reading" style={{ fontFamily: "var(--serif)", fontSize: 20, color: "var(--ink)" }}>
          {pitch_pack.angle}
        </p>

        {pitch_pack.objections.length > 0 ? (
          <>
            <h3 style={{ marginTop: "var(--s-6)" }}>Likely objections</h3>
            <div className="panel">
              {pitch_pack.objections.map((entry, i) => (
                <div className="check" key={i}>
                  <strong style={{ fontWeight: 500 }}>{entry.objection}</strong>
                  <p style={{ margin: "var(--s-2) 0 0" }}>{entry.answer}</p>
                </div>
              ))}
            </div>
          </>
        ) : null}

        <h3 style={{ marginTop: "var(--s-6)" }}>Contact route</h3>
        <div className="panel panel-sunken">
          <div className="check-head">
            <strong style={{ fontWeight: 500 }}>
              {pitch_pack.contact_route.named_person ?? "No named contact found"}
              {pitch_pack.contact_route.role ? `, ${pitch_pack.contact_route.role}` : ""}
            </strong>
            <span className="pill">{pitch_pack.contact_route.channel}</span>
            <SourceTags ids={pitch_pack.contact_route.sources} sources={sources} />
          </div>
          <p style={{ margin: "var(--s-3) 0 0" }}>{pitch_pack.contact_route.reasoning}</p>
        </div>

        <h3 style={{ marginTop: "var(--s-6)" }}>Draft outreach email</h3>
        <p className="label">Subject: {pitch_pack.outreach_email.subject}</p>
        <div className="email-draft">{pitch_pack.outreach_email.body}</div>
        <Gaps gaps={pitch_pack.gaps} />
      </section>

      {/* ─── 6. Sources ─────────────────────────────────────────────────── */}
      <section className="section" id="sources">
        <span className="label">Sources</span>
        <h2>Every claim, and when it was checked</h2>
        <ol className="sources">
          {sources.map((source) => (
            <li key={source.id} id={`source-${source.id}`}>
              {source.url ? (
                <a href={source.url} target="_blank" rel="noreferrer noopener">
                  {source.label}
                </a>
              ) : (
                source.label
              )}
              <div className="label" style={{ marginTop: 2 }}>
                Checked {ukDate(source.checked_on)}
              </div>
              {source.note ? (
                <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{source.note}</div>
              ) : null}
            </li>
          ))}
        </ol>
      </section>
    </>
  );
}
