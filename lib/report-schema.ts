import { z } from "zod";

/**
 * The prospect report payload.
 *
 * Two rules from the spreadsheet's Method tab are encoded in the types rather
 * than left to the writer's discretion:
 *
 *   1. A tag that was not detected is a QUESTION, not a finding. Consent
 *      management platforms block tags until a visitor accepts cookies, so an
 *      absent tag may simply be gated. Every check therefore carries an
 *      explicit `verdict`, and `not_detected` forces a `caveat`.
 *   2. A step that fails is recorded as a gap and the rest carries on. No
 *      figure is ever invented to fill a hole, so every numeric field is
 *      nullable and every section can carry `gaps`.
 */

export const REPORT_PAYLOAD_VERSION = 1;

/** An ISO date, YYYY-MM-DD. What "checked on" means on every claim. */
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected an ISO date, YYYY-MM-DD");

/** Pointer into the `sources` array by its `id`. */
const sourceRef = z.string().min(1);

export const sourceSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  url: z.string().url().nullable(),
  /** 'website' for a page we fetched, 'api' for a structured endpoint. */
  kind: z.enum([
    "website",
    "meta_ad_library",
    "google_ads_transparency",
    "companies_house",
    "spreadsheet",
    "api",
    "other",
  ]),
  checked_on: isoDate,
  note: z.string().nullable().default(null),
});

/** Anything we looked for and either did or did not find. */
export const checkSchema = z.object({
  label: z.string().min(1),
  /**
   * detected:     we saw it, and can say so.
   * not_detected: absent from what we fetched. NOT a finding. Needs a caveat.
   * inconclusive: the check could not be completed (challenge page, timeout).
   */
  verdict: z.enum(["detected", "not_detected", "inconclusive"]),
  /** What we actually saw. A tag ID, a script host, a header. Verbatim. */
  evidence: z.string().nullable().default(null),
  /**
   * Required whenever the verdict is not a plain positive, so the page can
   * never render an absence as though it were a fact.
   */
  caveat: z.string().nullable().default(null),
  sources: z.array(sourceRef).default([]),
});

export const gapSchema = z.object({
  what: z.string().min(1),
  why: z.string().min(1),
});

/** 1. Summary. */
export const summarySection = z.object({
  who_they_are: z.string().min(1),
  why_on_the_list: z.string().min(1),
  recommended_next_step: z.string().min(1),
  speed_score: z.number().nullable().default(null),
  value_score: z.number().nullable().default(null),
  value_score_label: z.string().nullable().default(null),
  gaps: z.array(gapSchema).default([]),
});

/** 2. Outside-in diagnostics. */
export const diagnosticsSection = z.object({
  platform: checkSchema.nullable().default(null),
  checks: z.array(checkSchema).default([]),
  /**
   * The Method tab's caveat, carried onto every page. Required: there is no
   * version of this page that may omit it.
   */
  consent_caveat: z.string().min(1),
  headline_finding: z.string().nullable().default(null),
  gaps: z.array(gapSchema).default([]),
});

export const adPlatformActivity = z.object({
  verdict: z.enum(["active", "inactive", "none_found", "inconclusive"]),
  active_ad_count: z.number().int().nonnegative().nullable().default(null),
  longest_run: z.string().nullable().default(null),
  creative_themes: z.array(z.string()).default([]),
  summary: z.string().nullable().default(null),
  caveat: z.string().nullable().default(null),
  sources: z.array(sourceRef).default([]),
});

/** 3. Ad activity. */
export const adActivitySection = z.object({
  meta: adPlatformActivity.nullable().default(null),
  google: adPlatformActivity.nullable().default(null),
  gaps: z.array(gapSchema).default([]),
});

/** 4. Business health. */
export const businessHealthSection = z.object({
  company_name: z.string().nullable().default(null),
  company_number: z.string().nullable().default(null),
  incorporated_on: isoDate.nullable().default(null),
  company_status: z.string().nullable().default(null),
  officers: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.string().nullable().default(null),
        appointed_on: isoDate.nullable().default(null),
      }),
    )
    .default([]),
  latest_accounts_to: isoDate.nullable().default(null),
  /** Figures in whole pounds. Null means we did not find it, never zero. */
  net_assets_gbp: z.number().nullable().default(null),
  net_current_liabilities_gbp: z.number().nullable().default(null),
  creditors_gbp: z.number().nullable().default(null),
  employees: z.number().int().nonnegative().nullable().default(null),
  ability_to_pay: z.object({
    read: z.enum(["comfortable", "workable", "price_sensitive", "unknown"]),
    reasoning: z.string().min(1),
  }),
  sources: z.array(sourceRef).default([]),
  gaps: z.array(gapSchema).default([]),
});

/** 5. Pitch pack. */
export const pitchPackSection = z.object({
  angle: z.string().min(1),
  objections: z
    .array(z.object({ objection: z.string().min(1), answer: z.string().min(1) }))
    .default([]),
  contact_route: z.object({
    named_person: z.string().nullable().default(null),
    role: z.string().nullable().default(null),
    channel: z.string().min(1),
    reasoning: z.string().min(1),
    sources: z.array(sourceRef).default([]),
  }),
  outreach_email: z.object({
    subject: z.string().min(1),
    body: z.string().min(1),
  }),
  gaps: z.array(gapSchema).default([]),
});

export const reportPayloadSchema = z.object({
  payload_version: z.literal(REPORT_PAYLOAD_VERSION),
  brand: z.string().min(1),
  slug: z.string().min(1),
  domain: z.string().nullable().default(null),
  researched_on: isoDate,
  summary: summarySection,
  diagnostics: diagnosticsSection,
  ad_activity: adActivitySection,
  business_health: businessHealthSection,
  pitch_pack: pitchPackSection,
  sources: z.array(sourceSchema).default([]),
});

export type ReportPayload = z.infer<typeof reportPayloadSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Check = z.infer<typeof checkSchema>;
export type Gap = z.infer<typeof gapSchema>;
export type AdPlatformActivity = z.infer<typeof adPlatformActivity>;

/** The Method tab's caveat, verbatim. The single wording used everywhere. */
export const CONSENT_CAVEAT =
  "Consent management platforms block tags until a visitor accepts cookies, " +
  "so a tag recorded as not detected may simply be gated rather than absent. " +
  "Everything below is a point-in-time read of what the homepage returned to " +
  "an unconsented visitor. Treat a missing tag as a question to ask them, " +
  "never a finding to assert.";

/**
 * Validate before insert. Throws a readable error listing every problem, so a
 * malformed payload never reaches the database.
 */
export function parseReportPayload(input: unknown): ReportPayload {
  const result = reportPayloadSchema.safeParse(input);
  if (!result.success) {
    const problems = result.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Report payload failed validation:\n${problems}`);
  }
  return result.data;
}

/** Cross-check that every sources[] reference resolves. Returns the dangling ids. */
export function danglingSourceRefs(payload: ReportPayload): string[] {
  const known = new Set(payload.sources.map((s) => s.id));
  const referenced: string[] = [];

  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, nested] of Object.entries(value)) {
        if (key === "sources" && Array.isArray(nested)) {
          for (const ref of nested) if (typeof ref === "string") referenced.push(ref);
        } else {
          visit(nested);
        }
      }
    }
  };

  // Walk every section, but not the sources table itself.
  const { sources: _table, ...sections } = payload;
  visit(sections);

  return [...new Set(referenced.filter((ref) => !known.has(ref)))];
}
