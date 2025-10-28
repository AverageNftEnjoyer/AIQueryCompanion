"use client";

import * as React from "react";
import type { AlignedRow, AlignedRowKind } from "@/lib/query-differ";

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";

export interface MiniChange {
  lineNumber: number;
  type: ChangeType;
  side: Side;
  span?: number;
  label?: string;
}

interface MiniMapProps {
  alignedRows: AlignedRow[];
  forceSide: Extract<Side, "old" | "new">;
  onJump: (opts: { side: Side; line: number }) => void;
  onFlashRange?: (opts: { side: Extract<Side, "old" | "new">; startLine: number; endLine: number }) => void;

  className?: string;
  soundSrc?: string;
  soundEnabled?: boolean;
  mapHeightPx?: number;
  minBlockPx?: number;
  maxStackRows?: number;

  changes?: MiniChange[];
}

const COLOR: Record<ChangeType, string> = {
  addition: "#10b981",
  modification: "#f59e0b",
  deletion: "#ef4444",
};

const ROW_OFFSET_PX = 3;

type Block = {
  key: string;
  type: ChangeType;     // addition | deletion | modification
  side: Side;           // "old" | "new" | "both"
  vStart: number;       // 1-based visual row start (alignedRows)
  vSpan: number;        // number of visual rows in this run
  topPx: number;
  heightPx: number;
  startLine: number;    // real file line number start 
  endLine: number;      // real file line number end
  label?: string;
};

export function MiniMap({
  alignedRows,
  forceSide,
  onJump,
  onFlashRange,
  className,
  soundSrc = "/minimapbar.mp3",
  soundEnabled = true,
  mapHeightPx = 220,
  minBlockPx = 6,
  maxStackRows = 3,
}: MiniMapProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const clickAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const [measuredH, setMeasuredH] = React.useState<number>(mapHeightPx);

  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const update = () => {
      const h = el.offsetHeight || el.clientHeight || mapHeightPx;
      if (typeof h === "number" && h > 0) setMeasuredH(h);
    };

    const parent = el.parentElement;
    const ro = new ResizeObserver(() => update());
    if (parent) ro.observe(parent);
    ro.observe(el);

    update();
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [mapHeightPx]);

  React.useEffect(() => {
    const el = clickAudioRef.current;
    if (!el) return;
    el.muted = !soundEnabled;
    if (!soundEnabled) {
      try {
        el.pause();
        el.currentTime = 0;
      } catch {}
    }
  }, [soundEnabled]);

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

 
  const blocks: Block[] = React.useMemo(() => {
    const H = Math.max(1, measuredH);
    const totalVisualRows = Math.max(1, alignedRows.length);
    const useOld = forceSide === "old";

    const includeKinds: Record<AlignedRowKind, boolean> = {
      unchanged: false,
      addition: !useOld,
      deletion: useOld,
      modification: true,
    };

    type Pending = {
      type: ChangeType;
      side: Side;            // "old"/"new" for pure adds/dels, "both" for modifications
      vStart: number;        // visual start row (1-based)
      vEnd: number;          // visual end row (inclusive)
      firstLine?: number;    // first real lineNumber on this pane
      lastLine?: number;     // last real lineNumber on this pane
    } | null;

    let cur: Pending = null;
    const out: Block[] = [];

    const rowToType = (k: AlignedRowKind): ChangeType =>
      k === "addition" ? "addition" : k === "deletion" ? "deletion" : "modification";

    const getV = (r: AlignedRow): number | undefined =>
      useOld ? r.old.visualIndex : r.new.visualIndex;

    const getLine = (r: AlignedRow): number | undefined =>
      useOld ? r.old.lineNumber : r.new.lineNumber;

    const sideTagFor = (k: AlignedRowKind): Side =>
      k === "modification" ? "both" : forceSide;

    const flush = () => {
      if (!cur) return;
      const vSpan = cur.vEnd - cur.vStart + 1;
      const heightPx = Math.max(minBlockPx, (vSpan / totalVisualRows) * H);
      let top = ((cur.vStart - 1) / totalVisualRows) * H;
      top = Math.min(Math.max(0, top), H - heightPx);

      const startLine = Math.max(1, cur.firstLine ?? 1);
      const endLine = Math.max(startLine, cur.lastLine ?? startLine);

      out.push({
        key: `${cur.type}-${cur.side}-${cur.vStart}-${vSpan}`,
        type: cur.type,
        side: cur.side,
        vStart: cur.vStart,
        vSpan,
        topPx: top,
        heightPx,
        startLine,
        endLine,
      });
      cur = null;
    };

    for (let i = 0; i < alignedRows.length; i++) {
      const r = alignedRows[i];
      if (!includeKinds[r.kind]) {
        flush();
        continue;
      }

      const v = getV(r);
      if (typeof v !== "number" || !Number.isFinite(v)) {
        flush();
        continue;
      }

      const t = rowToType(r.kind);
      const sideTag = sideTagFor(r.kind);
      const line = getLine(r);

      if (cur && cur.type === t && cur.side === sideTag && v === cur.vEnd + 1) {
        cur.vEnd = v;
        if (typeof line === "number") {
          if (cur.firstLine === undefined) cur.firstLine = line;
          cur.lastLine = line;
        }
      } else {
        flush();
        cur = { type: t, side: sideTag, vStart: v, vEnd: v };
        if (typeof line === "number") {
          cur.firstLine = line;
          cur.lastLine = line;
        }
      }
    }

    flush();

    const rowBottoms: number[] = [];
    const stacked: Block[] = [];
    for (let i = 0; i < out.length; i++) {
      const b = out[i];
      let top = b.topPx;
      let row = 0;
      for (; row < rowBottoms.length; row++) {
        if (top >= rowBottoms[row] + ROW_OFFSET_PX) break;
      }
      if (row === rowBottoms.length) {
        if (rowBottoms.length < (maxStackRows ?? 3)) {
          rowBottoms.push(-Infinity);
        } else {
          let best = 0;
          for (let r = 1; r < rowBottoms.length; r++) if (rowBottoms[r] < rowBottoms[best]) best = r;
          row = best;
          top = Math.min(measuredH - b.heightPx, Math.max(0, rowBottoms[row] + ROW_OFFSET_PX));
        }
      }
      const topWithOffset = Math.min(measuredH - b.heightPx, Math.max(0, top + row * ROW_OFFSET_PX));
      rowBottoms[row] = topWithOffset + b.heightPx;

      stacked.push({ ...b, topPx: topWithOffset });
    }

    return stacked;
  }, [alignedRows, forceSide, maxStackRows, measuredH, minBlockPx]);

  return (
    <div
      ref={rootRef}
      className={[
        "relative rounded-md overflow-hidden cursor-pointer",
        "bg-white/5 border border-white/10 hover:border-white/20",
        className || "",
      ].join(" ")}
      style={{ height: "100%" }}
      role="navigation"
      aria-label="Change minimap"
    >
      <audio ref={clickAudioRef} src={soundSrc} preload="auto" muted={!soundEnabled} />

      {blocks.map((b) => (
        <button
          key={b.key}
          title={`${b.type} • rows ${b.vStart}-${b.vStart + b.vSpan - 1}`}
          onClick={(e) => {
            e.preventDefault();
            playClick();
            onJump({ side: forceSide, line: b.startLine });
            onFlashRange?.({ side: forceSide, startLine: b.startLine, endLine: b.endLine });
            try {
              window.dispatchEvent(
                new CustomEvent("qa:flash-range", {
                  detail: { side: forceSide, startLine: b.startLine, endLine: b.endLine },
                })
              );
            } catch {}
          }}
          className="absolute left-0 right-0 transition-[filter,transform] hover:brightness-110 active:brightness-125"
          style={{
            top: `${b.topPx}px`,
            height: `${b.heightPx}px`,
            backgroundColor: COLOR[b.type],
            opacity: 1,
            mixBlendMode: "normal",
          }}
          aria-label={`Jump to ${b.type} at rows ${b.vStart}-${b.vStart + b.vSpan - 1}`}
        />
      ))}
    </div>
  );
}
