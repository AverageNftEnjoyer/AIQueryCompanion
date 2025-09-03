"use client"

import { useMemo, useRef, forwardRef, useImperativeHandle } from "react"
import type { Ref } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  canonicalizeSQL,
  generateQueryDiff,
  renderHighlightedSQL,
  type ComparisonResult,
} from "@/lib/query-differ"
import { BarChart3 } from "lucide-react"

export type QueryJumpSide = "old" | "new" | "both"
export type QueryComparisonHandle = {
  scrollTo: (opts: { side: QueryJumpSide; line: number }) => void
}

interface QueryComparisonProps {
  oldQuery: string
  newQuery: string
  className?: string
  showTitle?: boolean
  paneHeight?: number | string
  syncScrollEnabled?: boolean
}

type OldTag = "removed" | "modified"
type NewTag = "added" | "modified"

function QueryComparisonInner(
  {
    oldQuery,
    newQuery,
    className,
    showTitle = true,
    paneHeight = "clamp(520px, calc(100vh - 200px), 760px)",
    syncScrollEnabled = true,
  }: QueryComparisonProps,
  ref: Ref<QueryComparisonHandle>
) {
  const canonicalOld = useMemo(() => canonicalizeSQL(oldQuery), [oldQuery])
  const canonicalNew = useMemo(() => canonicalizeSQL(newQuery), [newQuery])
  const comparison: ComparisonResult = useMemo(
    () => generateQueryDiff(oldQuery, newQuery),
    [oldQuery, newQuery]
  )

  const oldMap = useMemo(() => {
    const map = new Map<number, OldTag>()
    for (let i = 0; i < comparison.diffs.length; i++) {
      const d = comparison.diffs[i]
      if (d.type === "deletion" && d.oldLineNumber) {
        const n = comparison.diffs[i + 1]
        map.set(d.oldLineNumber, n && n.type === "addition" ? "modified" : "removed")
      }
    }
    return map
  }, [comparison])

  const newMap = useMemo(() => {
    const map = new Map<number, NewTag>()
    for (let i = 0; i < comparison.diffs.length; i++) {
      const d = comparison.diffs[i]
      if (d.type === "addition" && d.newLineNumber) {
        const p = comparison.diffs[i - 1]
        map.set(d.newLineNumber, p && p.type === "deletion" ? "modified" : "added")
      }
    }
    return map
  }, [comparison])

  const theme = {
    baseRow: "group flex items-start gap-3 px-3 py-1.5 rounded-md",
    added: "bg-emerald-50 border-l-4 border-emerald-500",
    removed: "bg-rose-50 border-l-4 border-rose-500",
    modified: "bg-amber-50 border-l-4 border-amber-500",
    code: "text-slate-800",
    num: "text-slate-400",
    header: "text-slate-700",
  } as const

  const heightStyle = { height: typeof paneHeight === "number" ? `${paneHeight}px` : paneHeight } as const

  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const suppressSync = useRef<{ old: boolean; new: boolean }>({ old: false, new: false })

  const syncOther = (src: HTMLDivElement, dst: HTMLDivElement) => {
    const rv = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight)
    const rh = src.scrollLeft / Math.max(1, src.scrollWidth - src.clientWidth)
    dst.scrollTop = rv * Math.max(1, dst.scrollHeight - dst.clientHeight)
    dst.scrollLeft = rh * Math.max(1, dst.scrollWidth - dst.clientWidth)
  }

  const onPaneScroll = (side: "old" | "new") => {
    if (suppressSync.current[side]) {
      suppressSync.current[side] = false
      return
    }
    if (!syncScrollEnabled) return
    const src = side === "old" ? leftRef.current : rightRef.current
    const dst = side === "old" ? rightRef.current : leftRef.current
    if (src && dst) syncOther(src, dst)
  }

  useImperativeHandle(ref, () => ({
    scrollTo: ({ side, line }) => {
      if (side === "both") {
        const l = leftRef.current
        const r = rightRef.current
        if (!l || !r) return
        const tR = r.querySelector<HTMLElement>(`[data-line="${line}"]`)
        suppressSync.current.old = true
        suppressSync.current.new = true
        if (tR) r.scrollTop = tR.offsetTop - r.clientHeight / 2
        const rv = r.scrollTop / Math.max(1, r.scrollHeight - r.clientHeight)
        const rh = r.scrollLeft / Math.max(1, r.scrollWidth - r.clientWidth)
        l.scrollTop = rv * Math.max(1, l.scrollHeight - l.clientHeight)
        l.scrollLeft = rh * Math.max(1, l.scrollWidth - l.clientWidth)
        return
      }

      const primary = side === "old" ? leftRef.current : rightRef.current
      if (!primary) return
      suppressSync.current[side] = true
      const target = primary.querySelector<HTMLElement>(`[data-line="${line}"]`)
      if (target) {
        primary.scrollTop = target.offsetTop - primary.clientHeight / 2
      } else {
        const total = (side === "old" ? canonicalOld : canonicalNew).split("\n").length
        const ratio = Math.max(0, Math.min(1, (line - 1) / Math.max(1, total - 1)))
        primary.scrollTop = ratio * Math.max(1, primary.scrollHeight - primary.clientHeight)
      }
    },
  }))

  const renderSide = (
    text: string,
    tags: Map<number, OldTag | NewTag>,
    ariaLabel: string,
    side: "old" | "new"
  ) => {
    const lines = text.split("\n")
    const refDiv = side === "old" ? leftRef : rightRef
    return (
      <div
          ref={refDiv}
          onScroll={() => onPaneScroll(side)}
          className="rounded-lg border border-gray-200 bg-white overflow-auto hover-scroll focus:outline-none"
          style={{ ...heightStyle, scrollbarGutter: "stable" }}
          aria-label={ariaLabel}
          tabIndex={0}
        >

        <div className="w-max p-4 font-mono text-[13px] leading-relaxed text-slate-800">
          {lines.map((line, idx) => {
            const n = idx + 1
            const tag = tags.get(n)
            const rowBg =
              tag === "modified" ? theme.modified : tag === "removed" ? theme.removed : tag === "added" ? theme.added : ""
            return (
              <div key={n} data-line={n} className={`${theme.baseRow} ${rowBg}`}>
                <span className={`w-10 shrink-0 mt-0.5 text-xs ${theme.num}`}>{n}</span>
                <div className={`flex items-center gap-2 ${theme.code} shrink-0`}>
                  <code className="whitespace-pre pr-4">{renderHighlightedSQL(line)}</code>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className={className}>
      <Card className="mb-6 bg-white border-gray-200">
        {showTitle && (
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 font-heading text-slate-900">
              <BarChart3 className="w-5 h-5" />
              Query Comparison
            </CardTitle>
          </CardHeader>
        )}
        <CardContent className="pt-2">
          <div className="grid lg:grid-cols-2 gap-6">
            <div>
              <h3 className={`font-semibold mb-3 ${theme.header}`}>Original Query</h3>
              {renderSide(canonicalOld, oldMap, "Original query", "old")}
            </div>
            <div>
              <h3 className={`font-semibold mb-3 ${theme.header}`}>Updated Query</h3>
              {renderSide(canonicalNew, newMap, "Updated query", "new")}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export const QueryComparison = forwardRef<QueryComparisonHandle, QueryComparisonProps>(QueryComparisonInner)
