// /app/api/chatbot/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";

/** ============================== Config ============================== **/
const REQUEST_TIMEOUT_MS = 50000;

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_ASSISTANT_ID = process.env.OPENAI_ASSISTANT_ID;

if (!OPENAI_API_KEY) {
  throw new Error("Missing OPENAI_API_KEY in environment");
}
if (!OPENAI_ASSISTANT_ID) {
  throw new Error("Missing OPENAI_ASSISTANT_ID in environment");
}

/** ============================== Types ============================== **/
interface ChatbotBody {
  question?: string;
  oldQuery?: string;
  newQuery?: string;
  context?: {
    stats?: unknown;
    changeCount?: number;
  };
  history?: { role: string; content: string }[];
}

/** ============================== Utilities ============================== **/
function safeErrMessage(e: any, fallback = "Unexpected error") {
  const raw = typeof e?.message === "string" ? e.message : fallback;
  return raw
    .replace(/(Bearer\s+)[\w.\-]+/gi, "$1[REDACTED]")
    .replace(/(api[-_ ]?key\s*[:=]\s*)\w+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]");
}

function openAIHeaders() {
  return {
    Authorization: `Bearer ${OPENAI_API_KEY}`,
    "Content-Type": "application/json",
    "OpenAI-Beta": "assistants=v2", // ✅ required for Assistants API
  };
}

/** ============================== Assistants API Helpers ============================== **/
async function createThread() {
  const res = await fetch("https://api.openai.com/v1/threads", {
    method: "POST",
    headers: openAIHeaders(),
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function addMessage(threadId: string, body: ChatbotBody) {
  const contextParts: string[] = [];

  if (body.oldQuery) {
    contextParts.push(
      `OLD_QUERY (${body.oldQuery.split("\n").length} lines):\n\`\`\`sql\n${body.oldQuery}\n\`\`\``
    );
  }
  if (body.newQuery) {
    contextParts.push(
      `NEW_QUERY (${body.newQuery.split("\n").length} lines):\n\`\`\`sql\n${body.newQuery}\n\`\`\``
    );
  }
  if (body.context?.changeCount != null) {
    contextParts.push(`Change count: ${body.context.changeCount}`);
  }
  if (body.context?.stats) {
    contextParts.push(`Stats provided`);
  }

  const fullContent = [
    ...(contextParts.length ? [`Context:\n${contextParts.join("\n\n")}`] : []),
    `User question: ${body.question}`,
  ].join("\n\n");

  const res = await fetch(
    `https://api.openai.com/v1/threads/${threadId}/messages`,
    {
      method: "POST",
      headers: openAIHeaders(),
      body: JSON.stringify({ role: "user", content: fullContent }),
    }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function runAssistant(threadId: string) {
  const res = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
    method: "POST",
    headers: openAIHeaders(),
    body: JSON.stringify({ assistant_id: OPENAI_ASSISTANT_ID }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function pollRun(threadId: string, runId: string) {
  let status = "in_progress";
  let run;
  while (status === "in_progress" || status === "queued") {
    await new Promise((r) => setTimeout(r, 1500));
    const res = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
      { headers: openAIHeaders() }
    );
    if (!res.ok) throw new Error(await res.text());
    run = await res.json();
    status = run.status;
  }
  return run;
}

async function getMessages(threadId: string) {
  const res = await fetch(
    `https://api.openai.com/v1/threads/${threadId}/messages`,
    { headers: openAIHeaders() }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** ============================== Route ============================== **/
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ChatbotBody;
    const question = (body?.question || "").trim();

    if (!question) {
      return NextResponse.json(
        {
          answer:
            "Please paste your NEW_QUERY (and OLD_QUERY if you want a diff). You can also ask about a line range like `line 50–70`.",
          meta: { mode: "empty", playSound: true },
        },
        { status: 200 }
      );
    }

    const thread = await createThread();
    await addMessage(thread.id, body);
    const run = await runAssistant(thread.id);
    await pollRun(thread.id, run.id);
    const messages = await getMessages(thread.id);

    const assistantMsg = messages.data.find((m: any) => m.role === "assistant");
    const answer =
      assistantMsg?.content?.[0]?.text?.value ??
      "I couldn’t generate an answer for that query.";

    return NextResponse.json({
      answer,
      meta: { mode: "assistant", playSound: true },
    });
  } catch (err: any) {
    const msg = safeErrMessage(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
