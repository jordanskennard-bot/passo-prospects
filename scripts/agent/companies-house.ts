// Companies House, for /scope-prospects, through the official API.
//
//   node --experimental-strip-types scripts/agent/companies-house.ts search "Brew York"
//   node --experimental-strip-types scripts/agent/companies-house.ts profile 09607690
//   node --experimental-strip-types scripts/agent/companies-house.ts officers 09607690
//   node --experimental-strip-types scripts/agent/companies-house.ts psc 09607690
//   node --experimental-strip-types scripts/agent/companies-house.ts accounts 09607690
//
// Reads COMPANIES_HOUSE_API_KEY from the environment (or .env.local) and sends
// it only to Companies House. The key is never printed. Output is JSON, with a
// public find-and-update URL on everything so the report can cite it.
//
// Only business facts are printed: officers' names, roles and appointment
// dates, never dates of birth, nationalities or addresses.
//
// accounts reads the latest accounts filing. When it was filed as iXBRL the
// balance sheet figures are read from the tagged data (lib/companies-house.ts);
// when it is a scanned or PDF-only filing, no figures are given and the output
// says so, so the report records a gap rather than a guess.

import {
  headlineFigures,
  isCompanyNumber,
  parseIxbrlFacts,
} from "../../lib/companies-house.ts";

const API = "https://api.company-information.service.gov.uk";
const PUBLIC = "https://find-and-update.company-information.service.gov.uk";
const DOCUMENT_HOSTS = new Set(["document-api.company-information.service.gov.uk"]);

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

function apiKey(): string {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // Already in the environment, or absent: checked below.
  }
  const key = process.env.COMPANIES_HOUSE_API_KEY?.trim();
  if (!key) {
    die(
      "COMPANIES_HOUSE_API_KEY is not set. Use the public site " +
        `(${PUBLIC}) instead, or add the key to .env.local.`,
    );
  }
  return key;
}

async function get(url: string, accept = "application/json"): Promise<Response> {
  const host = new URL(url).host;
  if (host !== new URL(API).host && !DOCUMENT_HOSTS.has(host)) die(`Refusing to send the key to ${host}.`);
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${Buffer.from(`${apiKey()}:`).toString("base64")}`,
      Accept: accept,
    },
    // The document API redirects to a signed storage URL; fetch drops the
    // Authorization header on that cross-origin hop, so the key stays put.
    redirect: "follow",
  });
  if (response.status === 401) die("Companies House rejected the API key (401).");
  if (response.status === 429) die("Companies House rate limit reached (429). Try again in a few minutes.");
  return response;
}

async function getJson<T>(path: string): Promise<T | null> {
  const response = await get(`${API}${path}`);
  if (response.status === 404) return null;
  if (!response.ok) die(`Companies House returned ${response.status} for ${path}.`);
  return (await response.json()) as T;
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

function companyNumber(raw: string | undefined): string {
  const number = (raw ?? "").trim().toUpperCase();
  if (!isCompanyNumber(number)) die(`Not a company number: ${JSON.stringify(raw)}. Expected eight characters, e.g. 09607690.`);
  return number;
}

type Search = { items?: { title: string; company_number: string; company_status?: string; date_of_creation?: string; date_of_cessation?: string; address_snippet?: string }[] };

async function search(query: string | undefined) {
  if (!query?.trim()) die('Usage: search "<company name>"');
  const data = await getJson<Search>(`/search/companies?q=${encodeURIComponent(query.trim())}&items_per_page=10`);
  print({
    source_url: `${PUBLIC}/search/companies?q=${encodeURIComponent(query.trim())}`,
    results: (data?.items ?? []).map((i) => ({
      company_name: i.title,
      company_number: i.company_number,
      status: i.company_status ?? null,
      incorporated_on: i.date_of_creation ?? null,
      dissolved_on: i.date_of_cessation ?? null,
      registered_address: i.address_snippet ?? null,
    })),
  });
}

type Profile = {
  company_name: string; company_number: string; company_status?: string; type?: string; date_of_creation?: string;
  sic_codes?: string[]; registered_office_address?: Record<string, string>;
  accounts?: { last_accounts?: { made_up_to?: string; type?: string }; next_due?: string; next_made_up_to?: string };
};

async function profile(raw: string | undefined) {
  const number = companyNumber(raw);
  const p = await getJson<Profile>(`/company/${number}`);
  if (!p) die(`No company ${number}.`);
  const office = p.registered_office_address ?? {};
  print({
    source_url: `${PUBLIC}/company/${number}`,
    company_name: p.company_name,
    company_number: p.company_number,
    status: p.company_status ?? null,
    type: p.type ?? null,
    incorporated_on: p.date_of_creation ?? null,
    sic_codes: p.sic_codes ?? [],
    registered_office: [office.address_line_1, office.address_line_2, office.locality, office.postal_code].filter(Boolean).join(", ") || null,
    last_accounts_made_up_to: p.accounts?.last_accounts?.made_up_to ?? null,
    last_accounts_type: p.accounts?.last_accounts?.type ?? null,
    next_accounts_made_up_to: p.accounts?.next_made_up_to ?? null,
    next_accounts_due: p.accounts?.next_due ?? null,
  });
}

type Officers = { items?: { name: string; officer_role?: string; appointed_on?: string; resigned_on?: string }[]; resigned_count?: number };

async function officers(raw: string | undefined) {
  const number = companyNumber(raw);
  const data = await getJson<Officers>(`/company/${number}/officers?items_per_page=50`);
  const items = data?.items ?? [];
  print({
    source_url: `${PUBLIC}/company/${number}/officers`,
    active: items.filter((o) => !o.resigned_on).map((o) => ({ name: o.name, role: o.officer_role ?? null, appointed_on: o.appointed_on ?? null })),
    resigned_count: items.filter((o) => o.resigned_on).length,
  });
}

type Psc = { items?: { name?: string; kind?: string; natures_of_control?: string[]; notified_on?: string; ceased_on?: string }[] };

async function psc(raw: string | undefined) {
  const number = companyNumber(raw);
  const data = await getJson<Psc>(`/company/${number}/persons-with-significant-control`);
  print({
    source_url: `${PUBLIC}/company/${number}/persons-with-significant-control`,
    persons: (data?.items ?? []).map((p) => ({
      name: p.name ?? null,
      kind: p.kind ?? null,
      natures_of_control: p.natures_of_control ?? [],
      notified_on: p.notified_on ?? null,
      ceased_on: p.ceased_on ?? null,
    })),
  });
}

type Filings = { items?: { date: string; type: string; description?: string; description_values?: { made_up_date?: string }; links?: { document_metadata?: string }; transaction_id?: string }[] };
type DocumentMeta = { resources?: Record<string, unknown>; links?: { document?: string } };

async function accounts(raw: string | undefined) {
  const number = companyNumber(raw);
  const history = await getJson<Filings>(`/company/${number}/filing-history?category=accounts&items_per_page=10`);
  // Skip period-change notices (AA01): only an accounts statement has figures.
  const filing = (history?.items ?? []).find((f) => f.type.startsWith("AA") && f.type !== "AA01");
  const filingsUrl = `${PUBLIC}/company/${number}/filing-history?category=accounts`;
  if (!filing) {
    print({ source_url: filingsUrl, filing: null, figures: null, gap: "No accounts filing found." });
    return;
  }

  const base = {
    source_url: filingsUrl,
    filing: {
      filed_on: filing.date,
      type: filing.type,
      description: filing.description ?? null,
      made_up_to: filing.description_values?.made_up_date ?? null,
    },
  };

  const metaUrl = filing.links?.document_metadata;
  if (!metaUrl) {
    print({ ...base, figures: null, gap: "The filing has no document attached through the API." });
    return;
  }
  const metaResponse = await get(metaUrl);
  if (!metaResponse.ok) die(`Companies House returned ${metaResponse.status} for the filing document.`);
  const meta = (await metaResponse.json()) as DocumentMeta;
  const formats = Object.keys(meta.resources ?? {});

  if (!formats.includes("application/xhtml+xml") || !meta.links?.document) {
    print({
      ...base,
      formats,
      figures: null,
      gap: "Filed as PDF only, so the figures are not machine-readable. Record a gap rather than reading numbers off a scan.",
    });
    return;
  }

  const content = await get(meta.links.document, "application/xhtml+xml");
  if (!content.ok) die(`Companies House returned ${content.status} for the accounts content.`);
  const facts = parseIxbrlFacts(await content.text());
  const figures = headlineFigures(facts);
  print({
    ...base,
    formats,
    figures,
    note:
      "Figures are read from the iXBRL tags. Null means the filing does not carry that figure: small companies " +
      "often omit the profit and loss account, so turnover and profit are usually null.",
  });
}

const [command, arg] = process.argv.slice(2);
try {
  switch (command) {
    case "search": await search(arg); break;
    case "profile": await profile(arg); break;
    case "officers": await officers(arg); break;
    case "psc": await psc(arg); break;
    case "accounts": await accounts(arg); break;
    default:
      die('Commands: search "<name>", profile <number>, officers <number>, psc <number>, accounts <number>');
  }
} catch (error) {
  die(`Companies House lookup failed: ${error instanceof Error ? error.message : String(error)}`);
}
