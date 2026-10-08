// A hand-written report for Brew York, built only from the findings already in
// Passo_Yorkshire_Prospects_v2.xlsx.
//
// Its job is to exercise the schema and the page with real content before the
// agent exists. Everything here traces to a cell in the sheet; anything the
// sheet does not carry is recorded as a gap rather than guessed. The company
// number, officers and incorporation date are the honest examples: the sheet
// knows the accounts figure but not the registration, so the figure is used and
// the registration is left open.
//
//   node --experimental-strip-types scripts/seed-brew-york-report.ts [--dry-run]
//
// Brew York must be approved in the tracker. Like the agent, this claims it,
// files a new version, and sets it built; anything else is refused unwritten.

import {
  parseReportPayload,
  danglingSourceRefs,
  CONSENT_CAVEAT,
  REPORT_PAYLOAD_VERSION,
} from "../lib/report-schema.ts";

/** The sheet's own research date. Every claim below was checked then. */
const CHECKED = "2026-09-21";

const payload = {
  payload_version: REPORT_PAYLOAD_VERSION,
  brand: "Brew York",
  slug: "brew-york",
  domain: "brewyork.co.uk",
  researched_on: CHECKED,

  summary: {
    who_they_are:
      "A craft brewery and taproom in York, selling direct from a catalogue of around 261 products. " +
      "The shop runs on WooCommerce, with Mailchimp for email and Trustpilot for reviews. " +
      "Owner-managed, which means one conversation reaches the person who decides.",
    why_on_the_list:
      "They rank first of the eleven on the Phase 1 shortlist, on a speed score of 31 out of 33. " +
      "They are in York, the decision sits with one person, and they carry the clearest verified " +
      "problem on the whole list: their reported numbers are measurably wrong, and we can show them why.",
    recommended_next_step:
      "Ask for half an hour in person, lead with the double-counted purchases, and propose a paid " +
      "pilot at a low monthly number.",
    speed_score: 31,
    value_score: null,
    value_score_label: "Pending pay data",
    gaps: [
      {
        what: "the value score",
        why:
          "Ability to pay has not been scored, so the sheet's value score reads as pending. " +
          "The accounts position below is the better guide for now.",
      },
    ],
  },

  diagnostics: {
    headline_finding:
      "Two Meta pixel setups are firing at the same time, so every purchase is being counted " +
      "twice. The conversions and return on ad spend they read back are inflated, and nobody " +
      "looking at the account would see it.",
    consent_caveat: CONSENT_CAVEAT,
    platform: {
      label: "Ecommerce platform",
      verdict: "detected" as const,
      evidence: "WooCommerce. wp-content/plugins/woocommerce present in the homepage markup.",
      caveat: null,
      sources: ["site-fingerprint"],
    },
    checks: [
      {
        label: "Meta pixel, counted twice",
        verdict: "detected" as const,
        evidence:
          "Two separate implementations present: facebook-for-woocommerce and PixelYourSite.",
        caveat:
          "Worth confirming on a call that both are still live and that neither has been " +
          "deliberately scoped to different events. The fix is small either way.",
        sources: ["site-fingerprint"],
      },
      {
        label: "Google Ads conversion tag",
        verdict: "detected" as const,
        evidence: "AW-10805529416.",
        caveat:
          "The tag is installed and no ads were found running against it. Someone set up " +
          "measurement for a channel that is not switched on.",
        sources: ["site-fingerprint", "google-ads-transparency"],
      },
      {
        label: "Google Analytics 4",
        verdict: "detected" as const,
        evidence: "GA4 tag present.",
        caveat: null,
        sources: ["site-fingerprint"],
      },
      {
        label: "Email platform",
        verdict: "detected" as const,
        evidence: "Mailchimp.",
        caveat: null,
        sources: ["site-fingerprint"],
      },
      {
        label: "Affiliate tracking",
        verdict: "detected" as const,
        evidence: "Awin.",
        caveat:
          "Affiliate and paid media often claim the same order. Worth asking how the two are " +
          "separated before either is judged on its numbers.",
        sources: ["site-fingerprint"],
      },
      {
        label: "Consent management platform",
        verdict: "not_detected" as const,
        evidence: null,
        caveat:
          "Nothing was recorded in the fingerprint, which is a question rather than a finding. " +
          "If a consent tool is in place, some of the tags above may behave differently for a " +
          "visitor who has not accepted cookies, and the pixel picture could be different again.",
        sources: ["site-fingerprint"],
      },
    ],
    gaps: [
      {
        what: "whether the duplicate pixels are also duplicating on checkout",
        why:
          "The homepage markup shows both implementations loading. Which events each one sends " +
          "can only be confirmed from inside their account, or by watching a real purchase.",
      },
    ],
  },

  ad_activity: {
    meta: {
      verdict: "inactive" as const,
      active_ad_count: null,
      longest_run: null,
      creative_themes: [],
      summary:
        "Ads are present in the library but mostly inactive, so there has been spend at some " +
        "point and little or none of it recently.",
      caveat:
        "The library does not show spend, and an inactive ad may simply have been paused. " +
        "Ask what they have run this year before assuming the channel is cold.",
      sources: ["meta-ad-library"],
    },
    google: {
      verdict: "none_found" as const,
      active_ad_count: 0,
      longest_run: null,
      creative_themes: [],
      summary:
        "No ads found, against a live conversion tag. They are measuring a channel they are " +
        "not buying.",
      caveat: null,
      sources: ["google-ads-transparency"],
    },
    gaps: [
      {
        what: "the exact number and run length of the Meta ads",
        why:
          "The sheet records the library as showing ads present and mostly inactive without " +
          "counting them. A fresh look at the library before the call would firm this up.",
      },
    ],
  },

  business_health: {
    company_name: null,
    company_number: null,
    incorporated_on: null,
    company_status: null,
    officers: [],
    latest_accounts_to: "2025-03-31",
    net_assets_gbp: null,
    net_current_liabilities_gbp: -83324,
    creditors_gbp: null,
    employees: null,
    ability_to_pay: {
      read: "price_sensitive" as const,
      reasoning:
        "Net current liabilities of £83,324 at 31 March 2025 means more falls due within the year " +
        "than there are current assets to meet it. That is common enough in a brewery carrying " +
        "stock and equipment finance, and it is not a reason to walk away, but it does mean the " +
        "monthly number has to be small to get a yes. Treat this as a paid pilot at a low fee " +
        "rather than a retainer pitch.",
    },
    sources: ["companies-house-accounts", "shortlist"],
    gaps: [
      {
        what: "the registered company name, number, officers and incorporation date",
        why:
          "The spreadsheet carries the accounts figure but not the registration itself, and " +
          "Companies House was not reachable on this run. Look the company up before the call: " +
          "the named officer is also the contact route.",
      },
      {
        what: "net assets, creditors and employee count",
        why:
          "Not recorded in the spreadsheet. They sit in the same filing as the figure above and " +
          "are worth pulling at the same time.",
      },
    ],
  },

  pitch_pack: {
    angle:
      "Lead with the thing that costs them money today and can be proved from outside: their " +
      "purchases are being counted twice, so the numbers they are making decisions on are wrong. " +
      "Fix the counting first, then talk about what to spend. A brewery with a live Google tag " +
      "and no ads behind it also has an untested channel sitting there, but that is the second " +
      "conversation, not the opener.",
    objections: [
      {
        objection: "We already have someone doing our ads.",
        answer:
          "Then they will want this fixed too, because it makes their numbers look better than " +
          "they are. I am happy to send it over for whoever looks after it, with no expectation.",
      },
      {
        objection: "We cannot afford an agency.",
        answer:
          "I am looking for a few local brands to start with, so the fee is deliberately small " +
          "and there is no long contract. I would rather prove it on a low number than sell you " +
          "a retainer.",
      },
      {
        objection: "How do we know the advertising is actually working?",
        answer:
          "We measure against your own order data rather than what Meta reports, and we look at " +
          "which orders the advertising actually caused. Once the double counting is gone that " +
          "comparison becomes possible for the first time.",
      },
      {
        objection: "We are on WooCommerce, not Shopify.",
        answer:
          "That is fine. The order data is yours either way, and the pixel problem is a " +
          "WooCommerce one specifically, because the plugin and PixelYourSite are both trying " +
          "to do the same job.",
      },
    ],
    contact_route: {
      named_person: null,
      role: null,
      channel: "Email, then ask to come to the taproom",
      reasoning:
        "Owner-managed and in York, so a half-hour in person is both easy to offer and hard to " +
        "refuse, and it suits a finding that is better shown on a screen than written out. " +
        "Look up the named officer at Companies House before sending, and address it to them " +
        "rather than to a shop inbox.",
      sources: ["shortlist"],
    },
    outreach_email: {
      subject: "Two Meta pixels on brewyork.co.uk",
      body: [
        "Hello,",
        "",
        "I am Jordan Kennard. I have worked in media for fourteen years, including running " +
          "ecommerce media for brands such as PlayStation, and I am now independent and living " +
          "in York. I am looking for a few local brands to start with.",
        "",
        "One thing I spotted from outside your site: you have two Meta pixel setups running at " +
          "the same time, the WooCommerce one and PixelYourSite. When both fire, every purchase " +
          "gets counted twice, so the conversions and return on ad spend you are reading back " +
          "are higher than what actually happened.",
        "",
        "Could I come over for half an hour, whenever suits you? It is easier to show you than " +
          "to write it out.",
        "",
        "Jordan",
      ].join("\n"),
    },
    gaps: [
      {
        what: "who to address the email to",
        why:
          "No named contact was established on this run. The greeting is left open deliberately " +
          "rather than filled with a guess.",
      },
    ],
  },

  sources: [
    {
      id: "spreadsheet",
      label: "Passo_Yorkshire_Prospects_v2.xlsx, Prospects tab, Brew York row",
      url: null,
      kind: "spreadsheet" as const,
      checked_on: CHECKED,
      note: "Platform, martech, SKU count, paid media status and the Phase 1 scores.",
    },
    {
      id: "shortlist",
      label: "Passo_Yorkshire_Prospects_v2.xlsx, Phase 1 shortlist tab, rank 1",
      url: null,
      kind: "spreadsheet" as const,
      checked_on: CHECKED,
      note: "Opening line, why this one, and the known risk including the accounts figure.",
    },
    {
      id: "site-fingerprint",
      label: "brewyork.co.uk homepage, fingerprinted in a browser session",
      url: "https://brewyork.co.uk/",
      kind: "website" as const,
      checked_on: CHECKED,
      note:
        "Brew York sits behind an anti-bot challenge, so the homepage was inspected in a real " +
        "browser rather than fetched, per the spreadsheet's Method tab.",
    },
    {
      id: "meta-ad-library",
      label: "Meta Ad Library",
      url: "https://www.facebook.com/ads/library/",
      kind: "meta_ad_library" as const,
      checked_on: CHECKED,
      note: "Ads present, mostly inactive.",
    },
    {
      id: "google-ads-transparency",
      label: "Google Ads Transparency Center",
      url: "https://adstransparency.google.com/",
      kind: "google_ads_transparency" as const,
      checked_on: CHECKED,
      note: "Zero ads found against a live AW- conversion tag.",
    },
    {
      id: "companies-house-accounts",
      label: "Companies House, accounts to 31 March 2025",
      url: null,
      kind: "companies_house" as const,
      checked_on: CHECKED,
      note:
        "Reached via the spreadsheet rather than directly. The filing records net current " +
        "liabilities of £83,324. The company number is not recorded in the sheet, so no link " +
        "is given here rather than an invented one.",
    },
  ],
};

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");

  const parsed = parseReportPayload(payload);
  const dangling = danglingSourceRefs(parsed);
  if (dangling.length > 0) {
    throw new Error(`Payload references unknown sources: ${dangling.join(", ")}`);
  }

  const counts = {
    checks: parsed.diagnostics.checks.length + (parsed.diagnostics.platform ? 1 : 0),
    sources: parsed.sources.length,
    gaps:
      parsed.summary.gaps.length +
      parsed.diagnostics.gaps.length +
      parsed.ad_activity.gaps.length +
      parsed.business_health.gaps.length +
      parsed.pitch_pack.gaps.length,
  };
  console.log(
    `Payload valid. ${counts.checks} checks, ${counts.sources} sources, ${counts.gaps} recorded gaps. Every source reference resolves.`,
  );

  if (dryRun) {
    console.log("--dry-run: nothing written.");
    return;
  }

  const { createSupabaseServiceClient } = await import("../lib/supabase/service.ts");
  const supabase = createSupabaseServiceClient();

  const { data: prospect, error: lookupError } = await supabase
    .from("prospects")
    .select("id, brand, status")
    .eq("slug", parsed.slug)
    .maybeSingle();
  if (lookupError) throw new Error(lookupError.message);
  if (!prospect) {
    throw new Error(`No prospect with slug "${parsed.slug}". Run the seed script first.`);
  }

  // The same gate as the agent: only an approved prospect can have a report
  // filed against it. Claimed atomically, conditional on the status we read,
  // so a concurrent run or a change in the tracker cannot slip past.
  if (prospect.status !== "approved") {
    throw new Error(
      `${prospect.brand} is "${prospect.status}", not approved. Nothing was written.\n` +
        `Approve it in the tracker first (Re-run, if it is already built), then run this again.`,
    );
  }
  const { data: claimed, error: claimError } = await supabase
    .from("prospects")
    .update({ status: "researching" })
    .eq("id", prospect.id)
    .eq("status", "approved")
    .select("id");
  if (claimError) throw new Error(claimError.message);
  if (!claimed || claimed.length === 0) {
    throw new Error(`${prospect.brand} changed status a moment ago. Nothing was written.`);
  }

  // Hand the claim back if the insert fails, so the row is not left stuck.
  const release = () =>
    supabase.from("prospects").update({ status: "approved" }).eq("id", prospect.id).eq("status", "researching");

  const { data: latest } = await supabase
    .from("prospect_reports")
    .select("version")
    .eq("prospect_id", prospect.id)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (latest?.version ?? 0) + 1;

  const { error: insertError } = await supabase.from("prospect_reports").insert({
    prospect_id: prospect.id,
    version,
    payload: parsed,
    sources: parsed.sources,
  });
  if (insertError) {
    await release();
    throw new Error(`${insertError.message}. Claim released, status back to approved.`);
  }

  const { error: statusError } = await supabase
    .from("prospects")
    .update({ status: "built", built_at: new Date().toISOString() })
    .eq("id", prospect.id)
    .eq("status", "researching");
  if (statusError) throw new Error(statusError.message);

  console.log(`Wrote ${prospect.brand} report version ${version}, status set to built.`);
}

main().catch((error: unknown) => {
  console.error(`\nFailed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
