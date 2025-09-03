import { NextResponse } from "next/server"
import { generateQueryDiff, canonicalizeSQL, type ComparisonResult } from "@/lib/query-differ"

type ChangeType = "addition" | "modification" | "deletion"
type Side = "old" | "new" | "both"
type GoodBad = "good" | "bad"

type ChangeItem = {
  type: ChangeType
  description: string
  lineNumber: number
  side: Side
}

type ChangeExplanation = {
  index: number
  explanation: string
  syntax?: GoodBad
  performance?: GoodBad
  // internal optional fields (not required by UI but useful if needed)
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

const DEFAULT_XAI_MODEL = "grok-4"
const DEFAULT_AZURE_API_VERSION = "2024-02-15-preview"
const MAX_QUERY_CHARS = 120_000

// —— Grouping knobs ——
const GROUP_THRESHOLD = Math.max(2, Number(process.env.CHANGE_GROUP_THRESHOLD ?? 2))
const MAX_GROUP_LINES = Math.max(30, Number(process.env.CHANGE_GROUP_MAX_LINES ?? 30)) 

/* --------------------------------- Helpers -------------------------------- */

function tokenFromDescription(desc: string): string {
  const m =
    desc.match(/:\s(?:added|removed|changed.*to)\s"([^"]*)"/i) ??
    desc.match(/"([^"]*)"$/)
  return (m?.[1] ?? "").trim()
}

function shouldSuppressServer(desc: string): boolean {
  const tok = tokenFromDescription(desc)
  if (!tok) return true
  if (/^[(),;]+$/.test(tok)) return true
  if (/^\)$/.test(tok) || /^\($/.test(tok) || /^\)\s*,?$/.test(tok)) return true
  if (/\bAS\s*\($/i.test(tok)) return true
  return false
}

function asGoodBad(v: any): GoodBad | undefined {
  if (typeof v !== "string") return undefined
  const t = v.trim().toLowerCase()
  if (t === "good" || t === "bad") return t
  return undefined
}

// Extract a span (number of lines) from a grouped description, used to scale verbosity.
function spanFromDescription(desc: string): number {
  // matches: "added 7 lines", "removed 15 lines", "modified 3 lines"
  const m = desc.match(/\b(added|removed|modified)\s+(\d+)\s+lines?\b/i)
  if (m) return Math.max(1, Number(m[2]))
  // single-line atomic changes default to 1
  return 1
}

function verbosityForSpan(span: number): "short" | "medium" | "long" {
  if (span <= 2) return "short"       // quick fixes / tiny mods
  if (span <= 10) return "medium"     // small blocks
  return "long"                       // big blocks (procedures/CTEs etc.)
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
        // Optional conditional lines for bad ratings
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
      // Verbosity control
      "Write length according to 'verbosity' per change: short=1–2 sentences, medium=3–5, long=5–8.",
      "Short changes are often quick fixes—keep them concise. Large grouped blocks deserve more depth (e.g., new procedures/CTEs).",

      // Scope & audience
      "Audience is junior-level: use plain language; define jargon briefly the first time (e.g., 'sargable' = index-friendly).",
      "Do not speculate. If business meaning is unclear from names, say so briefly.",

      // What to cover
      "Describe effect on the clauses actually touched: SELECT, FROM, JOIN, WHERE, GROUP BY, HAVING, ORDER BY, LIMIT/OFFSET, WINDOW.",
      "Identify change_kind (e.g., filter_narrowed, filter_broadened, join_changed, join_added, join_removed, aggregation_changed, projection_changed, order_changed, limit_changed, window_changed/window_added, cte_changed, subquery_changed, literal_changed, function_added/function_changed).",

      // Ratings & conditional explanations
      "Provide 'syntax' and 'performance' ratings as 'good' or 'bad'.",
      "If syntax='bad', include a single sentence 'syntax_explanation' describing the issue and how to address it.",
      "If performance='bad', include a single sentence 'performance_explanation' describing the issue and how to address it.",
      "If a rating is 'good', OMIT the corresponding explanation field.",

      // Business impact
      "If names imply business meaning (e.g., invoices/customers/currencies), add 1–2 sentences on business impact; otherwise set business_impact appropriately ('clear','weak','none').",
      "For 'short' items, keep business comments concise.",

      // Output
      "Return JSON only matching the provided schema. No prose outside JSON.",
      "Preserve the provided 'index' exactly."
    ],
    dialect: "Oracle SQL",
    oldQuery,
    newQuery,
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
        suggestions: "array of strings (0–2 items, concise, actionable)"
      }]
    }
  }
}

/* ------------------------------ LLM providers ------------------------------ */

async function explainWithXAI(userPayload: any): Promise<ChangeExplanation[]> {
  const XAI_API_KEY = process.env.XAI_API_KEY
  const XAI_MODEL = process.env.XAI_MODEL || DEFAULT_XAI_MODEL
  const XAI_BASE_URL = process.env.XAI_BASE_URL || "https://api.x.ai"
  if (!XAI_API_KEY) throw new Error("Missing XAI_API_KEY in environment.")

  const resp = await fetch(`${XAI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${XAI_API_KEY}` },
    body: JSON.stringify({
      model: XAI_MODEL,
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "change_explanations",
          strict: true,
          schema: {
            type: "object",
            properties: {
              explanations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "number" },
                    text: { type: "string" },
                    clauses: {
                      type: "array",
                      items: { type: "string", enum: ["SELECT","FROM","JOIN","WHERE","GROUP BY","HAVING","ORDER BY","LIMIT/OFFSET","WINDOW"] },
                      uniqueItems: true
                    },
                    change_kind: { type: "string" },
                    syntax: { type: "string", enum: ["good", "bad"] },
                    performance: { type: "string", enum: ["good", "bad"] },
                    syntax_explanation: { type: "string" },
                    performance_explanation: { type: "string" },
                    business_impact: { type: "string", enum: ["clear","weak","none"] },
                    risk: { type: "string", enum: ["low","medium","high"] },
                    suggestions: {
                      type: "array",
                      items: { type: "string" },
                      maxItems: 2
                    }
                  },
                  required: ["index","text","syntax","performance","business_impact","risk"],
                  additionalProperties: false
                }
              }
            },
            required: ["explanations"],
            additionalProperties: false
          }
        }
      },
      messages: [
        {
          role: "system",
          content: [
            "You are a senior Oracle SQL reviewer for a junior developer audience.",
            "Write length according to each change's 'verbosity' (short=1–2, medium=3–5, long=5–8 sentences).",
            "Return JSON only, matching the schema—no extra keys or prose.",
            "If syntax='bad', include 'syntax_explanation' (1 sentence). If performance='bad', include 'performance_explanation' (1 sentence).",
            "If those ratings are 'good', omit the corresponding explanation fields."
          ].join(" ")
        },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  })

  if (!resp.ok) throw new Error(`xAI API error: ${await resp.text()}`)
  const data = await resp.json()
  const content = data?.choices?.[0]?.message?.content ?? ""
  return coerceExplanations(content)
}

async function explainWithAzure(userPayload: any): Promise<ChangeExplanation[]> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT
  const apiKey = process.env.AZURE_OPENAI_API_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION
  if (!endpoint || !apiKey || !deployment) {
    throw new Error("Missing Azure OpenAI env vars: AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY, AZURE_OPENAI_DEPLOYMENT.")
  }

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`

  let res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": apiKey },
    body: JSON.stringify({
      temperature: 0.1,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "change_explanations",
          strict: true,
          schema: {
            type: "object",
            properties: {
              explanations: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "number" },
                    text: { type: "string" },
                    clauses: {
                      type: "array",
                      items: { type: "string", enum: ["SELECT","FROM","JOIN","WHERE","GROUP BY","HAVING","ORDER BY","LIMIT/OFFSET","WINDOW"] },
                      uniqueItems: true
                    },
                    change_kind: { type: "string" },
                    syntax: { type: "string", enum: ["good", "bad"] },
                    performance: { type: "string", enum: ["good", "bad"] },
                    syntax_explanation: { type: "string" },
                    performance_explanation: { type: "string" },
                    business_impact: { type: "string", enum: ["clear","weak","none"] },
                    risk: { type: "string", enum: ["low","medium","high"] },
                    suggestions: {
                      type: "array",
                      items: { type: "string" },
                      maxItems: 2
                    }
                  },
                  required: ["index","text","syntax","performance","business_impact","risk"],
                  additionalProperties: false
                }
              }
            },
            required: ["explanations"],
            additionalProperties: false
          }
        }
      },
      messages: [
        {
          role: "system",
          content: [
            "You are a senior Oracle SQL reviewer for a junior developer audience.",
            "Write length according to each change's 'verbosity' (short=1–2, medium=3–5, long=5–8 sentences).",
            "Return JSON only, matching the schema—no extra keys or prose.",
            "If syntax='bad', include 'syntax_explanation' (1 sentence). If performance='bad', include 'performance_explanation' (1 sentence).",
            "If those ratings are 'good', omit the corresponding explanation fields."
          ].join(" ")
        },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  })

  if (!res.ok) {
    const firstErr = await res.text()
    // Retry without response_format (some deployments/models may ignore it),
    // but keep strict JSON-only instructions in the system prompt.
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        temperature: 0.1,
        messages: [
          {
            role: "system",
            content: [
              "You are a senior Oracle SQL reviewer for a junior developer audience.",
              "Write length according to each change's 'verbosity' (short=1–2, medium=3–5, long=5–8 sentences).",
              "Return a JSON object with key 'explanations': an array of items with keys:",
              "index:number, text:string, clauses:string[], change_kind:string, syntax:'good'|'bad', performance:'good'|'bad',",
              "syntax_explanation?:string (present only if syntax='bad'), performance_explanation?:string (present only if performance='bad'),",
              "business_impact:'clear'|'weak'|'none', risk:'low'|'medium'|'high', suggestions?:string[] (max 2).",
              "No prose outside JSON."
            ].join(" ")
          },
          { role: "user", content: JSON.stringify(userPayload) },
        ],
      }),
    })
    if (!res.ok) throw new Error(`Azure OpenAI error: ${firstErr} | Retry: ${await res.text()}`)
  }

  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content ?? ""
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

/* ---------------------------- Structural segmentation ---------------------------- */

type Segmenter = {
  boundaries: Set<number>
  labels: Map<number, string>
}

function buildSegmenter(sql: string): Segmenter {
  const boundaries = new Set<number>()
  const labels = new Map<number, string>()
  const lines = sql.split("\n")

  const rules: Array<[RegExp, string]> = [
    [/^\s*(CREATE(\s+OR\s+REPLACE)?\s+)?(PROCEDURE|FUNCTION|TRIGGER|PACKAGE|VIEW|TABLE)\b/i, "CREATE"],
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
    [/^\s*EXCEPTION\b/i, "EXCEPTION"],
    [/^\s*END\b/i, "END"],
    [/^\s*CURSOR\b/i, "CURSOR"],
    [/^\s*(FOR|WHILE)\b.*\bLOOP\b/i, "LOOP"],
    [/^\s*IF\b/i, "IF"],
  ]

  for (let idx = 0; idx < lines.length; idx++) {
    const n = idx + 1
    const t = lines[idx].trim()
    if (t === "") {
      boundaries.add(n)
      continue
    }
    for (const [re, label] of rules) {
      if (re.test(t)) {
        boundaries.add(n)
        if (!labels.has(n)) labels.set(n, label)
        break
      }
    }
  }
  return { boundaries, labels }
}

function findLabelInRange(seg: Segmenter, start: number, end: number): string | undefined {
  for (let n = start; n <= end; n++) {
    const l = seg.labels.get(n)
    if (l) return l
  }
  return undefined
}

/** Smarter grouping using consecutive runs + SQL boundaries. */
function groupChangesSmart(
  items: ChangeItem[],
  segNew: Segmenter,
  segOld: Segmenter,
  threshold = GROUP_THRESHOLD,
  maxBlock = MAX_GROUP_LINES
): ChangeItem[] {
  if (items.length === 0) return items

  const grouped: ChangeItem[] = []
  let i = 0

  while (i < items.length) {
    const start = i
    const base = items[i]
    let end = i

    // grow run while same type+side and consecutive lineNumbers
    while (
      end + 1 < items.length &&
      items[end + 1].type === base.type &&
      items[end + 1].side === base.side &&
      items[end + 1].lineNumber === items[end].lineNumber + 1
    ) {
      end++
    }

    const runLen = end - start + 1
    if (runLen < threshold) {
      // keep atomic items
      for (let k = start; k <= end; k++) grouped.push(items[k])
      i = end + 1
      continue
    }

    // candidate boundaries inside the run
    const seg = base.side === "old" ? segOld : segNew
    const runStart = items[start].lineNumber
    const runEnd = items[end].lineNumber

    const cuts: number[] = []
    for (let n = runStart + 1; n <= runEnd; n++) {
      if (seg.boundaries.has(n)) cuts.push(n)
    }

    // if no natural boundaries, split by window size
    if (cuts.length === 0) {
      let s = runStart
      while (s <= runEnd) {
        const e = Math.min(s + maxBlock - 1, runEnd)
        pushBlock(s, e)
        s = e + 1
      }
      i = end + 1
      continue
    }

    // build segments from boundaries; also enforce maxBlock
    let segStart = runStart
    for (let c = 0; c < cuts.length; c++) {
      const segEndCandidate = cuts[c] - 1
      if (segEndCandidate < segStart) continue

      // while segment too large, carve smaller chunks
      let a = segStart
      while (a <= segEndCandidate) {
        const b = Math.min(a + maxBlock - 1, segEndCandidate)
        if (b - a + 1 >= threshold) pushBlock(a, b)
        else {
          // too tiny: fallback to atomic for this tiny tail
          const tailOffset = a - runStart
          const tailLen = b - a + 1
          for (let off = 0; off < tailLen; off++) grouped.push(items[start + tailOffset + off])
        }
        a = b + 1
      }
      segStart = cuts[c]
    }

    // final tail after last cut
    if (segStart <= runEnd) {
      let a = segStart
      while (a <= runEnd) {
        const b = Math.min(a + maxBlock - 1, runEnd)
        if (b - a + 1 >= threshold) pushBlock(a, b)
        else {
          const tailOffset = a - runStart
          const tailLen = b - a + 1
          for (let off = 0; off < tailLen; off++) grouped.push(items[start + tailOffset + off])
        }
        a = b + 1
      }
    }

    i = end + 1

    function pushBlock(aLine: number, bLine: number) {
      const spanLen = bLine - aLine + 1
      const preview = tokenFromDescription(items[start].description)
      const label = findLabelInRange(seg, aLine, bLine)
      const rangeText = aLine === bLine ? `Line ${aLine}` : `Lines ${aLine}-${bLine}`
      const scope = label ? ` (${label}${label === "BEGIN" && findLabelInRange(seg, bLine, bLine) === "END" ? "…END" : " block"})` : ""
      const desc =
        base.type === "addition"
          ? `${rangeText}${scope}: added ${spanLen} lines. Preview "${preview}"`
          : base.type === "deletion"
          ? `${rangeText}${scope}: removed ${spanLen} lines. Preview "${preview}"`
          : `${rangeText}${scope}: modified ${spanLen} lines in a block. Preview "${preview}"`

      grouped.push({
        type: base.type,
        description: desc,
        lineNumber: aLine,
        side: base.side,
      })
    }
  }

  return grouped
}

/* ----------------------------------- Route ---------------------------------- */

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { oldQuery, newQuery, noAI } = body as { oldQuery: string; newQuery: string; noAI?: boolean }

    if (typeof oldQuery !== "string" || typeof newQuery !== "string") {
      return NextResponse.json({ error: "oldQuery and newQuery are required strings" }, { status: 400 })
    }
    if (oldQuery.length > MAX_QUERY_CHARS || newQuery.length > MAX_QUERY_CHARS) {
      return NextResponse.json(
        { error: `Each query must be ≤ ${MAX_QUERY_CHARS.toLocaleString()} characters.` },
        { status: 413 }
      )
    }

    const canonOld = canonicalizeSQL(oldQuery)
    const canonNew = canonicalizeSQL(newQuery)

    const diff = generateQueryDiff(canonOld, canonNew)
    const rawChanges = buildChanges(diff)

    const segNew = buildSegmenter(canonNew)
    const segOld = buildSegmenter(canonOld)
    const changes = groupChangesSmart(rawChanges, segNew, segOld, GROUP_THRESHOLD, MAX_GROUP_LINES)

    if (changes.length === 0) {
      return NextResponse.json({
        analysis: {
          summary: "No substantive changes detected.",
          changes: [],
          recommendations: [],
          riskAssessment: "Low",
          performanceImpact: "Neutral",
        },
      })
    }

    // Env flag OR per-request flag from client
    const AI_DISABLED = process.env.DISABLE_AI_ANALYSIS === "true" || noAI === true

    let modelExplanations: ChangeExplanation[] = []
    if (!AI_DISABLED) {
      const payload = buildUserPayload(canonOld, canonNew, changes)
      const provider = (process.env.LLM_PROVIDER || "xai").toLowerCase()
      if (provider === "azure") modelExplanations = await explainWithAzure(payload)
      else modelExplanations = await explainWithXAI(payload)
    }

    const expMap = new Map<number, ChangeExplanation>()
    modelExplanations.forEach((e) => {
      if (typeof e.index === "number" && (e.explanation && e.explanation.length > 0)) expMap.set(e.index, e)
    })

    const finalChanges = changes.map((c, idx) => {
      const m = expMap.get(idx) as ChangeExplanation | undefined
      let explanation =
        m?.explanation ||
        (AI_DISABLED
          ? "AI analysis is currently disabled, Dev testing in progress."
          : "This change adjusts the SQL, but details couldn’t be inferred confidently. Review surrounding context to confirm impact.")

      const extra: string[] = []
      if ((m as any)?._syntax_explanation && m?.syntax === "bad") extra.push(`Syntax: ${(m as any)._syntax_explanation}`)
      if ((m as any)?._performance_explanation && m?.performance === "bad")
        extra.push(`Performance: ${(m as any)._performance_explanation}`)
      if (extra.length) explanation = `${explanation} ${extra.join(" ")}`

      return {
        ...c,
        explanation,
        syntax: m?.syntax ?? "good",
        performance: m?.performance ?? "good",
        meta: m
          ? {
              clauses: (m as any)._clauses ?? [],
              change_kind: (m as any)._change_kind,
              business_impact: (m as any)._business_impact ?? "none",
              risk: (m as any)._risk ?? "low",
              suggestions: (m as any)._suggestions ?? [],
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

    return NextResponse.json({
      analysis: {
        summary,
        changes: finalChanges,
        recommendations: [],
        riskAssessment: "Low",
        performanceImpact: "Neutral",
      },
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 })
  }
}
