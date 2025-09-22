// /app/api/chatbot/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { canonicalizeSQL } from "@/lib/query-differ";

/** ============================== Config ============================== **/
const REQUEST_TIMEOUT_MS = 50_000;
// Hard cap for Assistants message 'content' is 256,000 chars. Keep a safety buffer.
const MAX_CONTENT = 240_000;

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
  oldQuery?: string;      // raw old
  newQuery?: string;      // raw new

  /** NEW: exact text currently visible to the user in the UI editor/viewer */
  visibleOld?: string;
  visibleNew?: string;

  /** Optional hint; when not provided we default to 'visible' if visible* are present */
  indexing?: "visible" | "canonical";

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

/** ============================== Line helpers (VISIBLE-first) ============================== **/
function splitLF(s: string) {
  return (s ?? "").replace(/\r\n/g, "\n").split("\n");
}

function numberSelectedLines(lines: string[], indices: number[]) {
  // indices are 0-based line indexes; we render as 1-based
  return indices
    .map((idx) => `${String(idx + 1).padStart(6, " ")} | ${lines[idx] ?? ""}`)
    .join("\n");
}

function buildDisplayBlock(label: string, text: string, opts?: { head?: number; tail?: number }) {
  const head = Math.max(0, opts?.head ?? 800);
  const tail = Math.max(0, opts?.tail ?? 800);
  const lines = splitLF(text);
  const total = lines.length;

  // If small enough, include everything
  if (total <= head + tail + 50) {
    const allIdx = Array.from({ length: total }, (_, i) => i);
    const content = numberSelectedLines(lines, allIdx);
    return {
      header: `${label} (numbered; total ${total} lines)`,
      content,
      included: total,
      total,
      truncated: false,
    };
  }

  // Otherwise include head and tail slices with a gap marker
  const headIdx = Array.from({ length: Math.min(head, total) }, (_, i) => i);
  const tailStart = Math.max(0, total - tail);
  const tailIdx = Array.from({ length: total - tailStart }, (_, i) => tailStart + i);

  const parts = [
    numberSelectedLines(lines, headIdx),
    `… (${total - head - tail} lines omitted) …`,
    numberSelectedLines(lines, tailIdx),
  ].join("\n");

  return {
    header: `${label} (numbered; total ${total} lines; truncated with head ${head} & tail ${tail})`,
    content: parts,
    included: head + tail,
    total,
    truncated: true,
  };
}

function sliceLines(text: string, start1: number, end1?: number) {
  const lines = splitLF(text);
  const total = lines.length;
  const from = Math.max(1, start1);
  const to = Math.min(total, end1 ?? start1);
  const idxs: number[] = [];
  for (let x = from; x <= to; x++) idxs.push(x - 1);
  const chunk = numberSelectedLines(lines, idxs);
  return { text: chunk, from, to, total };
}

function parseLineQuery(q: string):
  | { target: "old" | "new"; start: number; end?: number }
  | null {
  // Examples: "line 300", "line 120-130", "old line 50", "new line 77–92"
  const re = /\b(?:(old|new)\s*)?line\s+(\d+)(?:\s*[-–]\s*(\d+))?\b/i;
  const m = q.match(re);
  if (!m) return null;
  const target = (m[1]?.toLowerCase() as "old" | "new") ?? "new";
  const start = parseInt(m[2], 10);
  const end = m[3] ? parseInt(m[3], 10) : undefined;
  if (!Number.isFinite(start) || start < 1) return null;
  if (end && (!Number.isFinite(end) || end < start)) return null;
  return { target, start, end };
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

async function addMessage(threadId: string, fullContent: string) {
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
  let run: any;
  while (status === "in_progress" || status === "queued") {
    await new Promise((r) => setTimeout(r, 1200));
    const res = await fetch(
      `https://api.openai.com/v1/threads/${threadId}/runs/${runId}`,
      { headers: openAIHeaders(), cache: "no-store" }
    );
    if (!res.ok) throw new Error(await res.text());
    run = await res.json();
    status = run.status;
  }
  return run;
}

async function getMessages(threadId: string) {
  const res = await fetch(
    `https://api.openai.com/v1/threads/${threadId}/messages?limit=10`,
    { headers: openAIHeaders() }
  );
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

/** ============================== Prompt Builder (VISIBLE-indexed) ============================== **/
function buildPrompt(body: ChatbotBody) {
  const question = (body?.question || "").trim();

  // Canonical snapshots (for semantic stability / diffs)
  const canOld = body.oldQuery ? canonicalizeSQL(body.oldQuery) : "";
  const canNew = body.newQuery ? canonicalizeSQL(body.newQuery) : "";

  // Visible snapshots (the exact text the user sees in the UI)
  const visOld = (body.visibleOld ?? canOld) || "";
  const visNew = (body.visibleNew ?? canNew) || "";

  // Decide indexing source of truth
  const indexing: "visible" | "canonical" =
    body.indexing ?? (body.visibleOld || body.visibleNew ? "visible" : "canonical");

  const lineReq = parseLineQuery(question);
  const focusTarget: "old" | "new" = lineReq?.target ?? "new";

  const srcVisible = focusTarget === "old" ? visOld : visNew;
  const srcCanonical = focusTarget === "old" ? canOld : canNew;

  // FOCUS_LINES: always use the declared indexing source (prefer VISIBLE)
  let focusBlock = "";
  if (lineReq) {
    const focusText = indexing === "visible" ? srcVisible : srcCanonical;
    if (focusText) {
      const { text, from, to, total } = sliceLines(focusText, lineReq.start, lineReq.end);
      focusBlock =
        `FOCUS_RANGE (${indexing.toUpperCase()}): ${focusTarget.toUpperCase()} lines ${from}${
          to && to !== from ? `-${to}` : ""
        } of ${total}\n` +
        "FOCUS_LINES:\n```\n" + text + "\n```\n";
    } else {
      focusBlock = `FOCUS_RANGE: (${focusTarget.toUpperCase()} query not provided by user)\n`;
    }
  }

  // Build DISPLAY blocks (both visible and canonical; we’ll shrink as needed)
  let vOldBlk = visOld ? buildDisplayBlock("DISPLAY_VISIBLE_OLD", visOld, { head: 800, tail: 800 }) : null;
  let vNewBlk = visNew ? buildDisplayBlock("DISPLAY_VISIBLE_NEW", visNew, { head: 800, tail: 800 }) : null;
  let cOldBlk = canOld ? buildDisplayBlock("DISPLAY_CANONICAL_OLD", canOld, { head: 800, tail: 800 }) : null;
  let cNewBlk = canNew ? buildDisplayBlock("DISPLAY_CANONICAL_NEW", canNew, { head: 800, tail: 800 }) : null;

  const metaBits: string[] = [];
  if (body.context?.changeCount != null) metaBits.push(`Change count: ${body.context.changeCount}`);
  if (body.context?.stats) metaBits.push(`Stats provided`);

  const header =
    "SYSTEM NOTES FOR ASSISTANT:\n" +
    "- Treat DISPLAY_VISIBLE_* as the single source of truth for line numbers.\n" +
    "- When the user references a line/range, ALWAYS quote from VISIBLE blocks (not canonical).\n" +
    "- If OLD/NEW is unspecified, default to VISIBLE NEW.\n" +
    "- Use CANONICAL blocks only to improve SQL understanding; do not renumber lines.\n" +
    "- If FOCUS_LINES is present, start by quoting those exact line(s) and then explain in 2–4 sentences.\n";

  const compose = () => {
    const ctxParts: string[] = [];
    if (vOldBlk) ctxParts.push(`${vOldBlk.header}:\n\`\`\`\n${vOldBlk.content}\n\`\`\``);
    if (vNewBlk) ctxParts.push(`${vNewBlk.header}:\n\`\`\`\n${vNewBlk.content}\n\`\`\``);
    if (cOldBlk) ctxParts.push(`${cOldBlk.header}:\n\`\`\`\n${cOldBlk.content}\n\`\`\``);
    if (cNewBlk) ctxParts.push(`${cNewBlk.header}:\n\`\`\`\n${cNewBlk.content}\n\`\`\``);
    if (focusBlock) ctxParts.push(focusBlock);
    if (metaBits.length) ctxParts.push(metaBits.join("\n"));
    return [header, ...(ctxParts.length ? [`Context:\n${ctxParts.join("\n\n")}`] : []), `User question: ${question}`].join("\n\n");
  };

  let full = compose();

  // Shrink to stay under MAX_CONTENT.
  // Priority to KEEP: VISIBLE blocks and FOCUS_LINES. Drop CANONICAL first.
  const shrinkSteps = [
    { head: 500, tail: 500 },
    { head: 300, tail: 300 },
    { head: 150, tail: 150 },
    { head: 80, tail: 80 },
    { head: 40, tail: 40 },
  ];

  let step = 0;
  while (full.length > MAX_CONTENT && step < shrinkSteps.length) {
    if (cOldBlk) cOldBlk = buildDisplayBlock("DISPLAY_CANONICAL_OLD", canOld, shrinkSteps[step]);
    if (cNewBlk) cNewBlk = buildDisplayBlock("DISPLAY_CANONICAL_NEW", canNew, shrinkSteps[step]);
    if (vOldBlk) vOldBlk = buildDisplayBlock("DISPLAY_VISIBLE_OLD", visOld, shrinkSteps[step]);
    if (vNewBlk) vNewBlk = buildDisplayBlock("DISPLAY_VISIBLE_NEW", visNew, shrinkSteps[step]);
    full = compose();
    step++;
  }

  // Drop CANONICAL blocks entirely if still too big
  if (full.length > MAX_CONTENT) {
    cOldBlk = null;
    full = compose();
  }
  if (full.length > MAX_CONTENT) {
    cNewBlk = null;
    full = compose();
  }

  // Last resort: keep only FOCUS_LINES + tiny visible block for the focused side
  if (full.length > MAX_CONTENT) {
    const focusVis = focusTarget === "old" ? visOld : visNew;
    const tiny = buildDisplayBlock(`DISPLAY_VISIBLE_${focusTarget.toUpperCase()}`, focusVis, { head: 40, tail: 40 });
    // Keep only the tiny block that matches focus
    if (focusTarget === "old") {
      vOldBlk = tiny;
      vNewBlk = null;
    } else {
      vNewBlk = tiny;
      vOldBlk = null;
    }
    cOldBlk = null;
    cNewBlk = null;
    full = [
      header,
      "Context:\n" + (focusBlock || ""),
      tiny ? `${tiny.header}:\n\`\`\`\n${tiny.content}\n\`\`\`` : "",
      `User question: ${question}`,
    ].filter(Boolean).join("\n\n");
  }

  return { full };
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

    // Build message with DISPLAY_VISIBLE_* numbering and optional FOCUS_LINES
    const { full } = buildPrompt(body);

    // Always call the Assistant (no short-circuit)
    const thread = await createThread();
    await addMessage(thread.id, full);
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
