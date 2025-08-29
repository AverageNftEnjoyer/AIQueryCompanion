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
}

const DEFAULT_XAI_MODEL = "grok-4"
const DEFAULT_AZURE_API_VERSION = "2024-02-15-preview"
const MAX_QUERY_CHARS = 120_000

// —— Grouping knobs ——
const GROUP_THRESHOLD = Math.max(2, Number(process.env.CHANGE_GROUP_THRESHOLD ?? 3)) // 3+ lines => consider a group
const MAX_GROUP_LINES = Math.max(10, Number(process.env.CHANGE_GROUP_MAX_LINES ?? 60)) // hard cap per block

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

function coerceExplanations(content: string): ChangeExplanation[] {
  try {
    const parsed = JSON.parse(content)
    const out = (parsed?.explanations || []) as any[]
    return out
      .filter((x) => typeof x?.index === "number" && typeof x?.explanation === "string")
      .map((x) => ({
        index: x.index,
        explanation: String(x.explanation).trim(),
        syntax: asGoodBad(x.syntax),
        performance: asGoodBad(x.performance),
      }))
  } catch {
    return []
  }
}

function buildUserPayload(oldQuery: string, newQuery: string, changes: ChangeItem[]) {
  return {
    task:
      "For EACH change, write an original explanation (3–5 sentences) focused on SQL semantics AND business impact when inferable.",
    guidance: [
      "Explain how the change affects filters, joins, projections, grouping/HAVING, ORDER BY, limits, or window functions.",
      "Comment on plausible business meaning when names suggest it (e.g., invoices, customers, currencies).",
      "Also rate syntax and performance for each change using 'good' or 'bad'.",
      "syntax=good if the SQL remains syntactically valid; bad if it likely breaks or is suspicious (e.g., mismatched parentheses, dangling commas, invalid references).",
      "performance=good if it is likely neutral/improving (tighter filters, indexed joins/keys, pre-aggregation, fewer wildcards); bad if it risks regressions (non-sargable predicates, functions on indexed columns in WHERE/JOIN, unnecessary DISTINCT, broad wildcards, large CROSS JOINs, etc.).",
      "Avoid meta comments about line numbering; focus on the change impact.",
    ],
    oldQuery,
    newQuery,
    changes: changes.map((c, i) => ({ index: i, type: c.type, description: c.description })),
    output_schema: {
      explanations: [
        { index: "number", explanation: "string (3-5 sentences)", syntax: "'good' | 'bad'", performance: "'good' | 'bad'" },
      ],
    },
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
      temperature: 0.2,
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
                    explanation: { type: "string" },
                    syntax: { type: "string", enum: ["good", "bad"] },
                    performance: { type: "string", enum: ["good", "bad"] },
                  },
                  required: ["index", "explanation", "syntax", "performance"],
                  additionalProperties: false,
                },
              },
            },
            required: ["explanations"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You are a senior Oracle SQL reviewer. For each change, provide a clear (3–5 sentence) explanation plus 'syntax' and 'performance' ratings ('good'|'bad'). No meta-comments about line numbers.",
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
      temperature: 0.2,
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
                    explanation: { type: "string" },
                    syntax: { type: "string", enum: ["good", "bad"] },
                    performance: { type: "string", enum: ["good", "bad"] },
                  },
                  required: ["index", "explanation", "syntax", "performance"],
                  additionalProperties: false,
                },
              },
            },
            required: ["explanations"],
            additionalProperties: false,
          },
        },
      },
      messages: [
        {
          role: "system",
          content:
            "You are a senior Oracle SQL reviewer. Return JSON {explanations:[{index:number,explanation:string,syntax:'good'|'bad',performance:'good'|'bad'}]}. No extra text.",
        },
        { role: "user", content: JSON.stringify(userPayload) },
      ],
    }),
  })

  if (!res.ok) {
    const firstErr = await res.text()
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You are a senior Oracle SQL reviewer. Return a JSON object with key 'explanations': an array of {index:number, explanation:string (3-5 sentences), syntax:'good'|'bad', performance:'good'|'bad'}. Do NOT include any other text.",
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
    const { oldQuery, newQuery } = (await req.json()) as { oldQuery: string; newQuery: string }
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

    // structural segmenters for each side
    const segNew = buildSegmenter(canonNew)
    const segOld = buildSegmenter(canonOld)

    // smart grouping
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

    const payload = buildUserPayload(canonOld, canonNew, changes)
    const provider = (process.env.LLM_PROVIDER || "xai").toLowerCase()

    let modelExplanations: ChangeExplanation[] = []
    if (provider === "azure") modelExplanations = await explainWithAzure(payload)
    else modelExplanations = await explainWithXAI(payload)

    const expMap = new Map<number, ChangeExplanation>()
    modelExplanations.forEach((e) => {
      if (typeof e.index === "number" && e.explanation) expMap.set(e.index, e)
    })

    const finalChanges = changes.map((c, idx) => {
      const m = expMap.get(idx)
      return {
        ...c,
        explanation:
          m?.explanation ||
          "This change adjusts the SQL, but the service could not infer details confidently. Review surrounding context to confirm the impact on rows, grouping, and filters.",
        syntax: m?.syntax ?? "good",
        performance: m?.performance ?? "good",
      }
    })

    const counts = finalChanges.reduce(
      (acc, c) => {
        acc[c.type]++
        return acc
      },
      { addition: 0, deletion: 0, modification: 0 } as Record<ChangeType, number>
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
