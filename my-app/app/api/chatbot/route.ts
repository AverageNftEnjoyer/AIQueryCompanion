// /app/api/chatbot/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";

/** ============================== Config ============================== **/
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-nano";
const REQUEST_TIMEOUT_MS = Math.min(
  Number(process.env.CHATBOT_REQUEST_TIMEOUT_MS || process.env.FETCH_TIMEOUT_MS || 50000),
  (typeof maxDuration === "number" ? maxDuration : 60) * 1000 - 2000
);
const RETRIES = Math.min(2, Number(process.env.LLM_RETRIES ?? 1));

// Keep full queries (no clipping) so line numbers match.
const CLIP_BYTES = Infinity;

/** ============================== Types ============================== **/
type Msg = { role: "system" | "user" | "assistant"; content: string };

interface ChatbotBody {
  question?: string;
  oldQuery?: string;
  newQuery?: string;
  context?: {
    stats?: unknown;
    changeCount?: number;
  };
  history?: Msg[];
}

/** ============================== Utilities ============================== **/
function isNonEmptyString(x: any): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function safeErrMessage(e: any, fallback = "Unexpected error") {
  const raw = typeof e?.message === "string" ? e.message : fallback;
  return raw
    .replace(/(Bearer\s+)[\w.\-]+/gi, "$1[REDACTED]")
    .replace(/(api[-_ ]?key\s*[:=]\s*)\w+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]");
}

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit = {},
  timeoutMs = REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function withRetries<T>(fn: () => Promise<T>, max = RETRIES, baseDelay = 400) {
  let lastErr: any;
  for (let i = 0; i < max; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message || "");
      const retryable =
        /(?:\b429\b|5\d\d|ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN|timeout|aborted|AbortError)/i.test(msg);
      if (!retryable || i === max - 1) break;
      await new Promise((res) => setTimeout(res, baseDelay * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function clipText(s: string, budget = CLIP_BYTES) {
  const raw = (s || "").replace(/\r/g, "");
  if (!Number.isFinite(budget) || raw.length <= budget) return raw;
  return raw; // effectively disabled clipping
}

function softNormalize(s: string) {
  return (s || "").toLowerCase();
}

function looksRude(s: string) {
  const t = softNormalize(s);
  return /(fuck|idiot|stupid|dumbass|moron|kill yourself|kys|bitch|asshole)/i.test(t);
}

/** ============================== Line Lookup ============================== **/
function parseLineLookup(q: string) {
  const t = softNormalize(q);
  const m1 = t.match(/\bline\s+(\d{1,7})\b/);
  if (m1) return { kind: "single", line: Number(m1[1]) };
  const m2 = t.match(/\blines?\s+(\d{1,7})\s*[-to]+\s*(\d{1,7})/);
  if (m2) {
    const a = Number(m2[1]);
    const b = Number(m2[2]);
    return { kind: "range", start: Math.min(a, b), end: Math.max(a, b) };
  }
  return { kind: "none" };
}

function extractLines(src: string, which: any) {
  const lines = src.split("\n");
  const N = lines.length;
  if (which.kind === "single" && which.line) {
    const n = Math.min(Math.max(1, which.line), N);
    const contextBefore = Math.max(1, n - 2);
    const contextAfter = Math.min(N, n + 2);
    return {
      target: n,
      total: N,
      text: lines.slice(contextBefore - 1, contextAfter).join("\n"),
      exact: lines[n - 1] ?? "",
    };
  }
  if (which.kind === "range") {
    const s = Math.min(Math.max(1, which.start), N);
    const e = Math.min(Math.max(1, which.end), N);
    return { total: N, text: lines.slice(s - 1, e).join("\n") };
  }
  return null;
}

/** ============================== Prompt helpers ============================== **/
function systemPrompt(): Msg {
  return {
    role: "system",
    content: [
      "You are Query Companion — an Oracle SQL/PLSQL and SQL tutor.",
      "Default style: ≤3 short sentences unless the user explicitly asks for more (with words like explain, why, details).",
      "Stay on SQL/PLSQL and the provided queries. Off-topic: reply once with 'I'm sorry — that was off-topic for SQL/PLSQL and the provided queries.'",
    ].join("\n"),
  };
}

function wantsExpansion(q: string) {
  return /\b(explain|details|deep|verbose|why|walk ?through)\b/i.test(q);
}

/** ============================== LLM Call ============================== **/
async function callOpenAI(messages: Msg[], question: string): Promise<string> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = DEFAULT_OPENAI_MODEL;
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const body = {
    model: OPENAI_MODEL,
    messages,
    max_completion_tokens: wantsExpansion(question) ? 600 : 220,
  };

  const r = await withRetries(() =>
    fetchWithTimeout(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      },
      REQUEST_TIMEOUT_MS
    )
  );
  if (!r.ok) {
    const errText = await r.text();
    throw new Error(errText);
  }
  const j = await r.json();
  return j?.choices?.[0]?.message?.content?.trim() ?? "";
}

function clampAnswer(ans: string, q: string) {
  if (wantsExpansion(q)) return ans;
  const parts = ans.split(/(?<=\.|\?|!)\s+/).filter(Boolean);
  return parts.slice(0, 3).join(" ");
}

/** ============================== Route ============================== **/
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ChatbotBody;
    const question = String(body?.question ?? "").trim();
    const oldQuery = clipText(String(body?.oldQuery ?? ""));
    const newQuery = clipText(String(body?.newQuery ?? ""));

    if (!isNonEmptyString(question)) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    // Fast-path for "line 280" style questions
    const lineReq = parseLineLookup(question);
    if (lineReq.kind !== "none" && isNonEmptyString(newQuery)) {
      const ext = extractLines(newQuery, lineReq);
      if (ext) {
        return NextResponse.json({
          answer: `Here’s the snippet:\n${ext.text}`,
          meta: { mode: "line-lookup", totalLines: ext.total },
        });
      }
    }

    const msgs: Msg[] = [systemPrompt(), { role: "user", content: question }];
    let answer = await callOpenAI(msgs, question);
    if (!answer) answer = "I don’t have a specific answer yet.";
    answer = clampAnswer(answer, question);

    return NextResponse.json({ answer, meta: { model: DEFAULT_OPENAI_MODEL } });
  } catch (err: any) {
    const msg = safeErrMessage(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
