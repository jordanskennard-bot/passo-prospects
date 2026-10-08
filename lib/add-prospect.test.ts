// Adding a prospect by hand.
//
// The collision rules matter more than the happy path: the spreadsheet rows
// carry research from the 21 September pass, and an add that quietly overwrote
// one would destroy it with no trace.
//
//   node --experimental-strip-types --test lib/add-prospect.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { createProspect, type ProspectWriter, type NewProspectRow } from "./add-prospect.ts";
import { normaliseDomain, slugify } from "./slug.ts";

/** A writer over an in-memory list, recording what it was asked to insert. */
function fakeWriter(existing: { slug: string; brand: string; domain: string | null }[] = []) {
  const inserted: NewProspectRow[] = [];
  const writer: ProspectWriter = {
    async findBySlug(slug) {
      return existing.find((row) => row.slug === slug) ?? null;
    },
    async findByDomain(domain) {
      return existing.find((row) => row.domain === domain) ?? null;
    },
    async insert(row) {
      inserted.push(row);
      existing.push({ slug: row.slug, brand: row.brand, domain: row.domain });
    },
  };
  return { writer, inserted };
}

const BREW_YORK = { slug: "brew-york", brand: "Brew York", domain: "brewyork.co.uk" };

test("adds a prospect with only a brand", async () => {
  const { writer, inserted } = fakeWriter();
  const result = await createProspect(writer, { brand: "Florian Poirot" });

  assert.equal(result.ok, true);
  assert.equal(inserted.length, 1);
  assert.deepEqual(inserted[0], {
    slug: "florian-poirot",
    brand: "Florian Poirot",
    domain: null,
    town: null,
    category: null,
    platform: null,
    notes: null,
    source_tab: "manual",
    status: "new",
  });
});

test("a missing brand is refused", async () => {
  const { writer, inserted } = fakeWriter();
  for (const brand of ["", "   ", "\n"]) {
    const result = await createProspect(writer, { brand });
    assert.equal(result.ok, false);
    assert.match((result as { error: string }).error, /brand name is required/i);
  }
  assert.equal(inserted.length, 0, "nothing should be written");
});

test("a brand with no letters or digits is refused rather than given an empty slug", async () => {
  const { writer, inserted } = fakeWriter();
  const result = await createProspect(writer, { brand: "??? ---" });
  assert.equal(result.ok, false);
  assert.equal(inserted.length, 0);
});

test("a duplicate slug is refused and names the existing row", async () => {
  const { writer, inserted } = fakeWriter([BREW_YORK]);

  // Same brand, differently typed. slugify collapses both to brew-york.
  for (const brand of ["Brew York", "brew york", "BREW  YORK"]) {
    const result = await createProspect(writer, { brand });
    assert.equal(result.ok, false, brand);
    assert.match((result as { error: string }).error, /Brew York is already on the list/);
    assert.match((result as { error: string }).error, /Nothing was added/);
  }
  assert.equal(inserted.length, 0, "an existing row must never be overwritten");
});

test("a duplicate domain is refused even when the brand differs", async () => {
  const { writer, inserted } = fakeWriter([BREW_YORK]);

  const result = await createProspect(writer, {
    brand: "Brew York Brewing Company",
    domain: "https://www.brewyork.co.uk/shop?utm_source=x",
  });

  assert.equal(result.ok, false);
  assert.match((result as { error: string }).error, /already on the list with the domain brewyork\.co\.uk/);
  assert.equal(inserted.length, 0);
});

test("domains are normalised before they are stored", async () => {
  const cases: [string, string | null][] = [
    ["florianpoirot.co.uk", "florianpoirot.co.uk"],
    ["https://florianpoirot.co.uk", "florianpoirot.co.uk"],
    ["http://www.florianpoirot.co.uk/", "florianpoirot.co.uk"],
    ["HTTPS://WWW.FlorianPoirot.co.uk", "florianpoirot.co.uk"],
    ["  florianpoirot.co.uk/products/bread  ", "florianpoirot.co.uk"],
    ["florianpoirot.co.uk:443", "florianpoirot.co.uk"],
    ["https://florianpoirot.co.uk/?ref=a#top", "florianpoirot.co.uk"],
    ["", null],
    ["   ", null],
  ];

  for (const [input, expected] of cases) {
    assert.equal(normaliseDomain(input), expected, input);
  }

  // And the normalised form is what reaches the row.
  const { writer, inserted } = fakeWriter();
  await createProspect(writer, {
    brand: "Florian Poirot",
    domain: "  HTTPS://WWW.FlorianPoirot.co.uk/shop/  ",
  });
  assert.equal(inserted[0]?.domain, "florianpoirot.co.uk");
});

test("something that is not a domain is refused", async () => {
  const { writer, inserted } = fakeWriter();
  for (const domain of ["not a domain", "florianpoirot", "-bad-.com", "a..b"]) {
    const result = await createProspect(writer, { brand: `Test ${domain}`, domain });
    assert.equal(result.ok, false, domain);
    assert.match((result as { error: string }).error, /does not look like a website address/);
  }
  assert.equal(inserted.length, 0);
});

test("optional fields are trimmed, and blanks become null not empty strings", async () => {
  const { writer, inserted } = fakeWriter();
  await createProspect(writer, {
    brand: "  Florian Poirot  ",
    town: "  York  ",
    category: "",
    platform: "   ",
    notes: "  Worth a look.  ",
  });

  assert.equal(inserted[0]?.brand, "Florian Poirot");
  assert.equal(inserted[0]?.town, "York");
  assert.equal(inserted[0]?.category, null);
  assert.equal(inserted[0]?.platform, null);
  assert.equal(inserted[0]?.notes, "Worth a look.");
});

test("manual rows carry the manual source tab and start as new", async () => {
  const { writer, inserted } = fakeWriter();
  await createProspect(writer, { brand: "Florian Poirot" });
  assert.equal(inserted[0]?.source_tab, "manual");
  assert.equal(inserted[0]?.status, "new");
  // No scoring fields at all: those belong to the spreadsheet's model.
  assert.equal("speed_score" in (inserted[0] ?? {}), false);
  assert.equal("value_score" in (inserted[0] ?? {}), false);
});

test("the form and the seed agree on slugs", () => {
  // Both now call the same slugify, so a hand-added row cannot end up with a
  // different slug from the one a later re-seed would compute for that brand.
  for (const brand of ["Brew York", "Whittaker's Gin", "Mamas & Papas", "Spirit of Harrogate (Slingsby)"]) {
    assert.equal(slugify(brand), slugify(brand.toUpperCase()));
  }
  assert.equal(slugify("Mamas & Papas"), "mamas-and-papas");
  assert.equal(slugify("Whittaker's Gin"), "whittakers-gin");
});
