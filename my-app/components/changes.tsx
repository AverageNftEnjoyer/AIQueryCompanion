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
  lineNumber: number;
  side: Side;
  span?: number;
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

/**
 * Build maps that let us convert any row/line into a NEW-side "display line"
 * that includes placeholders for deletions. This mirrors what the user sees.
 *
 * - displayLineByRowIndex: the 1-based NEW display line for each aligned row index
 * - newLineToDisplay: map from actual NEW line numbers to their display lines
 * - oldLineToDisplay: map from OLD line numbers (deletions) to the display line
 *   where the blank placeholder appears in NEW
 */
function buildNewDisplayLineMaps(rows: AlignedRow[]) {
  const displayLineByRowIndex: number[] = [];
  const newLineToDisplay = new Map<number, number>();
  const oldLineToDisplay = new Map<number, number>();

  let displayLine = 0; // 1-based for user display
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    displayLine += 1;
    displayLineByRowIndex[i] = displayLine;

    if (isNum(r.new?.lineNumber)) {
      newLineToDisplay.set(r.new.lineNumber, displayLine);
    }

    if (r.kind === "deletion" && isNum(r.old?.lineNumber)) {
      oldLineToDisplay.set(r.old.lineNumber, displayLine);
    }
  }

  return { displayLineByRowIndex, newLineToDisplay, oldLineToDisplay };
}

/** Build groups strictly from aligned rows, anchoring to NEW display line numbers */
function deriveGroupsWithNewAnchors(rows: AlignedRow[]): ChangeItem[] {
  const groups: ChangeItem[] = [];
  const { newLineToDisplay, oldLineToDisplay } = buildNewDisplayLineMaps(rows);

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
      const startNew = run.startNew;
      const endNew = run.endNew;
      const span = endNew - startNew + 1;
      const anchorStartDisplay = newLineToDisplay.get(startNew) ?? startNew;
      const anchorEndDisplay = newLineToDisplay.get(endNew) ?? endNew;

      const base =
        span > 1
          ? `Lines ${anchorStartDisplay}-${anchorEndDisplay}: added ${span} line${span > 1 ? "s" : ""}`
          : `Line ${anchorStartDisplay}: added 1 line`;

      groups.push({
        type: "addition",
        side: "new",
        lineNumber: anchorStartDisplay,
        span: Math.max(1, anchorEndDisplay - anchorStartDisplay + 1),
        description: run.preview ? `${base}. Preview "${run.preview}"` : base,
      });
    } else if (run.kind === "deletion") {
      const startOld = run.startOld;
      const endOld = run.endOld;
      const span = endOld - startOld + 1;

      const anchorStartDisplay = oldLineToDisplay.get(startOld) ?? startOld;
      const anchorEndDisplay = oldLineToDisplay.get(endOld) ?? anchorStartDisplay;

      const base =
        span > 1
          ? `Lines ${anchorStartDisplay}-${anchorEndDisplay}: removed ${span} line${span > 1 ? "s" : ""}`
          : `Line ${anchorStartDisplay}: removed 1 line`;

      groups.push({
        type: "deletion",
        side: "old", 
        lineNumber: anchorStartDisplay,
        span: Math.max(1, anchorEndDisplay - anchorStartDisplay + 1),
        description: run.preview ? `${base}. Preview "${run.preview}"` : base,
      });
    } else {
 
      const sNew = run.startNew;
      const eNew = run.endNew;
      const sOld = run.startOld;
      const eOld = run.endOld;

      let anchorStartDisplay: number | undefined;
      let anchorEndDisplay: number | undefined;

      if (isNum(sNew) && isNum(eNew)) {
        anchorStartDisplay = newLineToDisplay.get(sNew) ?? sNew;
        anchorEndDisplay = newLineToDisplay.get(eNew) ?? eNew;
      } else if (isNum(sNew)) {
        anchorStartDisplay = newLineToDisplay.get(sNew) ?? sNew;
        anchorEndDisplay = anchorStartDisplay;
      } else if (isNum(sOld)) {
        anchorStartDisplay = oldLineToDisplay.get(sOld) ?? sOld;
        anchorEndDisplay = isNum(eOld)
          ? oldLineToDisplay.get(eOld) ?? anchorStartDisplay
          : anchorStartDisplay;
      }

      if (!isNum(anchorStartDisplay)) {
        anchorStartDisplay = 1;
        anchorEndDisplay = anchorStartDisplay;
      }
      if (!isNum(anchorEndDisplay)) anchorEndDisplay = anchorStartDisplay;

      const span = Math.max(1, anchorEndDisplay - anchorStartDisplay + 1);
      const base =
        span > 1
          ? `Lines ${anchorStartDisplay}-${anchorEndDisplay}: modified ${span} line${span > 1 ? "s" : ""}`
          : `Line ${anchorStartDisplay}: modified 1 line`;

      const pOld = (run.prevPreviewOld || "").trim();
      const pNew = (run.prevPreviewNew || "").trim();
      const preview =
        pOld && pNew
          ? `Preview "${pOld}" → "${pNew}"`
          : pNew
          ? `Preview "${pNew}"`
          : pOld
          ? `Preview "${pOld}"`
          : "";

      groups.push({
        type: "modification",
        side: "both",
        lineNumber: anchorStartDisplay,
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
  isLight: _isLight,
  typeFilter,
  sideFilter,
  onChangeTypeFilter,
  onChangeSideFilter,
  onJump,
  loadingChip,
}: Props) {
  const parseTypeFilter = (value: string): ChangeType | "all" =>
    value === "addition" || value === "modification" || value === "deletion" || value === "all" ? value : "all";
  const parseSideFilter = (value: string): Side | "all" =>
    value === "old" || value === "new" || value === "both" || value === "all" ? value : "all";

  const o = toLF(oldQuery);
  const n = toLF(newQuery);

  const comparison: ComparisonResult = useMemo(
    () => generateQueryDiff(o, n, { basis: "raw" }),
    [o, n]
  );

  const rows: AlignedRow[] = useMemo(() => buildAlignedRows(comparison), [comparison]);
  const groups = useMemo(() => deriveGroupsWithNewAnchors(rows), [rows]);

  const filtered = useMemo(
    () =>
      groups.filter(
        (g) =>
          (typeFilter === "all" || g.type === typeFilter) &&
          (sideFilter === "all" || g.side === sideFilter)
      ),
    [groups, typeFilter, sideFilter]
  );

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
    <Card className="bg-card border border-border rounded-md">
      <CardContent className="p-0">
        <audio ref={clickAudioRef} src="/minimapbar.mp3" preload="auto" muted={!soundEnabled} />

        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border">
          <h3 className="font-heading text-[13px] font-semibold uppercase tracking-[0.06em] text-foreground">
            Changes {loadingChip ? <Loader2 className="inline-block h-3.5 w-3.5 ml-2 animate-spin text-muted-foreground" /> : null}
          </h3>
          <div className="flex items-center gap-1.5">
            {(typeFilter !== "all" || sideFilter !== "all") && (
              <button
                type="button"
                onClick={() => {
                  onChangeTypeFilter("all");
                  onChangeSideFilter("all");
                }}
                className="h-[26px] px-2.5 text-xs rounded-md border border-border bg-card text-foreground hover:bg-surface-2 transition"
                title="Clear filters"
              >
                Clear
              </button>
            )}

            <select
              id="typeFilter"
              className="h-[26px] px-2 rounded-md border border-border text-xs bg-card text-foreground"
              value={typeFilter}
              onChange={(e) => onChangeTypeFilter(parseTypeFilter(e.target.value))}
              title="Filter by type"
            >
              <option value="all">All types</option>
              <option value="addition">Additions</option>
              <option value="modification">Modifications</option>
              <option value="deletion">Deletions</option>
            </select>

            <select
              id="sideFilter"
              className="h-[26px] px-2 rounded-md border border-border text-xs bg-card text-foreground"
              value={sideFilter}
              onChange={(e) => onChangeSideFilter(parseSideFilter(e.target.value))}
              title="Filter by side"
            >
              <option value="all">Both</option>
              <option value="old">Old only</option>
              <option value="new">New only</option>
            </select>
          </div>
        </div>

        <div className="h-[28rem] scroll-overlay focus:outline-none" tabIndex={0}>
          {filtered.length > 0 ? (
            <div>
              {filtered.map((chg, idx) => {
                const label =
                  chg.span && chg.span > 1
                    ? `lines ${chg.lineNumber}-${chg.lineNumber + chg.span - 1}`
                    : `line ${chg.lineNumber}`;
                const chipClass =
                  chg.type === "addition"
                    ? "bg-diff-add-bg text-diff-add-fg"
                    : chg.type === "deletion"
                    ? "bg-diff-del-bg text-diff-del-fg"
                    : "bg-diff-mod-bg text-diff-mod-fg";
                return (
                  <button
                    key={`${chg.type}-${chg.side}-${chg.lineNumber}-${chg.span ?? 1}-${idx}`}
                    className="flex w-full items-start gap-3 px-3.5 py-[11px] border-b border-border text-left transition hover:bg-surface-2 active:bg-surface-2 focus:outline-none focus:ring-0"
                    onClick={(e) => {
                      e.preventDefault();
                      playClick();
                      onJump("new", chg.lineNumber);
                      (e.currentTarget as HTMLButtonElement).blur();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        playClick();
                        onJump("new", chg.lineNumber);
                        (e.currentTarget as HTMLButtonElement).blur();
                      }
                    }}
                  >
                    <span className={`shrink-0 px-2 py-0.5 rounded-md text-[11px] font-semibold uppercase tracking-[0.04em] ${chipClass}`}>
                      {chg.type}
                    </span>
                    <span className="shrink-0 font-mono text-[11px] text-muted-foreground pt-0.5">
                      {chg.side} · {label}
                    </span>
                    <p className="text-xs leading-[1.5] text-foreground">{chg.description}</p>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              <p>No changes detected.</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
