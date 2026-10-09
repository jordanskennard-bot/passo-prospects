// The outreach rules. The ones that matter most: a newsletter from a
// prospect's domain must never count as a response, and statuses only move
// forward.
//
//   node --experimental-strip-types --test lib/outreach.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  indexProspectsByDomain,
  matchReceived,
  matchSent,
  normaliseDomain,
  normaliseMessageId,
  parseReferences,
  resolveStatus,
  type ProspectRef,
  type ScannedMessage,
} from "./outreach.ts";

const OWN = "jordan@passoagency.com";

const brewYork: ProspectRef = {
  id: "p-brew", slug: "brew-york", brand: "Brew York", domain: "brewyork.co.uk", status: "built",
};
const monk: ProspectRef = {
  id: "p-monk", slug: "northern-monk", brand: "Northern Monk", domain: "https://www.northernmonk.com/", status: "new",
};

function message(overrides: Partial<ScannedMessage>): ScannedMessage {
  return {
    messageId: "<m1@passoagency.com>",
    inReplyTo: null,
    references: [],
    date: new Date("2026-10-08T09:00:00Z"),
    from: [OWN],
    to: [],
    cc: [],
    subject: "Hello",
    ...overrides,
  };
}

test("domains normalise from whatever the sheet holds", () => {
  assert.equal(normaliseDomain("brewyork.co.uk"), "brewyork.co.uk");
  assert.equal(normaliseDomain("https://www.NorthernMonk.com/shop?x=1"), "northernmonk.com");
  assert.equal(normaliseDomain(""), null);
  assert.equal(normaliseDomain("not a domain"), null);
});

test("message ids compare with or without angle brackets", () => {
  assert.equal(normaliseMessageId("abc@x"), "<abc@x>");
  assert.equal(normaliseMessageId(" <abc@x> "), "<abc@x>");
  assert.deepEqual(parseReferences("<a@x> <b@y>\r\n <c@z>"), ["<a@x>", "<b@y>", "<c@z>"]);
});

test("a sent message to an address at a prospect's domain is matched", () => {
  const { byDomain } = indexProspectsByDomain([brewYork, monk]);
  assert.equal(matchSent(message({ to: ["wayne@brewyork.co.uk"] }), byDomain)?.slug, "brew-york");
  assert.equal(matchSent(message({ cc: ["info@northernmonk.com"] }), byDomain)?.slug, "northern-monk");
  assert.equal(matchSent(message({ to: ["shop@mail.brewyork.co.uk"] }), byDomain)?.slug, "brew-york");
});

test("a sent message to anyone else is not matched", () => {
  const { byDomain } = indexProspectsByDomain([brewYork, monk]);
  for (const to of [
    "someone@gmail.com",
    "wayne@brewyork.co.uk.evil.com",
    "wayne@notbrewyork.co.uk",
    "someone@co.uk",
  ]) {
    assert.equal(matchSent(message({ to: [to] }), byDomain), null, to);
  }
});

test("a prospect on a shared mail domain, or sharing a domain, is never matched by domain", () => {
  const gmailProspect = { ...monk, id: "p-g", slug: "g", domain: "gmail.com" };
  const twin = { ...brewYork, id: "p-twin", slug: "brew-york-2" };
  const { byDomain, ambiguous } = indexProspectsByDomain([gmailProspect, brewYork, twin]);
  assert.equal(matchSent(message({ to: ["a@gmail.com"] }), byDomain), null);
  assert.equal(matchSent(message({ to: ["a@brewyork.co.uk"] }), byDomain), null);
  assert.deepEqual(ambiguous, ["brewyork.co.uk"]);
});

test("a reply counts only through the thread", () => {
  const sent = new Map([["<m1@passoagency.com>", "p-brew"]]);
  const byId = new Map([["p-brew", brewYork]]);
  const reply = (o: Partial<ScannedMessage>) =>
    message({ messageId: "<r1@brewyork.co.uk>", from: ["wayne@brewyork.co.uk"], to: [OWN], ...o });

  assert.equal(matchReceived(reply({ inReplyTo: "<m1@passoagency.com>" }), sent, byId, OWN)?.slug, "brew-york");
  assert.equal(
    matchReceived(reply({ references: ["<other@x>", "<m1@passoagency.com>"] }), sent, byId, OWN)?.slug,
    "brew-york",
  );
  // A reply from a personal address still counts: the thread is the evidence.
  assert.equal(
    matchReceived(reply({ from: ["wayne@gmail.com"], inReplyTo: "m1@passoagency.com" }), sent, byId, OWN)?.slug,
    "brew-york",
  );
});

test("newsletters, receipts and marketing from a prospect's domain do not count", () => {
  const sent = new Map([["<m1@passoagency.com>", "p-brew"]]);
  const byId = new Map([["p-brew", brewYork]]);
  for (const from of ["news@brewyork.co.uk", "orders@brewyork.co.uk", "noreply@brewyork.co.uk"]) {
    const unsolicited = message({ messageId: "<n@brewyork.co.uk>", from: [from], to: [OWN] });
    assert.equal(matchReceived(unsolicited, sent, byId, OWN), null, from);
  }
  // A reply to a thread we never started does not count either.
  const otherThread = message({
    messageId: "<n2@brewyork.co.uk>", from: ["wayne@brewyork.co.uk"], inReplyTo: "<theirs@brewyork.co.uk>",
  });
  assert.equal(matchReceived(otherThread, sent, byId, OWN), null);
});

test("our own copies in the inbox are not replies", () => {
  const sent = new Map([["<m1@passoagency.com>", "p-brew"]]);
  const byId = new Map([["p-brew", brewYork]]);
  const ownCopy = message({ messageId: "<m2@passoagency.com>", from: ["Jordan@PassoAgency.com"], inReplyTo: "<m1@passoagency.com>" });
  assert.equal(matchReceived(ownCopy, sent, byId, OWN), null);
});

test("statuses move forward only", () => {
  assert.deepEqual(resolveStatus("new", ["sent"]), { kind: "moved", from: "new", to: "message_sent" });
  assert.deepEqual(resolveStatus("built", ["sent"]), { kind: "moved", from: "built", to: "message_sent" });
  assert.deepEqual(resolveStatus("message_sent", ["received"]), { kind: "moved", from: "message_sent", to: "response_received" });
  // A sent and its reply in the same scan go all the way.
  assert.deepEqual(resolveStatus("built", ["sent", "received"]), { kind: "moved", from: "built", to: "response_received" });
  // Never backwards.
  assert.deepEqual(resolveStatus("response_received", ["sent"]), { kind: "unchanged", status: "response_received" });
  assert.deepEqual(resolveStatus("message_sent", ["sent"]), { kind: "unchanged", status: "message_sent" });
  // A reply with no sent status to move from leaves new alone.
  assert.deepEqual(resolveStatus("new", ["received"]), { kind: "unchanged", status: "new" });
});

test("archived is never touched, and approved or researching are held", () => {
  assert.deepEqual(resolveStatus("archived", ["sent", "received"]), { kind: "unchanged", status: "archived" });
  assert.deepEqual(resolveStatus("approved", ["sent"]), { kind: "held", status: "approved" });
  assert.deepEqual(resolveStatus("researching", ["sent", "received"]), { kind: "held", status: "researching" });
});
