import { NextResponse } from "next/server"

/* ============================== Types ============================== */

interface Payload {
  newQuery: string
  analysis?: unknown
}
interface LLMResult {
  tldr: string
  structured: Record<string, any>
  meta: {
    model: string
    latencyMs: number
    pass: "model-p1" | "fallback"
    largeInput: boolean
    clipBytes: number
    error?: string
  }
}

/* ============================== Config ============================== */

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ""
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/,"")
const ANALYSIS_AGENT_ID = process.env.ANALYSIS_AGENT_ID || ""
const ANALYSIS_AGENT_MODEL = process.env.ANALYSIS_AGENT_MODEL || "gpt-4.1-nano"
const REQUEST_TIMEOUT_MS = Number(process.env.SUMMARY_REQUEST_TIMEOUT_MS || 65000)

/**
 * STRICT, FACT-ONLY SPEC
 * Goal: produce a short human summary that NEVER invents fields, numbers, filters, limits, or rankings.
 * If a detail is not literally present in the SQL, respond with “Not specified” or omit it.
 * Echo numeric literals exactly as they appear. Do not round, infer, estimate, or generalize.
 */
const SUMMARY_SPEC = `
Write a basic, fact-only overview of the provided SQL in 3–6 sentences.

Hard rules:
• Use only details that are explicitly present in the SQL text.
• Never invent thresholds, limits, rankings, filters, joins, currencies, date ranges, or business intent.
• If a detail is not explicitly in the SQL, say “Not specified” or omit it entirely.
• Echo numeric literals and identifiers exactly as they appear in the SQL (no new numbers or units).
• If the SQL has no LIMIT/TOP, say “Not specified” for row limiting.
• If the SQL has no ORDER BY, say “Not specified” for ordering.
• If the SQL has no GROUP BY or aggregates, do not claim any aggregation.
• If the SQL has WHERE conditions, list only the fields and literal comparisons that appear.
• Do not use domain assumptions (e.g., price caps, customer tiers) unless the literal words/numbers exist in the SQL.
• No code, no headings, no bullets, no lists, no JSON—paragraph only.

Style:
• Plain English, neutral tone, concise.
• Prefer phrasing like “The query selects …”, “It filters by …”, “It orders by … (or Not specified)”, “It limits rows by … (or Not specified)”.
`

/* ============================== Route ============================== */

export async function POST(req: Request) {
  const t0 = Date.now()
  try {
    if (!OPENAI_API_KEY) {
      return NextResponse.json({ error: "Missing OPENAI_API_KEY" }, { status: 500 })
    }
    if (!ANALYSIS_AGENT_ID) {
      return NextResponse.json({ error: "Missing ANALYSIS_AGENT_ID" }, { status: 500 })
    }

    const body = (await req.json()) as Payload
    const newQuery = typeof body?.newQuery === "string" ? body.newQuery.trim() : ""
    if (!newQuery) {
      return NextResponse.json({ error: "newQuery is required" }, { status: 400 })
    }

    const factHint = buildSqlFactHint(newQuery)
    const userContent = [
      "SQL:",
      "```sql",
      newQuery,
      "```",
      "",
      "FACT HINT (do not mention unless present in SQL; use only to avoid hallucinations):",
      factHint,
    ].join("\n")

    let text = ""
    let modelUsed = ANALYSIS_AGENT_MODEL
    let metaPass: LLMResult["meta"]["pass"] = "model-p1"
    let lastError: string | undefined

    try {
      const r = await fetchWithTimeout(
        `${OPENAI_BASE_URL}/responses`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            assistant_id: ANALYSIS_AGENT_ID,
            temperature: 0,
            input: [
              {
                role: "system",
                content: [{ type: "input_text", text: SUMMARY_SPEC }],
              },
              {
                role: "user",
                content: [{ type: "input_text", text: userContent }],
              },
            ],
          }),
        },
        REQUEST_TIMEOUT_MS
      )

      if (isRetryableStatus(r.status)) {
        const e: any = new Error(`Upstream ${r.status}: retryable`)
        e.__retryable = true
        throw e
      }
      if (!r.ok) {
        const errText = await r.text().catch(() => "")
        throw new Error(`OpenAI ${r.status}: ${errText}`)
      }

      const j = await r.json()
      text = extractResponseText(j)
      modelUsed = j?.model || ANALYSIS_AGENT_MODEL
    } catch (e: any) {
      lastError = String(e?.message || e)
      metaPass = "fallback"

      const rc = await fetchWithTimeout(
        `${OPENAI_BASE_URL}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: ANALYSIS_AGENT_MODEL,
            temperature: 0,
            messages: [
              { role: "system", content: "Return exactly one paragraph. Do not add any extra narration." },
              { role: "system", content: SUMMARY_SPEC },
              { role: "user", content: userContent },
            ],
          }),
        },
        REQUEST_TIMEOUT_MS
      )

      if (!rc.ok) {
        const errText = await rc.text().catch(() => "")
        return NextResponse.json(
          { error: `OpenAI fallback ${rc.status}: ${errText} | primary: ${lastError || ""}` },
          { status: 502 }
        )
      }

      const jc = await rc.json()
      text = extractResponseText(jc)
      modelUsed = jc?.model || ANALYSIS_AGENT_MODEL
    }

    text = (text || "").replace(/\s+/g, " ").trim()

    const sanitized = dropUnseenNumbers(text, newQuery)

    const res: LLMResult = {
      tldr: sanitized || "",
      structured: {}, 
      meta: {
        model: modelUsed,
        latencyMs: Date.now() - t0,
        pass: metaPass,
        largeInput: newQuery.length > 12000,
        clipBytes: newQuery.length,
        ...(lastError ? { error: lastError } : {}),
      },
    }

    if (!res.tldr) {
      return NextResponse.json({ error: "Empty summary" }, { status: 502 })
    }
    return NextResponse.json(res)
  } catch (e: any) {
    const msg = String(e?.message || "Unexpected error")
    const status =
      /Missing OPENAI_API_KEY|Missing ANALYSIS_AGENT_ID/.test(msg) ? 500 :
      /429/.test(msg) ? 429 :
      /timeout|aborted|ETIMEDOUT/i.test(msg) ? 504 :
      500
    return NextResponse.json({ error: msg }, { status })
  }
}

/* ============================== Helpers ============================== */

function isRetryableStatus(status: number) {
  return status === 429 || (status >= 500 && status <= 599)
}

function extractResponseText(j: any): string {
  try {
    if (Array.isArray(j?.output)) {
      const parts: string[] = []
      for (const item of j.output) {
        const content = item?.content
        if (Array.isArray(content)) {
          for (const c of content) {
            if (c?.type === "output_text" && typeof c?.text?.value === "string") parts.push(c.text.value)
            else if (typeof c?.text === "string") parts.push(c.text)
          }
        }
      }
      if (parts.length) return parts.join(" ").trim()
    }
    if (typeof j?.output_text === "string") return j.output_text.trim()
  } catch {}
  return j?.choices?.[0]?.message?.content?.trim?.() ?? ""
}


function buildSqlFactHint(sql: string): string {
  const nums = extractNumbers(sql)
  const hasLimit = /\bLIMIT\s+\d+/i.test(sql) || /\bFETCH\s+NEXT\s+\d+\s+ROWS\s+ONLY/i.test(sql) || /\bTOP\s+\(?\d+\)?/i.test(sql)
  const hasOrder = /\bORDER\s+BY\b/i.test(sql)
  const hasGroup = /\bGROUP\s+BY\b/i.test(sql)
  const hasAgg = /\b(SUM|COUNT|AVG|MIN|MAX)\s*\(/i.test(sql)
  const whereFields = Array.from(new Set((sql.match(/\bWHERE\b([\s\S]+)/i)?.[1] || "")
    .split(/AND|OR/gi)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => (s.match(/^[A-Za-z0-9_."]+/)?.[0] || ""))
    .filter(Boolean)))

  return [
    `Allowed numeric literals (echo exactly, do not invent others): ${nums.length ? nums.join(", ") : "(none)"}`,
    `Row limiting present: ${hasLimit ? "Yes (respect exact literal)" : "No"}`,
    `Ordering present: ${hasOrder ? "Yes" : "No"}`,
    `Grouping present: ${hasGroup ? "Yes" : "No"}`,
    `Aggregates present: ${hasAgg ? "Yes" : "No"}`,
    `WHERE fields seen: ${whereFields.length ? whereFields.join(", ") : "(none)"}`,
  ].join("\n")
}

function extractNumbers(sql: string): string[] {
  const matches = sql.match(/\b\d+(?:\.\d+)?\b/g) || []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    if (!seen.has(m)) {
      seen.add(m)
      out.push(m)
    }
  }
  return out
}

/**
 * If the LLM introduces numbers not present in the SQL, remove them conservatively.
 * Strategy: whitelist digits that appear in SQL; redact standalone numeric tokens not in whitelist.
 */
function dropUnseenNumbers(summary: string, sql: string): string {
  const allowed = new Set(extractNumbers(sql))
  return summary.replace(/\b\d+(?:\.\d+)?\b/g, (m) => (allowed.has(m) ? m : "a numeric value"))
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(t)
  }
}
