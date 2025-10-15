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
    // Fill parent so it aligns with minimaps on any screen size
    paneHeight = "100%",
    syncScrollEnabled = true,
  }: QueryComparisonProps,
  ref: Ref<QueryComparisonHandle>
) {
  const canonicalOld = useMemo(() => canonicalizeSQL(oldQuery), [oldQuery])
  const canonicalNew = useMemo(() => canonicalizeSQL(newQuery), [newQuery])

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

  // ⬇️ tighter row/number/line-height styles
  const theme = {
    baseRow: "group flex items-start gap-2 px-2 py-0.5 rounded-md",
    added: "bg-emerald-100 border-l-4 border-emerald-600",
    removed: "bg-rose-100 border-l-4 border-rose-600",
    modified: "bg-amber-100 border-l-4 border-amber-600",
    code: "text-slate-800",
    num: "text-slate-500",
    header: "text-slate-700",
  } as const

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

        suppressSync.current.old = true
        suppressSync.current.new = true

        if (tR) r.scrollTop = tR.offsetTop - r.clientHeight / 2

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

    const paneStyle =
      typeof paneHeight === "number"
        ? { height: `${paneHeight}px`, scrollbarGutter: "stable" as const }
        : { height: paneHeight, maxHeight: "100%", scrollbarGutter: "stable" as const }

    return (
      <div
        ref={refDiv}
        onScroll={() => onPaneScroll(side)}
        className="flex-1 min-h-0 rounded-lg border border-slate-200 bg-slate-50 overflow-auto hover-scroll focus:outline-none"
        style={paneStyle}
        aria-label={ariaLabel}
        tabIndex={0}
      >
        {/* ⬇️ smaller padding, font size, and tighter leading */}
        <div className="relative w-max p-2 font-mono text-[10px] md:text-[11px] leading-tight text-slate-800">
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
              <div key={n} data-side={side} data-line={n} className={`${theme.baseRow} ${rowBg} relative`}>
                <span className={`sticky left-0 z-10 w-10 pr-1.5 text-right select-none ${theme.num} bg-transparent`}>
                  {n}
                </span>
                <code className="block whitespace-pre pr-3">{renderHighlightedSQL(line)}</code>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      <div className={`${className ?? ""} h-full min-h-0`}>
        <Card className="mb-6 h-full min-h-0 flex flex-col bg-slate-50 border-slate-200 shadow-[0_1px_0_rgba(0,0,0,0.04)]">
          {showTitle && (
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 font-heading text-slate-900">
                <BarChart3 className="w-5 h-5" />
                Query Comparison
              </CardTitle>
            </CardHeader>
          )}
          <CardContent className="pt-2 h-full min-h-0 flex flex-col">
            <div className="grid lg:grid-cols-2 gap-6 h-full min-h-0">
              <div className="flex flex-col h-full min-h-0">
                <h3 className={`font-semibold mb-2 ${theme.header}`}>Original Query</h3>
                {renderSide(canonicalOld, oldMap, "Original query", "old")}
              </div>
              <div className="flex flex-col h-full min-h-0">
                <h3 className={`font-semibold mb-2 ${theme.header}`}>Updated Query</h3>
                {renderSide(canonicalNew, newMap, "Updated query", "new")}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <style jsx global>{`
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
        .flash-highlight {
          animation: qc-flash 1.1s ease-out;
        }
        @keyframes qc-flash {
          0% { outline: 2px solid rgba(250, 204, 21, 0.8); background-color: rgba(250, 204, 21, 0.18); }
          100% { outline: 0px solid transparent; background-color: transparent; }
        }
      `}</style>
    </>
  )
}

export const QueryComparison = forwardRef<QueryComparisonHandle, QueryComparisonProps>(QueryComparisonInner)
