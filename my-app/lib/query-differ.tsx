import React from "react"

export interface QueryDiff {
  type: "addition" | "deletion" | "modification" | "unchanged"
  content: string
  lineNumber: number
  oldLineNumber?: number
  newLineNumber?: number
}

export interface ComparisonResult {
  diffs: QueryDiff[]
  stats: {
    additions: number
    deletions: number
    modifications: number
    unchanged: number
  }
}

/** Normalize Windows CRLF to LF once. */
function normalizeEOL(s: string) {
  return s.replace(/\r\n/g, "\n")
}

function rtrim(s: string) {
  return s.replace(/\s+$/, "")
}

/**
 * Canonicalize SQL:
 * - Normalize whitespace (outside strings/comments)
 * - Add clause line breaks for stable diffs
 * - Collapse excessive blank lines
 * - Compact punctuation-only lines (except ');') onto previous
 * - Keep ');' on its own line
 * - Merge standalone numbers (and number+trailing , / ) / ,)) into previous line
 */
export function canonicalizeSQL(input: string): string {
  const lf = normalizeEOL(input).replace(/\t/g, "  ")
  let out = ""
  let i = 0

  while (i < lf.length) {
    const nl = lf.indexOf("\n", i)
    const rawLine = lf.slice(i, nl === -1 ? lf.length : nl)

    const dashDash = rawLine.indexOf("--")
    const code = dashDash >= 0 ? rawLine.slice(0, dashDash) : rawLine
    const comment = dashDash >= 0 ? rawLine.slice(dashDash) : ""

    // compress whitespace in code while preserving string literals
    let normalized = ""
    let j = 0
    while (j < code.length) {
      const ch = code[j]
      if (ch === "'") {
        let k = j + 1
        while (k < code.length) {
          if (code[k] === "'" && code[k + 1] !== "'") break
          if (code[k] === "'" && code[k + 1] === "'") k += 2
          else k++
        }
        normalized += code.slice(j, Math.min(k + 1, code.length))
        j = Math.min(k + 1, code.length)
        continue
      }
      const ws = code.slice(j).match(/^\s+/)
      if (ws) {
        normalized += " "
        j += ws[0].length
        continue
      }
      normalized += code[j++]
    }

    // clause breaks for stability
    normalized = normalized
      .replace(/,\s*/g, ", ")
      .replace(/, /g, ",\n  ")
      .replace(/\bINNER JOIN\b/gi, "\nINNER JOIN")
      .replace(/\bLEFT JOIN\b/gi, "\nLEFT JOIN")
      .replace(/\bRIGHT JOIN\b/gi, "\nRIGHT JOIN")
      .replace(/\bFULL JOIN\b/gi, "\nFULL JOIN")
      .replace(/\bJOIN\b/gi, "\nJOIN")
      .replace(/\bFROM\b/gi, "\nFROM")
      .replace(/\bWHERE\b/gi, "\nWHERE")
      .replace(/\bGROUP BY\b/gi, "\nGROUP BY")
      .replace(/\bORDER BY\b/gi, "\nORDER BY")
      .replace(/\bHAVING\b/gi, "\nHAVING")
      .replace(/\bUNION\b/gi, "\nUNION")

  // visual spacing before major clauses
    normalized = normalized.replace(
      /\n(SELECT\b|FROM\b|WHERE\b|GROUP BY\b|ORDER BY\b|HAVING\b|UNION\b|INNER JOIN\b|LEFT JOIN\b|RIGHT JOIN\b|FULL JOIN\b)/gi,
      "\n\n$1"
    )

    normalized = normalized.replace(/\s+$/g, "")

    out += normalized + comment + "\n"
    i = nl === -1 ? lf.length : nl + 1
  }

  let cleaned = out.replace(/\n{3,}/g, "\n\n")

  // ---- Punctuation/number compaction pass ----
  const lines = cleaned.split("\n")
  const merged: string[] = []
  const numberLineRE = /^\d+(?:\.\d+)?(?:,|\)|,\)|\),)?$/

  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx]
    const t = line.trim()
    if (!t) continue

    if (t === ");") {
      merged.push(t)
      continue
    }

    if (t === "," || t === "(" || t === ")" || t === ";") {
      if (merged.length === 0) {
        merged.push(t)
      } else {
        const prev = merged[merged.length - 1]
        const base = rtrim(prev)
        merged[merged.length - 1] =
          t === "," ? base + "," :
          t === "(" ? base + " (" :
          t === ")" ? base + ")" :
                      base + ";"
      }
      continue
    }

    let m: RegExpMatchArray | null
    if ((m = line.match(/^\s*,\s*(.*)$/)) && merged.length > 0) {
      merged[merged.length - 1] = rtrim(merged[merged.length - 1]) + ","
      if (m[1].trim()) merged.push(m[1])
      continue
    }
    if ((m = line.match(/^\s*;\s*(.*)$/)) && merged.length > 0) {
      merged[merged.length - 1] = rtrim(merged[merged.length - 1]) + ";"
      if (m[1].trim()) merged.push(m[1])
      continue
    }

    if (numberLineRE.test(t) && merged.length > 0) {
      merged[merged.length - 1] = rtrim(merged[merged.length - 1]) + " " + t
      continue
    }

    merged.push(line)
  }

  let finalOut = merged.join("\n")
  if (!finalOut.endsWith("\n")) finalOut += "\n"
  return finalOut
}

function normalizeLineForCompare(s: string) {
  return s.replace(/\s+/g, " ").trim().toUpperCase()
}

export function generateQueryDiff(
  oldQueryRaw: string,
  newQueryRaw: string,
  opts?: { basis?: "canonical" | "raw" }
): ComparisonResult {
  const basis = opts?.basis ?? "canonical"
  const oldQuery = basis === "canonical" ? canonicalizeSQL(oldQueryRaw) : normalizeEOL(oldQueryRaw)
  const newQuery = basis === "canonical" ? canonicalizeSQL(newQueryRaw) : normalizeEOL(newQueryRaw)

  const oldRaw = oldQuery.split("\n")
  const newRaw = newQuery.split("\n")

  const A = oldRaw.map(normalizeLineForCompare)
  const B = newRaw.map(normalizeLineForCompare)

  const m = A.length, n = B.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = A[i - 1] === B[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])
    }
  }

  const diffs: QueryDiff[] = []
  let i = m, j = n
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) {
      diffs.push({
        type: "unchanged",
        content: oldRaw[i - 1],
        lineNumber: j,
        oldLineNumber: i,
        newLineNumber: j,
      })
      i--; j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= (dp[i - 1]?.[j] ?? 0))) {
      diffs.push({
        type: "addition",
        content: newRaw[j - 1],
        lineNumber: j,
        newLineNumber: j,
      })
      j--
    } else {
      diffs.push({
        type: "deletion",
        content: oldRaw[i - 1],
        lineNumber: Math.max(1, j + 1),
        oldLineNumber: i,
      })
      i--
    }
  }

  diffs.reverse()

  // Stats: adjacent del+add pairs count as a "modification"
  let additions = 0, deletions = 0, unchanged = 0, modifications = 0
  for (let k = 0; k < diffs.length; k++) {
    const d = diffs[k]
    if (d.type === "unchanged") { unchanged++; continue }
    if (d.type === "addition") {
      const prev = diffs[k - 1]
      if (prev && prev.type === "deletion") modifications++; else additions++
      continue
    }
    if (d.type === "deletion") {
      const next = diffs[k + 1]
      if (!(next && next.type === "addition")) deletions++
    }
  }

  return { diffs, stats: { additions, deletions, modifications, unchanged } }
}

export function renderHighlightedSQL(line: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  let i = 0

  const KW = new Set([
    "SELECT","FROM","WHERE","JOIN","INNER","LEFT","RIGHT","OUTER","FULL","GROUP","BY","ORDER","HAVING","INSERT","UPDATE","DELETE",
    "MERGE","CREATE","ALTER","DROP","INDEX","TABLE","VIEW","PROCEDURE","FUNCTION","TRIGGER","AND","OR","NOT","IN","EXISTS","LIKE",
    "BETWEEN","IS","NULL","DISTINCT","COUNT","SUM","AVG","MAX","MIN","CASE","WHEN","THEN","ELSE","END","UNION","INTERSECT","MINUS","WITH","AS","ON","USING","NATURAL"
  ])

  const commentIdx = line.indexOf("--")
  const hardStop = commentIdx >= 0 ? commentIdx : line.length

  while (i < hardStop) {
    const ch = line[i]

    if (ch === "'") {
      let j = i + 1
      while (j < hardStop) {
        if (line[j] === "'" && line[j + 1] !== "'") break
        if (line[j] === "'" && line[j + 1] === "'") j += 2
        else j++
      }
      const lit = line.slice(i, Math.min(j + 1, hardStop))
      nodes.push(<span key={i} className="text-emerald-700 dark:text-emerald-400">{lit}</span>)
      i = Math.min(j + 1, hardStop)
      continue
    }

    const num = line.slice(i).match(/^\d+(\.\d+)?/)
    if (num) {
      nodes.push(<span key={i} className="text-violet-700 dark:text-violet-400">{num[0]}</span>)
      i += num[0].length
      continue
    }

    const word = line.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)?.[0]
    if (word) {
      if (KW.has(word.toUpperCase())) {
        nodes.push(<span key={i} className="text-sky-700 dark:text-sky-400 font-semibold">{word.toUpperCase()}</span>)
      } else {
        nodes.push(<span key={i}>{word}</span>)
      }
      i += word.length
      continue
    }

    nodes.push(<span key={i}>{ch}</span>)
    i++
  }

  if (commentIdx >= 0) {
    nodes.push(<span key="cmt" className="text-gray-500 dark:text-gray-400 italic">{line.slice(commentIdx)}</span>)
  }

  return nodes
}

export function formatSQL(query: string): string {
  return canonicalizeSQL(query)
}
