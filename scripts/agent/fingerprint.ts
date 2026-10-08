// Outside-in fingerprint of a prospect's homepage.
//
// The detection method is the one recorded on the spreadsheet's Method tab, so
// a re-run is comparable with the 21 September 2026 pass: fetch the homepage,
// regex the returned markup for platform markers and known vendor hosts and tag
// ID patterns, and confirm Shopify against /products.json and /cart.js, which
// only Shopify serves.
//
//   node --experimental-strip-types scripts/agent/fingerprint.ts <domain> [--json]
//
// Two things this deliberately does NOT do:
//   1. It does not accept cookies. Everything it reports is what an unconsented
//      visitor receives, which is why an absent tag is a question and not a
//      finding.
//   2. It does not retry past a bot challenge. A challenge page is reported as
//      blocked, which is a gap for the report to carry, not a thing to defeat.

export type Detection = {
  label: string;
  /** Regexes, any of which is sufficient. */
  patterns: RegExp[];
  /** Pulls the specific identifier out, when there is one worth quoting. */
  capture?: RegExp;
};

const PLATFORMS: Detection[] = [
  { label: "Shopify", patterns: [/cdn\.shopify\.com/i, /\/cdn\/shop\//i, /Shopify\.theme/i] },
  { label: "WooCommerce", patterns: [/wp-content\/plugins\/woocommerce/i, /woocommerce-no-js/i] },
  { label: "Magento 2 (Adobe Commerce)", patterns: [/Magento_Ui/i, /\/static\/frontend\//i] },
  { label: "BigCommerce", patterns: [/cdn\d*\.bigcommerce\.com/i, /bigcommerce\.com\/s-/i] },
  { label: "Squarespace", patterns: [/static\.squarespace\.com/i, /squarespace-cdn\.com/i] },
  { label: "Visualsoft", patterns: [/visualsoft/i] },
  { label: "Wix", patterns: [/static\.parastorage\.com/i, /wix\.com/i] },
];

const TAGS: Detection[] = [
  {
    label: "Meta pixel",
    patterns: [/connect\.facebook\.net/i, /\bfbq\s*\(/i, /facebook\.com\/tr\?/i],
    capture: /fbq\s*\(\s*['"]init['"]\s*,\s*['"](\d{8,})['"]/gi,
  },
  {
    label: "Meta pixel via WooCommerce plugin",
    patterns: [/facebook-for-woocommerce/i, /wc-facebook/i],
  },
  { label: "Meta pixel via PixelYourSite", patterns: [/pixelyoursite/i, /\bpys_/i] },
  {
    label: "Google Ads conversion tag",
    patterns: [/AW-\d{9,}/],
    capture: /\b(AW-\d{9,})\b/g,
  },
  { label: "Google Analytics 4", patterns: [/\bG-[A-Z0-9]{8,}\b/], capture: /\b(G-[A-Z0-9]{8,})\b/g },
  { label: "Google Tag Manager", patterns: [/\bGTM-[A-Z0-9]{5,}\b/], capture: /\b(GTM-[A-Z0-9]{5,})\b/g },
  { label: "Klaviyo", patterns: [/static\.klaviyo\.com/i, /klaviyo/i] },
  { label: "Mailchimp", patterns: [/chimpstatic\.com/i, /list-manage\.com/i, /mailchimp/i] },
  { label: "Attentive", patterns: [/attentivemobile\.com/i] },
  { label: "Recharge", patterns: [/rechargeapps\.com/i, /recharge-theme/i] },
  { label: "Judge.me", patterns: [/judge\.me/i, /judgeme/i] },
  { label: "Loox", patterns: [/loox\.io/i] },
  { label: "Trustpilot", patterns: [/trustpilot\.com/i] },
  { label: "Yotpo", patterns: [/yotpo\.com/i] },
  { label: "Awin", patterns: [/awin1\.com/i, /dwin\d\.com/i] },
  { label: "Stripe", patterns: [/js\.stripe\.com/i] },
  { label: "Microsoft Clarity", patterns: [/clarity\.ms/i] },
  { label: "TikTok pixel", patterns: [/analytics\.tiktok\.com/i] },
];

const CONSENT_PLATFORMS: Detection[] = [
  { label: "Cookiebot", patterns: [/cookiebot/i] },
  { label: "OneTrust", patterns: [/onetrust/i, /cookielaw\.org/i] },
  { label: "CookieYes", patterns: [/cookieyes/i] },
  { label: "Iubenda", patterns: [/iubenda/i] },
  { label: "Osano", patterns: [/osano/i] },
  { label: "Termly", patterns: [/termly/i] },
  { label: "Civic Cookie Control", patterns: [/cookiecontrol/i, /civiccomputing/i] },
  { label: "Klaro", patterns: [/klaro/i] },
  { label: "Shopify consent banner", patterns: [/consent-?tracking-?api/i, /customerPrivacy/i] },
];

export type Hit = { label: string; ids: string[] };

export type FingerprintResult = {
  domain: string;
  url: string;
  checked_on: string;
  /** ok, blocked (bot challenge), or failed (network, DNS, timeout). */
  outcome: "ok" | "blocked" | "failed";
  http_status: number | null;
  note: string | null;
  platform: Hit | null;
  platform_confirmations: string[];
  tags: Hit[];
  consent_platform: Hit | null;
  /**
   * More than one Meta pixel implementation, or more than one pixel ID. This is
   * the finding that was worth the most on the 21 September pass, so it is
   * computed rather than left to the reader.
   */
  duplicate_meta_pixel: { duplicated: boolean; implementations: string[]; ids: string[] };
};

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/125.0 Safari/537.36";

function matchAll(html: string, set: Detection[]): Hit[] {
  const hits: Hit[] = [];
  for (const detection of set) {
    if (!detection.patterns.some((p) => p.test(html))) continue;
    const ids = new Set<string>();
    if (detection.capture) {
      detection.capture.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = detection.capture.exec(html)) !== null) {
        if (m[1]) ids.add(m[1]);
      }
    }
    hits.push({ label: detection.label, ids: [...ids] });
  }
  return hits;
}

/** A challenge page is short, or names a known protection vendor. */
function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true;
  const CHALLENGE =
    /just a moment|checking your browser|cf-browser-verification|incapsula|imperva|attention required|enable javascript and cookies/i;
  return CHALLENGE.test(html) && html.length < 60_000;
}

async function fetchText(url: string, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": UA, accept: "text/html,*/*" },
    });
    return { status: response.status, body: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

export async function fingerprint(domain: string): Promise<FingerprintResult> {
  const host = domain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const url = `https://${host}/`;
  const checked_on = new Date().toISOString().slice(0, 10);

  const base: FingerprintResult = {
    domain: host, url, checked_on, outcome: "failed", http_status: null, note: null,
    platform: null, platform_confirmations: [], tags: [], consent_platform: null,
    duplicate_meta_pixel: { duplicated: false, implementations: [], ids: [] },
  };

  let html = "";
  try {
    const response = await fetchText(url);
    base.http_status = response.status;
    html = response.body;
  } catch (error) {
    base.note = `Could not fetch the homepage: ${
      error instanceof Error ? error.message : String(error)
    }. Record this as a gap rather than inferring anything from it.`;
    return base;
  }

  if (looksBlocked(base.http_status, html)) {
    base.outcome = "blocked";
    base.note =
      "The site returned a bot challenge rather than its homepage. Nothing can be " +
      "concluded about its tags from this response. Inspect it in a real browser " +
      "session, as the 21 September pass did for Brew York and Bettys, or record a gap.";
    return base;
  }

  base.outcome = "ok";

  const platforms = matchAll(html, PLATFORMS);
  base.platform = platforms[0] ?? null;
  if (platforms.length > 1) {
    base.note = `More than one platform marker present: ${platforms
      .map((p) => p.label)
      .join(", ")}. Worth a second look before asserting the platform.`;
  }

  // Shopify serves these two and nothing else does, so they confirm rather than suggest.
  if (base.platform?.label === "Shopify") {
    for (const path of ["products.json", "cart.js"]) {
      try {
        const probe = await fetchText(`https://${host}/${path}`, 12_000);
        if (probe.status === 200 && probe.body.trimStart().startsWith("{")) {
          base.platform_confirmations.push(`/${path} returned JSON`);
        }
      } catch {
        // A failed confirmation is not a contradiction. Leave it unlisted.
      }
    }
  }

  base.tags = matchAll(html, TAGS);
  base.consent_platform = matchAll(html, CONSENT_PLATFORMS)[0] ?? null;

  const metaImplementations = base.tags
    .filter((t) => t.label.startsWith("Meta pixel"))
    .map((t) => t.label);
  const metaIds = [
    ...new Set(base.tags.filter((t) => t.label === "Meta pixel").flatMap((t) => t.ids)),
  ];
  // Two plugins both loading the pixel, or two distinct IDs, both mean events
  // are counted more than once.
  const distinctSetups = metaImplementations.filter((l) => l !== "Meta pixel");
  base.duplicate_meta_pixel = {
    duplicated: distinctSetups.length > 1 || metaIds.length > 1,
    implementations: metaImplementations,
    ids: metaIds,
  };

  return base;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const domain = process.argv[2];
  if (!domain) {
    console.error("Usage: fingerprint.ts <domain> [--json]");
    process.exitCode = 1;
  } else {
    const result = await fingerprint(domain);
    if (process.argv.includes("--json")) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`${result.domain}  ${result.outcome}  http ${result.http_status ?? "none"}`);
      if (result.note) console.log(`  note: ${result.note}`);
    }
    // Nothing was read, so report nothing about the tags. Printing
    // "not detected" here would be exactly the false negative the consent
    // caveat warns about.
    if (result.outcome === "ok" && !process.argv.includes("--json")) {
      if (result.platform) {
        console.log(`  platform: ${result.platform.label}`);
        for (const c of result.platform_confirmations) console.log(`    confirmed: ${c}`);
      }
      for (const tag of result.tags) {
        console.log(`  tag: ${tag.label}${tag.ids.length ? ` (${tag.ids.join(", ")})` : ""}`);
      }
      console.log(`  consent platform: ${result.consent_platform?.label ?? "not detected"}`);
      if (result.duplicate_meta_pixel.duplicated) {
        console.log(
          `  DUPLICATE META PIXEL: ${result.duplicate_meta_pixel.implementations.join(" + ")}` +
            `${result.duplicate_meta_pixel.ids.length ? ` ids ${result.duplicate_meta_pixel.ids.join(", ")}` : ""}`,
        );
      }
    }
  }
}
