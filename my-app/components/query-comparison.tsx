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
import { Plus, Minus, Edit3, BarChart3 } from "lucide-react"

interface QueryComparisonProps {
  oldQuery: string
  newQuery: string
  className?: string
}

type OldTag = "removed" | "modified"
type NewTag = "added" | "modified"

export function QueryComparison({ oldQuery, newQuery, className }: QueryComparisonProps) {
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

  // On-brand colors
  const theme = {
    baseRow: "group flex items-start gap-3 px-3 py-1.5 rounded-md transition-colors",
    added: "bg-emerald-50 border-l-4 border-emerald-500",
    removed: "bg-rose-50 border-l-4 border-rose-500",
    modified: "bg-amber-50 border-l-4 border-amber-500",
    // force dark text inside white cards (overrides global text-white)
    code: "text-slate-800",
    num: "text-slate-400",
    header: "text-slate-700",
  } as const

  const renderSide = (
    text: string,
    tags: Map<number, OldTag | NewTag>,
  ) => {
    const lines = text.split("\n")
    return (
      <ScrollArea className="h-[480px] rounded-lg border border-gray-200 bg-white">
        {/* Force dark text within the white card content */}
        <div className="p-4 font-mono text-[13px] leading-relaxed text-slate-800">
          {lines.map((line, idx) => {
            const n = idx + 1
            const tag = tags.get(n)
            const rowBg =
              tag === "modified" ? theme.modified :
              tag === "removed"  ? theme.removed  :
              tag === "added"    ? theme.added    :
              ""

            return (
              <div key={n} className={`${theme.baseRow} ${rowBg}`}>
                <span className={`w-10 shrink-0 mt-0.5 text-xs ${theme.num}`}>{n}</span>
                <div className={`flex items-center gap-2 flex-1 ${theme.code}`}>
                  {tag === "removed"  && <Minus className="w-3 h-3 text-rose-600 shrink-0" />}
                  {tag === "added"    && <Plus  className="w-3 h-3 text-emerald-600 shrink-0" />}
                  {tag === "modified" && <Edit3 className="w-3 h-3 text-amber-600 shrink-0" />}
                  <code className="flex-1 break-words">{renderHighlightedSQL(line)}</code>
                </div>
              </div>
            )
          })}
        </div>
      </ScrollArea>
    )
  }

  return (
    <div className={className}>
      <Card className="mb-6 bg-white border-gray-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading text-slate-900">
            <BarChart3 className="w-5 h-5" />
            Query Comparison
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid lg:grid-cols-2 gap-6">
            <div>
              <h3 className={`font-semibold mb-3 ${theme.header}`}>Original Query</h3>
              {renderSide(canonicalOld, oldMap)}
            </div>
            <div>
              <h3 className={`font-semibold mb-3 ${theme.header}`}>Updated Query</h3>
              {renderSide(canonicalNew, newMap)}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
