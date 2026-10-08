// Adding a prospect by hand.
//
// Deliberately free of Next.js imports so the duplicate-detection and
// normalisation logic can be exercised under plain node. lib/prospects.ts
// re-exports all of it, and supplies the Supabase-backed writer.

import { slugify, normaliseDomain, looksLikeDomain } from "./slug.ts";

/** What the form collects. Everything but the brand is optional. */
export type AddProspectInput = {
  brand: string;
  domain?: string | null;
  town?: string | null;
  category?: string | null;
  platform?: string | null;
  notes?: string | null;
};

/** A row ready to insert. No scores: those belong to the spreadsheet's model. */
export type NewProspectRow = {
  slug: string;
  brand: string;
  domain: string | null;
  town: string | null;
  category: string | null;
  platform: string | null;
  notes: string | null;
  source_tab: "manual";
  status: "new";
};

/** An existing row a new one would collide with. */
export type ProspectStub = { slug: string; brand: string; domain: string | null };

/**
 * The narrow slice of the database createProspect needs.
 *
 * An interface rather than a Supabase client so the duplicate-detection logic
 * can be tested without a database. The real implementation is right below.
 */
export type ProspectWriter = {
  findBySlug(slug: string): Promise<ProspectStub | null>;
  findByDomain(domain: string): Promise<ProspectStub | null>;
  insert(row: NewProspectRow): Promise<void>;
};

export type CreateProspectResult =
  | { ok: true; slug: string; brand: string }
  | { ok: false; error: string };

/**
 * Validate, check for collisions, insert.
 *
 * Refuses rather than overwrites: the spreadsheet rows carry research we would
 * silently destroy, so a clash names the existing row and stops.
 */
export async function createProspect(
  writer: ProspectWriter,
  input: AddProspectInput,
): Promise<CreateProspectResult> {
  const brand = (input.brand ?? "").trim();
  if (brand === "") {
    return { ok: false, error: "A brand name is required." };
  }

  const slug = slugify(brand);
  if (slug === "") {
    return {
      ok: false,
      error: "That brand name has no letters or numbers in it, so it cannot be given a web address.",
    };
  }

  const domain = normaliseDomain(input.domain);
  if (domain !== null && !looksLikeDomain(domain)) {
    return {
      ok: false,
      error: `"${domain}" does not look like a website address. Use something like example.co.uk.`,
    };
  }

  const bySlug = await writer.findBySlug(slug);
  if (bySlug) {
    return {
      ok: false,
      error: `${bySlug.brand} is already on the list under the same web address (${bySlug.slug}). Nothing was added.`,
    };
  }

  if (domain !== null) {
    const byDomain = await writer.findByDomain(domain);
    if (byDomain) {
      return {
        ok: false,
        error: `${byDomain.brand} is already on the list with the domain ${domain}. Nothing was added.`,
      };
    }
  }

  const tidy = (value: string | null | undefined): string | null => {
    const text = (value ?? "").trim();
    return text === "" ? null : text;
  };

  await writer.insert({
    slug,
    brand,
    domain,
    town: tidy(input.town),
    category: tidy(input.category),
    platform: tidy(input.platform),
    notes: tidy(input.notes),
    source_tab: "manual",
    status: "new",
  });

  return { ok: true, slug, brand };
}

