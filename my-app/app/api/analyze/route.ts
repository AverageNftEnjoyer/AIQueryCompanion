import { NextResponse } from "next/server"
import { generateQueryDiff, canonicalizeSQL, type ComparisonResult } from "@/lib/query-differ"

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* Config                                                             */
/* ------------------------------------------------------------------ */

const DEFAULT_XAI_MODEL = "grok-4"
const DEFAULT_AZURE_API_VERSION = "2024-02-15-preview"
const MAX_QUERY_CHARS = 120_000 // per user request

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Extract the token inside the last quoted segment of a description */
function tokenFromDescription(desc: string): string {
  // Matches:  Line 31: added "rates AS ("   OR   Line 29: removed ")"   OR   changed ... to ")"
  const m =
    desc.match(/:\s(?:added|removed|changed.*to)\s"([^"]*)"/i) ??
    desc.match(/"([^"]*)"$/)
  return (m?.[1] ?? "").trim()
}

/** Suppress punctuation/structural wrapper noise from server output */
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

/** Parse JSON content from a model response safely. */
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

/** Build the user payload the model sees. */
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
        {
          index: "number (index into input 'changes')",
          explanation: "string (3-5 sentences)",
          syntax: "'good' | 'bad'",
          performance: "'good' | 'bad'",
        },
      ],
    },
  }
}

/* ------------------------------------------------------------------ */
/* Providers                                                          */
/* ------------------------------------------------------------------ */

async function explainWithXAI(userPayload: any): Promise<ChangeExplanation[]> {
  const XAI_API_KEY = process.env.XAI_API_KEY
  const XAI_MODEL = process.env.XAI_MODEL || DEFAULT_XAI_MODEL
  const XAI_BASE_URL = process.env.XAI_BASE_URL || "https://api.x.ai"
  if (!XAI_API_KEY) throw new Error("Missing XAI_API_KEY in environment.")

  const resp = await fetch(`${XAI_BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${XAI_API_KEY}`,
    },
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
    // Fallback without schema (older regions)
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

/* ------------------------------------------------------------------ */
/* Diff -> Change items                                               */
/* ------------------------------------------------------------------ */

function buildChanges(diff: ComparisonResult): ChangeItem[] {
  const out: ChangeItem[] = []
  for (let i = 0; i < diff.diffs.length; i++) {
    const d = diff.diffs[i]

    if (d.type === "deletion" && d.oldLineNumber) {
      const next = diff.diffs[i + 1]
      if (next && next.type === "addition" && next.newLineNumber) {
        // modification pair
        const desc =
          `Line ${next.newLineNumber}: changed from "${d.content.trim()}" to "${next.content.trim()}"`
        if (!shouldSuppressServer(desc)) {
          out.push({
            type: "modification",
            description: desc,
            lineNumber: next.newLineNumber,
            side: "both",
          })
        }
        i++ // consume the addition
      } else {
        // pure deletion
        const desc = `Line ${d.oldLineNumber}: removed "${d.content.trim()}"`
        if (!shouldSuppressServer(desc)) {
          out.push({
            type: "deletion",
            description: desc,
            lineNumber: d.oldLineNumber,
            side: "old",
          })
        }
      }
    } else if (d.type === "addition" && d.newLineNumber) {
      const prev = diff.diffs[i - 1]
      if (!(prev && prev.type === "deletion")) {
        const desc = `Line ${d.newLineNumber}: added "${d.content.trim()}"`
        if (!shouldSuppressServer(desc)) {
          out.push({
            type: "addition",
            description: desc,
            lineNumber: d.newLineNumber,
            side: "new",
          })
        }
      }
    }
  }

  // stable sort by line
  out.sort((a, b) => a.lineNumber - b.lineNumber)
  return out
}

/* ------------------------------------------------------------------ */
/* Route                                                              */
/* ------------------------------------------------------------------ */

export async function POST(req: Request) {
  try {
    const { oldQuery, newQuery } = (await req.json()) as {
      oldQuery: string
      newQuery: string
    }

    if (typeof oldQuery !== "string" || typeof newQuery !== "string") {
      return NextResponse.json({ error: "oldQuery and newQuery are required strings" }, { status: 400 })
    }

    // Caps (client also enforces, but double-check server-side)
    if (oldQuery.length > MAX_QUERY_CHARS || newQuery.length > MAX_QUERY_CHARS) {
      return NextResponse.json(
        { error: `Each query must be ≤ ${MAX_QUERY_CHARS.toLocaleString()} characters.` },
        { status: 413 }
      )
    }

    // Canonicalize (idempotent) for stable diffs
    const canonOld = canonicalizeSQL(oldQuery)
    const canonNew = canonicalizeSQL(newQuery)

    const diff = generateQueryDiff(canonOld, canonNew)
    const changes = buildChanges(diff)

    // If nothing meaningful changed, return a lightweight response
    if (changes.length === 0) {
      return NextResponse.json({
        analysis: {
          summary: "No substantive changes detected.",
          changes: [],
          recommendations: [],
          riskAssessment: "Low",
          performanceImpact: "Neutral",
        }
      })
    }

    // Build model payload and explain only kept (non-trivial) changes
    const payload = buildUserPayload(canonOld, canonNew, changes)
    const provider = (process.env.LLM_PROVIDER || "xai").toLowerCase()

    let modelExplanations: ChangeExplanation[] = []
    if (provider === "azure") {
      modelExplanations = await explainWithAzure(payload)
    } else {
      modelExplanations = await explainWithXAI(payload)
    }

    // Attach explanations + metrics back to changes
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
        syntax: m?.syntax ?? "good",        // fallback if model omitted
        performance: m?.performance ?? "good", // fallback if model omitted
      }
    })

    // Simple summary
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
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 })
  }
}
