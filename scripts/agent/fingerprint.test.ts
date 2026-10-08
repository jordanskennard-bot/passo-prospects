// Detection logic, exercised against fixtures rather than live sites.
//
// A live fetch is not a test: the site changes, the network may be blocked, and
// a bot challenge would make the result non-deterministic. These fixtures pin
// the behaviour that matters, including the duplicate-pixel case that was the
// most valuable finding of the 21 September pass.
//
//   node --experimental-strip-types --test scripts/agent/fingerprint.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { fingerprint } from "./fingerprint.ts";

/** Stand in for the network so the fixtures drive the parse. */
function stubFetch(bodies: Record<string, { status: number; body: string }>) {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input.toString();
    const match = bodies[url];
    if (!match) throw new Error(`unstubbed fetch: ${url}`);
    return new Response(match.body, { status: match.status });
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

// Brew York's recorded stack: WooCommerce, two Meta pixel implementations, a
// live Google Ads conversion tag, GA4, Mailchimp, Awin, Stripe.
const BREW_YORK_LIKE = `<!doctype html><html><head>
<link rel="stylesheet" href="/wp-content/plugins/woocommerce/assets/css/woocommerce.css">
<script src="https://connect.facebook.net/en_US/fbevents.js"></script>
<script>fbq('init', '123456789012345');</script>
<script src="/wp-content/plugins/facebook-for-woocommerce/assets/js/facebook-for-woocommerce.js"></script>
<script src="/wp-content/plugins/pixelyoursite/dist/scripts/public.js"></script>
<script async src="https://www.googletagmanager.com/gtag/js?id=AW-10805529416"></script>
<script>gtag('config','G-ABCD123456');</script>
<script src="https://chimpstatic.com/mcjs-connected/js/users/abc.js"></script>
<script src="https://www.dwin1.com/19038.js"></script>
<script src="https://js.stripe.com/v3/"></script>
</head><body>${"filler ".repeat(12000)}</body></html>`;

test("detects WooCommerce and both Meta pixel implementations", async () => {
  const restore = stubFetch({
    "https://brewyork.co.uk/": { status: 200, body: BREW_YORK_LIKE },
  });
  try {
    const result = await fingerprint("brewyork.co.uk");

    assert.equal(result.outcome, "ok");
    assert.equal(result.platform?.label, "WooCommerce");

    const labels = result.tags.map((t) => t.label);
    assert.ok(labels.includes("Meta pixel via WooCommerce plugin"));
    assert.ok(labels.includes("Meta pixel via PixelYourSite"));
    assert.ok(labels.includes("Google Ads conversion tag"));
    assert.ok(labels.includes("Google Analytics 4"));
    assert.ok(labels.includes("Awin"));

    // The headline finding, computed rather than left to the reader.
    assert.equal(result.duplicate_meta_pixel.duplicated, true);
    assert.deepEqual(result.duplicate_meta_pixel.implementations.sort(), [
      "Meta pixel",
      "Meta pixel via PixelYourSite",
      "Meta pixel via WooCommerce plugin",
    ]);

    // Identifiers are captured verbatim so the report can quote them.
    const googleAds = result.tags.find((t) => t.label === "Google Ads conversion tag");
    assert.deepEqual(googleAds?.ids, ["AW-10805529416"]);

    // Nothing was found, which must read as absent-from-this-response.
    assert.equal(result.consent_platform, null);
  } finally {
    restore();
  }
});

test("a single pixel implementation is not reported as duplicated", async () => {
  const restore = stubFetch({
    "https://example-single.co.uk/": {
      status: 200,
      body: `<html><head>
        <script src="https://cdn.shopify.com/s/files/1/theme.js"></script>
        <script src="https://connect.facebook.net/en_US/fbevents.js"></script>
        <script>fbq('init','999888777666555');</script>
        </head><body>${"x".repeat(5000)}</body></html>`,
    },
    "https://example-single.co.uk/products.json": { status: 200, body: '{"products":[]}' },
    "https://example-single.co.uk/cart.js": { status: 200, body: '{"items":[]}' },
  });
  try {
    const result = await fingerprint("example-single.co.uk");
    assert.equal(result.platform?.label, "Shopify");
    // Shopify is confirmed by endpoints only it serves.
    assert.deepEqual(result.platform_confirmations, [
      "/products.json returned JSON",
      "/cart.js returned JSON",
    ]);
    assert.equal(result.duplicate_meta_pixel.duplicated, false);
  } finally {
    restore();
  }
});

test("a bot challenge is reported as blocked, never as absent tags", async () => {
  const restore = stubFetch({
    "https://protected.co.uk/": {
      status: 403,
      body: "<html><body>Just a moment, checking your browser before accessing.</body></html>",
    },
  });
  try {
    const result = await fingerprint("protected.co.uk");
    assert.equal(result.outcome, "blocked");
    // The critical property: a challenge yields no tag claims at all.
    assert.deepEqual(result.tags, []);
    assert.equal(result.platform, null);
    assert.match(result.note ?? "", /real browser session|record a gap/i);
  } finally {
    restore();
  }
});

test("a network failure is a gap, not a finding", async () => {
  const restore = stubFetch({});
  try {
    const result = await fingerprint("unreachable.invalid");
    assert.equal(result.outcome, "failed");
    assert.deepEqual(result.tags, []);
    assert.match(result.note ?? "", /gap/i);
  } finally {
    restore();
  }
});

test("a consent platform is detected when present", async () => {
  const restore = stubFetch({
    "https://gated.co.uk/": {
      status: 200,
      body: `<html><head>
        <script src="https://consent.cookiebot.com/uc.js"></script>
        <link href="/wp-content/plugins/woocommerce/x.css">
        </head><body>${"y".repeat(5000)}</body></html>`,
    },
  });
  try {
    const result = await fingerprint("gated.co.uk");
    assert.equal(result.consent_platform?.label, "Cookiebot");
    // No Meta pixel found, but a consent tool is present: precisely the case
    // where absence must not be asserted.
    assert.equal(result.tags.some((t) => t.label.startsWith("Meta pixel")), false);
  } finally {
    restore();
  }
});
