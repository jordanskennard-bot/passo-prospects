// Matching emails to prospects, and the status moves that follow.
//
// Pure functions, no IMAP and no database, so scripts/scan-email.ts stays thin
// and every rule here is pinned by lib/outreach.test.ts.
//
// The rules:
//   - Sent: a message we sent to an address at a prospect's domain.
//   - Received: a reply to a message we sent, matched by In-Reply-To or
//     References. Mail that merely comes from a prospect's domain does not
//     count, so newsletters, receipts and marketing never move a status.
//   - Status moves are forward only. new or built becomes message_sent;
//     message_sent becomes response_received. archived is never touched.
//     approved and researching are held: the email is recorded, the status is
//     left alone, and the summary says so.

export type Direction = "sent" | "received";

export type ScannedMessage = {
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  date: Date;
  from: string[];
  to: string[];
  cc: string[];
  subject: string | null;
  /** IMAP UID in the folder it was read from, so its body can be fetched later. */
  uid?: number;
};

export type ProspectRef = {
  id: string;
  slug: string;
  brand: string;
  domain: string | null;
  status: string;
  category?: string | null;
};

export type EmailMatch = {
  prospect: ProspectRef;
  direction: Direction;
  message: ScannedMessage;
};

/** Public mailbox providers. A prospect "on" one of these cannot be matched by domain. */
const SHARED_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "hotmail.co.uk",
  "live.com", "live.co.uk", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com",
  "aol.com", "btinternet.com", "sky.com", "zoho.com", "zoho.eu", "protonmail.com",
]);

/** brewyork.co.uk from "https://www.BrewYork.co.uk/shop", or null. */
export function normaliseDomain(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim().toLowerCase();
  value = value.replace(/^[a-z]+:\/\//, "").replace(/^www\./, "");
  value = value.split(/[/?#:]/)[0] ?? "";
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) return null;
  return value;
}

/** The domain of an email address, lower-cased, or null. */
export function domainOfAddress(address: string): string | null {
  const at = address.trim().toLowerCase().lastIndexOf("@");
  if (at < 0) return null;
  return normaliseDomain(address.trim().slice(at + 1));
}

/** Message-IDs compare exactly, without surrounding space or angle brackets. */
export function normaliseMessageId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim().replace(/^<|>$/g, "").trim();
  return value.length > 0 ? `<${value}>` : null;
}

/** Every <id> in a References header, in order. */
export function parseReferences(header: string | null | undefined): string[] {
  if (!header) return [];
  return [...header.matchAll(/<[^<>\s]+>/g)].map((m) => m[0]);
}

/**
 * Domain to prospect. A domain claimed by two prospects is ambiguous and left
 * out, and listed so the summary can say why it was not matched.
 */
export function indexProspectsByDomain(prospects: ProspectRef[]): {
  byDomain: Map<string, ProspectRef>;
  ambiguous: string[];
} {
  const seen = new Map<string, ProspectRef[]>();
  for (const prospect of prospects) {
    const domain = normaliseDomain(prospect.domain);
    if (!domain || SHARED_DOMAINS.has(domain)) continue;
    seen.set(domain, [...(seen.get(domain) ?? []), prospect]);
  }
  const byDomain = new Map<string, ProspectRef>();
  const ambiguous: string[] = [];
  for (const [domain, matches] of seen) {
    if (matches.length === 1) byDomain.set(domain, matches[0]);
    else ambiguous.push(domain);
  }
  return { byDomain, ambiguous };
}

/** The prospect whose domain this address is at, including subdomains. */
export function prospectForAddress(
  address: string,
  byDomain: Map<string, ProspectRef>,
): ProspectRef | null {
  let domain = domainOfAddress(address);
  while (domain) {
    const hit = byDomain.get(domain);
    if (hit) return hit;
    const dot = domain.indexOf(".");
    // Walk up through parent domains, so mail.brewyork.co.uk matches
    // brewyork.co.uk. Only real prospect domains are in the map, so reaching
    // "co.uk" matches nothing; a single label like "uk" is not tried at all.
    const parent = dot >= 0 ? domain.slice(dot + 1) : null;
    domain = parent && parent.includes(".") ? parent : null;
  }
  return null;
}

/** A message from the Sent folder: which prospect it went to, if any. */
export function matchSent(
  message: ScannedMessage,
  byDomain: Map<string, ProspectRef>,
): ProspectRef | null {
  for (const address of [...message.to, ...message.cc]) {
    const prospect = prospectForAddress(address, byDomain);
    if (prospect) return prospect;
  }
  return null;
}

/**
 * A message from the Inbox: the prospect it is a reply to, if any. Only a
 * thread match counts. Sender domain alone is never enough.
 */
export function matchReceived(
  message: ScannedMessage,
  sentToProspect: Map<string, string>,
  prospectsById: Map<string, ProspectRef>,
  ownAddress: string,
): ProspectRef | null {
  // Our own copies (cc to self, sent-and-filed) are not replies.
  if (message.from.some((a) => a.trim().toLowerCase() === ownAddress.toLowerCase())) {
    return null;
  }
  const candidates = [message.inReplyTo, ...message.references]
    .map((id) => normaliseMessageId(id))
    .filter((id): id is string => id !== null);
  for (const id of candidates) {
    const prospectId = sentToProspect.get(id);
    if (prospectId) return prospectsById.get(prospectId) ?? null;
  }
  return null;
}

export type StatusOutcome =
  | { kind: "moved"; from: string; to: string }
  | { kind: "unchanged"; status: string }
  | { kind: "held"; status: string };

const HELD = new Set(["approved", "researching"]);

/**
 * Apply one email to a status, forward only. Called in date order, so a sent
 * and its reply found in the same scan take built to message_sent to
 * response_received.
 */
export function nextStatus(current: string, direction: Direction): string {
  if (direction === "sent" && (current === "new" || current === "built")) return "message_sent";
  if (direction === "received" && current === "message_sent") return "response_received";
  return current;
}

/** Fold every email for one prospect into its final status and what happened. */
export function resolveStatus(current: string, directions: Direction[]): StatusOutcome {
  if (HELD.has(current)) return { kind: "held", status: current };
  let status = current;
  for (const direction of directions) status = nextStatus(status, direction);
  return status === current
    ? { kind: "unchanged", status: current }
    : { kind: "moved", from: current, to: status };
}
