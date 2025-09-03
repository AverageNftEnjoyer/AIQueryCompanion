import { NextResponse } from "next/server"

interface Payload {
  newQuery: string
  analysis?: unknown
}

const DEFAULT_XAI_MODEL = "grok-4"
const DEFAULT_AZURE_API_VERSION = "2024-02-15-preview"

export async function POST(req: Request) {
  try {
    const { newQuery } = (await req.json()) as Payload
    if (typeof newQuery !== "string" || !newQuery.trim()) {
      return NextResponse.json({ error: "newQuery is required" }, { status: 400 })
    }

    const sketch = { newQuery }
    const provider = (process.env.LLM_PROVIDER || "xai").toLowerCase()

    const systemPrompt = [
      "You are a senior Oracle/SQL developer writing for junior developers and project managers.",
      "Write one short paragraph of 4–5 sentences in plain, friendly English.",
      "Explain only what the current query does from a business and operational perspective.",
      "Cover: what result it produces, the main business entities or tables involved, how the data is filtered, grouped, or ordered, and the purpose of the output.",
      "Mention practical notes like how fresh the data is expected to be, what the report or dataset is used for, and any simple assumptions or risks.",
      "Do not mention changes or edits. Do not paste SQL. Keep it clear and approachable."
    ].join(" ")

    async function callXAI(): Promise<string> {
      const XAI_API_KEY = process.env.XAI_API_KEY
      const XAI_MODEL = process.env.XAI_MODEL || DEFAULT_XAI_MODEL
      const XAI_BASE_URL = process.env.XAI_BASE_URL || "https://api.x.ai"
      if (!XAI_API_KEY) throw new Error("Missing XAI_API_KEY")

      const r = await fetch(`${XAI_BASE_URL}/v1/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${XAI_API_KEY}` },
        body: JSON.stringify({
          model: XAI_MODEL,
          temperature: 0.25,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(sketch) },
          ],
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      const j = await r.json()
      return j?.choices?.[0]?.message?.content?.trim() ?? ""
    }

    async function callAzure(): Promise<string> {
      const endpoint = process.env.AZURE_OPENAI_ENDPOINT
      const apiKey = process.env.AZURE_OPENAI_API_KEY
      const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
      const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION
      if (!endpoint || !apiKey || !deployment) throw new Error("Missing Azure OpenAI env vars")

      const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", "api-key": apiKey },
        body: JSON.stringify({
          temperature: 0.25,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: JSON.stringify(sketch) },
          ],
        }),
      })
      if (!r.ok) throw new Error(await r.text())
      const j = await r.json()
      return j?.choices?.[0]?.message?.content?.trim() ?? ""
    }

    const tldr = provider === "azure" ? await callAzure() : await callXAI()
    if (!tldr) return NextResponse.json({ error: "Empty summary" }, { status: 502 })
    return NextResponse.json({ tldr })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Unexpected error" }, { status: 500 })
  }
}
