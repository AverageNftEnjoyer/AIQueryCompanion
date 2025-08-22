// /lib/query-differ.tsx

export interface QueryDiff {
  type: "addition" | "deletion" | "modification" | "unchanged";
  content: string;
  /** Prefer UPDATED-side numbering for UI anchoring */
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

/** Case/whitespace-insensitive line normalization for comparison only. */
function normalizeLineForCompare(s: string) {
  return s.replace(/\s+/g, " ").trim().toUpperCase();
}

/**
 * Generates a robust, position-stable diff using LCS over normalized lines,
 * while preserving original lines for display and accurate line numbers.
 */
export function generateQueryDiff(oldQuery: string, newQuery: string): ComparisonResult {
  const oldRaw = normalizeEOL(oldQuery).split("\n");
  const newRaw = normalizeEOL(newQuery).split("\n");

  const A = oldRaw.map(normalizeLineForCompare);
  const B = newRaw.map(normalizeLineForCompare);

  const m = A.length;
  const n = B.length;

  // LCS DP table
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = A[i - 1] === B[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }

  const diffs: QueryDiff[] = [];
  let i = m;
  let j = n;

  // Walk back through the LCS table to build diffs
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i - 1] === B[j - 1]) {
      // unchanged
      diffs.push({
        type: "unchanged",
        content: oldRaw[i - 1],
        lineNumber: j, // updated-side reference
        oldLineNumber: i,
        newLineNumber: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= (dp[i - 1]?.[j] ?? 0))) {
      // addition in new
      diffs.push({
        type: "addition",
        content: newRaw[j - 1],
        lineNumber: j,
        newLineNumber: j,
      });
      j--;
    } else {
      // deletion from old
      diffs.push({
        type: "deletion",
        content: oldRaw[i - 1],
        // anchor deletions to the position *before* the next new line
        lineNumber: Math.max(1, j + 1),
        oldLineNumber: i,
      });
      i--;
    }
  }

  diffs.reverse();

  // Post-pass: count modifications where a deletion is immediately followed by an addition
  // (We keep diffs as add/delete pairs for clarity; only the stats aggregate them.)
  let additions = 0;
  let deletions = 0;
  let unchanged = 0;
  let modifications = 0;

  for (let k = 0; k < diffs.length; k++) {
    const d = diffs[k];
    if (d.type === "unchanged") {
      unchanged++;
      continue;
    }
    if (d.type === "addition") {
      const prev = diffs[k - 1];
      if (prev && prev.type === "deletion") {
        modifications++;
      } else {
        additions++;
      }
      continue;
    }
    if (d.type === "deletion") {
      const next = diffs[k + 1];
      if (next && next.type === "addition") {
        // counted as modification with the addition above
      } else {
        deletions++;
      }
    }
  }

  return { diffs, stats: { additions, deletions, modifications, unchanged } };
}

/** Simple SQL keyword highlighter for use with dangerouslySetInnerHTML. */
export function highlightSQLKeywords(query: string): string {
  const keywords = [
    "SELECT",
    "FROM",
    "WHERE",
    "JOIN",
    "INNER",
    "LEFT",
    "RIGHT",
    "OUTER",
    "FULL",
    "GROUP BY",
    "ORDER BY",
    "HAVING",
    "INSERT",
    "UPDATE",
    "DELETE",
    "MERGE",
    "CREATE",
    "ALTER",
    "DROP",
    "INDEX",
    "TABLE",
    "VIEW",
    "PROCEDURE",
    "FUNCTION",
    "TRIGGER",
    "AND",
    "OR",
    "NOT",
    "IN",
    "EXISTS",
    "LIKE",
    "BETWEEN",
    "IS",
    "NULL",
    "DISTINCT",
    "COUNT",
    "SUM",
    "AVG",
    "MAX",
    "MIN",
    "CASE",
    "WHEN",
    "THEN",
    "ELSE",
    "END",
    "UNION",
    "INTERSECT",
    "MINUS",
    "WITH",
    "AS",
    "ON",
    "USING",
    "NATURAL",
  ];

  let highlighted = query;

  // Keywords
  keywords.forEach((kw) => {
    const regex = new RegExp(`\\b${kw}\\b`, "gi");
    highlighted = highlighted.replace(
      regex,
      `<span class="text-blue-600 dark:text-blue-400 font-semibold">${kw.toUpperCase()}</span>`
    );
  });

  // Strings
  highlighted = highlighted.replace(
    /'([^']*)'/g,
    `<span class="text-green-600 dark:text-green-400">'$1'</span>`
  );

  // Numbers
  highlighted = highlighted.replace(
    /\b\d+(\.\d+)?\b/g,
    `<span class="text-purple-600 dark:text-purple-400">$&</span>`
  );

  // Single-line comments
  highlighted = highlighted.replace(
    /--.*$/gm,
    `<span class="text-gray-500 dark:text-gray-400 italic">$&</span>`
  );

  return highlighted;
}

/** Minimal formatter to improve readability in previews. */
export function formatSQL(query: string): string {
  return query
    .replace(/\s+/g, " ")
    .replace(/,/g, ",\n  ")
    .replace(/\bFROM\b/gi, "\nFROM")
    .replace(/\bWHERE\b/gi, "\nWHERE")
    .replace(/\bINNER JOIN\b/gi, "\nINNER JOIN")
    .replace(/\bLEFT JOIN\b/gi, "\nLEFT JOIN")
    .replace(/\bRIGHT JOIN\b/gi, "\nRIGHT JOIN")
    .replace(/\bFULL JOIN\b/gi, "\nFULL JOIN")
    .replace(/\bJOIN\b/gi, "\nJOIN")
    .replace(/\bGROUP BY\b/gi, "\nGROUP BY")
    .replace(/\bORDER BY\b/gi, "\nORDER BY")
    .replace(/\bHAVING\b/gi, "\nHAVING")
    .replace(/\bUNION\b/gi, "\nUNION")
    .trim();
}
