"use client";

import { useMemo, useRef, forwardRef, useImperativeHandle, useEffect } from "react";
import type { Ref } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  generateQueryDiff,
  buildAlignedRows,
  renderHighlightedSQL,
  type ComparisonResult,
  type AlignedRow,
} from "@/lib/query-differ";
import { BarChart3 } from "lucide-react";

export type QueryJumpSide = "old" | "new" | "both";
export type QueryComparisonHandle = {
  scrollTo: (opts: { side: QueryJumpSide; line: number; flash?: boolean }) => void;
  flashRange: (side: "old" | "new", startLine: number, endLine: number) => void; // NEW
};

interface QueryComparisonProps {
  oldQuery: string;
  newQuery: string;
  className?: string;
  showTitle?: boolean;
  paneHeight?: number | string;
  syncScrollEnabled?: boolean;
}

/** Normalize CRLF -> LF so line numbers stay stable across platforms. */
const toLF = (s: string) => s.replace(/\r\n/g, "\n");

function QueryComparisonInner(
  {
    oldQuery,
    newQuery,
    className,
    showTitle = true,
    paneHeight = "100%",
    syncScrollEnabled = true,
  }: QueryComparisonProps,
  ref: Ref<QueryComparisonHandle>
) {
  const displayOld = useMemo(() => toLF(oldQuery), [oldQuery]);
  const displayNew = useMemo(() => toLF(newQuery), [newQuery]);

  const comparison: ComparisonResult = useMemo(
    () => generateQueryDiff(displayOld, displayNew, { basis: "raw" }),
    [displayOld, displayNew]
  );

  const rows: AlignedRow[] = useMemo(() => buildAlignedRows(comparison), [comparison]);

  const theme = {
    baseRow: "group flex items-start gap-3 px-3 py-[2px] border-l-4 border-transparent",
    added: "bg-emerald-100 border-l-4 border-emerald-600",
    removed: "bg-rose-100 border-l-4 border-rose-600",
    modified: "bg-amber-100 border-l-4 border-amber-600",
    code: "text-slate-800",
    num: "text-slate-500",
    header: "text-slate-700",
  } as const;

  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const suppressSync = useRef<{ old: boolean; new: boolean }>({ old: false, new: false });

  const syncOther = (src: HTMLDivElement, dst: HTMLDivElement) => {
    const rv = src.scrollTop / Math.max(1, src.scrollHeight - src.clientHeight);
    const rh = src.scrollLeft / Math.max(1, src.scrollWidth - src.clientWidth);
    dst.scrollTop = rv * Math.max(1, dst.scrollHeight - dst.clientHeight);
    dst.scrollLeft = rh * Math.max(1, dst.scrollWidth - dst.clientWidth);
  };

  const onPaneScroll = (side: "old" | "new") => {
    if (suppressSync.current[side]) {
      suppressSync.current[side] = false;
      return;
    }
    if (!syncScrollEnabled) return;
    const src = side === "old" ? leftRef.current : rightRef.current;
    const dst = side === "old" ? rightRef.current : leftRef.current;
    if (src && dst) syncOther(src, dst);
  };

  function flashLine(side: "old" | "new", line: number) {
    const pane = side === "old" ? leftRef.current : rightRef.current;
    if (!pane) return;
    // Prefer display line; fallback to raw line
    const el =
      pane.querySelector<HTMLElement>(`[data-side="${side}"][data-line="${line}"]`) ||
      pane.querySelector<HTMLElement>(`[data-side="${side}"][data-rawline="${line}"]`);
    if (!el) return;
    el.classList.remove("flash-highlight");
    // reflow to restart animation
    void el.offsetWidth;
    el.classList.add("flash-highlight");
    window.setTimeout(() => el.classList.remove("flash-highlight"), 1200);
  }

  // NEW: flash a whole contiguous range (inclusive)
  function flashRangeImpl(side: "old" | "new", startLine: number, endLine: number) {
    const pane = side === "old" ? leftRef.current : rightRef.current;
    if (!pane) return;
    const s = Math.max(1, Math.min(startLine, endLine));
    const e = Math.max(1, Math.max(startLine, endLine));
    for (let ln = s; ln <= e; ln++) {
      const el =
        pane.querySelector<HTMLElement>(`[data-side="${side}"][data-line="${ln}"]`) ||
        pane.querySelector<HTMLElement>(`[data-side="${side}"][data-rawline="${ln}"]`);
      if (!el) continue;
      el.classList.remove("flash-highlight");
      void el.offsetWidth;
      el.classList.add("flash-highlight");
      window.setTimeout(() => el.classList.remove("flash-highlight"), 1200);
    }
  }

  useImperativeHandle(ref, () => ({
    scrollTo: ({ side, line, flash = true }) => {
      if (side === "both") {
        const l = leftRef.current;
        const r = rightRef.current;
        if (!l || !r) return;

        const tR =
          r.querySelector<HTMLElement>(`[data-side="new"][data-line="${line}"]`) ||
          r.querySelector<HTMLElement>(`[data-side="new"][data-rawline="${line}"]`) ||
          r.querySelector<HTMLElement>(`[data-line="${line}"]`);

        suppressSync.current.old = true;
        suppressSync.current.new = true;

        if (tR) r.scrollTop = tR.offsetTop - r.clientHeight / 2;

        const rv = r.scrollTop / Math.max(1, r.scrollHeight - r.clientHeight);
        const rh = r.scrollLeft / Math.max(1, r.scrollWidth - r.clientWidth);
        l.scrollTop = rv * Math.max(1, l.scrollHeight - l.clientHeight);
        l.scrollLeft = rh * Math.max(1, l.scrollWidth - l.clientWidth);

        if (flash) {
          flashLine("old", line);
          flashLine("new", line);
        }
        return;
      }

      const primary = side === "old" ? leftRef.current : rightRef.current;
      if (!primary) return;
      suppressSync.current[side] = true;

      const target =
        primary.querySelector<HTMLElement>(`[data-side="${side}"][data-line="${line}"]`) ||
        primary.querySelector<HTMLElement>(`[data-side="${side}"][data-rawline="${line}"]`) ||
        primary.querySelector<HTMLElement>(`[data-line="${line}"]`);

      if (target) {
        primary.scrollTop = target.offsetTop - primary.clientHeight / 2;
      } else {
        const total = (side === "old" ? displayOld : displayNew).split("\n").length;
        const ratio = Math.max(0, Math.min(1, (line - 1) / Math.max(1, total - 1)));
        primary.scrollTop = ratio * Math.max(1, primary.scrollHeight - primary.clientHeight);
      }

      if (flash) flashLine(side, line);
    },

    // NEW
    flashRange: (side, startLine, endLine) => {
      flashRangeImpl(side, startLine, endLine);
    },
  }));

  // Optional: respond to MiniMap’s DOM event fallback (qa:flash-range)
  useEffect(() => {
    const handler = (e: Event) => {
      const ce = e as CustomEvent<{ side: "old" | "new"; startLine: number; endLine: number }>;
      const d = ce.detail;
      if (!d) return;
      if (d.side !== "old" && d.side !== "new") return;
      flashRangeImpl(d.side, d.startLine, d.endLine);
    };
    window.addEventListener("qa:flash-range", handler as EventListener);
    return () => window.removeEventListener("qa:flash-range", handler as EventListener);
  }, []);

  const heightStyle =
    typeof paneHeight === "number"
      ? { height: `${paneHeight}px`, scrollbarGutter: "stable" as const }
      : { height: paneHeight, maxHeight: "100%", scrollbarGutter: "stable" as const };

  type Tag = "added" | "removed" | "modified" | undefined;

  const renderSide = (
    which: "old" | "new",
    ariaLabel: string
  ) => {
    const refDiv = which === "old" ? leftRef : rightRef;

    return (
      <div
        ref={refDiv}
        onScroll={() => onPaneScroll(which)}
        className="flex-1 min-h-0 rounded-lg border border-slate-200 bg-slate-50 overflow-auto hover-scroll focus:outline-none"
        style={heightStyle}
        aria-label={ariaLabel}
        tabIndex={0}
      >
        <div
          className="relative w-max p-2 font-mono text-[11px] leading-[1.15] text-slate-800"
          style={{
            fontVariantLigatures: "none",
            MozTabSize: 4 as unknown as string,
            OTabSize: 4 as unknown as string,
            tabSize: 4 as unknown as string,
          }}
        >
          {rows.map((row, idx) => {
            const isOld = which === "old";
            const side = isOld ? row.old : row.new;
            const tag: Tag =
              row.kind === "unchanged"
                ? undefined
                : row.kind === "modification"
                ? "modified"
                : row.kind === "addition"
                ? (isOld ? "added" : "added")
                : /* deletion */ (isOld ? "removed" : "removed");

            const rowBg =
              tag === "modified"
                ? theme.modified
                : tag === "removed"
                ? theme.removed
                : tag === "added"
                ? theme.added
                : "";

            const displayLine = side.visualIndex ?? idx + 1; // DISPLAY index (with deletion placeholders)
            const rawLine = side.lineNumber;                 // raw source line (may be undefined)

            return (
              <div
                key={idx}
                data-side={which}
                data-line={displayLine}
                {...(typeof rawLine === "number" ? { "data-rawline": rawLine } : {})}
                className={`${theme.baseRow} ${rowBg} relative`}
              >
                <span className={`sticky left-0 z-10 w-12 pr-2 text-right select-none ${theme.num} bg-transparent shrink-0`}>
                  {displayLine}
                </span>
                <code className="block whitespace-pre pr-4">
                  {renderHighlightedSQL(side.text ?? "")}
                </code>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

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
                {renderSide("old", "Original query")}
              </div>
              <div className="flex flex-col h-full min-h-0">
                <h3 className={`font-semibold mb-2 ${theme.header}`}>Updated Query</h3>
                {renderSide("new", "Updated query")}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <style jsx global>{`
      .flash-highlight {
        animation: qc-rect-flash 1.2s ease-out;
      }

      @keyframes qc-rect-flash {
        0% {
          background-color: rgba(250, 204, 21, 0.25); /* soft yellow fill */
          box-shadow: inset 0 0 0 2px rgba(250, 204, 21, 0.8); /* rectangular edge */
        }
        40% {
          background-color: rgba(250, 204, 21, 0.15);
          box-shadow: inset 0 0 0 2px rgba(250, 204, 21, 0.5);
        }
        100% {
          background-color: transparent;
          box-shadow: inset 0 0 0 0 rgba(250, 204, 21, 0);
        }
      }

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
  );
}

export const QueryComparison = forwardRef<QueryComparisonHandle, QueryComparisonProps>(QueryComparisonInner);
