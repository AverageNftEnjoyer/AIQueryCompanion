export const runtime = "nodejs";        // ensure Node.js Serverless Functions (not Edge)
export const dynamic = "force-dynamic"; // never cache; route is dynamic
export const maxDuration = 60;          // seconds (raise if your plan allows)

import { NextResponse } from "next/server"
import { generateQueryDiff, canonicalizeSQL, type ComparisonResult } from "@/lib/query-differ"

/* ============================================================================
   Types & Env
============================================================================ */

type ChangeType = "addition" | "modification" | "deletion"
type Side = "old" | "new" | "both"
type GoodBad = "good" | "bad"

type ChangeItem = {
  type: ChangeType
  description: string
  lineNumber: number
  side: Side
  span?: number
  range?: [number, number] // inclusive
}

type ChangeExplanation = {
  index: number
  explanation: string
  syntax: GoodBad
  performance: GoodBad
  meta?: {
    clauses: string[]
    change_kind?: string
    business_impact?: "clear" | "weak" | "none"
    risk?: "low" | "medium" | "high"
    suggestions?: string[]
  }
}

const XAI_API_KEY = process.env.XAI_API_KEY
const XAI_MODEL = process.env.XAI_MODEL || "grok-4"

// Networking/time budgets
const FUNCTION_MAX_MS = (typeof maxDuration === "number" ? maxDuration : 60) * 1000
const SAFE_BUDGET_MS = Math.max(5000, FUNCTION_MAX_MS - 2000) // 2s buffer so Vercel doesn’t kill first
const FETCH_TIMEOUT_MS = Math.min(
  Number(process.env.ANALYZE_REQUEST_TIMEOUT_MS || process.env.FETCH_TIMEOUT_MS || 55_000),
  SAFE_BUDGET_MS
)
const RETRIES = Math.max(0, Math.min(2, Number(process.env.LLM_RETRIES ?? 1)))

const ANALYSIS_MODEL_CLIP_BYTES = Math.max(8_000, Number(process.env.ANALYSIS_MODEL_CLIP_BYTES ?? 10_000))
const MAX_ITEMS_TO_EXPLAIN = Math.max(80, Number(process.env.MAX_ITEMS_TO_EXPLAIN ?? 120))
const BATCH_SIZE = Math.max(4, Math.min(16, Number(process.env.ANALYZE_BATCH_SIZE ?? 8)))
const ANALYZE_MAX_BATCHES = Math.max(1, Number(process.env.ANALYZE_MAX_BATCHES ?? 4)) // stop after N batches
const MAX_AI_BUDGET_MS = Math.max(5000, Number(process.env.MAX_AI_BUDGET_MS ?? 20_000)) // dedicate ~20s to AI
const GROUP_THRESHOLD = Math.max(2, Number(process.env.CHANGE_GROUP_THRESHOLD ?? 3)) // min contiguous lines to group
const MAX_GROUP_LINES = Math.max(30, Number(process.env.CHANGE_GROUP_MAX_LINES ?? 120))
const GAP_JOIN = Math.max(0, Number(process.env.CHANGE_GAP_JOIN ?? 1)) // join runs separated by <= GAP_JOIN

const MAX_QUERY_CHARS = 120_000

/* ============================================================================
   Small utils
============================================================================ */

function isNonEmptyString(x: any): x is string {
  return typeof x === "string" && x.trim().length > 0
}

function validateInput(body: any) {
  if (!body || !isNonEmptyString(body.oldQuery) || !isNonEmptyString(body.newQuery)) {
    throw new Error("oldQuery and newQuery must be non-empty strings.")
  }
  if (body.oldQuery.length > MAX_QUERY_CHARS || body.newQuery.length > MAX_QUERY_CHARS) {
    throw new Error(`Each query must be ≤ ${MAX_QUERY_CHARS.toLocaleString()} characters.`)
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n))
}

function clip(sql: string, budget = ANALYSIS_MODEL_CLIP_BYTES): string {
  const raw = (sql || "").replace(/\r/g, "")
  if (raw.length <= budget) return raw
  const head = raw.slice(0, Math.floor(budget * 0.6))
  const tail = raw.slice(-Math.floor(budget * 0.35))
  return `${head}\n/* ...clipped for model... */\n${tail}`
}

function safeErrMessage(e: any, fallback = "Unexpected error") {
  const raw = typeof e?.message === "string" ? e.message : fallback
  return raw
    .replace(/(Bearer\s+)[\w\.\-]+/gi, "$1[REDACTED]")
    .replace(/(api-key\s*:\s*)\w+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
}

/* ============================================================================
   HTTP helpers (timeout + retries)
============================================================================ */

async function fetchWithTimeout(input: RequestInfo, init: RequestInit = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}

async function withRetries<T>(fn: () => Promise<T>, max = RETRIES, baseDelay = 350): Promise<T> {
  let lastErr: any
  for (let i = 0; i <= max; i++) {
    try {
      return await fn()
    } catch (e: any) {
      lastErr = e
      const msg = String(e?.message || "")
      if (!/429|5\d\d|timeout|aborted|AbortError/i.test(msg)) break
      await new Promise((res) => setTimeout(res, baseDelay * Math.pow(2, i)))
    }
  }
  throw lastErr
}

/* ============================================================================
   Diff → atomic changes
============================================================================ */

function normalizeTokenPreview(s: string) {
  const t = s.trim()
  if (!t) return ""
  // Drop lone punctuation and noisy tokens
  if (/^[(),;]+$/.test(t)) return ""
  if (/^\)$/.test(t) || /^\($/.test(t) || /^\)\s*,?$/.test(t)) return ""
  if (/^"(?:\w+)"$/.test(t)) return ""
  return t.slice(0, 120)
}

function tokenFromDescription(desc: string): string {
  const m =
    desc.match(/:\s(?:added|removed|changed.*to)\s"([^"]*)"/i) ?? desc.match(/"([^"]*)"$/)
  return normalizeTokenPreview(m?.[1] ?? "")
}

function buildRawChanges(diff: ComparisonResult): ChangeItem[] {
  const out: ChangeItem[] = []
  for (let i = 0; i < diff.diffs.length; i++) {
    const d = diff.diffs[i]

    if (d.type === "deletion" && d.oldLineNumber) {
      const next = diff.diffs[i + 1]
      if (next && next.type === "addition" && next.newLineNumber) {
        const desc = `Line ${next.newLineNumber}: changed from "${d.content.trim()}" to "${next.content.trim()}"`
        const tok = tokenFromDescription(desc)
        if (tok) out.push({ type: "modification", description: desc, lineNumber: next.newLineNumber, side: "both" })
        i++
      } else {
        const desc = `Line ${d.oldLineNumber}: removed "${d.content.trim()}"`
        const tok = tokenFromDescription(desc)
        if (tok) out.push({ type: "deletion", description: desc, lineNumber: d.oldLineNumber, side: "old" })
      }
    } else if (d.type === "addition" && d.newLineNumber) {
      const prev = diff.diffs[i - 1]
      if (!(prev && prev.type === "deletion")) {
        const desc = `Line ${d.newLineNumber}: added "${d.content.trim()}"`
        const tok = tokenFromDescription(desc)
        if (tok) out.push({ type: "addition", description: desc, lineNumber: d.newLineNumber, side: "new" })
      }
    }
  }
  return out.sort((a, b) => a.lineNumber - b.lineNumber)
}

/* ============================================================================
   Structure-aware grouping (CTE / subquery / clause)
============================================================================ */

type SqlBlockKind = "CTE" | "SUBQUERY" | "PLSQL" | "CLAUSE"
type SqlBlock = { kind: SqlBlockKind; start: number; end: number; label: string }

type SqlStructure = {
  boundaries: Set<number> // lines that start a logical boundary
  labelByLine: Map<number, string>
  blocks: SqlBlock[]
  blockIndexByLine: Map<number, number>
}

function buildSqlStructure(sql: string): SqlStructure {
  const lines = sql.split("\n")
  const boundaries = new Set<number>()
  const labelByLine = new Map<number, string>()
  const blocks: SqlBlock[] = []
  const blockIndexByLine = new Map<number, number>()

  // Clause starts (fast regexes, 1 pass)
  const clauseRules: Array<[RegExp, string]> = [
    [/^\s*WITH\b/i, "WITH"],
    [/^\s*SELECT\b/i, "SELECT"],
    [/^\s*FROM\b/i, "FROM"],
    [/^\s*(INNER|LEFT|RIGHT|FULL)?\s*JOIN\b/i, "JOIN"],
    [/^\s*WHERE\b/i, "WHERE"],
    [/^\s*GROUP BY\b/i, "GROUP BY"],
    [/^\s*HAVING\b/i, "HAVING"],
    [/^\s*ORDER BY\b/i, "ORDER BY"],
    [/^\s*UNION(\s+ALL)?\b/i, "UNION"],
    [/^\s*INSERT\b/i, "INSERT"],
    [/^\s*UPDATE\b/i, "UPDATE"],
    [/^\s*DELETE\b/i, "DELETE"],
    [/^\s*MERGE\b/i, "MERGE"],
    [/^\s*BEGIN\b/i, "BEGIN"],
    [/^\s*END\b/i, "END"],
  ]

  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const t = lines[i].trim()
    if (!t) { boundaries.add(n); continue }
    for (const [re, label] of clauseRules) {
      if (re.test(t)) { boundaries.add(n); if (!labelByLine.has(n)) labelByLine.set(n, label); break }
    }
  }

  const pushBlock = (start: number, end: number, kind: SqlBlockKind, label: string) => {
    if (end < start) return
    const b: SqlBlock = { kind, start, end, label }
    const idx = blocks.push(b) - 1
    for (let ln = start; ln <= end; ln++) if (!blockIndexByLine.has(ln)) blockIndexByLine.set(ln, idx)
  }

  // WITH (CTE bodies)
  const withRE = /^\s*WITH\b/i
  const asOpenRE = /\bAS\s*\(\s*$/i
  let inWith = false
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const t = lines[i].trim()
    if (withRE.test(t)) inWith = true
    if (inWith && asOpenRE.test(t)) {
      const startLine = n + 1
      let depth = 1, j = i + 1
      while (j < lines.length && depth > 0) {
        const L = lines[j]
        depth += (L.match(/\(/g) || []).length
        depth -= (L.match(/\)/g) || []).length
        j++
      }
      const endLine = Math.max(startLine, j)
      pushBlock(startLine, endLine, "CTE", "CTE")
    }
    if (inWith && /^\s*SELECT\b/i.test(t)) inWith = false
  }

  // Subqueries: track parentheses that include SELECT
  type StackItem = { openLine: number; isSubquery: boolean }
  const stack: StackItem[] = []
  for (let i = 0; i < lines.length; i++) {
    const n = i + 1
    const line = lines[i]
    for (const ch of line) {
      if (ch === "(") stack.push({ openLine: n, isSubquery: false })
      else if (ch === ")") {
        const itm = stack.pop()
        if (itm && itm.isSubquery) pushBlock(itm.openLine, n, "SUBQUERY", "SUBQUERY")
      }
    }
    if (/\bSELECT\b/i.test(line) && stack.length > 0) {
      const top = stack[stack.length - 1]
      if (top && !top.isSubquery) top.isSubquery = true
    }
    // PL/SQL BEGIN…END
    if (/^\s*BEGIN\b/i.test(line)) {
      let j = i + 1, opens = 1
      while (j < lines.length && opens > 0) {
        if (/^\s*BEGIN\b/i.test(lines[j])) opens++
        if (/^\s*END\b/i.test(lines[j])) opens--
        j++
      }
      const endLine = Math.max(n, j)
      pushBlock(n, endLine, "PLSQL", "BEGIN…END")
    }
  }

  // Clause blocks as a fallback (covers plain SELECTs)
  labelByLine.forEach((lab, ln) => {
    const next = [...labelByLine.keys()].filter(k => k > ln).sort((a,b)=>a-b)[0] ?? lines.length + 1
    pushBlock(ln, next - 1, "CLAUSE", lab)
  })

  return { boundaries, labelByLine, blocks, blockIndexByLine }
}

function blockOf(struct: SqlStructure, line: number): SqlBlock | undefined {
  const idx = struct.blockIndexByLine.get(line)
  return typeof idx === "number" ? struct.blocks[idx] : undefined
}

function smartGroup(
  items: ChangeItem[],
  structNew: SqlStructure,
  structOld: SqlStructure,
  minRun = GROUP_THRESHOLD,
  maxBlock = MAX_GROUP_LINES,
  gapJoin = GAP_JOIN
): ChangeItem[] {
  if (items.length === 0) return items

  const grouped: ChangeItem[] = []
  let i = 0

  while (i < items.length) {
    // Grow a run of same-side, contiguous (allowing tiny gaps) changes
    const base = items[i]
    let end = i
    while (
      end + 1 < items.length &&
      items[end + 1].type === base.type &&
      items[end + 1].side === base.side &&
      items[end + 1].lineNumber <= items[end].lineNumber + 1 + gapJoin
    ) end++

    const runStart = items[i].lineNumber
    const runEnd = items[end].lineNumber
    const runLen = end - i + 1
    const struct = base.side === "old" ? structOld : structNew

    // If long enough, try to align to a dominant block (CTE/subquery/PLSQL/CLAUSE)
    if (runLen >= minRun) {
      // Find the block that covers ≥60% of this run
      const counts = new Map<number, number>()
      for (let k = i; k <= end; k++) {
        const b = blockOf(struct, items[k].lineNumber)
        if (!b) continue
        const idx = struct.blocks.indexOf(b)
        counts.set(idx, (counts.get(idx) ?? 0) + 1)
      }
      let bestIdx = -1, best = 0
      counts.forEach((v, key) => { if (v > best) { best = v; bestIdx = key } })

      const dominant = bestIdx >= 0 && best >= Math.ceil(runLen * 0.6) ? struct.blocks[bestIdx] : undefined

      const pushSpan = (a: number, b: number, labelHint?: string) => {
        const spanLen = Math.max(1, b - a + 1)
        const label = labelHint ?? (blockOf(struct, a)?.label || "")
        const where = label ? ` (${label} block)` : ""
        const preview = tokenFromDescription(items[i].description)
        const desc =
          base.type === "addition"
            ? `Lines ${a}-${b}${where}: added ${spanLen} lines. Preview "${preview}"`
            : base.type === "deletion"
            ? `Lines ${a}-${b}${where}: removed ${spanLen} lines. Preview "${preview}"`
            : `Lines ${a}-${b}${where}: modified ${spanLen} lines. Preview "${preview}"`
        grouped.push({ type: base.type, description: desc, lineNumber: a, side: base.side, span: spanLen, range: [a,b] })
      }

      if (dominant) {
        // Emit chunks of the dominant block up to maxBlock lines each
        let a = dominant.start
        let b = Math.min(dominant.end, a + maxBlock - 1)
        while (a <= dominant.end) {
          pushSpan(a, b, dominant.label)
          a = b + 1
          b = Math.min(dominant.end, a + maxBlock - 1)
        }
        i = end + 1
        continue
      }

      // Otherwise align to clause boundaries inside the run
      let segStart = runStart
      for (let n = runStart + 1; n <= runEnd; n++) {
        if (struct.boundaries.has(n)) {
          const segEnd = n - 1
          if (segEnd >= segStart) {
            if (segEnd - segStart + 1 >= minRun) pushSpan(segStart, segEnd)
            else {
              for (let k = segStart; k <= segEnd; k++) grouped.push(items[i + (k - runStart)])
            }
            segStart = n
          }
        }
      }
      if (segStart <= runEnd) {
        if (runEnd - segStart + 1 >= minRun) {
          pushSpan(segStart, runEnd)
        } else {
          for (let k = segStart; k <= runEnd; k++) grouped.push(items[i + (k - runStart)])
        }
      }

      i = end + 1
      continue
    }

    // Short run → keep atomics
    for (let k = i; k <= end; k++) grouped.push(items[k])
    i = end + 1
  }

  return grouped
}

/* ============================================================================
   LLM call (XAI only) + JSON guards
============================================================================ */

function buildUserPayload(oldQuery: string, newQuery: string, changes: ChangeItem[]) {
  const enriched = changes.map((c, i) => ({
    index: i, // batch-local index
    type: c.type,
    side: c.side,
    lineNumber: c.lineNumber,
    description: c.description,
    span: Math.max(1, c.span ?? (c.range ? (c.range[1] - c.range[0] + 1) : 1)),
  }))

  return {
    task: "Explain each SQL change for a junior developer. Be precise and concise.",
    guidance: [
      "Return ONLY JSON with key 'explanations' (array). No prose outside JSON.",
      "For each item: include the exact 'index' you were given.",
      "Write 1–2 sentences if span<=2, 3–5 if span<=10, 5–8 otherwise.",
      "Note the affected clauses (subset of SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET, WINDOW).",
      "Set change_kind (filter_narrowed, join_added, aggregation_changed, projection_added, order_changed, limit_added, window_changed, plsql_logic_changed, etc.).",
      "Rate syntax and performance as 'good' or 'bad'. If 'bad', add a one-sentence reason.",
      "business_impact: 'clear' if data semantics obviously change; 'weak' if unsure; else 'none'.",
      "risk: low/medium/high.",
      "0–2 short suggestions."
    ],
    dialect: "Oracle SQL",
    oldQuery: clip(oldQuery),
    newQuery: clip(newQuery),
    changes: enriched,
    output_schema: {
      explanations: [{
        index: "number",
        text: "string",
        clauses: "array of enums",
        change_kind: "string",
        syntax: "good|bad",
        performance: "good|bad",
        syntax_explanation: "string if syntax='bad'",
        performance_explanation: "string if performance='bad'",
        business_impact: "clear|weak|none",
        risk: "low|medium|high",
        suggestions: "array (0–2)"
      }]
    }
  }
}

// Very defensive JSON parse to avoid "Unexpected token 'A'..." failures
function safeParseLLMJson(raw: string): any | null {
  if (!raw) return null
  let txt = raw.trim()

  // Strip code fences
  txt = txt.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1").trim()

  // Try direct parse
  try { return JSON.parse(txt) } catch {}

  // Extract largest {...} span
  const first = txt.indexOf("{")
  const last = txt.lastIndexOf("}")
  if (first >= 0 && last > first) {
    let core = txt.slice(first, last + 1)

    // Remove trailing commas like ",}"
    core = core.replace(/,\s*([}\]])/g, "$1")

    // Ensure property names are quoted (best-effort)
    core = core.replace(/([{,]\s*)([A-Za-z_][A-Za-z0-9_\-]*)(\s*:)/g, '$1"$2"$3')

    try { return JSON.parse(core) } catch {}
  }
  return null
}

async function callXAIForBatch(systemPrompt: string, userPayload: any, timeoutMs: number) {
  if (!XAI_API_KEY) throw new Error("Missing XAI_API_KEY")
  const base = process.env.XAI_BASE_URL || "https://api.x.ai"

  const body = {
    model: XAI_MODEL,
    temperature: 0.1,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify(userPayload) },
    ],
  }

  const resp = await withRetries(
    () => fetchWithTimeout(`${base}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${XAI_API_KEY}` },
      body: JSON.stringify(body),
    }, timeoutMs),
    RETRIES
  )

  if (!resp.ok) throw new Error(await resp.text())
  const j = await resp.json()
  const text = j?.choices?.[0]?.message?.content?.trim() ?? ""
  return text
}

/* ============================================================================
   Heuristic fallback (when LLM can’t answer in time)
============================================================================ */

function guessClauses(desc: string): string[] {
  const s = desc.toUpperCase()
  const out = new Set<string>()
  if (/\bSELECT\b/.test(s) || /preview/i.test(s)) out.add("SELECT")
  if (/\bFROM\b/.test(s) || /\bJOIN\b/.test(s)) { out.add("FROM"); if (/\bJOIN\b/.test(s)) out.add("JOIN") }
  if (/\bWHERE\b/.test(s)) out.add("WHERE")
  if (/\bGROUP BY\b/.test(s)) out.add("GROUP BY")
  if (/\bHAVING\b/.test(s)) out.add("HAVING")
  if (/\bORDER BY\b/.test(s)) out.add("ORDER BY")
  return Array.from(out)
}

function heuristicExplain(c: ChangeItem): ChangeExplanation {
  const clauses = guessClauses(c.description)
  const span = Math.max(1, c.span ?? (c.range ? c.range[1] - c.range[0] + 1 : 1))
  const where = clauses.length ? ` (${clauses.join(", ")})` : ""
  const basic =
    c.type === "addition" ? "added" :
    c.type === "deletion" ? "removed" : "changed"

  const explanation =
    span <= 2
      ? `This ${basic} line likely adjusts logic${where}. Check for column/alias correctness and side effects.`
      : `This ${basic} block (${span} lines) refactors query logic${where}. Validate join/filter semantics, aggregates, and expected row counts.`

  return {
    index: -1, // filled later
    explanation,
    syntax: "good",
    performance: clauses.includes("WHERE") || clauses.includes("JOIN") ? "good" : "good",
    meta: {
      clauses,
      change_kind:
        clauses.includes("JOIN") ? "join_changed" :
        clauses.includes("WHERE") ? "filter_changed" :
        clauses.includes("GROUP BY") ? "aggregation_changed" :
        "logic_changed",
      business_impact: clauses.length ? "weak" : "none",
      risk: span > 20 ? "medium" : "low",
      suggestions: span > 10 ? ["Add a focused unit test around this block."] : [],
    }
  }
}

/* ============================================================================
   Caching (per unique pair)
============================================================================ */

const cache = new Map<string, any>()
function hashPair(a: string, b: string) {
  let h = 2166136261
  const s = a + "\u0000" + b
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(16)
}

/* ============================================================================
   Route
============================================================================ */

export async function POST(req: Request) {
  const started = Date.now()
const deadline = started + SAFE_BUDGET_MS
const aiDeadline = started + Math.min(MAX_AI_BUDGET_MS, SAFE_BUDGET_MS - 1500)
  try {
    const body = await req.json().catch(() => null)
    try { validateInput(body) } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400, headers: { "Cache-Control": "no-store" } })
    }

    const { oldQuery, newQuery, noAI } = body as { oldQuery: string; newQuery: string; noAI?: boolean }

    const canonOld = canonicalizeSQL(oldQuery)
    const canonNew = canonicalizeSQL(newQuery)

    // cache key
    const key = hashPair(canonOld, canonNew)
    if (cache.has(key)) {
      return NextResponse.json(cache.get(key), { headers: { "Cache-Control": "no-store" } })
    }

    // Diff → raw changes → structure-aware grouping
    const diff = generateQueryDiff(canonOld, canonNew)
    const raw = buildRawChanges(diff)
    const structNew = buildSqlStructure(canonNew)
    const structOld = buildSqlStructure(canonOld)
    const grouped = smartGroup(raw, structNew, structOld)

    if (grouped.length === 0) {
      const payload = {
        analysis: {
          summary: "No substantive changes detected.",
          changes: [],
          recommendations: [],
          riskAssessment: "Low",
          performanceImpact: "Neutral",
        },
        page: { cursor: 0, limit: 0, nextCursor: null, total: 0 },
      }
      cache.set(key, payload)
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
    }

    // Trim to global cap to protect token usage; remaining are still analyzed by heuristic
    const explainTargets = grouped.slice(0, MAX_ITEMS_TO_EXPLAIN)
    const overflowCount = grouped.length - explainTargets.length

    // Prepare batches
    const batches: ChangeItem[][] = []
    for (let i = 0; i < explainTargets.length; i += BATCH_SIZE) {
      batches.push(explainTargets.slice(i, i + BATCH_SIZE))
    }

    const results: ChangeExplanation[] = new Array(grouped.length).fill(null as any)
    let usedModel = false
    let lastModelError: string | undefined

    if (!noAI && XAI_API_KEY && batches.length > 0) {
      const systemPrompt =
        "You are a senior Oracle SQL reviewer. Respond with STRICT JSON ONLY. " +
        "Top-level object with key 'explanations' (array). No preface or commentary."

      for (let b = 0; b < batches.length; b++) {
      if (b >= ANALYZE_MAX_BATCHES) { lastModelError = `Stopped after ${ANALYZE_MAX_BATCHES} batches by config.`; break }
        const now = Date.now()
        const timeLeft = deadline - now
        const aiLeft = aiDeadline - now
       if (timeLeft < 2500 || aiLeft < 1500) { lastModelError = "AI budget exhausted; finishing with heuristics."; break }

        const batch = batches[b]
        const userPayload = buildUserPayload(canonOld, canonNew, batch)

        try {
            const txt = await callXAIForBatch(
            systemPrompt,
            userPayload,
           Math.min(FETCH_TIMEOUT_MS, Math.max(2000, Math.min(timeLeft, aiLeft) - 800)))         
          const parsed = safeParseLLMJson(txt)
          const arr: any[] = Array.isArray(parsed?.explanations) ? parsed.explanations : []

          // Map batch-local indices → global indices
          for (const item of arr) {
            if (typeof item?.index !== "number") continue
            const local = clamp(item.index, 0, batch.length - 1)
            const globalIdx = (b * BATCH_SIZE) + local

            const text = String(item?.text ?? "").trim()
            const syntax = /^(good|bad)$/i.test(item?.syntax) ? (item.syntax.toLowerCase() as GoodBad) : "good"
            const perf = /^(good|bad)$/i.test(item?.performance) ? (item.performance.toLowerCase() as GoodBad) : "good"
            const clauses = Array.isArray(item?.clauses) ? item.clauses.filter(Boolean).slice(0, 8) : []

            results[globalIdx] = {
              index: globalIdx,
              explanation: text || "Model returned an empty explanation.",
              syntax,
              performance: perf,
              meta: {
                clauses,
                change_kind: typeof item?.change_kind === "string" ? item.change_kind : undefined,
                business_impact:
                  item?.business_impact === "clear" || item?.business_impact === "weak" ? item.business_impact : "none",
                risk: item?.risk === "medium" || item?.risk === "high" ? item.risk : "low",
                suggestions: Array.isArray(item?.suggestions) ? item.suggestions.slice(0, 2) : [],
              }
            }
          }
          usedModel = true
        } catch (e: any) {
          lastModelError = safeErrMessage(e)
          // Continue; remaining items will get heuristic explanations
          break
        }
      }
    } else if (!XAI_API_KEY && !noAI) {
      lastModelError = "No XAI_API_KEY configured."
    }

    // Fill in any missing (including overflow) with heuristic explanations
    const allItems: ChangeItem[] = [...grouped]
    for (let i = 0; i < allItems.length; i++) {
      if (!results[i]) {
        const he = heuristicExplain(allItems[i])
        results[i] = { ...he, index: i }
      }
    }

    // Build final change objects in UI-friendly form
    const finalChanges = allItems.map((c, i) => {
      const r = results[i]
      return {
        ...c,
        index: i,
        explanation: r.explanation,
        syntax: r.syntax,
        performance: r.performance,
        meta: r.meta,
      }
    })

    const counts = finalChanges.reduce(
      (acc, c) => { acc[c.type]++; return acc },
      { addition: 0, deletion: 0, modification: 0 }
    )

    const summaryParts = [
      `${finalChanges.length} changes`,
      `${counts.addition} additions`,
      `${counts.modification} modifications`,
      `${counts.deletion} deletions`,
      usedModel ? "with AI explanations" : "heuristic only",
      overflowCount > 0 ? `(+${overflowCount} grouped beyond cap)` : undefined,
    ].filter(Boolean)

    const payload = {
      analysis: {
        summary: summaryParts.join(" — "),
        changes: finalChanges,
        recommendations: [],
        riskAssessment: "Low",
        performanceImpact: "Neutral",
      },
      // keep paging shape for compatibility (not used here)
      page: { cursor: 0, limit: finalChanges.length, nextCursor: null, total: finalChanges.length },
      _debug: {
        usedModel,
        batchesTried: Math.ceil(explainTargets.length / BATCH_SIZE),
        batchSize: BATCH_SIZE,
        timeMs: Date.now() - started,
        timeoutMs: FETCH_TIMEOUT_MS,
        retries: RETRIES,
        model: usedModel ? XAI_MODEL : "none",
        error: lastModelError,
        groupedCount: grouped.length,
        rawCount: raw.length,
      },
    }

    cache.set(key, payload)
    return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
  } catch (err: any) {
    const msg = String(err?.name || "") + ": " + safeErrMessage(err)
    return NextResponse.json({ error: msg }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
