// Reading iXBRL accounts. The fixture is cut from Brew York Limited's real
// filing for the year to 31 March 2025 (09607690), so the expected numbers are
// the ones on its published balance sheet.
//
//   node --experimental-strip-types --test lib/companies-house.test.ts

import { test } from "node:test";
import assert from "node:assert/strict";
import { headlineFigures, isCompanyNumber, parseIxbrlFacts, parseIxNumber } from "./companies-house.ts";

const ctx = (id: string, period: string, member?: string) => `
  <xbrli:context id="${id}">
    <xbrli:entity>
      <xbrli:identifier scheme="http://www.companieshouse.gov.uk/">09607690</xbrli:identifier>
      ${member ? `<xbrli:segment><xbrldi:explicitMember dimension="frs-core:FinancialInstrumentCurrentNon-currentDimension">${member}</xbrldi:explicitMember></xbrli:segment>` : ""}
    </xbrli:entity>
    <xbrli:period>${period}</xbrli:period>
  </xbrli:context>`;

const fact = (name: string, context: string, value: string, extra = "") =>
  `<ix:nonFraction contextRef="${context}" decimals="0" format="ixt:numcommadot" name="frs-core:${name}" unitRef="GBP"${extra}>${value}</ix:nonFraction>`;

const BREW_YORK = `
<html><body>
<ix:header><ix:resources>
  ${ctx("CURRENT_FY_END", "<xbrli:instant>2025-03-31</xbrli:instant>")}
  ${ctx("PREVIOUS_FY_END", "<xbrli:instant>2024-03-31</xbrli:instant>")}
  ${ctx("CURRENT_FY_PERIOD", "<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>")}
  ${ctx("CURRENT_FY_END_NonCurrent", "<xbrli:instant>2025-03-31</xbrli:instant>", "frs-core:Non-currentFinancialInstruments")}
</ix:resources></ix:header>
<table>
  <tr><td>${fact("CashBankOnHand", "CURRENT_FY_END", "238,666")}</td><td>${fact("CashBankOnHand", "PREVIOUS_FY_END", "261,147")}</td></tr>
  <tr><td>${fact("CurrentAssets", "CURRENT_FY_END", "1,142,877")}</td></tr>
  <tr><td>(${fact("Creditors", "CURRENT_FY_END", "1,226,201")})</td><td>(${fact("Creditors", "PREVIOUS_FY_END", "806,873")})</td></tr>
  <tr><td>(${fact("NetCurrentAssetsLiabilities", "CURRENT_FY_END", "83,324", ' sign="-"')})</td><td>${fact("NetCurrentAssetsLiabilities", "PREVIOUS_FY_END", "241,438")}</td></tr>
  <tr><td>(${fact("Creditors", "CURRENT_FY_END_NonCurrent", "322,123")})</td></tr>
  <tr><td>${fact("NetAssetsLiabilities", "CURRENT_FY_END", "579,591")}</td><td>${fact("NetAssetsLiabilities", "PREVIOUS_FY_END", "519,124")}</td></tr>
  <tr><td><ix:nonFraction contextRef="CURRENT_FY_PERIOD" decimals="0" name="frs-core:AverageNumberEmployeesDuringPeriod" unitRef="Number">98</ix:nonFraction></td></tr>
</table>
</body></html>`;

test("Brew York's balance sheet reads back exactly", () => {
  assert.deepEqual(headlineFigures(parseIxbrlFacts(BREW_YORK)), {
    balance_sheet_date: "2025-03-31",
    net_assets_gbp: 579591,
    net_current_assets_gbp: -83324,
    creditors_within_one_year_gbp: 1226201,
    creditors_after_one_year_gbp: 322123,
    cash_gbp: 238666,
    current_assets_gbp: 1142877,
    turnover_gbp: null,
    profit_loss_gbp: null,
    employees: 98,
  });
});

test("the prior year is never mistaken for the current one", () => {
  const facts = parseIxbrlFacts(BREW_YORK);
  assert.ok(facts.some((f) => f.name === "NetAssetsLiabilities" && f.value === 519124 && f.date === "2024-03-31"));
  assert.equal(headlineFigures(facts).net_assets_gbp, 579591);
});

test("context ids are not trusted: only dates and dimensions are", () => {
  const renamed = BREW_YORK.replaceAll("CURRENT_FY_END_NonCurrent", "c7").replaceAll("CURRENT_FY_END", "c1").replaceAll("PREVIOUS_FY_END", "c2");
  assert.deepEqual(headlineFigures(parseIxbrlFacts(renamed)), headlineFigures(parseIxbrlFacts(BREW_YORK)));
});

test("a filing with no figures gives nulls, never zeros", () => {
  const figures = headlineFigures(parseIxbrlFacts("<html><body>Scanned accounts</body></html>"));
  assert.deepEqual(Object.values(figures).filter((v) => v !== null), []);
});

test("numbers honour format, scale and sign", () => {
  assert.equal(parseIxNumber("1,234", { format: "ixt:numcommadot" }), 1234);
  assert.equal(parseIxNumber("1.234,5", { format: "ixt:numdotcomma" }), 1234.5);
  assert.equal(parseIxNumber("12", { scale: "3" }), 12000);
  assert.equal(parseIxNumber("83,324", { sign: "-" }), -83324);
  assert.equal(parseIxNumber("-", { format: "ixt:fixed-zero" }), 0);
  assert.equal(parseIxNumber("n/a", {}), null);
});

test("company numbers are validated before any request", () => {
  for (const ok of ["09607690", "SC123456", "NI012345"]) assert.equal(isCompanyNumber(ok), true, ok);
  for (const bad of ["", "9607690", "09607690; rm -rf ~", "../../etc", "brew york"]) {
    assert.equal(isCompanyNumber(bad), false, bad);
  }
});
