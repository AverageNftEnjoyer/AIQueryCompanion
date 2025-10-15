// /app/api/analyze/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { NextResponse } from "next/server";
import {
  generateQueryDiff,
  buildAlignedRows,
  type ComparisonResult,
  type AlignedRow,
} from "@/lib/query-differ";

/* ============================== Types & Config ============================== */

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";
type GoodBad = "good" | "bad";
/** Single fixed mode for 2–6 sentence explanations */
type DetailMode = "single";

type ChangeItem = {
  type: ChangeType;
  description: string;
  lineNumber: number;
  side: Side;
  span?: number;
  jumpLine?: number;
  index?: number; // added here so we can set it later without re-shaping
};

type ChangeExplanation = {
  index: number;
  explanation: string;
  syntax?: GoodBad;
  performance?: GoodBad;
  // optional diagnostics (not required by UI)
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _syntax_explanation?: string;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _performance_explanation?: string;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _clauses?: string[];
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _change_kind?: string;
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _business_impact?: "clear" | "weak" | "none";
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _risk?: "low" | "medium" | "high";
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore
  _suggestions?: string[];
};

type Provider = "openai";

const PROVIDER: Provider = "openai";

/** Prefer your Agent, else use your cheap model */
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
const ANALYSIS_AGENT_ID = process.env.ANALYSIS_AGENT_ID || "";
const DEFAULT_MODEL = process.env.ANALYSIS_AGENT_MODEL || "gpt-4.1-nano";

const MAX_QUERY_CHARS = 120_000;

// —— Networking knobs —— //
const FUNCTION_MAX_MS = (typeof maxDuration === "number" ? maxDuration : 60) * 1000;
const SAFE_BUDGET_MS = Math.max(5000, FUNCTION_MAX_MS - 2000);
const REQUEST_TIMEOUT_MS = Math.min(
  Number(process.env.ANALYZE_REQUEST_TIMEOUT_MS || process.env.FETCH_TIMEOUT_MS || 55000),
  SAFE_BUDGET_MS
);
const RETRIES = Math.min(2, Number(process.env.LLM_RETRIES ?? 1));

// —— Model budget knobs —— //
const MAX_ITEMS_TO_EXPLAIN = Math.max(60, Number(process.env.MAX_ITEMS_TO_EXPLAIN ?? 80));
const ANALYSIS_MODEL_CLIP_BYTES = Math.max(8_000, Number(process.env.ANALYSIS_MODEL_CLIP_BYTES ?? 12_000));

// —— Paging knobs —— //
const DEFAULT_PAGE_LIMIT = Math.max(10, Number(process.env.ANALYZE_PAGE_LIMIT ?? 30));
const MAX_PAGE_LIMIT = 100;

/* ============================== Small Utilities ============================= */

function isNonEmptyString(x: any): x is string {
  return typeof x === "string" && x.trim().length > 0;
}

function validateInput(body: any) {
  if (!body || !isNonEmptyString(body.oldQuery) || !isNonEmptyString(body.newQuery)) {
    throw new Error("oldQuery and newQuery must be non-empty strings.");
  }
  if (body.oldQuery.length > MAX_QUERY_CHARS || body.newQuery.length > MAX_QUERY_CHARS) {
    throw new Error(`Each query must be ≤ ${MAX_QUERY_CHARS.toLocaleString()} characters.`);
  }
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

/** Always single mode */
function detailFromRequest(_req: Request, _url: URL): DetailMode {
  return "single";
}

function safeErrMessage(e: any, fallback = "Unexpected error") {
  const raw = typeof e?.message === "string" ? e.message : fallback;
  return raw
    .replace(/(Bearer\s+)[\w\.\-]+/gi, "$1[REDACTED]")
    .replace(/(api-key\s*:\s*)\w+/gi, "$1[REDACTED]")
    .replace(/https?:\/\/[^\s)]+/gi, "[redacted-url]");
}

/* -------------------------- Fetch timeout & retry --------------------------- */

async function fetchWithTimeout(input: RequestInfo, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function isRetryableStatus(status: number) {
  return status === 429 || (status >= 500 && status <= 599);
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
        e?.__retryable === true ||
        /(?:ETIMEDOUT|ECONNRESET|ENETUNREACH|EAI_AGAIN|timeout|aborted|AbortError)/i.test(msg);
      if (!retryable || i === max - 1) break;
      await new Promise((res) => setTimeout(res, baseDelay * Math.pow(2, i)));
    }
  }
  throw lastErr;
}

/* --------------------------------- Helpers -------------------------------- */

function asGoodBad(v: any): GoodBad | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim().toLowerCase();
  if (t === "good" || t === "bad") return t;
  return undefined;
}

function coerceExplanations(content: string): ChangeExplanation[] {
  try {
    const parsed = JSON.parse(content);
    const out = (parsed?.explanations || []) as any[];
    return out
      .filter((x) => typeof x?.index === "number" && (typeof x?.text === "string" || typeof x?.explanation === "string"))
      .map((x) => {
        const explanation = String((x.text ?? x.explanation) || "").trim();
        const item: ChangeExplanation = {
          index: x.index,
          explanation,
          syntax: asGoodBad(x.syntax),
          performance: asGoodBad(x.performance),
        };
        if (typeof x.syntax_explanation === "string") (item as any)._syntax_explanation = x.syntax_explanation.trim();
        if (typeof x.performance_explanation === "string") (item as any)._performance_explanation = x.performance_explanation.trim();
        if (Array.isArray(x.clauses)) (item as any)._clauses = x.clauses;
        if (typeof x.change_kind === "string") (item as any)._change_kind = x.change_kind;
        if (typeof x.business_impact === "string") (item as any)._business_impact = x.business_impact;
        if (typeof x.risk === "string") (item as any)._risk = x.risk;
        if (Array.isArray(x.suggestions)) (item as any)._suggestions = x.suggestions;
        return item;
      });
  } catch {
    return [];
  }
}

function clipSqlForModel(sql: string, budget = ANALYSIS_MODEL_CLIP_BYTES): string {
  const raw = (sql || "").replace(/\r/g, "");
  if (raw.length <= budget) return raw;
  const head = raw.slice(0, Math.floor(budget * 0.6));
  const tail = raw.slice(-Math.floor(budget * 0.35));
  return `${head}\n/* ...clipped for model... */\n${tail}`;
}

/* ================== Derive groups EXACTLY like <Changes /> ================== */

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Server version of deriveGroups(rows) — mirrors your Changes.tsx */
function deriveGroupsServer(rows: AlignedRow[]): ChangeItem[] {
  type ModRun = {
    kind: "modification";
    startNew?: number;
    endNew?: number;
    startOld?: number;
    endOld?: number;
    prevPreviewNew?: string;
    prevPreviewOld?: string;
  };
  type AddRun = { kind: "addition"; startNew: number; endNew: number; preview?: string };
  type DelRun = { kind: "deletion"; startOld: number; endOld: number; preview?: string };

  const groups: ChangeItem[] = [];
  let run: ModRun | AddRun | DelRun | null = null;

  const flush = () => {
    if (!run) return;

    if (run.kind === "addition") {
      const start = run.startNew;
      const end = run.endNew;
      const span = end - start + 1;
      const base = span > 1 ? `Lines ${start}-${end}: added ${span} lines` : `Line ${start}: added 1 line`;
      groups.push({
        type: "addition",
        side: "new",
        lineNumber: start,
        span,
        description: run.preview ? `${base}. Preview "${run.preview}"` : base,
      });
    } else if (run.kind === "deletion") {
      const start = run.startOld;
      const end = run.endOld;
      const span = end - start + 1;
      const base = span > 1 ? `Lines ${start}-${end}: removed ${span} lines` : `Line ${start}: removed 1 line`;
      groups.push({
        type: "deletion",
        side: "old",
        lineNumber: start,
        span,
        description: run.preview ? `${base}. Preview "${run.preview}"` : base,
      });
    } else {
      // modification
      const anchorStart = isNum(run.startNew) ? run.startNew : (run.startOld as number);
      const anchorEnd = isNum(run.endNew) ? run.endNew! : (run.endOld as number);
      const span = Math.max(1, anchorEnd - anchorStart + 1);

      const base =
        span > 1 ? `Lines ${anchorStart}-${anchorEnd}: modified ${span} lines` : `Line ${anchorStart}: modified 1 line`;

      const pOld = (run.prevPreviewOld || "").trim();
      const pNew = (run.prevPreviewNew || "").trim();
      const preview =
        pOld && pNew ? `Preview "${pOld}" → "${pNew}"` : pNew ? `Preview "${pNew}"` : pOld ? `Preview "${pOld}"` : "";

      groups.push({
        type: "modification",
        side: "both",
        lineNumber: anchorStart,
        span,
        description: preview ? `${base}. ${preview}` : base,
      });
    }

    run = null;
  };

  const consecutive = (prev: number | undefined, next: number | undefined) =>
    isNum(prev) && isNum(next) && next === prev + 1;

  for (const row of rows) {
    if (row.kind === "unchanged") {
      flush();
      continue;
    }

    if (row.kind === "addition") {
      const lnNew = row.new.lineNumber;
      if (!isNum(lnNew)) {
        flush();
        continue;
      }
      const preview = (row.new.text || "").trim();
      if (run && run.kind === "addition" && consecutive(run.endNew, lnNew)) {
        run.endNew = lnNew;
        if (!run.preview && preview) run.preview = preview;
      } else {
        flush();
        run = { kind: "addition", startNew: lnNew, endNew: lnNew, preview };
      }
      continue;
    }

    if (row.kind === "deletion") {
      const lnOld = row.old.lineNumber;
      if (!isNum(lnOld)) {
        flush();
        continue;
      }
      const preview = (row.old.text || "").trim();
      if (run && run.kind === "deletion" && consecutive(run.endOld, lnOld)) {
        run.endOld = lnOld;
        if (!run.preview && preview) run.preview = preview;
      } else {
        flush();
        run = { kind: "deletion", startOld: lnOld, endOld: lnOld, preview };
      }
      continue;
    }

    // modification
    const lnNew = row.new?.lineNumber;
    const lnOld = row.old?.lineNumber;
    if (!isNum(lnNew) && !isNum(lnOld)) {
      flush();
      continue;
    }

    const pNew = (row.new?.text || "").trim();
    const pOld = (row.old?.text || "").trim();

    if (run && run.kind === "modification") {
      const okNew = !isNum(lnNew) || consecutive(run.endNew, lnNew);
      const okOld = !isNum(lnOld) || consecutive(run.endOld, lnOld);
      if (okNew && okOld) {
        if (isNum(lnNew)) run.endNew = lnNew;
        if (isNum(lnOld)) run.endOld = lnOld;
        if (!run.prevPreviewNew && pNew) run.prevPreviewNew = pNew;
        if (!run.prevPreviewOld && pOld) run.prevPreviewOld = pOld;
      } else {
        flush();
        run = {
          kind: "modification",
          startNew: isNum(lnNew) ? lnNew : undefined,
          endNew: isNum(lnNew) ? lnNew : undefined,
          startOld: isNum(lnOld) ? lnOld : undefined,
          endOld: isNum(lnOld) ? lnOld : undefined,
          prevPreviewNew: pNew,
          prevPreviewOld: pOld,
        };
      }
    } else {
      flush();
      run = {
        kind: "modification",
        startNew: isNum(lnNew) ? lnNew : undefined,
        endNew: isNum(lnNew) ? lnNew : undefined,
        startOld: isNum(lnOld) ? lnOld : undefined,
        endOld: isNum(lnOld) ? lnOld : undefined,
        prevPreviewNew: pNew,
        prevPreviewOld: pOld,
      };
    }
  }

  flush();
  groups.sort((a, b) => a.lineNumber - b.lineNumber);
  return groups;
}

/* ========================== Payload builder (single) ========================== */

function extractLineWindow(sql: string, line: number, window = 8): string {
  const lines = (sql || "").split("\n");
  const a = Math.max(0, line - 1 - window);
  const b = Math.min(lines.length - 1, line - 1 + window);
  return lines.slice(a, b + 1).join("\n");
}

function verbosityForSpan(span: number): "short" | "medium" | "long" {
  if (span <= 2) return "short";
  if (span <= 10) return "medium";
  return "long";
}

function buildUserPayload(oldQuery: string, newQuery: string, changes: ChangeItem[]) {
  const enriched = changes.map((c, i) => {
    const span = Math.max(1, c.span ?? 1);
    const verbosity = verbosityForSpan(span);
    const oldCtx = extractLineWindow(oldQuery, c.side === "old" ? c.lineNumber : Math.max(1, c.lineNumber - 1)).slice(0, 800);
    const newCtx = extractLineWindow(newQuery, c.side !== "old" ? c.lineNumber : Math.max(1, c.lineNumber - 1)).slice(0, 800);

    return {
      index: i,
      type: c.type,
      side: c.side,
      lineNumber: c.lineNumber,
      description: c.description,
      span,
      verbosity,
      hints: [],
      context: { old: oldCtx, newer: newCtx },
    };
  });

  const lengthPolicy =
    "Write 2–6 sentences per change (use 'verbosity' to bias: short≈2–3, medium≈4–5, long≈6). Focus on exactly what changed, correctness/edge-cases, and plan/index/cardinality implications. Keep it concrete and tied to the provided description/context.";

  return {
    task: "Explain each change for a junior developer.",
    guidance: [
      "Return ONLY JSON with a top-level key 'explanations' (array). No prose outside JSON.",
      lengthPolicy,
      "Avoid boilerplate; tie advice to the provided context snippets.",
      "Each item must include: index, text (2–6 sentences), clauses (subset), change_kind, syntax('good'|'bad'), performance('good'|'bad'), syntax_explanation if syntax='bad', performance_explanation if performance='bad', business_impact('clear'|'weak'|'none'), risk('low'|'medium'|'high'), suggestions (0–2).",
    ],
    dialect: "Oracle SQL",
    oldQuery: clipSqlForModel(oldQuery),
    newQuery: clipSqlForModel(newQuery),
    changes: enriched,
    output_schema: {
      explanations: [
        {
          index: "number (echo input index)",
          text: "string (2–6 sentences)",
          clauses:
            "array subset of ['SELECT','FROM','JOIN','WHERE','GROUP BY','HAVING','ORDER BY','LIMIT/OFFSET','WINDOW']",
          change_kind: "string",
          syntax: "good|bad",
          performance: "good|bad",
          syntax_explanation: "string if syntax='bad'",
          performance_explanation: "string if performance='bad'",
          business_impact: "clear|weak|none",
          risk: "low|medium|high",
          suggestions: "array (0–2)",
        },
      ],
    },
  };
}

/* ========================== OpenAI Agent / Model call ========================== */

async function callLLM(systemPrompt: string, userContent: string): Promise<{ text: string; model: string; via: "agent" | "model" }> {
  if (!OPENAI_API_KEY) throw new Error("Missing OPENAI_API_KEY");

  // ---- Try Agent (Responses API) first if configured ----
  if (ANALYSIS_AGENT_ID) {
    const attemptAgent = async () =>
      withRetries(async () => {
        const r = await fetchWithTimeout(
          `${OPENAI_BASE_URL.replace(/\/+$/,"")}/responses`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              agent: ANALYSIS_AGENT_ID,
              input: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userContent },
              ],
              response_format: { type: "json_object" },
              temperature: 0,
              max_output_tokens: 300,
            }),
          },
          REQUEST_TIMEOUT_MS
        );

        if (isRetryableStatus(r.status)) {
          const errText = await r.text().catch(() => "");
          const e = new Error(`OpenAI Responses ${r.status}: ${errText || "retryable error"}`) as any;
          e.__retryable = true;
          throw e;
        }
        if (!r.ok) {
          const errText = await r.text().catch(() => "");
          throw new Error(`OpenAI Responses ${r.status}: ${errText}`);
        }

        const j = await r.json().catch(() => ({}));
        const text =
          (j?.output_text ??
            (Array.isArray(j?.output)
              ? j.output
                  .flatMap((o: any) => (Array.isArray(o?.content) ? o.content : []))
                  .map((c: any) => c?.text)
                  .filter(Boolean)
                  .join("\n")
              : "")) ||
          j?.choices?.[0]?.message?.content?.trim() ||
          "";

        return { text, model: `agent:${ANALYSIS_AGENT_ID}`, via: "agent" as const };
      });

    try {
      const res = await attemptAgent();
      if (res.text && res.text.trim().length) return res;
    } catch {
      // fall through to model
    }
  }

  // ---- Fallback: plain model (Chat Completions) ----
  const attemptModel = async () =>
    withRetries(async () => {
      const r = await fetchWithTimeout(
        `${OPENAI_BASE_URL.replace(/\/+$/,"")}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${OPENAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: DEFAULT_MODEL,
            response_format: { type: "json_object" },
            temperature: 0,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: userContent },
            ],
          }),
        },
        REQUEST_TIMEOUT_MS
      );

      if (isRetryableStatus(r.status)) {
        const errText = await r.text().catch(() => "");
        const e = new Error(`OpenAI Chat ${r.status}: ${errText || "retryable error"}`) as any;
        e.__retryable = true;
        throw e;
      }
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        throw new Error(`OpenAI Chat ${r.status}: ${errText}`);
      }

      const j = await r.json().catch(() => ({}));
      const text = j?.choices?.[0]?.message?.content?.trim() ?? "";
      return { text, model: DEFAULT_MODEL, via: "model" as const };
    });

  return await attemptModel();
}

/* =============================== In-memory cache =============================== */

const cache = new Map<string, any>();
function hashPair(a: string, b: string) {
  let h = 2166136261;
  const s = a + "\u0000" + b;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0).toString(16);
}

/* ----------------------------------- Route ---------------------------------- */

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);
    try {
      validateInput(body);
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }

    const url = new URL(req.url);
    const cursorParam = Number(url.searchParams.get("cursor") ?? 0);
    const limitParam = Number(url.searchParams.get("limit") ?? DEFAULT_PAGE_LIMIT);
    const cursor = Math.max(0, isFinite(cursorParam) ? cursorParam : 0);
    const limit = clamp(isFinite(limitParam) ? limitParam : DEFAULT_PAGE_LIMIT, 10, MAX_PAGE_LIMIT);

    const mode = (url.searchParams.get("mode") || "").toLowerCase(); // "", "item"
    const itemIndexParam = Number(url.searchParams.get("index") ?? NaN);
    const prepOnly = url.searchParams.get("prepOnly") === "1";

    const detail: DetailMode = detailFromRequest(req, url); // always "single"

    const { oldQuery, newQuery } = body as { oldQuery: string; newQuery: string };
    const baseKey = hashPair(oldQuery, newQuery);

    // IMPORTANT: diff on RAW so line numbers match the on-screen comparison
    const diff: ComparisonResult = generateQueryDiff(oldQuery, newQuery, { basis: "raw" });

    // Build aligned rows exactly like the UI, then derive groups the exact same way
    const rows: AlignedRow[] = buildAlignedRows(diff);
    const grouped: ChangeItem[] = deriveGroupsServer(rows);

    if (grouped.length === 0) {
      const payload = {
        analysis: {
          summary: "No substantive changes detected.",
          changes: [],
          recommendations: [],
          riskAssessment: "Low",
          performanceImpact: "Neutral",
        },
        page: { cursor: 0, limit, nextCursor: null, total: 0 },
      };
      return NextResponse.json(payload, { headers: { "Cache-Control": "no-store" } });
    }

    // Cap total items; + collapsed tail entry if needed
    const sorted = [...grouped].sort((a, b) => a.lineNumber - b.lineNumber);
    const head = sorted.slice(0, MAX_ITEMS_TO_EXPLAIN);
    const tailCount = Math.max(0, sorted.length - head.length);
    const explainTargets: ChangeItem[] =
      tailCount > 0
        ? [
            ...head,
            {
              type: "modification",
              description: `+${tailCount} additional changes (collapsed)`,
              lineNumber: head.at(-1)!.lineNumber + 1,
              side: "new",
            },
          ]
        : head;

    /* ========================== MODE: prepOnly (no LLM) ========================== */
    if (prepOnly) {
      const pageItems = explainTargets.slice(cursor, cursor + limit);
      const nextCursor = cursor + pageItems.length < explainTargets.length ? cursor + pageItems.length : null;

      const placeholderChanges = pageItems.map((c, idxOnPage) => {
        const globalIdx = cursor + idxOnPage;
        return {
          ...c,
          index: globalIdx,
          explanation: "Pending…" as const,
          syntax: "good" as GoodBad,
          performance: "good" as GoodBad,
          meta: {
            clauses: [],
            change_kind: undefined,
            business_impact: "none" as const,
            risk: "low" as const,
            suggestions: [],
          },
        };
      });

      const responsePayload = {
        analysis: {
          summary: `Prepared ${explainTargets.length} changes (placeholders).`,
          changes: placeholderChanges,
          recommendations: [],
          riskAssessment: "Low",
          performanceImpact: "Neutral",
        },
        page: { cursor, limit, nextCursor, total: explainTargets.length },
      };

      cache.set(`${baseKey}:prep:${cursor}:${limit}:${detail}`, responsePayload);
      return NextResponse.json(responsePayload, { headers: { "Cache-Control": "no-store" } });
    }

    /* ============================ MODE: item (one-by-one) ============================ */
    if (mode === "item") {
      const total = explainTargets.length;
      const idx = Number.isFinite(itemIndexParam) ? clamp(itemIndexParam, 0, total - 1) : 0;
      const pageItems = [explainTargets[idx]];

      const systemPrompt = [
        "You are a senior Oracle SQL reviewer for a junior developer audience.",
        "Return ONLY JSON with a top-level key 'explanations' (array). No prose outside JSON.",
        "Write 2–6 sentences per change (biased by 'verbosity').",
        "Be concrete: clause semantics, join/predicate effects, null behavior, sargability, indexes, cardinality/row explosion, sort/limit.",
        "Avoid boilerplate and fluff; anchor advice to the provided description and local context.",
        "Each item must include: index, text, clauses, change_kind, syntax, performance, syntax_explanation(if bad), performance_explanation(if bad), business_impact, risk, suggestions(0–2).",
      ].join(" ");

      const userPayload = JSON.stringify(buildUserPayload(oldQuery, newQuery, pageItems));

      let explanationsText = "";
      let lastError: string | undefined;
      let usedModel = "";
      let via: "agent" | "model" = "model";

      try {
        const r = await callLLM(systemPrompt, userPayload);
        explanationsText = r.text;
        usedModel = r.model;
        via = r.via;
      } catch (e: any) {
        lastError = String(e?.message || e);
      }

      const parsed = (() => {
        if (!explanationsText) return [];
        const defenced = explanationsText.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1");
        try {
          return coerceExplanations(defenced);
        } catch {
          return [];
        }
      })();

      const m = parsed.find((e) => typeof e.index === "number");
      let explanation = "Pending…";
      let syntax: GoodBad = "good";
      let performance: GoodBad = "good";
      let meta:
        | {
            clauses?: string[];
            change_kind?: string;
            business_impact?: "clear" | "weak" | "none";
            risk?: "low" | "medium" | "high";
            suggestions?: string[];
          }
        | undefined;

      if (m?.explanation?.trim()) {
        explanation = m.explanation.trim();
        syntax = (m?.syntax === "bad" ? "bad" : "good") as GoodBad;
        performance = (m?.performance === "bad" ? "bad" : "good") as GoodBad;
        meta = {
          clauses: Array.isArray((m as any)._clauses) ? (m as any)._clauses : [],
          change_kind: typeof (m as any)._change_kind === "string" ? (m as any)._change_kind : undefined,
          business_impact:
            (m as any)._business_impact === "clear" || (m as any)._business_impact === "weak" ? (m as any)._business_impact : "none",
          risk: (m as any)._risk === "medium" || (m as any)._risk === "high" ? (m as any)._risk : "low",
          suggestions: Array.isArray((m as any)._suggestions) ? (m as any)._suggestions.slice(0, 2) : [],
        };
      } else if (lastError) {
        const friendly =
          /AbortError|aborted|timeout/i.test(lastError)
            ? "AI analysis temporarily unavailable: Network timeout reaching LLM provider."
            : `AI analysis temporarily unavailable: ${lastError}`;
        explanation = friendly;
      } else {
        explanation = "No AI explanation was produced.";
      }

      const finalChange = {
        ...pageItems[0],
        index: idx,
        explanation,
        syntax,
        performance,
        meta,
      };

      const responsePayload = {
        analysis: {
          summary: `Analyzed item ${idx + 1}/${total}.`,
          changes: [finalChange],
          recommendations: [],
          riskAssessment: "Low",
          performanceImpact: "Neutral",
        },
        page: { cursor: idx, limit: 1, nextCursor: idx + 1 < total ? idx + 1 : null, total },
        ...(process.env.NODE_ENV !== "production" && {
          _debug: {
            providerPreferred: PROVIDER,
            via,
            modelUsed: usedModel,
            usedExplanations: parsed.length,
            error: explanationsText ? undefined : lastError,
            timeoutMs: REQUEST_TIMEOUT_MS,
            retries: RETRIES,
            detailMode: detail,
          },
        }),
      };

      return NextResponse.json(responsePayload, { headers: { "Cache-Control": "no-store" } });
    }

    /* ======================== MODE: page (batch page) ======================== */
    const cacheKey = `${baseKey}:${cursor}:${limit}:page:${detail}`;
    if (cache.has(cacheKey)) {
      return NextResponse.json(cache.get(cacheKey), { headers: { "Cache-Control": "no-store" } });
    }

    const pageItems = explainTargets.slice(cursor, cursor + limit);
    const nextCursor = cursor + pageItems.length < explainTargets.length ? cursor + pageItems.length : null;

    const systemPrompt = [
      "You are a senior Oracle SQL reviewer for a junior developer audience.",
      "Return ONLY JSON with a top-level key 'explanations' (array). No prose outside JSON.",
      "Write 2–6 sentences per change (biased by 'verbosity').",
      "Be concrete: clause semantics, join/predicate effects, null behavior, sargability, indexes, cardinality/row explosion, sort/limit.",
      "Avoid boilerplate and fluff; anchor advice to the provided description and local context.",
      "Each item must include: index, text, clauses, change_kind, syntax, performance, syntax_explanation(if bad), performance_explanation(if bad), business_impact, risk, suggestions(0–2).",
    ].join(" ");

    const userPayload = JSON.stringify(buildUserPayload(oldQuery, newQuery, pageItems));

    let explanationsText = "";
    let modelUsed = "";
    let lastError: string | undefined;
    let via: "agent" | "model" = "model";

    try {
      const r = await callLLM(systemPrompt, userPayload);
      explanationsText = r.text;
      modelUsed = r.model;
      via = r.via;
    } catch (e: any) {
      lastError = String(e?.message || e);
    }

    const parsed = (() => {
      if (!explanationsText) return [];
      const defenced = explanationsText.replace(/```(?:json)?\s*([\s\S]*?)```/gi, "$1");
      try {
        return coerceExplanations(defenced);
      } catch {
        return [];
      }
    })();

    const expMapPage = new Map<number, ChangeExplanation>();
    parsed.forEach((e) => {
      if (typeof e.index === "number" && (e.explanation && e.explanation.length > 0)) expMapPage.set(e.index, e);
    });

    const finalChanges = pageItems.map((c, idxOnPage) => {
      const globalIdx = cursor + idxOnPage;
      const m = expMapPage.get(idxOnPage);
      let explanation: string;

      if (m?.explanation?.trim()) {
        explanation = m.explanation.trim();
      } else if (lastError) {
        const friendly =
          /AbortError|aborted|timeout/i.test(lastError)
            ? "AI analysis temporarily unavailable: Network timeout reaching LLM provider."
            : `AI analysis temporarily unavailable: ${lastError}`;
        explanation = friendly;
      } else {
        explanation = "No AI explanation was produced.";
      }

      const extras: string[] = [];
      if (m?.syntax === "bad" && (m as any)._syntax_explanation) extras.push(`Syntax: ${(m as any)._syntax_explanation}`);
      if (m?.performance === "bad" && (m as any)._performance_explanation)
        extras.push(`Performance: ${(m as any)._performance_explanation}`);
      if (extras.length) explanation += ` ${extras.join(" ")}`;

      return {
        ...c,
        index: globalIdx,
        explanation,
        syntax: (m?.syntax === "bad" ? "bad" : "good") as GoodBad,
        performance: (m?.performance === "bad" ? "bad" : "good") as GoodBad,
        meta: m
          ? {
              clauses: Array.isArray((m as any)._clauses) ? (m as any)._clauses : [],
              change_kind: typeof (m as any)._change_kind === "string" ? (m as any)._change_kind : undefined,
              business_impact:
                (m as any)._business_impact === "clear" || (m as any)._business_impact === "weak"
                  ? (m as any)._business_impact
                  : "none",
              risk: (m as any)._risk === "medium" || (m as any)._risk === "high" ? (m as any)._risk : "low",
              suggestions: Array.isArray((m as any)._suggestions) ? (m as any)._suggestions.slice(0, 2) : [],
            }
          : undefined,
      };
    });

    const counts = finalChanges.reduce(
      (acc, c) => {
        (acc as any)[c.type]++;
        return acc;
      },
      { addition: 0, deletion: 0, modification: 0 } as Record<ChangeType, number>
    );

    const summary =
      `Page ${cursor}-${cursor + finalChanges.length - 1} of ${explainTargets.length}: ` +
      `${finalChanges.length} changes — ${counts.addition} additions, ${counts.modification} modifications, ${counts.deletion} deletions.`;

    const responsePayload = {
      analysis: {
        summary,
        changes: finalChanges,
        recommendations: [],
        riskAssessment: "Low",
        performanceImpact: "Neutral",
      },
      page: { cursor, limit, nextCursor, total: explainTargets.length },
      ...(process.env.NODE_ENV !== "production" && {
        _debug: {
          providerPreferred: PROVIDER,
          via,
          modelUsed,
          usedExplanations: parsed.length,
          timeoutMs: REQUEST_TIMEOUT_MS,
          retries: RETRIES,
          detailMode: detail,
        },
      }),
    };

    cache.set(cacheKey, responsePayload);
    return NextResponse.json(responsePayload, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    const msg = String(err?.name || "") + ": " + safeErrMessage(err);
    return NextResponse.json({ error: msg }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
