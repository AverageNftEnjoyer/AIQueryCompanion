// components/query-comparison.tsx
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
  scrollTo: (opts: { side: QueryJumpSide; line: number; flash?: boolean }) => void
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
  // We render canonicalized text in both panes:
  const canonicalOld = useMemo(() => canonicalizeSQL(oldQuery), [oldQuery])
  const canonicalNew = useMemo(() => canonicalizeSQL(newQuery), [newQuery])

  // ❗ Build the diff on the EXACT strings we render, and tell the differ not to
  // canonicalize again (basis: "raw"). This keeps line numbers perfectly aligned.
  const comparison: ComparisonResult = useMemo(
    () => generateQueryDiff(canonicalOld, canonicalNew, { basis: "raw" }),
    [canonicalOld, canonicalNew]
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
  added: "bg-emerald-100 border-l-4 border-emerald-600",
  removed: "bg-rose-100 border-l-4 border-rose-600",
  modified: "bg-amber-100 border-l-4 border-amber-600",
  code: "text-slate-800",
  num: "text-slate-500",
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

  // Flash/highlight a specific line element briefly
  function flashLine(side: "old" | "new", line: number) {
    const pane = side === "old" ? leftRef.current : rightRef.current
    if (!pane) return
    const el = pane.querySelector<HTMLElement>(`[data-side="${side}"][data-line="${line}"]`)
    if (!el) return

    el.classList.remove("flash-highlight")
    void el.offsetWidth
    el.classList.add("flash-highlight")
    window.setTimeout(() => el.classList.remove("flash-highlight"), 1500)
  }

  useImperativeHandle(ref, () => ({
    scrollTo: ({ side, line, flash = true }) => {
      if (side === "both") {
        const l = leftRef.current
        const r = rightRef.current
        if (!l || !r) return
        const tR =
          r.querySelector<HTMLElement>(`[data-side="new"][data-line="${line}"]`) ||
          r.querySelector<HTMLElement>(`[data-line="${line}"]`)

        // prevent feedback loop
        suppressSync.current.old = true
        suppressSync.current.new = true

        if (tR) r.scrollTop = tR.offsetTop - r.clientHeight / 2

        // sync left pane to right's relative position
        const rv = r.scrollTop / Math.max(1, r.scrollHeight - r.clientHeight)
        const rh = r.scrollLeft / Math.max(1, r.scrollWidth - r.clientWidth)
        l.scrollTop = rv * Math.max(1, l.scrollHeight - l.clientHeight)
        l.scrollLeft = rh * Math.max(1, l.scrollWidth - l.clientWidth)

        if (flash) {
          flashLine("old", line)
          flashLine("new", line)
        }
        return
      }

      const primary = side === "old" ? leftRef.current : rightRef.current
      if (!primary) return
      suppressSync.current[side] = true

      const target =
        primary.querySelector<HTMLElement>(`[data-side="${side}"][data-line="${line}"]`) ||
        primary.querySelector<HTMLElement>(`[data-line="${line}"]`)

      if (target) {
        primary.scrollTop = target.offsetTop - primary.clientHeight / 2
      } else {
        // fallback: proportional scroll against the same canonical text we render
        const total = (side === "old" ? canonicalOld : canonicalNew).split("\n").length
        const ratio = Math.max(0, Math.min(1, (line - 1) / Math.max(1, total - 1)))
        primary.scrollTop = ratio * Math.max(1, primary.scrollHeight - primary.clientHeight)
      }

      if (flash) flashLine(side, line)
    },
  }))

  const renderSide = (
    text: string,
    tags: Map<number, OldTag | NewTag>,
    ariaLabel: string,
    side: "old" | "new"
  ) => {
const displayText = text.endsWith("\n") ? text.slice(0, -1) : text
const lines = displayText ? displayText.split("\n") : []   
const refDiv = side === "old" ? leftRef : rightRef

    return (
      <div
        ref={refDiv}
        onScroll={() => onPaneScroll(side)}
        className="rounded-lg border border-slate-200 bg-slate-50 overflow-auto hover-scroll focus:outline-none"
        style={{ ...heightStyle, scrollbarGutter: "stable" }}
        aria-label={ariaLabel}
        tabIndex={0}
      >
        <div className="relative w-max p-3 font-mono text-[11px] leading-snug text-slate-800">
          {lines.map((line, idx) => {
            const n = idx + 1
            const tag = tags.get(n)
            const rowBg =
              tag === "modified"
                ? theme.modified
                : tag === "removed"
                ? theme.removed
                : tag === "added"
                ? theme.added
                : ""

            return (
              <div
                key={n}
                data-side={side}
                data-line={n}
                className={`${theme.baseRow} ${rowBg} relative`}
              >
                <span
                className={`sticky left-0 z-10 w-12 pr-2 text-right select-none ${theme.num} bg-transparent`}
              >
                {n}
              </span>
                <code className="block whitespace-pre pr-4">{renderHighlightedSQL(line)}</code>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={className}>
        <Card className="mb-6 bg-slate-50 border-slate-200 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
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

      <style jsx global>{`
        /* === Light scrollbar overrides (keep) === */
        .hover-scroll::-webkit-scrollbar {
          width: 10px;
          height: 10px;
        }
        .hover-scroll::-webkit-scrollbar-track {
          background: #f8fafc;
        }
        .hover-scroll::-webkit-scrollbar-thumb {
          background-color: #cbd5e1;
          border-radius: 6px;
          border: 2px solid #f8fafc;
        }
        .hover-scroll::-webkit-scrollbar-thumb:hover {
          background-color: #94a3b8;
        }
        .hover-scroll {
          scrollbar-width: thin;
          scrollbar-color: #cbd5e1 #f8fafc;
        }
      `}</style>
    </>
  )
}

export const QueryComparison = forwardRef<QueryComparisonHandle, QueryComparisonProps>(QueryComparisonInner)
