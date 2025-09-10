import { NextResponse } from "next/server"
import { generateQueryDiff, canonicalizeSQL, type ComparisonResult } from "@/lib/query-differ"

/* ============================== Types & Config ============================== */

type ChangeType = "addition" | "modification" | "deletion"
type Side = "old" | "new" | "both"
type GoodBad = "good" | "bad"

type ChangeItem = {
  type: ChangeType
  description: string
  lineNumber: number
  side: Side
  span?: number
  jumpLine?: number
}

type ChangeExplanation = {
  index: number
  explanation: string
  syntax?: GoodBad
  performance?: GoodBad
  // optional diagnostics (not required by UI)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _syntax_explanation?: string
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _performance_explanation?: string
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _clauses?: string[]
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _change_kind?: string
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _business_impact?: "clear" | "weak" | "none"
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _risk?: "low" | "medium" | "high"
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _suggestions?: string[]
}

const DEFAULT_XAI_MODEL = process.env.XAI_MODEL || "grok-4"
const MAX_QUERY_CHARS = 120_000

// —— Grouping knobs (server defaults; can be overridden by request headers safely) ——
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const GROUP_THRESHOLD = Math.max(2, Number(process.env.CHANGE_GROUP_THRESHOLD ?? 2))
const MAX_GROUP_LINES = Math.max(30, Number(process.env.CHANGE_GROUP_MAX_LINES ?? 30))

// —— Networking knobs ——
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const FETCH_TIMEOUT_MS = Math.max(8_000, Number(process.env.FETCH_TIMEOUT_MS ?? 12_000))
const RETRIES = Math.min(2, Number(process.env.LLM_RETRIES ?? 1))

// —— Model budget knobs ——
// eslint-disable-next-line @typescript-eslint/no-non-null-assertion
const MAX_ITEMS_TO_EXPLAIN = Math.max(60, Number(process.env.MAX_ITEMS_TO_EXPLAIN ?? 80))
const ANALYSIS_MODEL_CLIP_BYTES = Math.max(8_000, Number(process.env.ANALYSIS_MODEL_CLIP_BYTES ?? 12_000))

/* ============================== Small Utilities ============================= */

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

function groupingFromHeaders(req: Request) {
  const h = new Headers(req.headers)
  const thr = Number(h.get("x-group-threshold") ?? GROUP_THRESHOLD)
  const max = Number(h.get("x-group-max-lines") ?? MAX_GROUP_LINES)
  return {
    threshold: clamp(isFinite(thr) ? thr : GROUP_THRESHOLD, 2, 50),
    maxLines: clamp(isFinite(max) ? max : MAX_GROUP_LINES, 20, 200),
  }
}

function safeErrMessage(e: any, fallback = "Unexpected error") {
  const raw = typeof e?.message === "string" ? e.message : fallback
  return raw
    .replace(/(Bearer\s+)[\w\.\-]+/gi, "$1[REDACTED]")
    .replace(/(api-key\s*:\s*)\w+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]")
}

/* -------------------------- Fetch timeout & retry --------------------------- */

async function fetchJSONWithTimeout(url: string, init: RequestInit, timeoutMs = FETCH_TIMEOUT_MS) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ac.signal })
    return res
  } finally {
    clearTimeout(t)
  }
}

async function withRetry<T>(fn: () => Promise<T>, retries = RETRIES): Promise<T> {
  let lastErr: any
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn()
    } catch (e) {
      lastErr = e
      await new Promise((r) => setTimeout(r, 300 * (i + 1)))
    }
  }
  throw lastErr
}

/* --------------------------------- Helpers -------------------------------- */

function tokenFromDescription(desc: string): string {
  const m =
    desc.match(/:\s(?:added|removed|changed.*to)\s"([^"]*)"/i) ?? desc.match(/"([^"]*)"$/)
  return (m?.[1] ?? "").trim()
}

function shouldSuppressServer(desc: string): boolean {
  const tok = tokenFromDescription(desc)
  if (!tok) return true
  if (/^[(),;]+$/.test(tok)) return true
  if (/^\)$/.test(tok) || /^\($/.test(tok) || /^\)\s*,?$/.test(tok)) return true
  if (/\bAS\s*\($/i.test(tok)) return true
  if (/^"(?:\w+)"$/.test(tok)) return true
  if (/^\bON\b\s*$/i.test(tok)) return true
  return false
}

function asGoodBad(v: any): GoodBad | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim().toLowerCase()
  if (t === "good" || t === "bad") return t
  return undefined
}

function spanFromDescription(desc: string): number {
  const m = desc.match(/\b(added|removed|modified)\s+(\d+)\s+lines?\b/i)
  if (m) return Math.max(1, Number(m[2]))
  return 1
}

function verbosityForSpan(span: number): "short" | "medium" | "long" {
  if (span <= 2) return "short"
  if (span <= 10) return "medium"
  return "long"
}

function coerceExplanations(content: string): ChangeExplanation[] {
  try {
    const parsed = JSON.parse(content)
    const out = (parsed?.explanations || []) as any[]
    return out
      .filter((x) => typeof x?.index === "number" && (typeof x?.text === "string" || typeof x?.explanation === "string"))
      .map((x) => {
        const explanation = String((x.text ?? x.explanation) || "").trim()
        const item: ChangeExplanation = {
          index: x.index,
          explanation,
          syntax: asGoodBad(x.syntax),
          performance: asGoodBad(x.performance),
        }
        if (typeof x.syntax_explanation === "string") (item as any)._syntax_explanation = x.syntax_explanation.trim()
        if (typeof x.performance_explanation === "string") (item as any)._performance_explanation = x.performance_explanation.trim()
        if (Array.isArray(x.clauses)) (item as any)._clauses = x.clauses
        if (typeof x.change_kind === "string") (item as any)._change_kind = x.change_kind
        if (typeof x.business_impact === "string") (item as any)._business_impact = x.business_impact
        if (typeof x.risk === "string") (item as any)._risk = x.risk
        if (Array.isArray(x.suggestions)) (item as any)._suggestions = x.suggestions
        return item
      })
  } catch {
    return []
  }
}

function clipSqlForModel(sql: string, budget = ANALYSIS_MODEL_CLIP_BYTES): string {
  const raw = (sql || "").replace(/\r/g, "")
  if (raw.length <= budget) return raw
  const head = raw.slice(0, Math.floor(budget * 0.6))
  const tail = raw.slice(-Math.floor(budget * 0.35))
  return `${head}\n/* ...clipped for model... */\n${tail}`
}

function buildUserPayload(oldQuery: string, newQuery: string, changes: ChangeItem[]) {
  const enriched = changes.map((c, i) => {
    const span = spanFromDescription(c.description)
    const verbosity = verbosityForSpan(span)
    return {
      index: i,
      type: c.type,
      side: c.side,
      lineNumber: c.lineNumber,
      description: c.description,
      span,
      verbosity, // short | medium | long
    }
  })

  return {
    task: "Explain each change so a junior developer understands what changed and why it matters.",
    guidance: [
      "Write length according to 'verbosity' per change: short=1–2 sentences, medium=3–5, long=5–8.",
      "Short changes are quick fixes; large grouped blocks (CTEs/subqueries/procedures) deserve more depth.",
      "Audience is junior-level: use plain language; define jargon briefly (e.g., 'sargable' = index-friendly).",
      "Do not speculate beyond names.",
      "Describe effects on touched clauses: SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET, WINDOW.",
      "Identify change_kind (filter_narrowed, join_added, aggregation_changed, etc.).",
      "Provide 'syntax' and 'performance' ratings as 'good' or 'bad'. If 'bad', include one-sentence *_explanation.",
      "Add brief business impact if implied by names; else mark as 'weak' or 'none'.",
      "Return JSON only matching the schema. No prose outside JSON.",
      "Preserve the provided 'index' exactly."
    ],
    dialect: "Oracle SQL",
    oldQuery: clipSqlForModel(oldQuery),
    newQuery: clipSqlForModel(newQuery),
    changes: enriched,
    output_schema: {
      explanations: [{
        index: "number (echo input index)",
        text: "string (1–8 sentences based on 'verbosity')",
        clauses: "array of enums subset of ['SELECT','FROM','JOIN','WHERE','GROUP BY','HAVING','ORDER BY','LIMIT/OFFSET','WINDOW']",
        change_kind: "string enum describing type",
        syntax: "enum: ['good','bad']",
        performance: "enum: ['good','bad']",
        syntax_explanation: "string (present only if syntax='bad', 1 sentence)",
        performance_explanation: "string (present only if performance='bad', 1 sentence)",
        business_impact: "enum: ['clear','weak','none']",
        risk: "enum: ['low','medium','high']",
        suggestions: "array of strings (0–2 items)"
      }]
    }
  }
}

/* ------------------------------ LLM provider (xAI only) ------------------------------ */

async function explainWithXAI(userPayload: any): Promise<ChangeExplanation[]> {
  const XAI_API_KEY = process.env.XAI_API_KEY
  const XAI_MODEL = process.env.XAI_MODEL || DEFAULT_XAI_MODEL
  const XAI_BASE_URL = process.env.XAI_BASE_URL || "https://api.x.ai"
  if (!XAI_API_KEY) throw new Error("Missing XAI_API_KEY in environment.")

  const resp = await withRetry(() =>
    fetchJSONWithTimeout(`${XAI_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${XAI_API_KEY}` },
      body: JSON.stringify({
        model: XAI_MODEL,
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              "You are a senior Oracle SQL reviewer for a junior developer audience.",
              "Return ONLY JSON with a top-level key 'explanations' (array). No prose outside JSON.",
              "For each item include: index, text, clauses (subset of ['SELECT','FROM','JOIN','WHERE','GROUP BY','HAVING','ORDER BY','LIMIT/OFFSET','WINDOW']),",
              "change_kind, syntax ('good'|'bad'), performance ('good'|'bad'),",
              "syntax_explanation if syntax='bad', performance_explanation if performance='bad',",
              "business_impact ('clear'|'weak'|'none'), risk ('low'|'medium'|'high'), suggestions (0–2)."
            ].join(" ")
          },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      }),
    })
  )

  if (!resp.ok) throw new Error(`xAI API error (${resp.status})`)
  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content ?? ""
  return coerceExplanations(content)
}

/* --------------------------- Diff → atomic changes -------------------------- */

function buildChanges(diff: ComparisonResult): ChangeItem[] {
  const out: ChangeItem[] = []
  for (let i = 0; i < diff.diffs.length; i++) {
    const d = diff.diffs[i]

    if (d.type === "deletion" && d.oldLineNumber) {
      const next = diff.diffs[i + 1]
      if (next && next.type === "addition" && next.newLineNumber) {
        const desc = `Line ${next.newLineNumber}: changed from "${d.content.trim()}" to "${next.content.trim()}"`
        if (!shouldSuppressServer(desc)) {
          out.push({ type: "modification", description: desc, lineNumber: next.newLineNumber, side: "both" })
        }
        i++
      } else {
        const desc = `Line ${d.oldLineNumber}: removed "${d.content.trim()}"`
        if (!shouldSuppressServer(desc)) {
          out.push({ type: "deletion", description: desc, lineNumber: d.oldLineNumber, side: "old" })
        }
      }
    } else if (d.type === "addition" && d.newLineNumber) {
      const prev = diff.diffs[i - 1]
      if (!(prev && prev.type === "deletion")) {
        const desc = `Line ${d.newLineNumber}: added "${d.content.trim()}"`
        if (!shouldSuppressServer(desc)) {
          out.push({ type: "addition", description: desc, lineNumber: d.newLineNumber, side: "new" })
        }
      }
    }
  }

  out.sort((a, b) => a.lineNumber - b.lineNumber)
  return out
}

/* --------------------- Subquery/CTE-aware structural analysis --------------------- */

type SqlBlockKind = "CTE" | "SUBQUERY" | "BEGIN_END" | "CLAUSE"
type SqlBlock = { kind: SqlBlockKind; start: number; end: number; label: string }

type SqlStructure = {
  boundaries: Set<number>
  labels: Map<number, string>
  blocks: SqlBlock[]
  byLine: Map<number, number> // line → block index
}

function buildSqlStructure(sql: string): SqlStructure {
  const lines = sql.split("\n")
  const boundaries = new Set<number>()
  const labels = new Map<number, string>()
  const blocks: SqlBlock[] = []
  const byLine = new Map<number, number>()

  // Clause boundaries
  const clauseRules: Array<[RegExp, string]> = [
    [/^\s*(CREATE(\s+OR\s+REPLACE)?\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE|VIEW|TABLE)\b/i, "CREATE"],
    [/^\s*WITH\b/i, "WITH"],
    [/^\s*SELECT\b/i, "SELECT"],
    [/^\s*FROM\b/i, "FROM"],
    [/^\s*(INNER|LEFT|RIGHT|FULL)?\s*JOIN\b/i, "JOIN"],
    [/^\s*WHERE\b/i, "WHERE"],
    [/^\s*CONNECT\s+BY\b/i, "CONNECT BY"],
    [/^\s*START\s+WITH\b/i, "START WITH"],
    [/^\s*GROUP BY\b/i, "GROUP BY"],
    [/^\s*HAVING\b/i, "HAVING"],
    [/^\s*MODEL\b/i, "MODEL"],
    [/^\s*ORDER BY\b/i, "ORDER BY"],
    [/^\s*UNION(\s+ALL)?\b/i, "UNION"],
    [/^\s*INSERT\b/i, "INSERT"],
    [/^\s*UPDATE\b/i, "UPDATE"],
    [/^\s*DELETE\b/i, "DELETE"],
    [/^\s*MERGE\b/i, "MERGE"],
    [/^\s*BEGIN\b/i, "BEGIN"],
    [/^\s*EXCEPTION\b/i, "EXCEPTION"],
    [/^\s*END\b/i, "END"],
    [/^\s*CURSOR\b/i, "CURSOR"],
    [/^\s*(FOR|WHILE)\b.*\bLOOP\b/i, "LOOP"],
    [/^\s*IF\b/i, "IF"],
  ]

  for (let idx = 0; idx < lines.length; idx++) {
    const n = idx + 1
    const t = lines[idx].trim()
    if (!t) { boundaries.add(n); continue }
    for (const [re, label] of clauseRules) {
      if (re.test(t)) { boundaries.add(n); if (!labels.has(n)) labels.set(n, label); break }
    }
  }

  const pushBlock = (start: number, end: number, kind: SqlBlockKind, label: string) => {
    if (end < start) return
    const b: SqlBlock = { kind, start, end, label }
    const idx = blocks.push(b) - 1
    for (let ln = start; ln <= end; ln++) if (!byLine.has(ln)) byLine.set(ln, idx)
  }

  // WITH .. AS ( ... )
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

  // Subqueries: '(' ... SELECT ... ')'
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

    // BEGIN..END (PL/SQL)
    if (/^\s*BEGIN\b/i.test(line)) {
      let j = i + 1, opens = 1
      while (j < lines.length && opens > 0) {
        if (/^\s*BEGIN\b/i.test(lines[j])) opens++
        if (/^\s*END\b/i.test(lines[j])) opens--
        j++
      }
      const endLine = Math.max(n, j)
      pushBlock(n, endLine, "BEGIN_END", "BEGIN…END")
    }
  }

  // Clause blocks (fallback grouping)
  labels.forEach((lab, ln) => {
    const next = [...labels.keys()].filter(k => k > ln).sort((a,b)=>a-b)[0] ?? lines.length + 1
    pushBlock(ln, next - 1, "CLAUSE", lab)
  })

  return { boundaries, labels, blocks, byLine }
}

function blockContaining(struct: SqlStructure, line: number): SqlBlock | undefined {
  const idx = struct.byLine.get(line)
  return typeof idx === "number" ? struct.blocks[idx] : undefined
}

function findLabelInRange(struct: SqlStructure, start: number, end: number): string | undefined {
  const b = blockContaining(struct, start)
  if (b && start >= b.start && end <= b.end) return b.label
  for (let n = start; n <= end; n++) {
    const l = struct.labels.get(n)
    if (l) return l
  }
  return undefined
}

/** Grouping that understands subqueries/CTEs/blocks. */
function groupChangesSmart(
  items: ChangeItem[],
  structNew: SqlStructure,
  structOld: SqlStructure,
  threshold = GROUP_THRESHOLD,
  maxBlock = MAX_GROUP_LINES
): ChangeItem[] {
  if (items.length === 0) return items

  const grouped: ChangeItem[] = []
  let i = 0

  while (i < items.length) {
    const base = items[i]
    let end = i

    while (
      end + 1 < items.length &&
      items[end + 1].type === base.type &&
      items[end + 1].side === base.side &&
      items[end + 1].lineNumber === items[end].lineNumber + 1
    ) end++

    const runStart = items[i].lineNumber
    const runEnd = items[end].lineNumber
    const runLen = end - i + 1

    const struct = base.side === "old" ? structOld : structNew

    const majorityBlock = (() => {
      const counts = new Map<number, number>()
      for (let k = i; k <= end; k++) {
        const b = blockContaining(struct, items[k].lineNumber)
        if (!b) continue
        const idx = struct.blocks.indexOf(b)
        counts.set(idx, (counts.get(idx) ?? 0) + 1)
      }
      let bestIdx = -1, best = 0
      counts.forEach((v, key) => { if (v > best) { best = v; bestIdx = key } })
      return bestIdx >= 0 && best >= Math.ceil(runLen * 0.6) ? struct.blocks[bestIdx] : undefined
    })()

    const pushBlock = (aLine: number, bLine: number, labelHint?: string) => {
      const spanLen = bLine - aLine + 1
      const preview = tokenFromDescription(items[i].description)
      const label = labelHint ?? findLabelInRange(struct, aLine, bLine)
      const rangeText = aLine === bLine ? `Line ${aLine}` : `Lines ${aLine}-${bLine}`
      const scope = label ? ` (${label} block)` : ""
      const desc =
        base.type === "addition"
          ? `${rangeText}${scope}: added ${spanLen} lines. Preview "${preview}"`
          : base.type === "deletion"
          ? `${rangeText}${scope}: removed ${spanLen} lines. Preview "${preview}"`
          : `${rangeText}${scope}: modified ${spanLen} lines. Preview "${preview}"`

      grouped.push({ type: base.type, description: desc, lineNumber: aLine, side: base.side, span: spanLen })
    }

    if (majorityBlock && runLen >= threshold) {
      let a = majorityBlock.start
      let b = Math.min(majorityBlock.end, a + maxBlock - 1)
      while (a <= majorityBlock.end) {
        pushBlock(a, b, majorityBlock.label)
        a = b + 1
        b = Math.min(majorityBlock.end, a + maxBlock - 1)
      }
      i = end + 1
      continue
    }

    if (runLen >= threshold) {
      let segStart = runStart
      for (let n = runStart + 1; n <= runEnd; n++) {
        if (struct.boundaries.has(n)) {
          const segEnd = n - 1
          if (segEnd >= segStart) {
            if (segEnd - segStart + 1 >= threshold) pushBlock(segStart, segEnd)
            else {
              const off0 = segStart - runStart
              for (let k = 0; k < (segEnd - segStart + 1); k++) grouped.push(items[i + off0 + k])
            }
            segStart = n
          }
        }
      }
      if (segStart <= runEnd) {
        if (runEnd - segStart + 1 >= threshold) pushBlock(segStart, runEnd)
        else {
          const off0 = segStart - runStart
          for (let k = 0; k < (runEnd - segStart + 1); k++) grouped.push(items[i + off0 + k])
        }
      }
      i = end + 1
      continue
    }

    for (let k = i; k <= end; k++) grouped.push(items[k])
    i = end + 1
  }

  return grouped
}

/* =============================== In-memory cache =============================== */

const cache = new Map<string, any>()
function hashPair(a: string, b: string) {
  // tiny FNV-ish hash (demo-grade)
  let h = 2166136261
  const s = a + "\u0000" + b
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return (h >>> 0).toString(16)
}

/* ----------------------------------- Route ---------------------------------- */

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    try {
      validateInput(body)
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400, headers: { "Cache-Control": "no-store" } })
    }
    const { oldQuery, newQuery, noAI } = body as { oldQuery: string; newQuery: string; noAI?: boolean }

    const canonOld = canonicalizeSQL(oldQuery)
    const canonNew = canonicalizeSQL(newQuery)

    // cache hit?
    const cacheKey = hashPair(canonOld, canonNew)
    if (cache.has(cacheKey)) {
      return NextResponse.json(cache.get(cacheKey), { headers: { "Cache-Control": "no-store" } })
    }

    const diff = generateQueryDiff(canonOld, canonNew)
    const rawChanges = buildChanges(diff)

    const structNew = buildSqlStructure(canonNew)
    const structOld = buildSqlStructure(canonOld)

    const { threshold, maxLines } = groupingFromHeaders(req)
    const grouped = groupChangesSmart(rawChanges, structNew, structOld, threshold, maxLines)

    if (grouped.length === 0) {
      const payload = {
        analysis: {
          summary: "No substantive changes detected.",
          changes: [],
          recommendations: [],
          riskAssessment: "Low",
          performanceImpact: "Neutral",
        },
      }
      cache.set(cacheKey, payload)
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } })
    }

    // Cap model payload deterministically
    const sorted = [...grouped].sort((a, b) => a.lineNumber - b.lineNumber)
    const head = sorted.slice(0, MAX_ITEMS_TO_EXPLAIN)
    const tailCount = Math.max(0, sorted.length - head.length)
    const explainTargets: ChangeItem[] =
      tailCount > 0
        ? [
            ...head,
            {
              type: "modification",
              description: `+${tailCount} additional changes (collapsed)`,
              lineNumber: head.at(-1)!.lineNumber + 1,
              side: "new",
            },
          ]
        : head

    // ======== xAI only (no Azure fallback) ========
    const AI_ENABLED = noAI !== true
    let modelExplanations: ChangeExplanation[] = []
    let modelError: string | null = null

    if (AI_ENABLED) {
      const payload = buildUserPayload(canonOld, canonNew, explainTargets)
      try {
        modelExplanations = await explainWithXAI(payload)
      } catch (e: any) {
        modelError = safeErrMessage(e)
        modelExplanations = []
      }
    }

    const expMap = new Map<number, ChangeExplanation>()
    modelExplanations.forEach((e) => {
      if (typeof e.index === "number" && (e.explanation && e.explanation.length > 0)) expMap.set(e.index, e)
    })

    const finalChanges = explainTargets.map((c, idx) => {
      const m = expMap.get(idx)
      let explanation: string

      if (m?.explanation?.trim()) {
        explanation = m.explanation.trim()
      } else if (!AI_ENABLED) {
        explanation = "AI analysis is disabled for this run (noAI=true)."
      } else if (modelError) {
        explanation = `AI analysis temporarily unavailable: ${modelError}`
      } else {
        explanation = "No AI explanation was produced."
      }

      const extras: string[] = []
      if (m?.syntax === "bad" && (m as any)._syntax_explanation) extras.push(`Syntax: ${(m as any)._syntax_explanation}`)
      if (m?.performance === "bad" && (m as any)._performance_explanation)
        extras.push(`Performance: ${(m as any)._performance_explanation}`)
      if (extras.length) explanation += ` ${extras.join(" ")}`

      return {
        ...c,
        explanation,
        syntax: (m?.syntax === "bad" ? "bad" : "good") as GoodBad,
        performance: (m?.performance === "bad" ? "bad" : "good") as GoodBad,
        meta: m
          ? {
              clauses: Array.isArray((m as any)._clauses) ? (m as any)._clauses : [],
              change_kind: typeof (m as any)._change_kind === "string" ? (m as any)._change_kind : undefined,
              business_impact:
                (m as any)._business_impact === "clear" || (m as any)._business_impact === "weak"
                  ? (m as any)._business_impact
                  : "none",
              risk: (m as any)._risk === "medium" || (m as any)._risk === "high" ? (m as any)._risk : "low",
              suggestions: Array.isArray((m as any)._suggestions) ? (m as any)._suggestions.slice(0, 2) : [],
            }
          : undefined,
      }
    })

    const counts = finalChanges.reduce(
      (acc, c) => {
        acc[c.type]++
        return acc
      },
      { addition: 0, deletion: 0, modification: 0 } as Record<"addition" | "deletion" | "modification", number>
    )

    const summary = `Detected ${finalChanges.length} substantive changes — ${counts.addition} additions, ${counts.modification} modifications, ${counts.deletion} deletions.`

    const responsePayload = {
      analysis: {
        summary,
        changes: finalChanges,
        recommendations: [],
        riskAssessment: "Low",
        performanceImpact: "Neutral",
      },
      ...(process.env.NODE_ENV !== "production" && {
        _debug: {
          provider: "xai",
          usedExplanations: modelExplanations.length,
          modelError,
        },
      }),
    }

    cache.set(cacheKey, responsePayload)
    return NextResponse.json(responsePayload, { headers: { "Cache-Control": "no-store" } })
  } catch (err: any) {
    return NextResponse.json({ error: safeErrMessage(err) }, { status: 500, headers: { "Cache-Control": "no-store" } })
  }
}
