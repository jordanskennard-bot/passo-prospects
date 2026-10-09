// Reading the figures out of Companies House iXBRL accounts. Pure, no network,
// so it is pinned by lib/companies-house.test.ts against a real filing.
//
// Context ids ("CURRENT_FY_END" and so on) differ between accounting packages,
// so nothing here trusts them. Each context is read for its date and its
// dimensions, and a figure is only reported as a headline when it is the
// plain, undimensioned value at the balance sheet date (or for the period
// ending on it), or carries the dimension that says which creditors it is.

export type IxbrlFact = {
  name: string;
  value: number;
  /** Instant, or the end of the period, YYYY-MM-DD. */
  date: string | null;
  /** Dimension members, e.g. "frs-core:Non-currentFinancialInstruments". Empty for a plain figure. */
  members: string[];
};

export type AccountsFigures = {
  balance_sheet_date: string | null;
  net_assets_gbp: number | null;
  net_current_assets_gbp: number | null;
  creditors_within_one_year_gbp: number | null;
  creditors_after_one_year_gbp: number | null;
  cash_gbp: number | null;
  current_assets_gbp: number | null;
  turnover_gbp: number | null;
  profit_loss_gbp: number | null;
  employees: number | null;
};

const decode = (text: string) =>
  text
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .trim();

/** One iXBRL number, applying format, scale and sign. Null if unreadable. */
export function parseIxNumber(raw: string, attrs: { format?: string; scale?: string; sign?: string }): number | null {
  const text = decode(raw);
  const format = (attrs.format ?? "").toLowerCase();
  let value: number;
  if (/zerodash|fixed-zero|fixedzero/.test(format) || /^[-–—]$/.test(text)) {
    value = 0;
  } else {
    let digits = text.replace(/\s/g, "");
    // numdotcomma / numcommadecimal: 1.234,56. Everything else: 1,234.56.
    if (/numdotcomma|numcommadecimal|numspacecomma/.test(format)) digits = digits.replace(/\./g, "").replace(",", ".");
    else digits = digits.replace(/,/g, "");
    digits = digits.replace(/[()]/g, "");
    if (!/^\d+(\.\d+)?$/.test(digits)) return null;
    value = Number(digits);
  }
  const scale = Number(attrs.scale ?? 0);
  if (Number.isFinite(scale) && scale !== 0) value *= 10 ** scale;
  if (attrs.sign === "-") value = -value;
  return Math.round(value * 100) / 100;
}

function attr(tag: string, name: string): string | undefined {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];
}

/** Every numeric fact in an iXBRL document, with its context resolved. */
export function parseIxbrlFacts(xhtml: string): IxbrlFact[] {
  const contexts = new Map<string, { date: string | null; members: string[] }>();
  for (const m of xhtml.matchAll(/<xbrli:context\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/xbrli:context>/g)) {
    const body = m[2];
    const date =
      body.match(/<xbrli:instant>\s*([\d-]{10})\s*<\/xbrli:instant>/)?.[1] ??
      body.match(/<xbrli:endDate>\s*([\d-]{10})\s*<\/xbrli:endDate>/)?.[1] ??
      null;
    const members = [...body.matchAll(/<xbrldi:explicitMember\b[^>]*>\s*([^<\s]+)\s*<\/xbrldi:explicitMember>/g)].map((x) => x[1]);
    contexts.set(m[1], { date, members });
  }

  const facts: IxbrlFact[] = [];
  for (const m of xhtml.matchAll(/<ix:nonFraction\b([^>]*)>([\s\S]*?)<\/ix:nonFraction>/g)) {
    const tag = m[1];
    const name = attr(tag, "name");
    const contextRef = attr(tag, "contextRef");
    if (!name || !contextRef) continue;
    const value = parseIxNumber(m[2], { format: attr(tag, "format"), scale: attr(tag, "scale"), sign: attr(tag, "sign") });
    if (value === null) continue;
    const context = contexts.get(contextRef);
    facts.push({ name: name.replace(/^[^:]+:/, ""), value, date: context?.date ?? null, members: context?.members ?? [] });
  }
  return facts;
}

/** The headline figures at the latest balance sheet date. Null where the filing does not carry one. */
export function headlineFigures(facts: IxbrlFact[]): AccountsFigures {
  const dates = facts.map((f) => f.date).filter((d): d is string => d !== null).sort();
  const latest = dates.at(-1) ?? null;
  const at = (name: string, member?: RegExp) =>
    facts.find(
      (f) =>
        f.name === name &&
        f.date === latest &&
        (member ? f.members.some((m) => member.test(m)) : f.members.length === 0),
    )?.value ?? null;

  const within = /WithinOneYear|(^|:)CurrentFinancialInstruments$/i;
  const after = /AfterOneYear|(^|:)Non-?currentFinancialInstruments$/i;

  return {
    balance_sheet_date: latest,
    net_assets_gbp: at("NetAssetsLiabilities"),
    net_current_assets_gbp: at("NetCurrentAssetsLiabilities"),
    // Some packages tag due-within-one-year creditors plainly, others with a dimension.
    creditors_within_one_year_gbp: at("Creditors", within) ?? at("Creditors"),
    creditors_after_one_year_gbp: at("Creditors", after),
    cash_gbp: at("CashBankOnHand"),
    current_assets_gbp: at("CurrentAssets"),
    turnover_gbp: at("TurnoverRevenue"),
    profit_loss_gbp: at("ProfitLoss"),
    employees: at("AverageNumberEmployeesDuringPeriod"),
  };
}

/** Companies House company numbers: eight characters, digits or a two-letter prefix. */
export function isCompanyNumber(value: string): boolean {
  return /^(\d{8}|[A-Z]{2}\d{6})$/.test(value);
}
