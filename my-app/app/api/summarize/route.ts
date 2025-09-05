import { NextResponse } from "next/server"

/* ---------- Types ---------- */

type Provider = "xai" | "azure"
type StmtType = "select" | "dml" | "plsql"

interface Payload { newQuery: string; analysis?: unknown; audience?: "stakeholder" | "developer" }
interface LLMResult {
  tldr: string
  structured: Record<string, any>
  meta: {
    provider: Provider
    model: string
    latencyMs: number
    pass: "model-p1" | "model-p2" | "heuristic"
    largeInput: boolean
    clipBytes: number
    audience: "stakeholder" | "developer"
  }
}

type ContextHints = {
  freshnessHint: string
  subqueryHints: string[]
  windowFnHint: string | ""
  setOpsHint: string | ""
}

/* ---------- Config ---------- */

const DEFAULT_XAI_MODEL = "grok-4"
const DEFAULT_AZURE_API_VERSION = "2024-02-15-preview"

// Accept any input size; only clip what we *send to the model*
const MODEL_CLIP_BYTES = 12_000
const REQUEST_TIMEOUT_MS = 28_000

/* ---------- Route ---------- */

export async function POST(req: Request) {
  const t0 = Date.now()
  try {
    const body = (await req.json()) as Payload
    const newQuery = typeof body?.newQuery === "string" ? body.newQuery.trim() : ""
    if (!newQuery) return NextResponse.json({ error: "newQuery is required" }, { status: 400 })

    // Audience: default to stakeholder (per your request)
    const url = new URL(req.url)
    const audienceParam = (url.searchParams.get("audience") || "").toLowerCase()
    const bodyAudience = (typeof (body as any)?.audience === "string" ? (body as any).audience : "").toLowerCase()
    const audience: "stakeholder" | "developer" =
      audienceParam === "developer" || bodyAudience === "developer" ? "developer" : "stakeholder"

    // Detect statement type
    const stmt = detectStmtType(newQuery)
    const provider: Provider = ((process.env.LLM_PROVIDER || "xai").toLowerCase() as Provider) || "xai"

    // Build hints/signals from full text (no clipping here)
    const hints = getQueryHints(newQuery)
    const signals = extractSignals(newQuery)

    // Smart clip the payload for the model
    const { clip, clipBytes } = smartClip(newQuery, stmt, MODEL_CLIP_BYTES)
    const systemPrompt1 = buildSystemPrompt(stmt, /*strict*/ false)
    const userPayload1 = buildUserPayload(clip, stmt, hints, signals, /*forceConcreteness*/ false, audience)

    // Pass 1
    let metaPass: LLMResult["meta"]["pass"] = "model-p1"
    let { text, model } =
      provider === "azure" ? await callAzure(systemPrompt1, userPayload1) : await callXAI(systemPrompt1, userPayload1)

    let parsed = tryParseLastJson(text)
    // Backfill basics if model missed them
    if (!parsed.freshness && hints.freshnessHint) parsed.freshness = hints.freshnessHint
    if ((!parsed.entities || parsed.entities.length === 0) && signals.tables.length) {
      parsed.entities = signals.tables.slice(0, 10)
    }

    let tldr = composeTLDR(stmt, parsed, audience).trim()

    // Anti-boilerplate second pass
    if (!tldr || isBoilerplate(tldr)) {
      const systemPrompt2 = buildSystemPrompt(stmt, /*strict*/ true)
      const userPayload2 = buildUserPayload(clip, stmt, hints, signals, /*forceConcreteness*/ true, audience)
      metaPass = "model-p2"
      const second =
        provider === "azure" ? await callAzure(systemPrompt2, userPayload2) : await callXAI(systemPrompt2, userPayload2)
      text = second.text; model = second.model

      parsed = tryParseLastJson(text)
      if (!parsed.freshness && hints.freshnessHint) parsed.freshness = hints.freshnessHint
      if ((!parsed.entities || parsed.entities.length === 0) && signals.tables.length) {
        parsed.entities = signals.tables.slice(0, 10)
      }
      tldr = composeTLDR(stmt, parsed, audience).trim()

      // Heuristic fallback
      if (!tldr || isBoilerplate(tldr)) {
        metaPass = "heuristic"
        const heur = heuristicSummary(stmt, newQuery, hints, signals, audience)
        parsed = { ...parsed, ...heur.structured }
        tldr = heur.tldr
      }
    }

    if (!tldr) return NextResponse.json({ error: "Empty summary" }, { status: 502 })

    const res: LLMResult = {
      tldr,
      structured: parsed,
      meta: {
        provider,
        model,
        latencyMs: Date.now() - t0,
        pass: metaPass,
        largeInput: newQuery.length > MODEL_CLIP_BYTES,
        clipBytes,
        audience,
      },
    }

    return NextResponse.json(res)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Unexpected error" }, { status: 500 })
  }
}

/* ---------- Boilerplate detection ---------- */

const BAD_PHRASES = [
  /concise business-facing dataset/i,
  /core tables/i,
  /scope that matters for reporting/i,
  /applies grouping or ordering/i,
  /intended for dashboards or scheduled reports/i,
  /supports day-to-day monitoring/i,
  /reasonably fresh/i,
  /within normal batch windows/i,
  /this query prepares/i,
  /this statement applies controlled changes/i,
  /business-ready dataset/i
]

function isBoilerplate(text: string): boolean {
  const s = text.trim()
  if (s.length < 40) return true
  return BAD_PHRASES.some(r => r.test(s))
}

/* ---------- Statement detection ---------- */

function detectStmtType(sql: string): StmtType {
  const s = stripComments(sql).trim().toUpperCase()
  if (/^SELECT\b|^WITH\b/.test(s)) return "select"
  if (/^INSERT\b|^UPDATE\b|^DELETE\b|^MERGE\b/.test(s)) return "dml"
  if (/\bCREATE\s+(OR\s+REPLACE\s+)?(PACKAGE|PROCEDURE|FUNCTION)\b/.test(s) || /\bDECLARE\b|\bBEGIN\b[\s\S]*\bEND\b;?/.test(s))
    return "plsql"
  return "select"
}

/* ---------- Smart clipping ---------- */

function smartClip(sql: string, stmt: StmtType, budget: number): { clip: string; clipBytes: number } {
  const raw = sql.replace(/\r/g, "")
  if (raw.length <= budget) return { clip: raw, clipBytes: raw.length }

  if (stmt === "select") {
    const head = raw.slice(0, 4000)
    const where = (raw.match(/WHERE[\s\S]*?(GROUP\s+BY|ORDER\s+BY|UNION|INTERSECT|MINUS|$)/i)?.[0] || "").slice(0, 3000)
    const group = (raw.match(/GROUP\s+BY[\s\S]*?(ORDER\s+BY|UNION|INTERSECT|MINUS|$)/i)?.[0] || "").slice(0, 2000)
    const order = (raw.match(/ORDER\s+BY[\s\S]*?(UNION|INTERSECT|MINUS|$)/i)?.[0] || "").slice(0, 1500)
    const clip = [head, where, group, order].filter(Boolean).join("\n/* ...clipped... */\n").slice(0, budget)
    return { clip, clipBytes: clip.length }
  }

  if (stmt === "dml") {
    const head = raw.slice(0, 4000)
    const where = (raw.match(/WHERE[\s\S]*?;/i)?.[0] || raw.match(/WHERE[\s\S]*?(RETURNING|$)/i)?.[0] || "").slice(0, 4000)
    const clip = [head, where].filter(Boolean).join("\n/* ...clipped... */\n").slice(0, budget)
    return { clip, clipBytes: clip.length }
  }

  // PLSQL
  const header = (raw.match(/\bCREATE\s+(OR\s+REPLACE\s+)?(PACKAGE|PROCEDURE|FUNCTION)[\s\S]{0,3000}/i)?.[0] || raw.slice(0, 3000))
  const sigs = (raw.match(/\b(PROCEDURE|FUNCTION)\s+[A-Z0-9_]+\s*\([^\)]{0,400}\)/gi) || []).slice(0, 6).join("\n")
  const bodies = (raw.match(/\b(PROCEDURE|FUNCTION)\s+[A-Z0-9_]+[\s\S]{0,1200}?END\s+\1/gi) || []).slice(0, 2).join("\n/* ...clipped... */\n")
  const clip = [header, sigs, bodies].filter(Boolean).join("\n/* ...clipped... */\n").slice(0, budget)
  return { clip, clipBytes: clip.length }
}

/* ---------- Hints (subqueries/windows/set ops + freshness) ---------- */

function getQueryHints(sql: string): ContextHints {
  const s = sql.toUpperCase().replace(/\/\*[\s\S]*?\*\/|--.*$/gm, " ")

  const subqueryHints: string[] = []
  if (/\bWITH\b/.test(s)) subqueryHints.push("Uses CTE(s) for modularizing logic.")
  if (/\bEXISTS\s*\(/.test(s)) subqueryHints.push("Uses EXISTS for presence checks (semi-joins).")
  if (/\bIN\s*\(\s*SELECT\b/.test(s)) subqueryHints.push("Uses IN (subquery) for membership filtering.")
  if (/\b(ANY|ALL)\s*\(\s*SELECT\b/.test(s)) subqueryHints.push("Uses ANY/ALL subquery comparisons.")

  const windowFnHint = /\bOVER\s*\(/.test(s)
    ? "Uses analytic/window functions for rankings or running totals."
    : ""

  const setOpsHint = /\b(UNION|INTERSECT|MINUS)\b/.test(s)
    ? "Combines result sets via set operations."
    : ""

  const freshnessHint = deriveFreshnessHint(s)

  return { freshnessHint, subqueryHints, windowFnHint, setOpsHint }
}

function deriveFreshnessHint(S: string): string {
  if (/\b(SYSDATE|SYSTIMESTAMP|CURRENT_DATE|CURRENT_TIMESTAMP)\b/.test(S)) {
    if (/\bTRUNC\(\s*SYSDATE\s*\)\b/.test(S)) {
      if (/\bBETWEEN\b[\s\S]*\bSYSDATE\b/.test(S)) return "Intraday (today→now) within warehouse latency."
      if (/\b>=\s*TRUNC\(\s*SYSDATE\s*\)/.test(S)) return "Intraday (start of day) within warehouse latency."
    }
    if (/\bSYSDATE\s*-\s*\d+(\.\d+)?\b/.test(S)) return "Rolling recent window relative to now."
    if (/\bBETWEEN\b[\s\S]*\bSYSDATE\s*-\s*\d+[\s\S]*\bAND\b[\s\S]*\bSYSDATE\b/.test(S))
      return "Rolling N-day window up to current time."
    return "Near real-time relative to current time."
  }
  if (/\bTRUNC\(\s*([A-Z_\.]*\.)?[A-Z_]+,\s*'DD'\s*\)/.test(S) || /\bTRUNC\(\s*SYSDATE\s*\)\b/.test(S))
    return "Daily periodized."
  if (/\bTRUNC\(\s*([A-Z_\.]*\.)?[A-Z_]+,\s*'IW'\s*\)/.test(S))
    return "Weekly periodized."
  if (/\bTRUNC\(\s*([A-Z_\.]*\.)?[A-Z_]+,\s*'MM'\s*\)/.test(S))
    return "Monthly periodized."
  if (/\bADD_MONTHS\(\s*TRUNC\(\s*SYSDATE\s*,\s*'MM'\s*\)\s*,\s*-?\d+\s*\)/.test(S))
    return "Month-to-date or prior-month window."
  if (/\b(BETWEEN|>=|>)\s*TRUNC\(\s*SYSDATE\s*\)\s*-\s*\d+\b/.test(S) || /\b>=\s*SYSDATE\s*-\s*\d+\b/.test(S))
    return "Rolling N-day window."
  return ""
}

/* ---------- Signals extraction ---------- */

function extractSignals(sql: string) {
  const up = sql.toUpperCase()

  const tableLike = (up.match(/\b([A-Z_]+\.)?[A-Z_]+(?:_T|_V|_MV|_FCT|_DIM)?\b/g) || [])
    .filter(t => !STOP_WORDS.has(t))
  const schemaQual = (up.match(/\b[A-Z][A-Z0-9_]*\.[A-Z_]+\b/g) || [])
  const tables = Array.from(new Set([...schemaQual, ...tableLike])).slice(0, 30)

  const procs = Array.from(new Set((up.match(/\bPROCEDURE\s+([A-Z_0-9]+)\b/g) || []).map(m => m.split(/\s+/)[1]))).slice(0, 20)
  const funcs = Array.from(new Set((up.match(/\bFUNCTION\s+([A-Z_0-9]+)\b/g) || []).map(m => m.split(/\s+/)[1]))).slice(0, 20)

  const businessVerbs = Array.from(new Set(up.match(/\b(ALLOCATE|CALCULATE|UPDATE|PROCESS|DELETE|INSERT|LOG|RECONCILE|EXPORT|POST|ROLLUP)\b/g) || [])).slice(0, 20)

  const wherePreds = (sql.match(/WHERE[\s\S]*?(GROUP\s+BY|ORDER\s+BY|UNION|INTERSECT|MINUS|$)/gi) || [])
    .map(w => w.replace(/--.*$/gm,"").replace(/\/\*[\s\S]*?\*\//gm,"").slice(0, 600))
  const samplePredicates = wherePreds.join(" ").match(/\b([A-Z_\.]+)\s*(=|IN|BETWEEN|>=|<=|>|<)\s*([A-Z0-9_'":(),.\s-]{1,40})/gi) || []

  const hasRMA = /\bRMA\b|\bRETURN\b/.test(up)
  const hasIntraCo = /\bINTRA[-_\s]?COMPANY\b|\bINTRA[_\s]?DEST[_\s]?ORG\b/.test(up)
  const hasCredit = /\bCREDIT\b/.test(up)

  const grouping = /\bGROUP\s+BY\b/i.test(sql)
  const ordering = /\bORDER\s+BY\b/i.test(sql)
  const joins = (sql.match(/\bJOIN\b/gi) || []).length

  return { tables, procs, funcs, businessVerbs, wherePredicates: samplePredicates.slice(0, 8), flags: { hasRMA, hasIntraCo, hasCredit }, grouping, ordering, joins }
}

const STOP_WORDS = new Set([
  "SELECT","FROM","JOIN","WHERE","GROUP","ORDER","BY","ON","AND","OR","NOT",
  "INSERT","UPDATE","DELETE","MERGE","CREATE","PACKAGE","PROCEDURE","FUNCTION",
  "BEGIN","END","DECLARE","VALUES","SET","WITH","UNION","INTERSECT","MINUS"
])

/* ---------- Prompting ---------- */

function buildSystemPrompt(stmt: StmtType, strict: boolean): string {
  const commonEnd = strict
    ? "Return ONLY JSON. Use concrete nouns from the payload (tables, routines, example filters). Avoid generic placeholders (e.g., 'core tables', 'reasonably fresh'). If unsure, write 'unknown'. Do not paste SQL."
    : "Return ONLY JSON. Prefer concrete nouns from the payload (tables, routines, filters). Do not paste SQL."

  if (stmt === "select") {
    return [
      "You are a senior Oracle/SQL developer writing for junior devs and project managers.",
      `JSON schema: {
        "purpose": string,
        "entities": string[],
        "fgo": string,
        "freshness": string,
        "risks": string,
        "specialTechniques": string
      }`,
      "Describe ONLY what the current SELECT produces and why it is used.",
      commonEnd
    ].join(" ")
  }
  if (stmt === "dml") {
    return [
      "You are a senior Oracle developer.",
      `JSON schema: {
        "purpose": string,
        "entities": string[],
        "effects": string,
        "risks": string,
        "freshness": string
      }`,
      "Describe ONLY what this DML changes and why.",
      commonEnd
    ].join(" ")
  }
  return [
    "You are a senior Oracle developer.",
    `JSON schema: {
      "purpose": string,
      "entities": string[],
      "keyRoutines": string[],
      "flow": string,
      "freshness": string,
      "risks": string,
      "specialTechniques": string
    }`,
    "Describe ONLY what this code does in business terms.",
    commonEnd
  ].join(" ")
}

function buildUserPayload(
  clip: string,
  stmt: StmtType,
  contextHints: ContextHints,
  signals: ReturnType<typeof extractSignals>,
  forceConcreteness = false,
  audience: "stakeholder" | "developer" = "stakeholder"
): string {
  const NoGeneric = forceConcreteness
    ? {
        AvoidPhrases: [
          "concise business-facing dataset","core tables","scope that matters for reporting",
          "applies grouping or ordering","intended for dashboards or scheduled reports",
          "supports day-to-day monitoring","reasonably fresh","normal batch windows","business-ready dataset"
        ]
      }
    : {}
  return JSON.stringify({
    stmtType: stmt,
    audience,
    ContextHints: contextHints,
    Signals: signals,
    codeClip: clip,
    ...NoGeneric
  })
}

/* ---------- Acronyms (expanded for stakeholder) ---------- */

const ACRONYM_MAP: Record<string,string> = {
  // Finance & Accounting
  "AP": "Accounts Payable",
  "AR": "Accounts Receivable",
  "GL": "General Ledger",
  "COGS": "Cost of Goods Sold",
  "PO": "Purchase Order",
  "PR": "Purchase Requisition",
  "INV": "Invoice",
  "CM": "Credit Memo",
  "DM": "Debit Memo",
  "VAT": "Value-Added Tax",
  "FX": "Foreign Exchange",
  "MTD": "Month to Date",
  "QTD": "Quarter to Date",
  "YTD": "Year to Date",
  "EOM": "End of Month",

  // Supply Chain / Logistics
  "BOM": "Bill of Materials",
  "MRP": "Material Requirements Planning",
  "WIP": "Work in Process",
  "SKU": "Stock Keeping Unit",
  "RMA": "Return Material Authorization",
  "ASN": "Advanced Shipping Notice",
  "ETA": "Estimated Time of Arrival",
  "ETD": "Estimated Time of Departure",
  "SLA": "Service Level Agreement",
  "DC": "Distribution Center",
  "WH": "Warehouse",
  "UOM": "Unit of Measure",
  "LT": "Lead Time",
  "MOQ": "Minimum Order Quantity",

  // Oracle / ERP
  "EBS": "E-Business Suite",
  "HCM": "Human Capital Management",
  "CRM": "Customer Relationship Management",
  "ERP": "Enterprise Resource Planning",
  "BI": "Business Intelligence",
  "UDM": "Unified Data Model",

  // Data / Analytics / DB
  "ETL": "Extract, Transform, Load",
  "ELT": "Extract, Load, Transform",
  "KPI": "Key Performance Indicator",
  "OLAP": "Online Analytical Processing",
  "OLTP": "Online Transaction Processing",
  "SQL": "Structured Query Language",
  "DDL": "Data Definition Language",
  "DML": "Data Manipulation Language",
  "PK": "Primary Key",
  "FK": "Foreign Key",
}

function expandAcronyms(text: string, seen = new Set<string>()): string {
  if (!text) return text
  const keys = Object.keys(ACRONYM_MAP).join("|")
  if (!keys) return text
  const rx = new RegExp(`\\b(${keys})\\b`, "g")
  return text.replace(rx, (m) => {
    if (!seen.has(m)) {
      seen.add(m)
      return `${ACRONYM_MAP[m]} (${m})`
    }
    return m
  })
}

/* ---------- TLDR composition router ---------- */

function composeTLDR(
  stmt: StmtType,
  d: any,
  audience: "stakeholder" | "developer" = "stakeholder"
): string {
  const entitiesTxt = formatEntities(d.entities)
  const base = (audience === "developer")
    ? composeTLDR_Developer(stmt, d, entitiesTxt)
    : composeTLDR_Stakeholder(stmt, d, entitiesTxt)

  // Stakeholder: expand acronyms and scrub any remaining tech identifiers
  const finalText = (audience === "stakeholder") ? softDeTech(expandAcronyms(base)) : base
  return scrubBoilerplate(finalText)
}

/* ---------- Stakeholder (plain-English, 4–6 sentences, no raw tech names) ---------- */

function composeTLDR_Stakeholder(stmt: StmtType, d: any, entitiesTxt: string): string {
  const focus = stmt === "select" ? "query" : stmt === "dml" ? "statement" : "PL/SQL unit"
  const purpose = d.purpose || (stmt === "select" ? "producing a clear report" : stmt === "dml" ? "applying targeted changes" : "running an end-to-end process")
  const howSimple = simpleTechniqueLine(d) // e.g., “It uses lookups and simple checks to match records.”
  const freshness = d.freshness ? `You can expect ${trimPeriod(d.freshness)}.` : ""

  // Describe “what it does” + “how it works” in basic terms; avoid naming entities directly.
  let body = ""
  if (stmt === "select") {
    const fgo = d.fgo ? simplifyFGO(d.fgo) : "It organizes the results so totals and comparisons are easy to read."
    body = [
      `To start, this ${focus} focuses on ${purpose}.`,
      `It pulls the right business records and ${fgo}`,
      howSimple,
      freshness,
    ].filter(Boolean).join(" ")
  } else if (stmt === "dml") {
    const effects = d.effects ? simplifyEffects(d.effects) : "It updates only the rows that meet the intended conditions."
    const fresh2 = freshness ? freshness.replace(/^You can expect/, "Changes become visible when") : ""
    body = [
      `To start, this ${focus} focuses on ${purpose}.`,
      `It works on the relevant business records. ${effects}`,
      howSimple,
      fresh2,
    ].filter(Boolean).join(" ")
  } else {
    const flow = d.flow ? simplifyFlow(d.flow) : "It processes the inputs step-by-step and writes back the results."
    const fresh3 = freshness ? freshness.replace(/^You can expect/, "Timing and freshness:") : ""
    body = [
      `To start, this ${focus} focuses on ${purpose}.`,
      flow,
      howSimple,
      fresh3,
    ].filter(Boolean).join(" ")
  }

  const constrained = clampSentences(body, 4, 6)
  const closer = buildInShortStakeholder(stmt, d) // no entity names in closer
  return `${constrained} ${closer}`.trim()
}

/* ---------- Developer (can mention entities/techniques; still human) ---------- */

function composeTLDR_Developer(stmt: StmtType, d: any, entitiesTxt: string): string {
  const focus = stmt === "select" ? "query" : stmt === "dml" ? "statement" : "PL/SQL unit"
  const extras: string[] = []
  if (d.specialTechniques) extras.push(sentenceize(d.specialTechniques))
  if (d.fgo && stmt === "select") extras.push(sentenceize(d.fgo))
  if (stmt === "dml" && d.effects) extras.push(sentenceize(d.effects))
  if (d.freshness) extras.push(`Freshness/latency: ${trimPeriod(d.freshness)}.`)
  if (d.risks) extras.push(`Risks/assumptions: ${trimPeriod(d.risks)}.`)

  let first = ""
  if (stmt === "select") {
    const purpose = d.purpose || "producing an analytical dataset"
    first = `This ${focus} generates ${purpose} from ${entitiesTxt}, emphasizing the business-relevant slice of data.`
  } else if (stmt === "dml") {
    const purpose = d.purpose || "performing controlled updates"
    first = `This ${focus} performs ${purpose} on ${entitiesTxt}, scoped by the intended predicates.`
  } else {
    const purpose = d.purpose || "coordinating batch logic and persistence"
    const routines = d.keyRoutines?.length ? ` Key routines: ${d.keyRoutines.slice(0,4).join(", ")}.` : ""
    first = `This ${focus} handles ${purpose} across ${entitiesTxt}.${routines}`
  }

  const body = [first, ...extras].filter(Boolean).join(" ")
  const constrained = clampSentences(body, 5, 8)
  const closer = buildInShortDeveloper(stmt, d, entitiesTxt)
  return `${constrained} ${closer}`.trim()
}

/* ---------- Tone helpers & stakeholder simplifiers ---------- */

function toClause(s?: string): string {
  if (!s) return ""
  const t = s.trim().replace(/^[Uu]ses\b/, "It uses")
  return t.endsWith(".") ? t : `${t}.`
}

function sentenceize(s: string): string {
  if (!s) return ""
  s = s.trim()
  s = s.replace(/\b(GROUP|ORDER|WHERE|JOIN)\b/gi, (m) => m.toLowerCase())
  return s.endsWith(".") ? s : `${s}.`
}

function simpleTechniqueLine(d: any): string {
  const bits: string[] = []
  if (d.specialTechniques?.match(/window|analytic/i)) bits.push("running totals or rankings")
  if (d.specialTechniques?.match(/set operations|UNION|INTERSECT|MINUS/i)) bits.push("combining lists")
  if (d.specialTechniques?.match(/IN|EXISTS/i)) bits.push("membership or existence checks")
  if (bits.length === 0) return ""
  return `It uses simple techniques like ${bits.join(", ")} to match and combine the right records.`
}

function simplifyFGO(s: string): string {
  s = s.replace(/GROUP\s+BY/gi, "groups")
  s = s.replace(/ORDER\s+BY/gi, "orders")
  s = s.replace(/\bJOIN\b/gi, "joins")
  return sentenceize(s)
}

function simplifyEffects(s: string): string {
  s = s.replace(/WHERE/gi, "where")
  s = s.replace(/IN\s*\(.+?\)/gi, "in a defined list")
  return sentenceize(s)
}

function simplifyFlow(s: string): string {
  // De-tech: translate “steps include update/insert/log …” to plain English
  s = s.replace(/steps include/gi, "it proceeds through steps like")
  s = s.replace(/\blog(s|ging)?\b/gi, "recording activity")
  return sentenceize(s)
}

function buildInShortStakeholder(stmt: StmtType, d: any): string {
  const gist =
    stmt === "select"
      ? (d.purpose ? d.purpose : "summarizing the right data for decision-making")
      : stmt === "dml"
      ? (d.purpose ? d.purpose : "applying the intended changes safely")
      : (d.purpose ? d.purpose : "running the end-to-end process reliably")

  const addon =
    stmt === "select"
      ? d.fgo ? ` ${trimPeriod(d.fgo)}` : ""
      : stmt === "dml"
      ? d.effects ? ` ${trimPeriod(d.effects)}` : ""
      : ""

  return `In short, it ${gist.toLowerCase()} using the relevant business data.${addon ? " " + sentenceize(addon) : ""}`
}

function buildInShortDeveloper(stmt: StmtType, d: any, entitiesTxt: string): string {
  const gist =
    stmt === "select"
      ? (d.purpose ? d.purpose : "summarizing the right data for decision-making")
      : stmt === "dml"
      ? (d.purpose ? d.purpose : "applying the intended changes safely")
      : (d.purpose ? d.purpose : "running the end-to-end process reliably")

  const extra =
    stmt === "select" ? (d.fgo ? ` ${trimPeriod(d.fgo)}` : "")
    : stmt === "dml" ? (d.effects ? ` ${trimPeriod(d.effects)}` : "")
    : d.keyRoutines?.length ? ` via ${d.keyRoutines.slice(0,2).join(" & ")}` : ""

  return `In short, it ${gist.toLowerCase()} using ${entitiesTxt}.${extra ? " " + (extra.endsWith(".") ? extra : extra + ".") : ""}`
}


/* ---------- De-tech: remove raw identifiers for stakeholder ---------- */

function softDeTech(input: string): string {
  if (!input) return input
  let s = input

  // schema.table → “business tables”
  s = s.replace(/\b[A-Z][A-Z0-9_]*\.[A-Z][A-Z0-9_]*\b/g, "business tables")

  // screaming_snake identifiers (tables, procs, funcs) → “business logic/data”
  s = s.replace(/\b([A-Z][A-Z0-9]*_){1,}[A-Z0-9]*\b/g, "business logic")

  // “via logging_*” → “with supporting logs”
  s = s.replace(/via\s+logging[_a-z0-9]*/gi, "with supporting logs")

  // collapse double spaces leftover
  return s.replace(/\s{2,}/g, " ").trim()
}

/* ---------- Heuristic fallback ---------- */

function heuristicSummary(
  stmt: StmtType,
  sql: string,
  hints: ContextHints,
  sig: ReturnType<typeof extractSignals>,
  audience: "stakeholder" | "developer"
) {
  const structured: any = {}
  structured.entities = sig.tables.slice(0, 10)
  if (stmt === "select") {
    structured.purpose = guessPurposeFromTables(sig.tables) || "a reporting dataset"
    structured.fgo = [
      sig.joins ? `${sig.joins} join(s) across ${structured.entities.length || "multiple"} table(s)` : "",
      sig.wherePredicates?.length ? `filters such as ${sig.wherePredicates.slice(0,3).join("; ")}` : "",
      sig.grouping ? "groups results (aggregations present)" : "",
      sig.ordering ? "orders results for readability" : ""
    ].filter(Boolean).join("; ")
    structured.freshness = hints.freshnessHint || "unknown"
    structured.risks = "subject to data latency and edge-case records"
    structured.specialTechniques = [hints.windowFnHint, ...hints.subqueryHints, hints.setOpsHint].filter(Boolean).join(" ")
  } else if (stmt === "dml") {
    structured.purpose = guessPurposeFromVerbs(sig.businessVerbs) || "controlled data changes"
    structured.effects = sig.wherePredicates?.length
      ? `modifies rows meeting conditions like ${sig.wherePredicates.slice(0,3).join("; ")}`
      : "modifies targeted rows based on WHERE conditions"
    structured.freshness = "visible once the transaction commits and downstream ETL refreshes"
    structured.risks = "risk of unintended updates if predicates are broad"
  } else {
    structured.purpose = guessPurposeFromVerbs(sig.businessVerbs) || "a business process orchestrator"
    structured.keyRoutines = [...sig.funcs.slice(0,4), ...sig.procs.slice(0,4)].slice(0,4)
    structured.flow = buildFlow(sig)
    structured.freshness = hints.freshnessHint || "per batch run timing"
    const flags = []
    if (sig.flags.hasRMA) flags.push("RMA handling")
    if (sig.flags.hasCredit) flags.push("credit memo adjustments")
    if (sig.flags.hasIntraCo) flags.push("intra-company scenarios")
    structured.specialTechniques = [hints.windowFnHint, ...hints.subqueryHints, hints.setOpsHint, flags.join(", ")].filter(Boolean).join("; ")
    structured.risks = "error rows isolated; late postings can shift totals"
  }
  const tldr = composeTLDR(stmt, structured, audience)
  return { tldr, structured }
}

function guessPurposeFromTables(tables: string[]): string | undefined {
  const t = tables.join(" ")
  if (/ORDER/i.test(t)) return "order and fulfillment metrics"
  if (/INVOICE|AP_|AR_/i.test(t)) return "billing/payables/receivables reporting"
  if (/INVENT/i.test(t)) return "inventory balances and movements"
  if (/CUSTOMER|CUST/i.test(t)) return "customer-level reporting"
  if (/PRODUCT|ITEM/i.test(t)) return "product-level performance"
  return undefined
}

function guessPurposeFromVerbs(verbs: string[]): string | undefined {
  if (!verbs?.length) return undefined
  if (verbs.includes("ALLOCATE")) return "allocation of costs or amounts"
  if (verbs.includes("RECONCILE")) return "reconciliation of financial records"
  if (verbs.includes("EXPORT")) return "exporting curated data"
  if (verbs.includes("ROLLUP")) return "aggregating results for reporting"
  if (verbs.includes("UPDATE") || verbs.includes("INSERT") || verbs.includes("DELETE")) return "data maintenance operations"
  return undefined
}

function buildFlow(sig: ReturnType<typeof extractSignals>): string {
  const steps = []
  if (sig.businessVerbs.length) steps.push(`steps include ${sig.businessVerbs.slice(0,3).map(v=>v.toLowerCase()).join(", ")}`)
  if (sig.procs.length || sig.funcs.length) steps.push("key routines invoked for calculation and persistence")
  if (sig.wherePredicates.length) steps.push("conditions applied to target the right records")
  return steps.join("; ")
}

/* ---------- Providers (retries + timeout) ---------- */

async function callXAI(systemPrompt: string, userContent: string): Promise<{ text: string; model: string }> {
  const XAI_API_KEY = process.env.XAI_API_KEY
  const XAI_MODEL = process.env.XAI_MODEL || DEFAULT_XAI_MODEL
  const XAI_BASE_URL = process.env.XAI_BASE_URL || "https://api.x.ai"
  if (!XAI_API_KEY) throw new Error("Missing XAI_API_KEY")

  const body = { model: XAI_MODEL, temperature: 0.15, messages: [
    { role: "system", content: systemPrompt },
    { role: "user", content: userContent },
  ]}

  const r = await withRetries(() =>
    fetchWithTimeout(`${XAI_BASE_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${XAI_API_KEY}` },
      body: JSON.stringify(body),
    }, REQUEST_TIMEOUT_MS)
  )
  if (!r.ok) throw new Error(await r.text())
  const j = await r.json()
  const text = j?.choices?.[0]?.message?.content?.trim() ?? ""
  return { text, model: XAI_MODEL }
}

async function callAzure(systemPrompt: string, userContent: string): Promise<{ text: string; model: string }> {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT
  const apiKey = process.env.AZURE_OPENAI_API_KEY
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || DEFAULT_AZURE_API_VERSION
  if (!endpoint || !apiKey || !deployment) throw new Error("Missing Azure OpenAI env vars")

  const url = `${endpoint}/openai/deployments/${deployment}/chat/completions?api-version=${apiVersion}`
  const body: any = {
    temperature: 0.15,
    // If your deployment supports strict JSON:
    // response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent },
    ],
  }

  const r = await withRetries(() =>
    fetchWithTimeout(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify(body),
    }, REQUEST_TIMEOUT_MS)
  )
  if (!r.ok) throw new Error(await r.text())
  const j = await r.json()
  const text = j?.choices?.[0]?.message?.content?.trim() ?? ""
  return { text, model: deployment }
}

async function withRetries<T>(fn: () => Promise<T>, max = 3, baseDelay = 400): Promise<T> {
  let lastErr: any
  for (let i = 0; i < max; i++) {
    try { return await fn() } catch (e: any) {
      lastErr = e
      const msg = String(e?.message || "")
      if (!/429|5\d\d|timeout|exceeded|aborted/i.test(msg)) break
      await new Promise((res) => setTimeout(res, baseDelay * Math.pow(2, i)))
    }
  }
  throw lastErr
}

async function fetchWithTimeout(input: RequestInfo, init: RequestInit = {}, timeoutMs = 15000) {
  const controller = new AbortController()
  const t = setTimeout(() => controller.abort(), timeoutMs)
  try { return await fetch(input, { ...init, signal: controller.signal }) } finally { clearTimeout(t) }
}

/* ---------- JSON parsing & misc ---------- */

function tryParseLastJson(text: string): any {
  try { return JSON.parse(text) } catch {}
  const m = text.match(/\{[\s\S]*\}$/m)
  if (!m) return {}
  try { return JSON.parse(m[0]) } catch { return {} }
}

function formatEntities(arr: any): string {
  if (!Array.isArray(arr) || arr.length === 0) return "identified tables (names extracted from code)"
  const list = arr.slice(0, 6)
  if (list.length === 1) return list[0]
  if (list.length === 2) return `${list[0]} and ${list[1]}`
  return `${list.slice(0, -1).join(", ")}, and ${list[list.length - 1]}`
}

function ensurePeriod(s: string): string { s = s.trim(); return s.endsWith(".") ? s : s + "." }
function trimPeriod(s: string): string { return s.trim().replace(/[.]+$/, "") }

function clampSentences(text: string, min: number, max: number): string {
  const sentences = (text.replace(/\s+/g, " ").match(/[^.!?]+[.!?]+/g) || [text]).map(s => s.trim())
  if (sentences.length > max) return sentences.slice(0, max).join(" ").trim()
  if (sentences.length < min) return text.trim()
  return text.trim()
}

function scrubBoilerplate(s: string): string {
  let out = s
  for (const r of BAD_PHRASES) out = out.replace(r, "")
  return out.replace(/\s{2,}/g, " ").trim()
}

function stripComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\/|--.*$/gm, "")
}
