import { z } from "zod";
import {
  fetchWithTimeout,
  isRetryableStatus,
  jsonNoStore,
  mapErrorStatus,
  safeErrorMessage,
} from "@/lib/server/http";

interface LLMResult {
  tldr: string;
  structured: Record<string, unknown>;
  meta: {
    model: string;
    latencyMs: number;
    pass: "model-p1" | "fallback";
    largeInput: boolean;
    clipBytes: number;
    error?: string;
  };
}

const MAX_QUERY_CHARS = 160_000;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const ANALYSIS_AGENT_ID = process.env.ANALYSIS_AGENT_ID || "";
const ANALYSIS_AGENT_MODEL = process.env.ANALYSIS_AGENT_MODEL || "gpt-4.1-nano";
const REQUEST_TIMEOUT_MS = Number(process.env.SUMMARY_REQUEST_TIMEOUT_MS || 65_000);

const payloadSchema = z.object({
  newQuery: z
    .string()
    .trim()
    .min(1, "newQuery is required")
    .max(MAX_QUERY_CHARS, `newQuery must be <= ${MAX_QUERY_CHARS.toLocaleString()} characters`),
  analysis: z.unknown().optional(),
});

const SUMMARY_SPEC = `
Write a fact-only overview of the provided SQL in 3-6 sentences.

Hard rules:
- Use only details explicitly present in the SQL text.
- Never invent thresholds, limits, rankings, filters, joins, currencies, date ranges, or business intent.
- If a detail is not explicitly in the SQL, say "Not specified" or omit it.
- Echo numeric literals and identifiers exactly as they appear in SQL.
- If SQL has no LIMIT/TOP, say "Not specified" for row limiting.
- If SQL has no ORDER BY, say "Not specified" for ordering.
- If SQL has no GROUP BY or aggregates, do not claim aggregation.
- If SQL has WHERE conditions, list only fields and literal comparisons that appear.
- Do not use domain assumptions unless literal words/numbers exist in SQL.
- Output paragraph text only (no code blocks, headings, bullets, JSON, or lists).
`.trim();

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function readStringField(value: unknown, key: string): string | null {
  if (!isJsonRecord(value)) return null;
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : null;
}

function extractResponseText(payload: unknown): string {
  if (isJsonRecord(payload)) {
    const output = payload.output;
    if (Array.isArray(output)) {
      const parts: string[] = [];
      for (const item of output) {
        if (!isJsonRecord(item)) continue;
        const content = item.content;
        if (!Array.isArray(content)) continue;
        for (const contentPart of content) {
          if (!isJsonRecord(contentPart)) continue;
          if (contentPart.type === "output_text") {
            const textObj = contentPart.text;
            const nestedValue = readStringField(textObj, "value");
            if (nestedValue) parts.push(nestedValue);
            else if (typeof textObj === "string") parts.push(textObj);
          }
        }
      }
      if (parts.length) return parts.join(" ").trim();
    }

    const outputText = payload.output_text;
    if (typeof outputText === "string") return outputText.trim();

    const choices = payload.choices;
    if (Array.isArray(choices) && choices.length > 0 && isJsonRecord(choices[0])) {
      const message = choices[0].message;
      if (isJsonRecord(message)) {
        const content = message.content;
        if (typeof content === "string") return content.trim();
      }
    }
  }

  return "";
}

function extractNumbers(sql: string): string[] {
  const matches = sql.match(/\b\d+(?:\.\d+)?\b/g) || [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const value of matches) {
    if (seen.has(value)) continue;
    seen.add(value);
    output.push(value);
  }
  return output;
}

function buildSqlFactHint(sql: string): string {
  const numbers = extractNumbers(sql);
  const hasLimit = /\bLIMIT\s+\d+/i.test(sql) || /\bFETCH\s+NEXT\s+\d+\s+ROWS\s+ONLY/i.test(sql) || /\bTOP\s+\(?\d+\)?/i.test(sql);
  const hasOrder = /\bORDER\s+BY\b/i.test(sql);
  const hasGroup = /\bGROUP\s+BY\b/i.test(sql);
  const hasAggregate = /\b(SUM|COUNT|AVG|MIN|MAX)\s*\(/i.test(sql);
  const whereFields = Array.from(
    new Set(
      (sql.match(/\bWHERE\b([\s\S]+)/i)?.[1] || "")
        .split(/AND|OR/gi)
        .map((segment) => segment.trim())
        .filter(Boolean)
        .map((segment) => segment.match(/^[A-Za-z0-9_."]+/)?.[0] || "")
        .filter(Boolean)
    )
  );

  return [
    `Allowed numeric literals: ${numbers.length ? numbers.join(", ") : "(none)"}`,
    `Row limiting present: ${hasLimit ? "Yes" : "No"}`,
    `Ordering present: ${hasOrder ? "Yes" : "No"}`,
    `Grouping present: ${hasGroup ? "Yes" : "No"}`,
    `Aggregates present: ${hasAggregate ? "Yes" : "No"}`,
    `WHERE fields seen: ${whereFields.length ? whereFields.join(", ") : "(none)"}`,
  ].join("\n");
}

function dropUnseenNumbers(summary: string, sql: string): string {
  const allowed = new Set(extractNumbers(sql));
  return summary.replace(/\b\d+(?:\.\d+)?\b/g, (match) => (allowed.has(match) ? match : "a numeric value"));
}

async function callResponsesAPI(userContent: string) {
  const response = await fetchWithTimeout(
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
          { role: "system", content: [{ type: "input_text", text: SUMMARY_SPEC }] },
          { role: "user", content: [{ type: "input_text", text: userContent }] },
        ],
      }),
    },
    REQUEST_TIMEOUT_MS
  );

  if (isRetryableStatus(response.status)) {
    throw new Error(`OpenAI responses request retryable failure (${response.status})`);
  }
  if (!response.ok) {
    throw new Error(`OpenAI responses request failed (${response.status})`);
  }

  const payload: unknown = await response.json();
  const modelName = readStringField(payload, "model") || ANALYSIS_AGENT_MODEL;
  return {
    text: extractResponseText(payload),
    model: modelName,
  };
}

async function callFallbackChatCompletion(userContent: string) {
  const response = await fetchWithTimeout(
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
          { role: "system", content: "Return exactly one paragraph. Do not add extra narration." },
          { role: "system", content: SUMMARY_SPEC },
          { role: "user", content: userContent },
        ],
      }),
    },
    REQUEST_TIMEOUT_MS
  );

  if (!response.ok) {
    throw new Error(`OpenAI fallback request failed (${response.status})`);
  }

  const payload: unknown = await response.json();
  const modelName = readStringField(payload, "model") || ANALYSIS_AGENT_MODEL;
  return {
    text: extractResponseText(payload),
    model: modelName,
  };
}

export async function POST(req: Request) {
  const startMs = Date.now();

  try {
    if (!OPENAI_API_KEY) {
      return jsonNoStore({ error: "Missing OPENAI_API_KEY" }, { status: 500 });
    }
    if (!ANALYSIS_AGENT_ID) {
      return jsonNoStore({ error: "Missing ANALYSIS_AGENT_ID" }, { status: 500 });
    }

    const rawBody: unknown = await req.json().catch(() => null);
    const parsed = payloadSchema.safeParse(rawBody);
    if (!parsed.success) {
      return jsonNoStore({ error: parsed.error.issues[0]?.message || "Invalid request body" }, { status: 400 });
    }

    const { newQuery } = parsed.data;
    const factHint = buildSqlFactHint(newQuery);
    const userContent = [
      "SQL:",
      "```sql",
      newQuery,
      "```",
      "",
      "FACT HINT (do not mention unless present in SQL; use only to avoid hallucinations):",
      factHint,
    ].join("\n");

    let summaryText = "";
    let modelUsed = ANALYSIS_AGENT_MODEL;
    let flow: LLMResult["meta"]["pass"] = "model-p1";
    let primaryError: string | undefined;

    try {
      const primary = await callResponsesAPI(userContent);
      summaryText = primary.text;
      modelUsed = primary.model;
    } catch (error: unknown) {
      primaryError = safeErrorMessage(error, "Primary summary generation failed");
      flow = "fallback";
      const fallback = await callFallbackChatCompletion(userContent);
      summaryText = fallback.text;
      modelUsed = fallback.model;
    }

    const compact = (summaryText || "").replace(/\s+/g, " ").trim();
    const sanitized = dropUnseenNumbers(compact, newQuery);
    if (!sanitized) {
      return jsonNoStore({ error: "Empty summary" }, { status: 502 });
    }

    const response: LLMResult = {
      tldr: sanitized,
      structured: {},
      meta: {
        model: modelUsed,
        latencyMs: Date.now() - startMs,
        pass: flow,
        largeInput: newQuery.length > 12_000,
        clipBytes: newQuery.length,
        ...(primaryError ? { error: primaryError } : {}),
      },
    };

    return jsonNoStore(response);
  } catch (error: unknown) {
    const message = safeErrorMessage(error);
    return jsonNoStore({ error: message }, { status: mapErrorStatus(message, 500) });
  }
}
