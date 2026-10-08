// Enforce the content rules on anything written for a prospect page.
//
// The agent runs this on its own output before writing a report, and it runs
// over the repo's own copy in CI. Mechanical checks only: it catches the rules
// that are absolute, and says nothing about the rules that need judgement.
//
//   node --experimental-strip-types scripts/lint-copy.ts [paths...]
//
// With no paths it lints the copy-carrying source in this repo.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

type Rule = {
  name: string;
  pattern: RegExp;
  why: string;
};

const RULES: Rule[] = [
  {
    name: "em dash",
    pattern: /—/g,
    why: "No em dashes anywhere. Use a comma, a full stop, or a colon.",
  },
  {
    name: "en dash",
    pattern: /–/g,
    why: "No en dashes anywhere. Use a comma, a full stop, or a colon.",
  },
  {
    name: "banned term",
    // Words that would give away the wrong posture. Passo is a York-based paid
    // media agency for small businesses, not a technology pitch.
    pattern: /\b(agentic|programmatic|AI-powered|AI-driven|autonomous|incrementality|incremental uplift)\b/gi,
    why: "Use plain terms: wasted spend, which orders your advertising actually caused, your own order data rather than what Meta reports.",
  },
  {
    name: "bare AI",
    pattern: /\bAI\b/g,
    why: "Never describe what we do as AI.",
  },
  {
    name: "exclamation mark",
    pattern: /!(?=\s|$|["'’])/g,
    why: "No exclamation marks in prospect-facing copy.",
  },
  {
    name: "brand search",
    // "non-brand search" is the phrase we want, so it must not trip this.
    pattern: /(?<!\bnon[- ])\bbrand search\b/gi,
    why: "Brand search is never recommended. Say non-brand search.",
  },
];

/** Lines that are allowed to mention a banned term, because they are the rule
 *  itself rather than copy. Keyed by the exact file. */
const RULE_FILES = new Set(["scripts/lint-copy.ts"]);

const COPY_EXTENSIONS = new Set([".ts", ".tsx", ".md", ".json"]);
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "data", "public"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (COPY_EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

type Finding = { file: string; line: number; rule: string; text: string; why: string };

type Segment = { line: number; text: string };

/**
 * Pull the prose out of a TypeScript file: string literals and comments only.
 *
 * Linting raw source lines gives false positives on syntax that has nothing to
 * do with copy. A non-null assertion reads as an exclamation mark, and a parser
 * comparing against the dash characters a spreadsheet actually uses has to name
 * those characters. Neither is prose, so neither is linted.
 */
export function copySegments(source: string): Segment[] {
  const segments: Segment[] = [];
  let line = 1;
  let i = 0;

  const push = (startLine: number, text: string) => {
    if (text.trim() !== "") segments.push({ line: startLine, text });
  };

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (ch === "\n") { line++; i++; continue; }

    // Line comment.
    if (ch === "/" && next === "/") {
      const start = line;
      let end = source.indexOf("\n", i);
      if (end === -1) end = source.length;
      push(start, source.slice(i + 2, end));
      i = end;
      continue;
    }

    // Block comment.
    if (ch === "/" && next === "*") {
      const start = line;
      let end = source.indexOf("*/", i + 2);
      if (end === -1) end = source.length;
      const body = source.slice(i + 2, end);
      push(start, body);
      line += (body.match(/\n/g) ?? []).length;
      i = end + 2;
      continue;
    }

    // String or template literal.
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      const start = line;
      let j = i + 1;
      let body = "";
      while (j < source.length) {
        if (source[j] === "\\") {
          // Keep the escape as written, so "\u2013" stays six characters and is
          // not mistaken for the character it denotes.
          body += source[j] + (source[j + 1] ?? "");
          j += 2;
          continue;
        }
        if (source[j] === quote) break;
        if (source[j] === "\n") {
          if (quote !== "`") break;
          line++;
        }
        body += source[j];
        j++;
      }
      push(start, body);
      i = j + 1;
      continue;
    }

    i++;
  }

  return segments;
}

export function lintText(file: string, text: string): Finding[] {
  // The linter's own rule table names the banned words on purpose.
  if (RULE_FILES.has(file.replace(/^\.\//, ""))) return [];

  const isCode = /\.tsx?$/.test(file);
  const segments: Segment[] = isCode
    ? copySegments(text)
    : text.split("\n").map((line, index) => ({ line: index + 1, text: line }));

  const findings: Finding[] = [];
  for (const segment of segments) {
    // A line that states a rule has to name the words the rule forbids. Mark
    // those with lint-copy:allow rather than exempting the whole file, so the
    // other rules still apply to every line of it.
    if (segment.text.includes("lint-copy:allow")) continue;
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      if (!rule.pattern.test(segment.text)) continue;
      findings.push({
        file,
        line: segment.line,
        rule: rule.name,
        text: segment.text.trim().slice(0, 140),
        why: rule.why,
      });
    }
  }
  return findings;
}

const targets = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const files = targets.length > 0 ? targets : walk(".");

const findings = files.flatMap((file) => lintText(file, readFileSync(file, "utf8")));

if (findings.length === 0) {
  console.log(`Copy rules: clean across ${files.length} files.`);
} else {
  console.error(`Copy rules: ${findings.length} problems.\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  ${f.rule}`);
    console.error(`    ${f.text}`);
    console.error(`    ${f.why}\n`);
  }
  process.exitCode = 1;
}
