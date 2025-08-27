"use client"

import { useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  canonicalizeSQL,
  generateQueryDiff,
  renderHighlightedSQL,
  type ComparisonResult,
} from "@/lib/query-differ"
import { BarChart3 } from "lucide-react"

interface QueryComparisonProps {
  oldQuery: string
  newQuery: string
  className?: string
  /** Hide in-card title when the page header already shows it */
  showTitle?: boolean
}

type OldTag = "removed" | "modified"
type NewTag = "added" | "modified"

export function QueryComparison({
  oldQuery,
  newQuery,
  className,
  showTitle = true,
}: QueryComparisonProps) {
  // Canonicalize for consistent line breaks
  const canonicalOld = useMemo(() => canonicalizeSQL(oldQuery), [oldQuery])
  const canonicalNew = useMemo(() => canonicalizeSQL(newQuery), [newQuery])

  // Build a robust diff
  const comparison: ComparisonResult = useMemo(
    () => generateQueryDiff(oldQuery, newQuery),
    [oldQuery, newQuery]
  )

  // Per-side tag maps
  const oldMap = useMemo(() => {
    const map = new Map<number, OldTag>()
    for (let i = 0; i < comparison.diffs.length; i++) {
      const d = comparison.diffs[i]
      if (d.type === "deletion" && d.oldLineNumber) {
        const next = comparison.diffs[i + 1]
        map.set(d.oldLineNumber, next && next.type === "addition" ? "modified" : "removed")
      }
    }
    return map
  }, [comparison])

  const newMap = useMemo(() => {
    const map = new Map<number, NewTag>()
    for (let i = 0; i < comparison.diffs.length; i++) {
      const d = comparison.diffs[i]
      if (d.type === "addition" && d.newLineNumber) {
        const prev = comparison.diffs[i - 1]
        map.set(d.newLineNumber, prev && prev.type === "deletion" ? "modified" : "added")
      }
    }
    return map
  }, [comparison])

  // Compact, low-contrast theme (to match original inputs)
  const theme = {
    railNum:
      "w-8 shrink-0 text-right pr-2 text-[11px] leading-[1.3] text-slate-400",
    code:
      "font-mono text-[12.5px] leading-[1.32] text-slate-700 whitespace-pre-wrap break-words",
    header: "text-slate-700",
    row: "grid grid-cols-[2rem_1fr] items-start gap-2 py-0.5 px-2 rounded-md hover:bg-slate-100/50 transition-colors",
    // subtle pill highlights with left accent bar (softer than before)
    pillBase:
      "relative block rounded-md px-2 py-0.5",
    added:
      "bg-emerald-100/50 before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1.5 before:rounded-l-md before:bg-emerald-500/70",
    modified:
      "bg-amber-100/50 before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1.5 before:rounded-l-md before:bg-amber-500/70",
    removed:
      "bg-rose-100/50 before:content-[''] before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1.5 before:rounded-l-md before:bg-rose-500/70",
  } as const

  const renderSide = (
    text: string,
    tags: Map<number, OldTag | NewTag>,
  ) => {
    const lines = text.split("\n")
    return (
      <ScrollArea className="h-[560px] rounded-xl border border-gray-200 bg-slate-50 shadow-inner">
        <div className="p-3">
          {lines.map((line, idx) => {
            const n = idx + 1
            const tag = tags.get(n)

            const pillClass =
              tag === "modified"
                ? `${theme.pillBase} ${theme.modified}`
                : tag === "removed"
                ? `${theme.pillBase} ${theme.removed}`
                : tag === "added"
                ? `${theme.pillBase} ${theme.added}`
                : ""

            return (
              <div key={n} className={theme.row}>
                {/* line number */}
                <span className={theme.railNum}>{n}</span>

                {/* code line (highlighted if needed) */}
                <div className={pillClass || undefined}>
                  <code className={theme.code}>
                    {renderHighlightedSQL(line)}
                  </code>
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    )
  }

  // Slightly reduced padding (compact) and less bright container
  const contentPad = showTitle ? "p-4" : "pt-4 pb-3 px-3"

  return (
    <div className={className}>
      <Card className="mb-6 bg-white/95 border-gray-200 shadow-lg">
        {showTitle && (
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-heading text-slate-900">
              <BarChart3 className="w-5 h-5" />
              Query Comparison
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className={contentPad}>
          <div className="grid lg:grid-cols-2 gap-5">
            <div>
              <h3 className={`font-semibold mb-2 ${theme.header}`}>Original Query</h3>
              {renderSide(canonicalOld, oldMap)}
            </div>
            <div>
              <h3 className={`font-semibold mb-2 ${theme.header}`}>Updated Query</h3>
              {renderSide(canonicalNew, newMap)}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
