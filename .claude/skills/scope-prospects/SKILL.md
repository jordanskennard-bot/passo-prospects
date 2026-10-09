---
name: scope-prospects
description: Research approved prospects in the Passo prospect tracker and publish one page per prospect. Use when the user runs /scope-prospects, asks to scope or research a prospect, or asks to build a prospect page. Only ever touches prospects whose tracker status is approved.
---

# scope-prospects

Research the prospects I have approved, and publish one page each.

Run from the repository root. Every command below assumes
`node --experimental-strip-types`, and a `.env.local` holding
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.

## The gate, before anything else

**Never research a prospect that is not approved.** Approval is mine to give in
the tracker, and it is the only thing that puts a prospect in scope.

With a brand named:

```bash
node --experimental-strip-types scripts/agent/prospects.ts list-approved --brand "Brew York"
```

If that exits non-zero, **stop**. Tell me the prospect is not approved and that I
need to approve it in the tracker. Do not fetch their site, do not look them up,
do not draft anything. Do not offer to research a different prospect instead.

With no brand named, the same command lists the whole approved queue, shortlist
rank first. If it returns `[]`, say so and stop.

Work one prospect at a time, start to finish, before moving to the next.

**Never write to `prospect_notes`, `prospect_emails` or a prospect's status
outside the commands below.** Notes are mine and the email scan's. The only
writes this skill makes are `claim`, `release` and `write-report`.

## Per prospect

### 1. Read what is already known

```bash
node --experimental-strip-types scripts/agent/prospects.ts sheet-findings <slug>
```

The 21 September 2026 pass established the platform, the martech, the paid media
status and a provable problem for every prospect on the `prospects` tab. Read it
before fetching anything.

A prospect whose `source_tab` is `manual` was added by hand in the tracker and
has no spreadsheet findings: expect nulls for the scores, the shortlist fields,
the martech and the provable problem. That is the normal shape of a manual row,
not a failure and not a gap to record. Research it from scratch, and take the
`notes` field as the reason it is on the list. Your job is to confirm, date and deepen it, not to
re-derive it from scratch, and certainly not to contradict it silently. If what
you find now disagrees with the sheet, say so explicitly in the report and keep
both readings with their dates.

### 2. Claim it

```bash
node --experimental-strip-types scripts/agent/prospects.ts claim <slug>
```

Sets status to `researching`. If a later step fails badly enough that you cannot
produce a report, hand it back:

```bash
node --experimental-strip-types scripts/agent/prospects.ts release <slug> "what went wrong"
```

### 3. Fingerprint the homepage

```bash
node --experimental-strip-types scripts/agent/fingerprint.ts <domain> --json
```

This fetches the homepage as an unconsented visitor and applies the Method tab's
detection: `cdn.shopify.com` and `/products.json` for Shopify,
`wp-content/plugins/woocommerce` for WooCommerce, `Magento_Ui` for Magento, `fbq`
and pixel IDs, `AW-` conversion tags, `G-` and `GTM-`, Klaviyo, Recharge,
Mailchimp, Awin, review apps, and consent platforms. It computes
`duplicate_meta_pixel` for you, which is the single most valuable finding on this
list when it is true.

Three outcomes, and they are not interchangeable:

- `ok`: the markup was read. Report what was found.
- `blocked`: a bot challenge came back. **You learned nothing about their tags.**
  Record a gap. Inspect in a real browser session if you have one. Never report
  a tag as absent on the strength of a challenge page.
- `failed`: the fetch did not complete. Record a gap and carry on.

### 4. Ad activity

Check the Meta Ad Library and the Google Ads Transparency Center:

- Meta Ad Library: `https://www.facebook.com/ads/library/?q=<brand>&country=GB`.
  If the Meta connector is available, `ads_library_search` is better than a fetch.
- Google Ads Transparency Center: `https://adstransparency.google.com/?region=GB`.

Record active ad count, how long the longest has run, and the creative themes.
Neither source shows spend, so never state a budget. An inactive ad means there
was spend once, not that there is spend now.

### 5. Companies House

With `COMPANIES_HOUSE_API_KEY` set, use the API
(`https://api.company-information.service.gov.uk/search/companies?q=<brand>`,
HTTP basic, the key as the username and an empty password). Without it, use the
public site at `https://find-and-update.company-information.service.gov.uk`.

Take the registered name, number, incorporation date, status, officers, the
latest accounts date, and whatever of net assets, net current liabilities,
creditors and employees the filing gives. Then write the ability-to-pay read:
`comfortable`, `workable`, `price_sensitive` or `unknown`, with your reasoning.

Negative net current liabilities is not a reason to walk away. It is a reason the
first number has to be small. Say that, rather than implying they are in trouble.

The named officer is usually also the contact route.

### 6. Write the report

Build the payload against `lib/report-schema.ts`, save it as JSON, then:

```bash
node --experimental-strip-types scripts/agent/prospects.ts write-report <slug> /tmp/<slug>.json
```

This validates with zod, refuses a payload whose slug does not match, refuses one
citing a source that is not in its own `sources` table, inserts a new version
keeping every earlier one, and sets status to `built`. It prints the one-line
summary. Check your copy first:

```bash
node --experimental-strip-types scripts/lint-copy.ts /tmp/<slug>.json
```

## Never invent a figure

If a step fails, or a source does not carry something, record it as a gap in the
relevant section and carry on. A gap says what was not established and why. An
invented number is worse than an empty field, because I will act on it.

Nothing is nullable by accident: every numeric field in the schema accepts null
precisely so you never have to reach for a plausible value.

## The consent caveat

Carry `CONSENT_CAVEAT` from `lib/report-schema.ts` onto every report, verbatim.
It is a required field, so a payload cannot omit it.

A tag that was not detected is **a question to ask them, never a finding to
assert**. Consent tools gate tags until a visitor accepts cookies, and the
spreadsheet records Bettys as a confirmed example: its Meta pixel does not fire
before Cookiebot consent. Every check with a verdict other than `detected` needs
a caveat saying so in plain words.

## How to write

British English. Sentence case headings. No em dashes, no en dashes anywhere.

Never use these words, which the linter also blocks: agentic, programmatic, AI-powered, autonomous, incrementality. <!-- lint-copy:allow -->
Say it plainly instead: "your own order data rather than what
Meta reports", "which orders your advertising actually caused", "wasted spend".
Where the prospect is on Shopify, "your Shopify numbers, not Meta's" is the
phrase; where they are not, say "your own order data".

Passo is a York-based paid media agency for small businesses. Never present it as
a technology company, never mention automation, and never describe what we do in the terms the linter blocks. <!-- lint-copy:allow -->

Never recommend search on their own brand name. Non-brand search only. <!-- lint-copy:allow -->

`scripts/lint-copy.ts` enforces the mechanical half of this. The rest is on you.

## The outreach email

Short. Four short paragraphs at most.

1. **Who I am and why I am writing.** Jordan Kennard, fourteen years in media,
   ran ecommerce media for brands such as PlayStation, now independent, living in
   York, looking for local brands to start with.
2. **The one specific finding.** One. The best one. In their language, not ours.
3. **An offer to come and talk in person**, at a time that suits them.

**Never open with a sentence about their company.** Not a compliment, not an
observation about their beer, not "I've been following what you're doing". Open
with who I am.

If no named contact was established, leave the greeting open rather than guessing
a name, and record the gap.

## At the end

Print one line per prospect, exactly as `write-report` emits it: brand, version,
source count, gaps recorded, and the page path. Nothing else. If a prospect was
released rather than built, say which and why.
