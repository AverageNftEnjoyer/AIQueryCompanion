// /lib/query-differ.tsx

export interface QueryDiff {
  type: "addition" | "deletion" | "modification" | "unchanged";
  content: string;
  /** Anchor to UPDATED-side numbering for UI */
  lineNumber: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface ComparisonResult {
  diffs: QueryDiff[];
  stats: {
    additions: number;
    deletions: number;
    modifications: number;
    unchanged: number;
  };
}

/** Normalize Windows CRLF to LF once. Do NOT trim or remove empty lines. */
function normalizeEOL(s: string) {
  return s.replace(/\r\n/g, "\n");
}

/**
 * Canonicalize both queries identically so line breaks and spacing are stable.
 * Idempotent: running twice won’t change output further.
 */
export function canonicalizeSQL(input: string): string {
  let s = normalizeEOL(input);

  // Tabs → spaces (consistent)
  s = s.replace(/\t/g, "  ");

  // Keep indentation but compress internal whitespace, strip trailing spaces
  s = s
    .split("\n")
    .map((ln) => {
      const m = ln.match(/^(\s*)(.*)$/);
      if (!m) return ln;
      const [, indent, rest] = m;
      return indent + rest.replace(/\s+/g, " ").trimEnd();
    })
    .join("\n");

  // Break common SQL clauses onto their own lines (stable)
  s = s
    .replace(/,\s*/g, ", ")      // commas normalize first
    .replace(/, /g, ",\n  ")     // newline after comma with small indent
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
    .replace(/\bUNION\b/gi, "\nUNION");

  // Add a blank line BEFORE major section boundaries (visual clarity)
  s = s.replace(
    /\n(SELECT\b|FROM\b|WHERE\b|GROUP BY\b|ORDER BY\b|HAVING\b|UNION\b|INNER JOIN\b|LEFT JOIN\b|RIGHT JOIN\b|FULL JOIN\b)/gi,
    "\n\n$1"
  );

  // Tighten: collapse any 3+ blanks to a single blank
  s = s.replace(/\n{3,}/g, "\n\n");

  // Guarantee trailing newline for stable counts
  if (!s.endsWith("\n")) s += "\n";

  return s;
}

/** Case/whitespace-insensitive compare key for LCS only. */
function normalizeLineForCompare(s: string) {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Robust, position-stable diff (LCS over normalized lines) built from
 * the *canonicalized* versions of both queries. We keep UPDATED-side
 * numbering as the single source of truth for the UI.
 */
export function generateQueryDiff(oldQueryRaw: string, newQueryRaw: string): ComparisonResult {
  // Canonicalize BOTH queries the SAME way
  const oldQuery = canonicalizeSQL(oldQueryRaw);
  const newQuery = canonicalizeSQL(newQueryRaw);

  const oldRaw = oldQuery.split("\n");
  const newRaw = newQuery.split("\n");

  const A = oldRaw.map(normalizeLineForCompare);
  const B = newRaw.map(normalizeLineForCompare);

  const m = A.length;
  const n = B.length;

  // LCS DP
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const diffs: QueryDiff[] = [];
  let i = m, j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) {
      diffs.push({
        type: "unchanged",
        content: oldRaw[i - 1],
        lineNumber: j,
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= (dp[i - 1]?.[j] ?? 0))) {
      diffs.push({
        type: "addition",
        content: newRaw[j - 1],
        lineNumber: j,
        newLineNumber: j,
      });
      j--;
    } else {
      diffs.push({
        type: "deletion",
        content: oldRaw[i - 1],
        lineNumber: Math.max(1, j + 1), // deletion before next new line
        oldLineNumber: i,
      });
      i--;
    }
  }

  diffs.reverse();

  // Stats: adjacent del+add pairs count as a "modification"
  let additions = 0, deletions = 0, unchanged = 0, modifications = 0;
  for (let k = 0; k < diffs.length; k++) {
    const d = diffs[k];
    if (d.type === "unchanged") { unchanged++; continue; }
    if (d.type === "addition") {
      const prev = diffs[k - 1];
      if (prev && prev.type === "deletion") modifications++; else additions++;
      continue;
    }
    if (d.type === "deletion") {
      const next = diffs[k + 1];
      if (!(next && next.type === "addition")) deletions++;
    }
  }

  return { diffs, stats: { additions, deletions, modifications, unchanged } };
}

/** Display helper */
export function highlightSQLKeywords(query: string): string {
  const keywords = [
    "SELECT","FROM","WHERE","JOIN","INNER","LEFT","RIGHT","OUTER","FULL",
    "GROUP BY","ORDER BY","HAVING","INSERT","UPDATE","DELETE","MERGE",
    "CREATE","ALTER","DROP","INDEX","TABLE","VIEW","PROCEDURE","FUNCTION",
    "TRIGGER","AND","OR","NOT","IN","EXISTS","LIKE","BETWEEN","IS","NULL",
    "DISTINCT","COUNT","SUM","AVG","MAX","MIN","CASE","WHEN","THEN","ELSE",
    "END","UNION","INTERSECT","MINUS","WITH","AS","ON","USING","NATURAL",
  ];

  let highlighted = query;

  keywords.forEach((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, "gi");
    highlighted = highlighted.replace(
      regex,
      `<span class="text-blue-600 dark:text-blue-400 font-semibold">${kw.toUpperCase()}</span>`
    );
  });

  highlighted = highlighted.replace(/'([^']*)'/g, `<span class="text-green-600 dark:text-green-400">'$1'</span>`);
  highlighted = highlighted.replace(/\b\d+(\.\d+)?\b/g, `<span class="text-purple-600 dark:text-purple-400">$&</span>`);
  highlighted = highlighted.replace(/--.*$/gm, `<span class="text-gray-500 dark:text-gray-400 italic">$&</span>`);
  return highlighted;
}

/** Optional quick formatter */
export function formatSQL(query: string): string {
  return canonicalizeSQL(query);
}
