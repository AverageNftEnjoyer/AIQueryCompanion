import { NextResponse } from "next/server"
import { canonicalizeSQL, generateQueryDiff, type ComparisonResult } from "@/lib/query-differ"

type ChangeType = "addition" | "modification" | "deletion"
type Side = "old" | "new" | "both"

type ChangeItem = {
  type: ChangeType
  description: string
  lineNumber: number          
  side: Side                
}

type ChangeWithExpl = ChangeItem & { explanation: string }
type ChangeExplanation = { index: number; explanation: string }

const DEFAULT_XAI_MODEL = "grok-4"
const DEFAULT_AZURE_API_VERSION = "2024-02-15-preview"

// ---------------- utils ----------------

function snippet(s: string, n = 120) {
  const t = s.replace(/\s+/g, " ").trim()
  return t.length <= n ? t : t.slice(0, n - 1) + "…"
}

function buildStructuredChanges(diff: ComparisonResult): ChangeItem[] {
  const out: ChangeItem[] = []
  for (let i = 0; i < diff.diffs.length; i++) {
    const d = diff.diffs[i]
    if (d.type === "deletion" && d.oldLineNumber) {
      const next = diff.diffs[i + 1]
      if (next && next.type === "addition" && next.newLineNumber) {
        out.push({
          type: "modification",
          lineNumber: next.newLineNumber,
          side: "both",
          description: `Line ${next.newLineNumber}: changed from "${snippet(d.content)}" to "${snippet(next.content)}"`,
        })
        i++ // consume the paired addition
      } else {
        // pure deletion
        out.push({
          type: "deletion",
          lineNumber: d.oldLineNumber,
          side: "old",
          description: `Line ${d.oldLineNumber}: removed "${snippet(d.content)}"`,
        })
      }
    } else if (d.type === "addition" && d.newLineNumber) {
      const prev = diff.diffs[i - 1]
      if (!(prev && prev.type === "deletion")) {
        out.push({
          type: "addition",
          lineNumber: d.newLineNumber,
          side: "new",
          description: `Line ${d.newLineNumber}: added "${snippet(d.content)}"`,
        })
      }
    }
  }

  out.sort((a, b) => a.lineNumber - b.lineNumber)
  return out
}

function buildUserPayload(oldQuery: string, newQuery: string, changes: ChangeItem[]) {
  return {
    task:
      "For EACH change, write an original explanation (2–4 sentences) that matches that specific change and its impact on the SQL result.",
    guidance: [
      "Do not copy the input description; write in your own words.",
      "Tie the change to SQL semantics (filters, joins, projections, grouping, HAVING, ORDER BY, limits, window functions).",
      "Deletions: clarify what behavior/data is removed and side effects.",
      "Additions: clarify new behavior/constraints/metrics and how results shift.",
      "Modifications: clarify what changed, why it matters, and likely impact on rows/aggregates/perf.",
      "Each explanation must be 2–4 sentences, no bullets, concise but concrete."
    ],
    oldQuery,
    newQuery,
    changes: changes.map((c, i) => ({ index: i, type: c.type, description: c.description })),
    output_schema: {
      explanations: [{ index: "number", explanation: "string (2–4 sentences)" }]
    }
  }
}

function coerceExplanations(content: string): ChangeExplanation[] {
  try {
    const parsed = JSON.parse(content)
    const out = (parsed?.explanations || []) as any[]
    return out
      .filter(x => typeof x?.index === "number" && typeof x?.explanation === "string")
      .map(x => ({ index: x.index, explanation: x.explanation.trim() }))
  } catch {
    return []
  }
}

// ---------------- providers ----------------

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
                  properties: { index: { type: "number" }, explanation: { type: "string" } },
                  required: ["index", "explanation"], additionalProperties: false
                }
              }
            },
            required: ["explanations"], additionalProperties: false
          }
        }
      },
      messages: [
        { role: "system",
          content: "You are a senior Oracle SQL reviewer. For each change, produce an original, concrete explanation (2–4 sentences). Do not repeat the change description verbatim. Relate the change to query semantics and probable business meaning."
        },
        { role: "user", content: JSON.stringify(userPayload) }
      ]
    })
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
                  properties: { index: { type: "number" }, explanation: { type: "string" } },
                  required: ["index", "explanation"], additionalProperties: false
                }
              }
            },
            required: ["explanations"], additionalProperties: false
          }
        }
      },
      messages: [
        { role: "system",
          content: "You are a senior Oracle SQL reviewer. For each change, produce an original, concrete explanation (2–4 sentences). Do not repeat the change description verbatim. Relate the change to query semantics and probable business meaning."
        },
        { role: "user", content: JSON.stringify(userPayload) }
      ]
    })
  })

  if (!res.ok) {
    const firstErr = await res.text()
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        temperature: 0.2,
        messages: [
          { role: "system",
            content: "You are a senior Oracle SQL reviewer. Return a JSON object with key 'explanations': an array of {index:number, explanation:string (2-4 sentences)}. Do NOT include any other text."
          },
          { role: "user", content: JSON.stringify(userPayload) }
        ]
      })
    })
    if (!res.ok) throw new Error(`Azure OpenAI error: ${firstErr} | Retry: ${await res.text()}`)
  }

  const json = await res.json()
  const content = json?.choices?.[0]?.message?.content ?? ""
  return coerceExplanations(content)
}

// ---------------- route ----------------

export async function POST(req: Request) {
  try {
    const len = Number(req.headers.get("content-length") || "0")
    if (len > 256 * 1024) return NextResponse.json({ error: "Payload too large" }, { status: 413 })

    const { oldQuery, newQuery } = (await req.json()) as { oldQuery?: string; newQuery?: string }
    if (!oldQuery || !newQuery) return NextResponse.json({ error: "oldQuery and newQuery are required." }, { status: 400 })

    const canonOld = canonicalizeSQL(oldQuery)
    const canonNew = canonicalizeSQL(newQuery)
    const comparison = generateQueryDiff(canonOld, canonNew)
    const changes = buildStructuredChanges(comparison)

    if (changes.length === 0) {
      return NextResponse.json({
        analysis: {
          summary: "No changes detected.",
          riskAssessment: "Low",
          performanceImpact: "Neutral",
          changes: [],
          recommendations: [],
        }
      })
    }

    const payload = buildUserPayload(canonOld, canonNew, changes)
    const provider = (process.env.LLM_PROVIDER || "xai").toLowerCase()
    const modelExpls = provider === "azure" ? await explainWithAzure(payload) : await explainWithXAI(payload)

    const merged: ChangeWithExpl[] = changes.map((c, i) => {
      const ex = modelExpls.find(e => e.index === i)?.explanation
      return { ...c, explanation: ex || "The tool could not infer details confidently. Review surrounding lines for the exact effect on rows, grouping, and filters." }
    })

    const summary = `${merged.filter(x => x.type === "addition").length} additions, ${merged.filter(x => x.type === "deletion").length} deletions, ${merged.filter(x => x.type === "modification").length} modifications.`

    return NextResponse.json({
      analysis: {
        summary,
        riskAssessment: "Low",
        performanceImpact: "Neutral",
        changes: merged,
        recommendations: [],
      }
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 })
  }
}
