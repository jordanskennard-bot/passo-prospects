// Slug and domain normalisation, shared by the seed script and the tracker's
// "Add prospect" form.
//
// This lives in lib/ rather than scripts/ so both can import it: a row added by
// hand must get exactly the same slug the seed would have given it, or the two
// could produce different slugs for the same brand and the duplicate check
// would miss.

/** Brand name to URL slug. Stable: the same brand always gives the same slug. */
export function slugify(brand: string): string {
  return brand
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A typed-in domain to the bare host the spreadsheet uses.
 *
 * The sheet stores hosts like `brewyork.co.uk`, so anything pasted from a
 * browser bar has to be reduced to the same shape or the duplicate check will
 * not see that `https://www.brewyork.co.uk/` is the row already present.
 *
 * Returns null when there is nothing usable, so an empty field stays empty
 * rather than becoming an empty string.
 */
export function normaliseDomain(input: string | null | undefined): string | null {
  if (!input) return null;

  let text = input.trim().toLowerCase();
  if (text === "") return null;

  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  text = text.replace(/^www\./, "");
  text = text.split(/[/?#]/)[0] ?? "";                // path, query, fragment
  text = text.replace(/:\d+$/, "");                   // port
  text = text.replace(/\.+$/, "");                    // trailing dots

  return text === "" ? null : text;
}

/** Does this look like a hostname we could actually fetch? */
export function looksLikeDomain(domain: string): boolean {
  // At least one dot, labels of letters, digits and hyphens, not starting or
  // ending with a hyphen. Deliberately loose: this catches typos, it is not a
  // registry check.
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(domain);
}
