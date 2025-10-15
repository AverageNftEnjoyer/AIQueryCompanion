"use client";

import React, { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import {
  generateQueryDiff,
  buildAlignedRows,
  type ComparisonResult,
  type AlignedRow,
} from "@/lib/query-differ";

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";
type GoodBad = "good" | "bad";

export type ChangeItem = {
  type: ChangeType;
  description: string;
  explanation?: string;
  lineNumber: number; // start line of the group on the chosen side
  side: Side;
  span?: number; // number of lines in the group
  syntax?: GoodBad;
  performance?: GoodBad;
  index?: number;
  meta?: {
    clauses?: string[];
    change_kind?: string;
    business_impact?: "clear" | "weak" | "none";
    risk?: "low" | "medium" | "high";
    suggestions?: string[];
  };
};

type Props = {
  oldQuery: string;
  newQuery: string;
  isLight: boolean;
  typeFilter: ChangeType | "all";
  sideFilter: Side | "all";
  onChangeTypeFilter: (v: ChangeType | "all") => void;
  onChangeSideFilter: (v: Side | "all") => void;
  onJump: (side: Side | "both", line: number) => void;
  loadingChip?: boolean;
};

const toLF = (s: string) => s.replace(/\r\n/g, "\n");
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Build groups strictly from aligned rows, with safe narrowing on line numbers */
function deriveGroups(rows: AlignedRow[]): ChangeItem[] {
  const groups: ChangeItem[] = [];

  type ModRun = {
    kind: "modification";
    startNew?: number;
    endNew?: number;
    startOld?: number;
    endOld?: number;
    prevPreviewNew?: string;
    prevPreviewOld?: string;
  };
  type AddRun = { kind: "addition"; startNew: number; endNew: number; preview?: string };
  type DelRun = { kind: "deletion"; startOld: number; endOld: number; preview?: string };

  let run: ModRun | AddRun | DelRun | null = null;

  const flush = () => {
    if (!run) return;

    if (run.kind === "addition") {
      const start = run.startNew;
      const end = run.endNew;
      const span = end - start + 1;
      const base =
        span > 1
          ? `Lines ${start}-${end}: added ${span} lines`
          : `Line ${start}: added 1 line`;
      groups.push({
        type: "addition",
        side: "new",
        lineNumber: start,
        span,
        description: run.preview ? `${base}. Preview "${run.preview}"` : base,
      });
    } else if (run.kind === "deletion") {
      const start = run.startOld;
      const end = run.endOld;
      const span = end - start + 1;
      const base =
        span > 1
          ? `Lines ${start}-${end}: removed ${span} lines`
          : `Line ${start}: removed 1 line`;
      groups.push({
        type: "deletion",
        side: "old",
        lineNumber: start,
        span,
        description: run.preview ? `${base}. Preview "${run.preview}"` : base,
      });
    } else {
      // modification
      const anchorStart = isNum(run.startNew) ? run.startNew : (run.startOld as number);
      const anchorEnd = isNum(run.endNew) ? run.endNew! : (run.endOld as number);
      const span = Math.max(1, anchorEnd - anchorStart + 1);

      const base =
        span > 1
          ? `Lines ${anchorStart}-${anchorEnd}: modified ${span} lines`
          : `Line ${anchorStart}: modified 1 line`;

      const pOld = (run.prevPreviewOld || "").trim();
      const pNew = (run.prevPreviewNew || "").trim();
      const preview = pOld && pNew
        ? `Preview "${pOld}" → "${pNew}"`
        : pNew
        ? `Preview "${pNew}"`
        : pOld
        ? `Preview "${pOld}"`
        : "";

      groups.push({
        type: "modification",
        side: "both",
        lineNumber: anchorStart,
        span,
        description: preview ? `${base}. ${preview}` : base,
      });
    }

    run = null;
  };

  const consecutive = (prev: number | undefined, next: number | undefined) =>
    isNum(prev) && isNum(next) && next === prev + 1;

  for (const row of rows) {
    if (row.kind === "unchanged") {
      flush();
      continue;
    }

    if (row.kind === "addition") {
      const lnNew = row.new.lineNumber;
      if (!isNum(lnNew)) {
        flush();
        continue;
      }
      const preview = (row.new.text || "").trim();
      if (run && run.kind === "addition" && consecutive(run.endNew, lnNew)) {
        run.endNew = lnNew;
        if (!run.preview && preview) run.preview = preview;
      } else {
        flush();
        run = { kind: "addition", startNew: lnNew, endNew: lnNew, preview };
      }
      continue;
    }

    if (row.kind === "deletion") {
      const lnOld = row.old.lineNumber;
      if (!isNum(lnOld)) {
        flush();
        continue;
      }
      const preview = (row.old.text || "").trim();
      if (run && run.kind === "deletion" && consecutive(run.endOld, lnOld)) {
        run.endOld = lnOld;
        if (!run.preview && preview) run.preview = preview;
      } else {
        flush();
        run = { kind: "deletion", startOld: lnOld, endOld: lnOld, preview };
      }
      continue;
    }

    // modification
    const lnNew = row.new?.lineNumber;
    const lnOld = row.old?.lineNumber;
    if (!isNum(lnNew) && !isNum(lnOld)) {
      flush();
      continue;
    }

    const pNew = (row.new?.text || "").trim();
    const pOld = (row.old?.text || "").trim();

    if (run && run.kind === "modification") {
      const okNew = !isNum(lnNew) || consecutive(run.endNew, lnNew);
      const okOld = !isNum(lnOld) || consecutive(run.endOld, lnOld);
      if (okNew && okOld) {
        if (isNum(lnNew)) run.endNew = lnNew;
        if (isNum(lnOld)) run.endOld = lnOld;
        if (!run.prevPreviewNew && pNew) run.prevPreviewNew = pNew;
        if (!run.prevPreviewOld && pOld) run.prevPreviewOld = pOld;
      } else {
        flush();
        run = {
          kind: "modification",
          startNew: isNum(lnNew) ? lnNew : undefined,
          endNew: isNum(lnNew) ? lnNew : undefined,
          startOld: isNum(lnOld) ? lnOld : undefined,
          endOld: isNum(lnOld) ? lnOld : undefined,
          prevPreviewNew: pNew,
          prevPreviewOld: pOld,
        };
      }
    } else {
      flush();
      run = {
        kind: "modification",
        startNew: isNum(lnNew) ? lnNew : undefined,
        endNew: isNum(lnNew) ? lnNew : undefined,
        startOld: isNum(lnOld) ? lnOld : undefined,
        endOld: isNum(lnOld) ? lnOld : undefined,
        prevPreviewNew: pNew,
        prevPreviewOld: pOld,
      };
    }
  }

  flush();
  groups.sort((a, b) => a.lineNumber - b.lineNumber);
  return groups;
}

export function Changes({
  oldQuery,
  newQuery,
  isLight,
  typeFilter,
  sideFilter,
  onChangeTypeFilter,
  onChangeSideFilter,
  onJump,
  loadingChip,
}: Props) {
  const o = toLF(oldQuery);
  const n = toLF(newQuery);

  const comparison: ComparisonResult = useMemo(
    () => generateQueryDiff(o, n, { basis: "raw" }),
    [o, n]
  );

  const rows: AlignedRow[] = useMemo(() => buildAlignedRows(comparison), [comparison]);
  const groups = useMemo(() => deriveGroups(rows), [rows]);

  const filtered = useMemo(
    () =>
      groups.filter(
        (g) =>
          (typeFilter === "all" || g.type === typeFilter) &&
          (sideFilter === "all" || g.side === sideFilter)
      ),
    [groups, typeFilter, sideFilter]
  );

  // --- Sound playback (same as minimap) ---
  const clickAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const [soundEnabled] = React.useState(true);
  const playClick = () => {
    if (!soundEnabled) return;
    const el = clickAudioRef.current;
    if (!el) return;
    try {
      el.muted = false;
      el.pause();
      el.currentTime = 0;
      el.volume = 0.6;
      void el.play();
    } catch {}
  };

  return (
    <Card className="bg-white border-slate-200 ring-1 ring-black/5 shadow-[0_1px_0_rgba(0,0,0,0.05),0_10px_30px_rgba(0,0,0,0.10)] dark:ring-0 dark:border-gray-200 dark:shadow-lg">
      <CardContent className="p-5">
        <audio ref={clickAudioRef} src="/minimapbar.mp3" preload="auto" muted={!soundEnabled} />

        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-900 font-semibold">
            Changes {loadingChip ? <Loader2 className="inline-block h-4 w-4 ml-2 animate-spin text-slate-400" /> : null}
          </h3>
          <div className="flex items-center gap-2">
            {(typeFilter !== "all" || sideFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  onChangeTypeFilter("all");
                  onChangeSideFilter("all");
                }}
                className="h-8 px-3 text-sm rounded border border-gray-300 bg-white text-black"
                title="Clear filters"
              >
                Clear
              </button>
            )}

            <select
              id="typeFilter"
              className="h-8 px-2 rounded border border-gray-300 text-sm bg-white text-black"
              value={typeFilter}
              onChange={(e) => onChangeTypeFilter(e.target.value as any)}
              title="Filter by type"
            >
              <option value="all">All Types</option>
              <option value="addition">Additions</option>
              <option value="modification">Modifications</option>
              <option value="deletion">Deletions</option>
            </select>

            <select
              id="sideFilter"
              className="h-8 px-2 rounded border border-gray-300 text-sm bg-white text-black"
              value={sideFilter}
              onChange={(e) => onChangeSideFilter(e.target.value as any)}
              title="Filter by side"
            >
              <option value="all">Both</option>
              <option value="old">Old only</option>
              <option value="new">New only</option>
            </select>
          </div>
        </div>

        <div className="h-[28rem] scroll-overlay focus:outline-none pr-3" tabIndex={0}>
          {filtered.length > 0 ? (
            <div className="space-y-3">
              {filtered.map((chg, idx) => {
                const label =
                  chg.span && chg.span > 1
                    ? `lines ${chg.lineNumber}-${chg.lineNumber + chg.span - 1}`
                    : `line ${chg.lineNumber}`;
                return (
                  <button
                    key={`${chg.type}-${chg.side}-${chg.lineNumber}-${chg.span ?? 1}-${idx}`}
                    className="group w-full text-left bg-gray-50 border border-gray-200 rounded-lg p-3 cursor-pointer transition hover:bg-amber-50 hover:border-amber-300 hover:shadow-sm active:bg-amber-100 active:border-amber-300 focus:outline-none focus:ring-0"
                    onClick={(e) => {
                      e.preventDefault();
                      playClick();
                      onJump(chg.side, chg.lineNumber);
                      (e.currentTarget as HTMLButtonElement).blur();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        playClick();
                        onJump(chg.side, chg.lineNumber);
                        (e.currentTarget as HTMLButtonElement).blur();
                      }
                    }}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className={`px-2 py-1 rounded text-xs font-medium transition ${
                          chg.type === "addition"
                            ? "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200"
                            : chg.type === "deletion"
                            ? "bg-rose-100 text-rose-700 group-hover:bg-rose-200"
                            : "bg-amber-100 text-amber-700 group-hover:bg-amber-200"
                        }`}
                      >
                        {chg.type}
                      </span>
                      <span className="text-xs text-gray-500">
                        {chg.side} · {label}
                      </span>
                    </div>
                    <p className="text-gray-800 text-sm">{chg.description}</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-gray-500">
              <p>No changes detected.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
