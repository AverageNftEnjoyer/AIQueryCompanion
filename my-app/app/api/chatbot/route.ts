export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import { canonicalizeSQL } from "@/lib/query-differ";
import { fetchWithTimeout, mapErrorStatus, safeErrorMessage } from "@/lib/server/http";

const REQUEST_TIMEOUT_MS = Number(process.env.ANALYZE_REQUEST_TIMEOUT_MS || 50_000);
const MAX_CONTENT = 240_000;
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
const CHATBOT_MODEL = process.env.ANALYSIS_AGENT_MODEL || "gpt-4.1-nano";
// One turn = one user message + one assistant reply. Capped server-side too,
// regardless of what the client sends, to bound cost/context size.
const MAX_TURNS = 8;
const MAX_HISTORY_MESSAGE_CHARS = 4_000;

function requireEnv(name: "OPENAI_API_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing ${name} in environment`);
  }
  return value;
}

interface ChatbotBody {
  question?: string;
  oldQuery?: string;
  newQuery?: string;
  visibleOld?: string;
  visibleNew?: string;
  indexing?: "visible" | "canonical";
  context?: {
    stats?: unknown;
    changeCount?: number;
  };
  history?: { role: string; content: string }[];
}

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null;
}

function getRecordString(value: unknown, key: string): string | undefined {
  if (!isJsonRecord(value)) return undefined;
  const candidate = value[key];
  return typeof candidate === "string" ? candidate : undefined;
}

/* ---------- Line helpers (VISIBLE-first, trims trailing empty line) ---------- */
function splitVisibleLines(s: string) {
  const parts = (s ?? "").replace(/\r\n/g, "\n").split("\n");
  if (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
  return parts;
}

function numberSelectedLines(lines: string[], indices: number[]) {
  return indices
    .map((idx) => `${String(idx + 1).padStart(6, " ")} | ${lines[idx] ?? ""}`)
    .join("\n");
}

function buildDisplayBlock(label: string, text: string, opts?: { head?: number; tail?: number }) {
  const head = Math.max(0, opts?.head ?? 800);
  const tail = Math.max(0, opts?.tail ?? 800);
  const lines = splitVisibleLines(text);
  const total = lines.length;

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
  const lines = splitVisibleLines(text);
  const total = lines.length;
  const from = Math.max(1, start1);
  const to = Math.min(total, end1 ?? start1);
  const idxs: number[] = [];
  for (let x = from; x <= to; x++) idxs.push(x - 1);
  const chunk = numberSelectedLines(lines, idxs);
  return { text: chunk, from, to, total };
}

function parseLineQuery(
  q: string
): { target: "old" | "new" | null; start: number; end?: number } | null {
  const re = /\b(?:(old|new)\s*)?line\s+(\d+)(?:\s*(?:-|\u2013|\u2014)\s*(\d+))?\b/i;
  const m = q.match(re);
  if (!m) return null;
  const rawTarget = m[1]?.toLowerCase();
  const target = rawTarget === "old" || rawTarget === "new" ? (rawTarget as "old" | "new") : null;
  const start = parseInt(m[2], 10);
  const end = m[3] ? parseInt(m[3], 10) : undefined;
  if (!Number.isFinite(start) || start < 1) return null;
  if (end && (!Number.isFinite(end) || end < start)) return null;
  return { target, start, end };
}

function parseSideFollowup(q: string): { target: "old" | "new"; line?: number } | null {
  const m = q.match(/^\s*(old|new)(?:\s*(?:line)?\s*(\d{1,7}))?\s*$/i);
  if (!m) return null;
  const target = m[1].toLowerCase() as "old" | "new";
  const line = m[2] ? parseInt(m[2], 10) : undefined;
  return { target, line };
}

function findLastUnscopedLine(history: ChatbotBody["history"]): number | null {
  if (!history) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const h = history[i];
    if (h.role !== "user") continue;
    const parsed = parseLineQuery(h.content);
    if (parsed && parsed.target == null) return parsed.start;
  }
  return null;
}

/* ------------------------------ Chat Completions ------------------------------ */
function extractResponseText(payload: unknown): string {
  if (!isJsonRecord(payload) || !Array.isArray(payload.choices)) return "";
  const first = payload.choices[0];
  if (!isJsonRecord(first) || !isJsonRecord(first.message)) return "";
  const content = first.message.content;
  return typeof content === "string" ? content.trim() : "";
}

type ChatTurn = { role: "user" | "assistant"; content: string };

/** Keep only the last MAX_TURNS exchanges (user+assistant pairs), trimmed and validated. */
function sanitizeHistory(raw: ChatbotBody["history"]): ChatTurn[] {
  if (!Array.isArray(raw)) return [];
  const cleaned = raw
    .filter((h): h is { role: string; content: string } => isJsonRecord(h) && typeof h.content === "string")
    .filter((h) => h.role === "user" || h.role === "assistant")
    .map((h) => ({ role: h.role as "user" | "assistant", content: h.content.trim().slice(0, MAX_HISTORY_MESSAGE_CHARS) }))
    .filter((h) => h.content.length > 0);
  return cleaned.slice(-MAX_TURNS * 2);
}

async function askChatModel(systemText: string, history: ChatTurn[], userText: string): Promise<string> {
  const apiKey = requireEnv("OPENAI_API_KEY");
  const res = await fetchWithTimeout(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: CHATBOT_MODEL,
        temperature: 0.3,
        messages: [
          { role: "system", content: systemText },
          ...history,
          { role: "user", content: userText },
        ],
      }),
    },
    REQUEST_TIMEOUT_MS
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`OpenAI chat completions request failed (${res.status})${errText ? `: ${errText}` : ""}`);
  }

  const payload: unknown = await res.json().catch(() => ({}));
  return extractResponseText(payload);
}

/* ----------------------- Prompt Builder (FORCE RAW NEW LINES) ----------------------- */
function buildPrompt(body: ChatbotBody) {
  const question = (body?.question || "").trim();

  const canOld = body.oldQuery ? canonicalizeSQL(body.oldQuery) : "";
  const canNew = body.newQuery ? canonicalizeSQL(body.newQuery) : "";

 
  const visOld = (body.visibleOld ?? body.oldQuery ?? "") || "";
  const visNew = (body.visibleNew ?? body.newQuery ?? "") || "";

  const indexing: "visible" | "canonical" = "visible";

  const lineReq = parseLineQuery(question);
  const focusTarget: "old" | "new" = (lineReq?.target ?? "new");

  const srcVisible = focusTarget === "old" ? visOld : visNew;
  const srcCanonical = focusTarget === "old" ? canOld : canNew;

  let focusBlock = "";
  if (lineReq) {
    const focusText = indexing === "visible" ? srcVisible : srcCanonical;
    if (focusText) {
      const { text, from, to, total } = sliceLines(focusText, lineReq.start, lineReq.end);
      focusBlock =
        `FOCUS_RANGE: ${focusTarget.toUpperCase()} lines ${from}${to && to !== from ? `-${to}` : ""} of ${total}\n` +
        "FOCUS_LINES:\n```\n" + text + "\n```\n";
    } else {
      focusBlock = `FOCUS_RANGE: (${focusTarget.toUpperCase()} query not provided by user)\n`;
    }
  }

  let vOldBlk = visOld ? buildDisplayBlock("DISPLAY_OLD (raw numbering)", visOld, { head: 800, tail: 800 }) : null;
  let vNewBlk = visNew ? buildDisplayBlock("DISPLAY_NEW (raw numbering)", visNew, { head: 800, tail: 800 }) : null;
  let cOldBlk = canOld ? buildDisplayBlock("DISPLAY_CANONICAL_OLD (do not use for numbering)", canOld, { head: 800, tail: 800 }) : null;
  let cNewBlk = canNew ? buildDisplayBlock("DISPLAY_CANONICAL_NEW (do not use for numbering)", canNew, { head: 800, tail: 800 }) : null;

  const metaBits: string[] = [];
  if (body.context?.changeCount != null) metaBits.push(`Change count: ${body.context.changeCount}`);
  if (body.context?.stats) metaBits.push(`Stats provided`);

 const header =
  "You are QueryLens — a senior Oracle SQL/PLSQL and SQL tutor.\n" +
  "\n" +
  "Important Context Alignment Rules:\n" +
  "- Always reference the numbered NEW query display exactly as shown. This display may include blank placeholder lines to align with deletions from the OLD query.\n" +
  "- Blank lines are intentional; they mark where lines existed in the OLD query. Treat them as meaningful for alignment, not as missing or invalid.\n" +
  "- Never reference canonicalized or raw numbering. Only use the DISPLAY_NEW numbering seen by the user.\n" +
  "- If a referenced line is blank, explain what *used to be there* based on the diff context (e.g., 'This line is blank because a WHERE clause was removed here').\n" +
  "- Use natural phrasing: 'On line 42...', 'Between lines 75–78...' — never say 'RAW line' or 'canonical line'.\n";


  const compose = () => {
    const ctxParts: string[] = [];
    if (vOldBlk) ctxParts.push(`${vOldBlk.header}:\n\`\`\`\n${vOldBlk.content}\n\`\`\``);
    if (vNewBlk) ctxParts.push(`${vNewBlk.header}:\n\`\`\`\n${vNewBlk.content}\n\`\`\``);
    if (cOldBlk) ctxParts.push(`${cOldBlk.header}:\n\`\`\`\n${cOldBlk.content}\n\`\`\``);
    if (cNewBlk) ctxParts.push(`${cNewBlk.header}:\n\`\`\`\n${cNewBlk.content}\n\`\`\``);
    if (focusBlock) ctxParts.push(focusBlock);
    if (metaBits.length) ctxParts.push(metaBits.join("\n"));
    return [...(ctxParts.length ? [`Context:\n${ctxParts.join("\n\n")}`] : []), `User question: ${question}`].join("\n\n");
  };

  let userBody = compose();

  const shrinkSteps = [
    { head: 500, tail: 500 },
    { head: 300, tail: 300 },
    { head: 150, tail: 150 },
    { head: 80, tail: 80 },
    { head: 40, tail: 40 },
  ];

  let step = 0;
  while (header.length + userBody.length > MAX_CONTENT && step < shrinkSteps.length) {
    if (cOldBlk) cOldBlk = buildDisplayBlock("DISPLAY_CANONICAL_OLD (do not use for numbering)", canOld, shrinkSteps[step]);
    if (cNewBlk) cNewBlk = buildDisplayBlock("DISPLAY_CANONICAL_NEW (do not use for numbering)", canNew, shrinkSteps[step]);
    if (vOldBlk) vOldBlk = buildDisplayBlock("DISPLAY_OLD (raw numbering)", visOld, shrinkSteps[step]);
    if (vNewBlk) vNewBlk = buildDisplayBlock("DISPLAY_NEW (raw numbering)", visNew, shrinkSteps[step]);
    userBody = compose();
    step++;
  }

  if (header.length + userBody.length > MAX_CONTENT) {
    cOldBlk = null;
    userBody = compose();
  }
  if (header.length + userBody.length > MAX_CONTENT) {
    cNewBlk = null;
    userBody = compose();
  }

  // Last resort: keep only NEW raw with focus
  if (header.length + userBody.length > MAX_CONTENT) {
    const tiny = buildDisplayBlock(`DISPLAY_NEW (raw numbering)`, visNew, { head: 40, tail: 40 });
    vNewBlk = tiny;
    vOldBlk = null;
    cOldBlk = null;
    cNewBlk = null;
    userBody = [
      "Context:\n" + (focusBlock || ""),
      tiny ? `${tiny.header}:\n\`\`\`\n${tiny.content}\n\`\`\`` : "",
      `User question: ${question}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  return { system: header, user: userBody };
}

/* ---------------------------------- Route ---------------------------------- */
export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => ({}))) as ChatbotBody;
    const question = (body?.question || "").trim();

    if (!question) {
      return NextResponse.json(
        {
          answer:
            "Please paste your NEW query (and OLD query if you want a diff). You can also ask about a line range like “line 50–70”.",
          meta: { mode: "empty", playSound: true },
        },
        { status: 200 }
      );
    }

    const hasVisibleOld = !!(body.visibleOld && body.visibleOld.length);
    const hasVisibleNew = !!(body.visibleNew && body.visibleNew.length);
    const hasRawOld = !!(body.oldQuery && body.oldQuery.length);
    const hasRawNew = !!(body.newQuery && body.newQuery.length);
    const compareMode = (hasVisibleOld && hasVisibleNew) || (hasRawOld && hasRawNew);

    // Prefer RAW queries for visible context (so numbering is raw)
    const visOldText = (body.visibleOld ?? body.oldQuery ?? "") || "";
    const visNewText = (body.visibleNew ?? body.newQuery ?? "") || "";
    const oldLines = splitVisibleLines(visOldText);
    const newLines = splitVisibleLines(visNewText);
    const bothPresent = oldLines.length > 0 && newLines.length > 0;

    // Handle follow-up like "old 220" / "new 180"
    const sideFollowup = parseSideFollowup(question);
    if (sideFollowup && compareMode) {
      let line = sideFollowup.line;
      if (!line) {
        const last = findLastUnscopedLine(body.history);
        if (last) line = last;
      }
      if (line) {
        body.question = `${sideFollowup.target} line ${line}`;
      } else {
        return NextResponse.json(
          {
            answer: `Which line number in the ${sideFollowup.target.toUpperCase()} query? (e.g., “${sideFollowup.target} line 280”)`,
            meta: { mode: "disambiguate", playSound: true },
          },
          { status: 200 }
        );
      }
    }

    // If user said just "line N", prefer NEW; validate range against NEW first.
    const parsed = parseLineQuery(body.question || question);
    if (compareMode && parsed && parsed.target == null && bothPresent) {
      const n = parsed.start;
      const end = parsed.end;
      const withinNew = n >= 1 && n <= newLines.length;
      const withinOld = n >= 1 && n <= oldLines.length;

      if (withinNew) {
        body.question = `new line ${n}${end ? `-${end}` : ""}`;
      } else if (withinOld) {
        body.question = `old line ${n}${end ? `-${end}` : ""}`;
      } else {
        return NextResponse.json(
          {
            answer: `Line ${n} is out of range. NEW has ${newLines.length} line(s); OLD has ${oldLines.length} line(s).`,
            meta: { mode: "range", playSound: true },
          },
          { status: 200 }
        );
      }
    } else if (compareMode && parsed && parsed.target == null && !bothPresent) {
      const n = parsed.start;
      return NextResponse.json(
        {
          answer: `Did you mean OLD or NEW for line ${n}? Reply with “old line ${n}” or “new line ${n}”.`,
          meta: { mode: "disambiguate", playSound: true },
        },
        { status: 200 }
      );
    }

    const { system, user } = buildPrompt({ ...body, indexing: "visible", question: body.question || question });
    const history = sanitizeHistory(body.history);

    const answer = (await askChatModel(system, history, user)).trim() || "I couldn't generate an answer for that query.";

    return NextResponse.json({
      answer,
      meta: { mode: "assistant", playSound: true },
    });
  } catch (err: unknown) {
    const msg = safeErrorMessage(err);
    return NextResponse.json({ error: msg }, { status: mapErrorStatus(msg) });
  }
}
