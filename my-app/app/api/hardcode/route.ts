export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import OpenAI from "openai";
import {
  generateQueryDiff,
  buildAlignedRows,
  type ComparisonResult,
  type AlignedRow,
} from "@/lib/query-differ";

/* ============================== Types ============================== */

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";
type GoodBad = "good" | "bad";

type ChangeItem = {
  index?: number;
  type: ChangeType;
  side: Side;
  lineNumber: number;
  description: string;
  explanation: string;
  syntax: GoodBad;
  performance: GoodBad;
  span?: number;
  severity?: "block" | "warn" | "info";
};

type Severity = "warn" | "block" | "info";
type Finding = {
  lineNumber: number; 
  side: "new";
  rule: string;
  reason: string;
  snippet: string;
  literals?: string[];
  severity: Severity;
};

const MAX_QUERY_CHARS = 140_000;

/* ============================ Utilities ============================ */

function isNonEmptyString(x: any): x is string {
  return typeof x === "string" && x.trim().length > 0;
}
function lf(s: string): string {
  return (s ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}
function safeErrMessage(e: any, fallback = "Unexpected error") {
  const raw = typeof e?.message === "string" ? e.message : fallback;
  return raw
    .replace(/(Bearer\s+)[\w.\-]+/gi, "$1[REDACTED]")
    .replace(/(api[-_ ]?key\s*[:=]\s*)\w+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]");
}

/* ============================ Heuristics =========================== */

const NUMERIC_WHITELIST = new Set<string>(["0", "1", "100", "2.00", "0.00"]);
const ID_COLUMN_WHITELIST = [/(\bUSER_ID\b|\bCLIENT_ID\b|\bCUSTOMER_ID\b|\bACCOUNT_ID\b)/i];
const LOOKUP_COLUMN_WHITELIST = [
  /\bSTATUS\b/i,
  /\bSTATE_CODE\b/i,
  /\bTYPE_CODE\b/i,
  /\bCATEGORY(_CODE)?\b/i,
  /\bROLE(_CODE)?\b/i,
];
const ENV_STRING_RE = /\b(dev|stage|staging|prod|production|uat)\b/i;
const SECRET_RE = /\b(IDENTIFIED\s+BY|PASSWORD\s*=|ACCESS[_\-]?TOKEN|API[_\-]?KEY|SECRET)\b/i;
const DATE_LIT_RE = /\bDATE\s*'[^']*'|\bTO_DATE\s*\(/i;
const STRING_LIT_RE = /'((?:''|[^'])*)'/g;
const NUMBER_LIT_RE = /(?<![\w\.])(?:\d+(?:\.\d+)?)(?![\w\.])/g;

/* ---------- Comments handling ---------- */
const FULL_LINE_COMMENT_RE = /^\s*(--|\/\*|\*|\*\/)/;
const INLINE_BLOCK_RE = /\/\*[\s\S]*?\*\//g;
const INLINE_DASH_RE = /--.*$/;
function stripInlineComments(s: string): string {
  return s.replace(INLINE_BLOCK_RE, "").replace(INLINE_DASH_RE, "");
}

function isLikelyIdColumn(line: string) {
  return ID_COLUMN_WHITELIST.some((re) => re.test(line));
}
function isLookupColumn(line: string) {
  return LOOKUP_COLUMN_WHITELIST.some((re) => re.test(line));
}
function collectStringLiterals(line: string): string[] {
  const out: string[] = [];
  STRING_LIT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = STRING_LIT_RE.exec(line))) out.push(m[1].replace(/''/g, "'"));
  return out;
}
function collectNumberLiterals(line: string): string[] {
  const out: string[] = [];
  NUMBER_LIT_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = NUMBER_LIT_RE.exec(line))) out.push(m[0]);
  return out;
}
function looksLikePriceRounding(line: string) {
  return /\bROUND\s*\([^)]*,\s*2\s*\)/i.test(line) || /\bROUND\s*\(\s*NVL\s*\(/i.test(line);
}

/* ------------- SUBSTR diagnostics relaxation ------------- */
const ERROR_CONTEXT_RE = /(SQLERRM|DBMS_UTILITY\.FORMAT_ERROR_(STACK|BACKTRACE)|\$\$plsql_line)/i;
const SUBSTR_CALL_RE = /\b(?:SUBSTRB?|DBMS_LOB\.SUBSTR)\s*\(([^)]*)\)/ig;
const SUBSTR_LEN_ALLOWLIST = new Set<string>(["128", "255", "256", "512", "1000", "1024", "2000", "4000"]);
function stripSubstrErrorLengths(line: string, nums: string[]): string[] {
  if (!ERROR_CONTEXT_RE.test(line)) return nums;
  let keep = [...nums];
  SUBSTR_CALL_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SUBSTR_CALL_RE.exec(line))) {
    const args = m[1]
      .split(",")
      .map((s) => stripInlineComments(s).trim())
      .filter(Boolean);
    const startArg = args[1]?.match(/^\d+$/)?.[0];
    const lenArg = args[2]?.match(/^\d+$/)?.[0];
    if (startArg) keep = keep.filter((n) => n !== startArg);
    if (lenArg && SUBSTR_LEN_ALLOWLIST.has(lenArg)) {
      keep = keep.filter((n) => n !== lenArg);
    }
  }
  return keep;
}

/* -------- Stable domain constants for APPLICATION_ID (never flag) -------- */
const STABLE_ENUMS = {
  APPLICATION_ID: new Set<string>(["200", "222"]), // 200=PAYTABLES, 222=RECEIVABLES
};
function isAppIdContext(line: string): boolean {
  return /\bAPPLICATION_ID\b/i.test(line);
}
function onlyAllowedAppIds(values: string[]): boolean {
  if (!values.length) return false;
  return values.every((v) => STABLE_ENUMS.APPLICATION_ID.has(v));
}
function extractAppIdNums(line: string): string[] {
  const eq = line.match(/\bAPPLICATION_ID\b\s*=\s*(\d+)/i);
  if (eq && eq[1]) return [eq[1]];
  const inm = line.match(/\bAPPLICATION_ID\b\s*IN\s*\(([^)]+)\)/i);
  if (inm && inm[1]) {
    const nums = inm[1]
      .split(",")
      .map((s) => s.trim())
      .filter((t) => /^\d+(\.\d+)?$/.test(t));
    return nums;
  }
  return [];
}

/* ===================== NEW-side target line finder ===================== */
function newTouchedLinesFromRows(rows: AlignedRow[]): number[] {
  const set = new Set<number>();
  for (const r of rows) {
    if (r.kind === "addition" || r.kind === "modification") {
      const ln = r.new?.lineNumber;
      if (typeof ln === "number" && Number.isFinite(ln)) set.add(ln);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

/* ==================== NEW: char-vs-number detectors ==================== */

/** Column name patterns that are very often string-coded */
const STRINGY_COL_HINT = /\b(STATUS|STATE|TYPE|ROLE|CATEGORY|CLASS|CODE|_CD|_CODE|FLAG|DESC|DESCRIPTION)\b/i;

/** equality like: COL = 1   or   COL = 1.2  */
const EQ_CHAR_NUM_RE = /\b([A-Z_][A-Z0-9_$#]*)\s*=\s*(\d+(?:\.\d+)?)(?![\w\.])/i;

/** IN-list like: COL IN (1,2,3) — unquoted numbers only */
const IN_CHAR_NUM_RE = /\b([A-Z_][A-Z0-9_$#]*)\s+IN\s*\(\s*(\d+(?:\.\d+)?(?:\s*,\s*\d+(?:\.\d+)?)*)\s*\)/i;

/** BETWEEN like: COL BETWEEN 1 AND 9 */
const BETWEEN_CHAR_NUM_RE = /\b([A-Z_][A-Z0-9_$#]*)\s+BETWEEN\s+(\d+(?:\.\d+)?)\s+AND\s+(\d+(?:\.\d+)?)/i;

/** TO_CHAR applied to a numeric literal on the right side:  char_col = TO_CHAR(1) */
const TO_CHAR_RIGHT_NUM_RE = /\b([A-Z_][A-Z0-9_$#]*)\s*=\s*TO_CHAR\s*\(\s*(\d+(?:\.\d+)?)\s*\)/i;

/** TO_NUMBER applied to the column:  TO_NUMBER(char_col) = 1  (function on column -> index skip) */
const TO_NUMBER_ON_COLUMN_RE = /\bTO_NUMBER\s*\(\s*([A-Z_][A-Z0-9_$#]*)\s*\)\s*=\s*(\d+(?:\.\d+)?)/i;

function pushCharNumFinding(
  findings: Finding[],
  lineNumber: number,
  snippet: string,
  rule: string,
  col: string,
  nums: string[],
  severity: Severity = "warn"
) {
  findings.push({
    lineNumber,
    side: "new",
    rule,
    reason:
      `Character-like column \`${col}\` compared to unquoted numeric literal${nums.length > 1 ? "s" : ""} ` +
      `(${nums.join(", ")}). This forces implicit conversion and may throw ORA-01722 or bypass indexes. ` +
      `Quote the literals (e.g., '${nums[0]}') or cast the **literal**, not the column.`,
    snippet,
    severity,
    literals: nums,
  });
}

/* =============================== Scanner =============================== */

function scanLine(lineText: string, lineNumber: number): Finding[] {
  const findings: Finding[] = [];
  if (!lineText) return findings;
  if (FULL_LINE_COMMENT_RE.test(lineText)) return findings;

  const line = stripInlineComments(lineText);

  if (SECRET_RE.test(line)) {
    findings.push({
      lineNumber,
      side: "new",
      rule: "secret/credential",
      reason: "Possible secret/credential or password found.",
      snippet: lineText,
      severity: "block",
    });
  } else if (ENV_STRING_RE.test(line)) {
    findings.push({
      lineNumber,
      side: "new",
      rule: "env-or-schema",
      reason: "Environment- or schema-specific reference appears hardcoded.",
      snippet: lineText,
      severity: "block",
    });
  }

  // Date literals are allowed; other rules may still apply
  if (DATE_LIT_RE.test(line)) {
    /* keep scanning */
  }

  /* --- NEW: char-vs-number rules (run before any “early returns”) --- */

  {
    const m = line.match(EQ_CHAR_NUM_RE);
    if (m) {
      const col = m[1];
      const num = m[2];
      if (STRINGY_COL_HINT.test(col)) {
        pushCharNumFinding(findings, lineNumber, lineText, "char-vs-number-compare", col, [num], "warn");
      }
    }
  }
  {
    const m = line.match(IN_CHAR_NUM_RE);
    if (m) {
      const col = m[1];
      const list = m[2].split(",").map((s) => s.trim()).filter(Boolean);
      if (STRINGY_COL_HINT.test(col)) {
        pushCharNumFinding(findings, lineNumber, lineText, "char-vs-number-in", col, list, "warn");
      }
    }
  }
  {
    const m = line.match(BETWEEN_CHAR_NUM_RE);
    if (m) {
      const col = m[1];
      const nums = [m[2], m[3]];
      if (STRINGY_COL_HINT.test(col)) {
        pushCharNumFinding(findings, lineNumber, lineText, "char-vs-number-between", col, nums, "warn");
      }
    }
  }
  {
    const m = line.match(TO_CHAR_RIGHT_NUM_RE);
    if (m) {
      const col = m[1];
      const num = m[2];
      if (STRINGY_COL_HINT.test(col)) {
        findings.push({
          lineNumber,
          side: "new",
          rule: "to-char-right-literal",
          reason:
            `\`${col}\` is character-like; comparing to \`TO_CHAR(${num})\` is redundant and still encourages mixing types. ` +
            `Prefer quoting the literal directly (e.g., '${num}').`,
          snippet: lineText,
          severity: "info",
          literals: [num],
        });
      }
    }
  }
  {
    const m = line.match(TO_NUMBER_ON_COLUMN_RE);
    if (m) {
      const col = m[1];
      const num = m[2];
      findings.push({
        lineNumber,
        side: "new",
        rule: "to-number-on-column",
        reason:
          `\`TO_NUMBER(${col}) = ${num}\` applies a function to the column, which disables index usage and can raise ORA-01722. ` +
          `Prefer comparing \`${col}\` to a quoted literal ('${num}') or cast the **literal** side instead.`,
        snippet: lineText,
        severity: "warn",
        literals: [num],
      });
    }
  }

  const skipMagicNumber =
    isLikelyIdColumn(line) || looksLikePriceRounding(line) || isLookupColumn(line);

  if (!skipMagicNumber) {
    let nums = collectNumberLiterals(line).filter((n) => !NUMERIC_WHITELIST.has(n));
    nums = stripSubstrErrorLengths(line, nums);

    // APPLICATION_ID carve-out
    let appIdAllAllowed = false;
    if (isAppIdContext(line)) {
      const appNums = extractAppIdNums(line);
      if (appNums.length && onlyAllowedAppIds(appNums)) {
        appIdAllAllowed = true;
      }
    }

    if (!appIdAllAllowed && nums.length) {
      const hasNote = /--\s*(business rule|per\s+requirements?|per\s+spec)/i.test(lineText);
      if (!hasNote) {
        findings.push({
          lineNumber,
          side: "new",
          rule: "magic-number",
          reason: `Hardcoded numeric literal(s) without context: ${nums.join(", ")}`,
          snippet: lineText,
          severity: "warn",
          literals: nums,
        });
      }
    }

    if (!appIdAllAllowed && /\bIN\s*\(/i.test(line)) {
      const strings = collectStringLiterals(line);
      const allLits = strings.concat(nums);
      const distinct = Array.from(new Set(allLits.map((x) => x.trim()))).filter(Boolean);
      if (distinct.length >= 3) {
        findings.push({
          lineNumber,
          side: "new",
          rule: "in-list-3plus",
          reason: `IN-list with ${distinct.length} distinct hardcoded values.`,
          snippet: lineText,
          severity: "warn",
          literals: distinct,
        });
      }
    }
  }

  return findings;
}

/* ========================= Agent (optional explain) ========================= */

async function explainWithAgent(
  oldQuery: string,
  newQuery: string,
  findings: Finding[]
): Promise<string[]> {
  const apiKey = process.env.OPENAI_API_KEY;
  const agentId = process.env.HARDCODE_AGENT_ID;
  if (!apiKey || !agentId) {
    return findings.map(
      (f) => `${f.severity.toUpperCase()}: ${f.reason}\nLine ${f.lineNumber}: ${f.snippet}`
    );
  }

  const openai = new OpenAI({ apiKey });

  const userContent = [
    "You are a SQL static analysis explainer.",
    "Given old & new queries and a list of hardcoding findings, produce a concise, one-paragraph explanation for each finding (numbered list).",
    "",
    "Rules to emphasize:",
    "- Flag comparisons of CHARACTER columns to unquoted numeric literals (e.g., STATUS = 1, TYPE_CODE IN (1,2)). Explain Oracle’s implicit conversion risk (ORA-01722) and index bypass when functions apply to columns.",
    "- Recommend quoting the literals (e.g., STATUS = '1') or casting the literal, not the column. Avoid TO_NUMBER(column) or TO_CHAR(column) in predicates.",
    "",
    "OLD QUERY:",
    "```sql",
    oldQuery || "",
    "```",
    "NEW QUERY:",
    "```sql",
    newQuery,
    "```",
    "FINDINGS JSON:",
    JSON.stringify(findings, null, 2),
  ].join("\n");

  const model = "gpt-4.1-nano";

  try {
    const resp = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: "You are HARDCODE Inspector: analyze hardcoded SQL issues with Oracle-focused guidance." },
        { role: "user", content: userContent },
      ],
      temperature: 0.2,
      top_p: 0.9,
      max_tokens: 1000,
    });
    const text = resp.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Empty agent response");
    const items = text.split(/\n(?=\d+\.)/g).map((s) => s.replace(/^\s*\d+\.\s*/, "").trim());
    return findings.map((_, i) => items[i] || "");
  } catch {
    return findings.map(
      (f) => `${f.severity.toUpperCase()}: ${f.reason}\nLine ${f.lineNumber}: ${f.snippet}`
    );
  }
}

/* ================================= Route ================================= */

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const scanMode = url.searchParams.get("scanMode") || undefined;

    const body = await req.json().catch(() => null);

    const oldQueryRaw = lf((body?.oldQuery ?? "") as string);
    const newQueryRaw = lf((body?.newQuery ?? "") as string);

    if (!isNonEmptyString(newQueryRaw)) {
      throw new Error("newQuery must be a non-empty string.");
    }
    if (newQueryRaw.length > MAX_QUERY_CHARS || oldQueryRaw.length > MAX_QUERY_CHARS) {
      throw new Error(`Each query must be ≤ ${MAX_QUERY_CHARS.toLocaleString()} characters.`);
    }

    let targetLineNumbers: number[] = [];
    const newLines = newQueryRaw.split("\n");

    if (scanMode === "newOnly" || !isNonEmptyString(oldQueryRaw)) {
      targetLineNumbers = Array.from({ length: newLines.length }, (_, i) => i + 1);
    } else {
      const diff: ComparisonResult = generateQueryDiff(oldQueryRaw, newQueryRaw, { basis: "raw" });
      const rows: AlignedRow[] = buildAlignedRows(diff);
      targetLineNumbers = newTouchedLinesFromRows(rows);
    }

    if (targetLineNumbers.length === 0) {
      return NextResponse.json(
        { analysis: { changes: [] }, page: { total: 0 } },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const findings: Finding[] = [];
    for (const ln of targetLineNumbers) {
      findings.push(...scanLine(newLines[ln - 1] ?? "", ln));
    }

    if (findings.length === 0) {
      return NextResponse.json(
        { analysis: { changes: [] }, page: { total: 0 } },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const explanations = await explainWithAgent(oldQueryRaw, newQueryRaw, findings);

    const changes: ChangeItem[] = findings
      .map((f, i) => {
        const bad = f.severity === "block" || f.severity === "warn";
        return {
          index: i,
          type: "modification",
          side: "new",
          lineNumber: f.lineNumber,
          description: `${f.rule}: ${f.reason}`,
          explanation: explanations[i] || `${f.severity.toUpperCase()}: ${f.reason}`,
          syntax: bad ? "bad" : "good",
          performance: "good",
          severity: f.severity,
        } as ChangeItem;
      })
      .sort((a, b) => a.lineNumber - b.lineNumber);

    return NextResponse.json(
      {
        analysis: { changes, summary: `Hardcoding scan: ${changes.length} finding(s).` },
        page: { total: changes.length },
        meta: { mode: scanMode === "newOnly" || !isNonEmptyString(oldQueryRaw) ? "newOnly-raw" : "diff-new" },
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err: any) {
    const msg = safeErrMessage(err);
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
