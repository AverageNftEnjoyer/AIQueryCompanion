// /app/api/chatbot/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";

/** ============================== Config ============================== **/
const DEFAULT_OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-5-nano"; // or your chosen model
const REQUEST_TIMEOUT_MS = Math.min(
  Number(process.env.CHATBOT_REQUEST_TIMEOUT_MS || process.env.FETCH_TIMEOUT_MS || 50000),
  (typeof maxDuration === "number" ? maxDuration : 60) * 1000 - 2000 // small safety buffer
);
const RETRIES = Math.min(2, Number(process.env.LLM_RETRIES ?? 1));
const CLIP_BYTES = Math.max(10_000, Number(process.env.CHATBOT_CLIP_BYTES ?? 12_000));

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
  history?: Msg[]; // optional conversational history from the client
}

/** ============================== Utilities ============================== **/
function isNonEmptyString(x: any): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function safeErrMessage(e: any, fallback = "Unexpected error") {
  const raw = typeof e?.message === "string" ? e.message : fallback;
  return raw
    .replace(/(Bearer\s+)[\w\.\-]+/gi, "$1[REDACTED]")
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
      // Retry only on 429/5xx/timeouts/aborts
      if (!/429|5\d\d|timeout|aborted|AbortError/i.test(msg)) break;
      await new Promise((res) => setTimeout(res, baseDelay * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

function clipText(s: string, budget = CLIP_BYTES) {
  const raw = (s || "").replace(/\r/g, "");
  if (raw.length <= budget) return raw;
  const head = raw.slice(0, Math.floor(budget * 0.6));
  const tail = raw.slice(-Math.floor(budget * 0.35));
  return `${head}\n/* ...clipped... */\n${tail}`;
}

function softNormalize(s: string) {
  return (s || "").toLowerCase();
}

function looksRude(s: string) {
  const t = softNormalize(s);
  return /(fuck|idiot|stupid|dumbass|moron|kill yourself|kys|bitch|asshole)/i.test(t);
}

/** ============================== Prompt (Overhauled) ============================== **/
const systemPrompt: Msg = {
  role: "system",
  content: [
    "You are **Query Companion**, a senior SQL/PLSQL reviewer and tutor.",
    "You can answer interactive questions about:",
    "- SQL & PL/SQL fundamentals (e.g., 'What does SQL stand for?', joins, indexes, window functions).",
    "- Performance and optimization (sargability, join selectivity, index usage, GROUP BY cardinality, ORDER BY/CTE costs).",
    "- Transactions and reliability (ACID, COMMIT/ROLLBACK patterns, error handling).",
    "- Diffrences between two provided queries (oldQuery vs newQuery).",
    "",
    "CONVERSATION STYLE:",
    "- Be concise and practical (1–6 sentences unless asked for more).",
    "- Use the user’s prior turns (history) for context.",
    "- If the exact behavior depends on unknown details (schema/stats), say what’s unknown and how to verify (EXPLAIN PLAN, row counts, DBMS_METADATA.GET_DDL, user_source/all_source diffs).",
    "- If the user is rude, stay calm and continue helping briefly, then steer back to the topic.",
    "",
    "RELEVANCE POLICY (loose):",
    "- Treat any SQL/PLSQL/database question as RELEVANT, even if general. Answer normally.",
    "- If the user asks something clearly unrelated to SQL/databases (e.g., weather, sports scores, recipes), politely decline with a single line and suggest SQL/data topics instead.",
    "",
    "WHEN ASKED ABOUT THE DIFF:",
    "- Compare oldQuery vs newQuery. Call out risk items (COMMITs in loops, broadened WHERE, non-sargable filters, set operations altering row counts).",
    "- Mention performance angles (join selectivity, indexes, window functions, GROUP BY, ORDER BY/CTE).",
    "- Provide a short verification plan.",
    "",
    "FORMAT:",
    "- Keep answers self-contained and readable. Prefer plain English, minimal code unless requested.",
  ].join("\n"),
};

/** Build final messages array for the API */
function buildMessages(payload: {
  question: string;
  oldQuery: string;
  newQuery: string;
  context: ChatbotBody["context"];
  history?: Msg[];
}): Msg[] {
  const { question, oldQuery, newQuery, context, history } = payload;

  // Optional assistant context priming (very compact to save tokens)
  const primer: Msg = {
    role: "assistant",
    content: [
      "Context summary:",
      context?.changeCount != null ? `• changeCount: ${context.changeCount}` : "",
      context?.stats ? "• stats provided" : "",
      oldQuery ? "• oldQuery: (clipped)" : "",
      newQuery ? "• newQuery: (clipped)" : "",
    ]
      .filter(Boolean)
      .join("\n"),
  };

  const userMsg: Msg = {
    role: "user",
    content: JSON.stringify(
      {
        question,
        oldQuery,
        newQuery,
        context: {
          changeCount: context?.changeCount,
          stats: context?.stats,
        },
      },
      null,
      0
    ),
  };

  const msgs: Msg[] = [systemPrompt, ...(history ?? []), primer, userMsg];
  return msgs;
}

/** ============================== LLM Call ============================== **/
async function callOpenAI(messages: Msg[]): Promise<string> {
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const OPENAI_MODEL = DEFAULT_OPENAI_MODEL;
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  const body = {
    model: OPENAI_MODEL,
    messages,
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

/** ============================== Route ============================== **/
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ChatbotBody;
    const question = String(body?.question ?? "").trim();
    const oldQuery = clipText(String(body?.oldQuery ?? ""));
    const newQuery = clipText(String(body?.newQuery ?? ""));
    const context = (body?.context ?? {}) as ChatbotBody["context"];
    const history = Array.isArray(body?.history) ? (body.history as Msg[]) : undefined;

    if (!isNonEmptyString(question)) {
      return NextResponse.json({ error: "question is required" }, { status: 400 });
    }

    const rude = looksRude(question);

    const msgs = buildMessages({
      question: rude
        ? `${question}\n\n(Tone note: user was rude; please respond calmly and helpfully, then steer back to topic.)`
        : question,
      oldQuery,
      newQuery,
      context,
      history,
    });

    const answer = await callOpenAI(msgs);
    return NextResponse.json({
      answer: answer || "I don’t have a specific answer yet.",
      meta: { model: DEFAULT_OPENAI_MODEL, rude },
    });
  } catch (err: any) {
    const msg = safeErrMessage(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
