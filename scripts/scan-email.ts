// Scan the Passo mailbox for outreach to prospects, move their status, and
// draw notes from their replies.
//
//   npm run scan-email                                   record, move, add notes
//   npm run scan-email -- --dry-run                      show what would happen, write nothing
//   npm run scan-email -- --backfill-notes               also add notes for stored replies that have none
//   npm run scan-email -- --dry-run --backfill-notes     show proposed backfill notes, write nothing
//
// Reads Sent and Inbox on Zoho EU over IMAP for the last 14 days. The rules
// live in lib/outreach.ts: a sent email to a prospect's domain is 'sent'; an
// inbox email counts as 'received' only if it replies to one of those, so a
// prospect's newsletters and receipts never move anything. Statuses only move
// forward, archived is never touched, and approved or researching prospects are
// recorded but held, so this never interferes with the /scope-prospects gate.
//
// Notes (lib/reply-notes.ts): for each received reply, after the email row is
// stored, the new text of the reply (quotes and signatures stripped) goes to
// Claude with the prospect's brand and category. The reply is untrusted data.
// What comes back is validated and can only ever become note rows for that one
// prospect, inserted with source 'email'. Existing notes are never edited or
// deleted, and the model's output never changes a status or anything else.
//
// Idempotent: every message is keyed by its Message-ID, and one already in
// public.prospect_emails is skipped. Notes are unique per (message, body).
//
// The IMAP password and the Anthropic key are read from the macOS keychain at
// run time and held only in memory. Neither is printed, logged or written.

import { execFileSync } from "node:child_process";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  ImapFlow,
  type FetchMessageObject,
  type MessageAddressObject,
  type MessageStructureObject,
} from "imapflow";
import { createSupabaseServiceClient } from "../lib/supabase/service.ts";
import { ALLOWED_EMAILS } from "../lib/auth.ts";
import {
  indexProspectsByDomain,
  matchReceived,
  matchSent,
  normaliseMessageId,
  parseReferences,
  resolveStatus,
  type Direction,
  type EmailMatch,
  type ProspectRef,
  type ScannedMessage,
} from "../lib/outreach.ts";
import {
  buildUserContent,
  MAX_REPLY_CHARS,
  ModelOutputSchema,
  NOTES_MODEL,
  stripReply,
  SYSTEM_PROMPT,
  validateModelNotes,
  type ExtractedNote,
} from "../lib/reply-notes.ts";

const ACCOUNT = ALLOWED_EMAILS[0];
const IMAP_HOST = "imap.zoho.eu";
const IMAP_KEYCHAIN = { service: "passo-zoho-imap", account: ACCOUNT };
const ANTHROPIC_KEYCHAIN = { service: "passo-anthropic", account: "scan-email" };
const LOOKBACK_DAYS = 14;
const MAX_BODY_BYTES = 256 * 1024;

const dryRun = process.argv.includes("--dry-run");
const backfillNotes = process.argv.includes("--backfill-notes");

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** A keychain secret, or null. stderr is discarded so nothing sensitive is echoed. */
function readKeychain({ service, account }: { service: string; account: string }): string | null {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", service, "-a", account, "-w"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).replace(/\n$/, "");
  } catch {
    return null;
  }
}

const addKeychainHint = ({ service, account }: { service: string; account: string }) =>
  `security add-generic-password -s ${service} -a ${account} -w`;

const addresses = (list: MessageAddressObject[] | undefined): string[] =>
  (list ?? []).map((a) => a.address ?? "").filter(Boolean);

function toScanned(msg: FetchMessageObject): ScannedMessage | null {
  const env = msg.envelope;
  const messageId = normaliseMessageId(env?.messageId);
  if (!env || !messageId) return null;
  const headers = msg.headers?.toString("utf8") ?? "";
  // Unfold continuation lines, then take the References value.
  const referencesLine = headers.replace(/\r?\n[ \t]+/g, " ").match(/^references:(.*)$/im)?.[1];
  return {
    messageId,
    inReplyTo: normaliseMessageId(env.inReplyTo),
    references: parseReferences(referencesLine),
    date: env.date ? new Date(env.date) : new Date(0),
    from: addresses(env.from),
    to: addresses(env.to),
    cc: addresses(env.cc),
    subject: env.subject ?? null,
    uid: msg.uid,
  };
}

async function readFolder(client: ImapFlow, path: string, since: Date): Promise<ScannedMessage[]> {
  const lock = await client.getMailboxLock(path);
  try {
    const uids = await client.search({ since }, { uid: true });
    if (!uids || uids.length === 0) return [];
    const out: ScannedMessage[] = [];
    for await (const msg of client.fetch(uids, { envelope: true, headers: ["references"] }, { uid: true })) {
      const scanned = toScanned(msg);
      if (scanned) out.push(scanned);
    }
    return out;
  } finally {
    lock.release();
  }
}

/** The first text/plain part, else the first text/html part, of a structure tree. */
function findTextPart(node: MessageStructureObject | undefined): { part: string; html: boolean } | null {
  if (!node) return null;
  const leaves: MessageStructureObject[] = [];
  const walk = (n: MessageStructureObject) => {
    if (n.childNodes?.length) n.childNodes.forEach(walk);
    else leaves.push(n);
  };
  walk(node);
  const inline = leaves.filter((l) => l.disposition !== "attachment");
  const plain = inline.find((l) => l.type.toLowerCase() === "text/plain");
  if (plain) return { part: plain.part ?? "1", html: false };
  const html = inline.find((l) => l.type.toLowerCase() === "text/html");
  if (html) return { part: html.part ?? "1", html: true };
  return null;
}

/** Download one message's text, decoded. Caller holds the mailbox lock. */
async function downloadText(client: ImapFlow, uid: number): Promise<{ text: string; html: boolean } | null> {
  const meta = await client.fetchOne(String(uid), { bodyStructure: true }, { uid: true });
  const found = meta ? findTextPart(meta.bodyStructure) : null;
  if (!found) return null;
  const { content } = await client.download(String(uid), found.part, { uid: true, maxBytes: MAX_BODY_BYTES });
  const chunks: Buffer[] = [];
  for await (const chunk of content) chunks.push(Buffer.from(chunk));
  return { text: Buffer.concat(chunks).toString("utf8"), html: found.html };
}

type Reply = {
  prospect: ProspectRef;
  messageId: string;
  date: Date;
  from: string;
  /** Stripped new text, or null when it could not be read. */
  text: string | null;
  note: string | null;
  backfill: boolean;
};

type NoteResult = { notes: ExtractedNote[]; problems: string[] };

async function extractNotes(anthropic: Anthropic, reply: Reply): Promise<NoteResult> {
  if (!reply.text) return { notes: [], problems: [reply.note ?? "no readable text"] };
  if (!reply.text.trim()) return { notes: [], problems: [] };

  const problems: string[] = [];
  let replyText = reply.text;
  if (replyText.length > MAX_REPLY_CHARS) {
    problems.push(`reply cut to ${MAX_REPLY_CHARS} of ${replyText.length} characters before sending`);
    replyText = replyText.slice(0, MAX_REPLY_CHARS);
  }

  try {
    const response = await anthropic.messages.parse({
      model: NOTES_MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: zodOutputFormat(ModelOutputSchema) },
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: buildUserContent({
            brand: reply.prospect.brand,
            category: reply.prospect.category ?? null,
            replyText,
          }),
        },
      ],
    });
    if (response.stop_reason === "refusal") {
      return { notes: [], problems: [...problems, "the model declined this reply; no notes"] };
    }
    if (response.stop_reason === "max_tokens") {
      return { notes: [], problems: [...problems, "the model ran out of room; no notes"] };
    }
    const checked = validateModelNotes(response.parsed_output);
    if (checked.error) problems.push(`output rejected: ${checked.error}`);
    for (const r of checked.rejected) problems.push(`dropped "${r.body}": ${r.reason}`);
    return { notes: checked.notes, problems };
  } catch (error) {
    const status = error instanceof Anthropic.APIError ? ` (${error.status})` : "";
    return { notes: [], problems: [...problems, `API call failed${status}: ${(error as Error).message}`] };
  }
}

async function main() {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Fall through: the service client names the missing variables.
  }
  const db = createSupabaseServiceClient();

  // ─── What we already know ────────────────────────────────────────────────
  const { data: prospectRows, error: prospectError } = await db
    .from("prospects")
    .select("id, slug, brand, domain, status, category");
  if (prospectError) die(`Could not read prospects: ${prospectError.message}`);
  const prospects = (prospectRows ?? []) as ProspectRef[];
  const prospectsById = new Map(prospects.map((p) => [p.id, p]));
  const { byDomain, ambiguous } = indexProspectsByDomain(prospects);

  const known = new Set<string>();
  const sentToProspect = new Map<string, string>();
  const storedReplies: { message_id: string; prospect_id: string; sent_at: string; from_address: string }[] = [];
  const { data: stored, error: storedError } = await db
    .from("prospect_emails")
    .select("message_id, prospect_id, direction, sent_at, from_address");
  if (storedError) {
    if (!dryRun) die(`Could not read prospect_emails (${storedError.message}). Apply migration 003 first.`);
    console.log(`Note: prospect_emails is not readable (${storedError.message}). Dry run treats it as empty.\n`);
  }
  for (const row of stored ?? []) {
    known.add(row.message_id);
    if (row.direction === "sent") sentToProspect.set(row.message_id, row.prospect_id);
    else storedReplies.push(row);
  }

  // Replies that already have notes. Only needed to decide what to backfill.
  const noted = new Set<string>();
  if (backfillNotes) {
    const { data: notes, error: notesError } = await db
      .from("prospect_notes")
      .select("source_message_id")
      .not("source_message_id", "is", null);
    if (notesError) die(`Could not read prospect_notes (${notesError.message}). Apply migration 004 first.`);
    for (const n of notes ?? []) noted.add(n.source_message_id as string);
  }
  const backfillTargets = backfillNotes
    ? storedReplies.filter((r) => !noted.has(r.message_id) && prospectsById.has(r.prospect_id))
    : [];

  // ─── Read the mailbox ────────────────────────────────────────────────────
  const imapPassword = readKeychain(IMAP_KEYCHAIN);
  if (!imapPassword) {
    die(`No keychain password for IMAP. Add it with: ${addKeychainHint(IMAP_KEYCHAIN)}`);
  }
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: 993,
    secure: true,
    auth: { user: ACCOUNT, pass: imapPassword },
    logger: false,
  });
  try {
    await client.connect();
  } catch (error) {
    die(`IMAP sign-in to ${IMAP_HOST} failed: ${(error as Error).message}`);
  }

  const matches: EmailMatch[] = [];
  const replies: Reply[] = [];
  try {
    const folders = await client.list();
    const sentPath =
      folders.find((f) => f.specialUse === "\\Sent")?.path ??
      folders.find((f) => f.path.toLowerCase() === "sent")?.path;
    if (!sentPath) die(`No Sent folder found. Folders: ${folders.map((f) => f.path).join(", ")}`);
    const sentMessages = await readFolder(client, sentPath, since);
    const inboxMessages = await readFolder(client, "INBOX", since);
    console.log(
      `Scanned ${sentMessages.length} in ${sentPath} and ${inboxMessages.length} in INBOX since ` +
        `${since.toISOString().slice(0, 10)}.` +
        (backfillNotes ? ` Backfilling notes for ${backfillTargets.length} stored repl${backfillTargets.length === 1 ? "y" : "ies"} with none.` : "") +
        (dryRun ? " Dry run: nothing will be written." : "") +
        "\n",
    );

    // ─── Match. Sent first, so a reply in the same scan finds its thread. ─
    const seenThisRun = new Set<string>();
    for (const message of [...sentMessages].sort((a, b) => +a.date - +b.date)) {
      const prospect = matchSent(message, byDomain);
      if (!prospect) continue;
      sentToProspect.set(message.messageId, prospect.id);
      if (known.has(message.messageId) || seenThisRun.has(message.messageId)) continue;
      seenThisRun.add(message.messageId);
      matches.push({ prospect, direction: "sent", message });
    }
    for (const message of [...inboxMessages].sort((a, b) => +a.date - +b.date)) {
      const prospect = matchReceived(message, sentToProspect, prospectsById, ACCOUNT);
      if (!prospect) continue;
      if (known.has(message.messageId) || seenThisRun.has(message.messageId)) continue;
      seenThisRun.add(message.messageId);
      matches.push({ prospect, direction: "received", message });
    }

    // ─── Reply text, while the connection is open ────────────────────────
    const newReplies = matches.filter((m) => m.direction === "received");
    if (newReplies.length > 0 || backfillTargets.length > 0) {
      const lock = await client.getMailboxLock("INBOX");
      try {
        const fetchReply = async (
          prospect: ProspectRef, messageId: string, date: Date, from: string, uid: number | undefined, backfill: boolean,
        ) => {
          const reply: Reply = { prospect, messageId, date, from, text: null, note: null, backfill };
          try {
            let found = uid;
            if (found === undefined) {
              // A stored reply: find it again by Message-ID, any age.
              const hits = await client.search({ header: { "message-id": messageId } }, { uid: true });
              found = hits && hits.length > 0 ? hits[0] : undefined;
            }
            if (found === undefined) {
              reply.note = "no longer in INBOX";
            } else {
              const body = await downloadText(client, found);
              if (body) reply.text = stripReply(body.text, { html: body.html });
              else reply.note = "no text part";
            }
          } catch (error) {
            reply.note = `could not read the body: ${(error as Error).message}`;
          }
          replies.push(reply);
        };
        for (const m of newReplies) {
          await fetchReply(m.prospect, m.message.messageId, m.message.date, m.message.from.join(", "), m.message.uid, false);
        }
        for (const r of backfillTargets) {
          await fetchReply(prospectsById.get(r.prospect_id)!, r.message_id, new Date(r.sent_at), r.from_address, undefined, true);
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  // ─── Notes need the Anthropic key only if there is a reply to read ───────
  let anthropic: Anthropic | null = null;
  let anthropicGap: string | null = null;
  if (replies.length > 0) {
    const key = readKeychain(ANTHROPIC_KEYCHAIN);
    if (key) anthropic = new Anthropic({ apiKey: key });
    else anthropicGap = `no Anthropic key in the keychain. Add it with: ${addKeychainHint(ANTHROPIC_KEYCHAIN)}`;
  }

  // ─── Per prospect: record emails, move status, then add notes ────────────
  const byProspect = new Map<string, { matches: EmailMatch[]; replies: Reply[] }>();
  const bucket = (id: string) => {
    if (!byProspect.has(id)) byProspect.set(id, { matches: [], replies: [] });
    return byProspect.get(id)!;
  };
  for (const m of matches) bucket(m.prospect.id).matches.push(m);
  for (const r of replies) bucket(r.prospect.id).replies.push(r);

  if (byProspect.size === 0) console.log("No new emails matched a prospect, and no replies need notes.");
  const held: string[] = [];
  let failures = 0;
  let notesTotal = 0;

  for (const [prospectId, work] of byProspect) {
    const prospect = prospectsById.get(prospectId)!;
    work.matches.sort((a, b) => +a.message.date - +b.message.date);
    console.log(`${prospect.brand} (${prospect.slug}), currently ${prospect.status}`);
    for (const { direction, message } of work.matches) {
      const who = direction === "sent" ? `to ${[...message.to, ...message.cc].join(", ")}` : `from ${message.from.join(", ")}`;
      console.log(
        `  ${direction.padEnd(8)} ${message.date.toISOString().slice(0, 16).replace("T", " ")}  ${who}  "${message.subject ?? ""}"`,
      );
    }

    // 1. Record the emails. Notes may only follow a stored email.
    let emailsStored = true;
    if (work.matches.length > 0 && !dryRun) {
      const rows = work.matches.map(({ direction, message }) => ({
        prospect_id: prospect.id,
        direction,
        message_id: message.messageId,
        in_reply_to: message.inReplyTo,
        sent_at: message.date.toISOString(),
        from_address: message.from.join(", "),
        to_address: [...message.to, ...message.cc].join(", "),
        subject: message.subject,
      }));
      const { error } = await db
        .from("prospect_emails")
        .upsert(rows, { onConflict: "message_id", ignoreDuplicates: true });
      if (error) {
        failures++;
        emailsStored = false;
        console.log(`  Failed: could not record emails: ${error.message}. Status and notes left alone.`);
      }
    }

    // 2. Move the status, forward only. Notes never influence this.
    if (work.matches.length > 0 && emailsStored) {
      const outcome = resolveStatus(prospect.status, work.matches.map((m) => m.direction as Direction));
      if (outcome.kind === "moved") {
        let moved = true;
        if (!dryRun) {
          // Conditional on the status we read, so a change made in the tracker
          // since the scan started is never overwritten.
          const { data, error } = await db
            .from("prospects")
            .update({ status: outcome.to })
            .eq("id", prospect.id)
            .eq("status", outcome.from)
            .select("id");
          if (error || !data || data.length === 0) {
            moved = false;
            failures++;
            console.log(`  Failed: status not moved: ${error?.message ?? "it changed since the scan started"}.`);
          }
        }
        if (moved) console.log(`  status: ${outcome.from} -> ${outcome.to}${dryRun ? " (would move)" : ""}`);
      } else if (outcome.kind === "held") {
        held.push(`${prospect.brand} (${outcome.status})`);
        console.log(`  status: held at ${outcome.status}; emails ${dryRun ? "would be " : ""}recorded only`);
      } else {
        console.log(`  status: unchanged (${outcome.status})`);
      }
    }

    // 3. Notes from replies, only once their emails are stored.
    let added = 0;
    for (const reply of work.replies.sort((a, b) => +a.date - +b.date)) {
      const label = `${reply.backfill ? "backfill" : "reply"} ${reply.date.toISOString().slice(0, 16).replace("T", " ")} from ${reply.from}`;
      if (!emailsStored && !reply.backfill) continue;
      if (!anthropic) {
        failures++;
        console.log(`  notes for ${label}: skipped, ${anthropicGap}`);
        continue;
      }
      const result = await extractNotes(anthropic, reply);
      for (const problem of result.problems) console.log(`  notes for ${label}: ${problem}`);
      if (result.notes.length === 0) {
        if (result.problems.length === 0) console.log(`  notes for ${label}: none worth recording`);
        continue;
      }
      for (const note of result.notes) {
        console.log(`  ${dryRun ? "proposed" : "note"} [${note.category}] ${note.body}`);
      }
      if (dryRun) {
        added += result.notes.length;
        continue;
      }
      // Insert only. ignoreDuplicates is ON CONFLICT DO NOTHING: an existing
      // note is never edited or deleted.
      const { data, error } = await db
        .from("prospect_notes")
        .upsert(
          result.notes.map((note) => ({
            prospect_id: prospect.id,
            category: note.category,
            body: note.body,
            source: "email",
            source_message_id: reply.messageId,
          })),
          { onConflict: "source_message_id,body", ignoreDuplicates: true },
        )
        .select("id");
      if (error) {
        failures++;
        console.log(`  Failed: could not add notes for ${label}: ${error.message}.`);
        continue;
      }
      added += data?.length ?? 0;
    }
    notesTotal += added;
    if (work.replies.length > 0) {
      console.log(`  notes added: ${added}${dryRun ? " (dry run: proposed, not written)" : ""}`);
    }
    console.log("");
  }

  if (held.length > 0) {
    console.log(`Held, not moved, because a research run owns them: ${held.join(", ")}.`);
  }
  if (ambiguous.length > 0) {
    console.log(`Not matched, domain shared by more than one prospect: ${ambiguous.join(", ")}.`);
  }
  console.log(
    `${matches.length} new email${matches.length === 1 ? "" : "s"}, ` +
      `${notesTotal} note${notesTotal === 1 ? "" : "s"} ${dryRun ? "proposed" : "added"}, ` +
      `across ${byProspect.size} prospect${byProspect.size === 1 ? "" : "s"}.` +
      (dryRun ? " Dry run: nothing written." : ""),
  );
  if (failures > 0) process.exit(1);
}

await main();
