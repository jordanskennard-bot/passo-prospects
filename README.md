# passo-prospects

Private prospect tracker and scoping agent. One operator, one allow-listed email,
`noindex` on everything.

Nothing is researched until it is approved in the tracker.

## What is here

| Path | What it is |
| --- | --- |
| `app/page.tsx` | The tracker. Sort by speed score, value score, town, category, brand, status. Filter by status and source tab. Row actions: approve, unapprove, archive, rerun. |
| `app/p/[slug]/` | The prospect page, rendered from the latest report version. |
| `app/login/`, `app/auth/` | Magic-link sign in, and the callback that refuses anyone not on the allow-list. |
| `proxy.ts` | Route protection. Next 16 renamed `middleware` to `proxy`. |
| `lib/auth.ts` | The allow-list. Mirrored in the migration's `prospects_is_operator()`. |
| `lib/report-schema.ts` | The report payload, as zod. Validated before any insert. |
| `supabase/migrations/001_prospects.sql` | Both tables, RLS, the operator function. |
| `scripts/seed.ts` | Imports the spreadsheet. Safe to re-run. |
| `scripts/agent/` | The approval gate, the fingerprinter, the report writer. |
| `.claude/skills/scope-prospects/` | The agent, as a skill. Run `/scope-prospects`. |
| `data/` | The source spreadsheet. |

Three layers protect the data, deliberately: `proxy.ts` redirects, every page and
server action calls `requireOperator()`, and RLS refuses rows to anyone whose JWT
email is not the operator's. The proxy alone is not the control, because Next
documents it as something that may be deployed to a CDN.

## Running it

```bash
npm install
cp .env.example .env.local     # then fill it in
npm run check                  # typecheck, copy rules, tests
npm run dev
```

### Applying the migration

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/001_prospects.sql
# or paste the file into the Supabase SQL editor.
```

It adds two tables, one function and one trigger. It alters nothing that exists.

### Seeding

```bash
npm run seed:dry   # parse and report, touches nothing
npm run seed       # write
```

Current counts from `data/Passo_Yorkshire_Prospects_v2.xlsx`:

| Source tab | Rows |
| --- | --- |
| Prospects | 33 |
| Checked not Shopify | 19 |
| Blocked by bot protection | 12 |
| **Total** | **64** |

Plus the Phase 1 shortlist merged onto 11 of them.

Re-running updates spreadsheet fields and never touches `status`, `approved_at`,
`built_at` or `notes`, so re-seeding after an approval cannot un-approve anything.
The script asserts this and fails loudly if the count of non-new rows ever drops.

### Adding a prospect

Most prospects come from the spreadsheet. For anything else, use **Add prospect**
on the tracker. It takes a brand (required) plus an optional domain, town,
category, platform and notes, and nothing else: scores belong to the
spreadsheet's model, so a manual row carries none and sorts last.

The row is saved with `source_tab = 'manual'`, which the **Added manually**
filter shows. The seed only ever writes the three spreadsheet tabs, so a manual
row survives every future re-seed untouched.

A domain is reduced to its bare host before saving, so pasting
`https://www.example.co.uk/shop` stores `example.co.uk`. If the slug or the
domain already belongs to another prospect, the add is refused and names that
row rather than overwriting it.

This needs migration `002_manual_prospects.sql`, which widens the `source_tab`
check constraint. Without it the insert is rejected and the form says so.

### The agent

```bash
npm run scope list-approved                      # the queue
npm run scope list-approved -- --brand "Brew York"   # the gate
```

The gate exits non-zero for anything not approved, which is what stops the skill.

## Deploying to Vercel

The app is a standard Next.js project with no build configuration, so Vercel
needs only the environment variables and the domain.

### 1. Environment variables

Set all four for **production, preview and development**:

| Name | Value | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | The existing Passo project URL | Browser-visible. RLS is the protection, not secrecy. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | The project anon key | Browser-visible, same reason. |
| `SUPABASE_SERVICE_ROLE_KEY` | The project service role key | **Server only.** Bypasses RLS. Only the seed and the agent use it. Never prefix it with `NEXT_PUBLIC_`. |
| `NEXT_PUBLIC_SITE_URL` | `https://prospects.passoagency.com` | Where magic links come back to. No trailing slash. |

Optional: `COMPANIES_HOUSE_API_KEY`. Without it the agent falls back to the
public Companies House site and records the weaker source in the payload.

### 2. DNS

`passoagency.com` is on GitHub Pages at the apex and must stay there, so add one
record for the subdomain only. At your DNS provider for `passoagency.com`:

```
Type   Name         Value                  TTL
CNAME  prospects    cname.vercel-dns.com.  3600
```

Then add `prospects.passoagency.com` as a domain on the Vercel project and let it
verify. Do not touch the apex `A` records; they point at GitHub Pages and the
marketing site depends on them.

### 3. Supabase auth settings

In the Supabase dashboard, Authentication, URL Configuration:

- **Site URL**: `https://prospects.passoagency.com`
- **Redirect URLs**: add both
  - `https://prospects.passoagency.com/auth/callback`
  - `http://localhost:3000/auth/callback`

Magic links fail silently if the callback is not on that list.

### 4. After the first deploy

Sign in once as `jordan@passoagency.com` to create the user, then confirm the
refusal path works with any other address: the link will arrive, and the callback
will sign it straight back out to `/login?error=not_allowed`.

## Changing who may use this site

Two places, and both are required:

1. `ALLOWED_EMAILS` in `lib/auth.ts`
2. `public.prospects_is_operator()` in the migration

The duplication is deliberate. A mistake in one layer should not open the other.
