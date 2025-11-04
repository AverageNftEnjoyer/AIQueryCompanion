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


const SUMMARY_SPEC = `
Write a concise business overview (5–10 sentences, ~120–220 words).
Explain:
• Business purpose of the query and what the result will be used for.
• Time window and scope of data included.
• Who/what is included or excluded (e.g., customer segments, activity status, currencies).
• Core calculations (how invoice totals are derived, discount handling, currency conversion).
• Ranking/threshold logic (how invoices are ranked within a customer, the $750 cutoff).
• Sorting/limiting behavior (by month and total, top 100 with ties).
• Any important caveats or data quality risks that a stakeholder should understand.
Style rules:
• Plain English prose only. No headings, no bullets, no code, no lists.
• Keep it neutral, specific, and directly tied to the provided SQL behavior.
Return only the 5–10 sentence paragraph.
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

    const agentPayload = JSON.stringify({
      newQuery,
      analysis: body?.analysis ?? null
    })

    let text = ""
    let modelUsed = ANALYSIS_AGENT_MODEL
    let metaPass: LLMResult["meta"]["pass"] = "model-p1"
    let lastError: string | undefined

    // PRIMARY: Responses API
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
            input: [
              {
                role: "system",
                content: [{ type: "input_text", text: SUMMARY_SPEC }],
              },
              {
                role: "user",
                content: [{ type: "input_text", text: agentPayload }],
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
            messages: [
              { role: "system", content: "Return exactly the paragraph. No extra narration." },
              { role: "system", content: SUMMARY_SPEC },
              { role: "user", content: agentPayload },
            ],
            // Slight temperature helps avoid rigid repetition while staying concise
            temperature: 0.2
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

    // Hard trim: remove newlines, enforce paragraph only
    text = (text || "").replace(/\s+/g, " ").trim()

    const res: LLMResult = {
      tldr: text || "",
      structured: tryParseLastJson(text) || {},
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

function tryParseLastJson(text: string): any {
  if (!text) return {}
  const defenced = text.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1")
  try { return JSON.parse(defenced) } catch {}
  const m = defenced.match(/\{[\s\S]*\}$/m)
  if (!m) return {}
  try { return JSON.parse(m[0]) } catch { return {} }
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
