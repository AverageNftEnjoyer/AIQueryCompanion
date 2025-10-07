"use client";

import * as React from "react";

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";

export interface MiniChange {
  type: ChangeType;
  lineNumber: number;
  side: Side;
  span?: number;
  label?: string;
}

interface MiniMapProps {
  totalLines: number;
  changes: MiniChange[];
  onJump: (opts: { side: Side; line: number }) => void;
  className?: string;
  soundSrc?: string;
  soundEnabled?: boolean;
  mapHeightPx?: number;
  minBlockPx?: number;
  forceSide?: Side;
  maxStackRows?: number;
}

const COLOR: Record<ChangeType, string> = {
  addition: "#10b981", // green
  modification: "#f59e0b", // amber
  deletion: "#ef4444", // red
};

const ROW_OFFSET_PX = 3;

export function MiniMap({
  totalLines,
  changes,
  onJump,
  className,
  soundSrc = "/minimapbar.mp3",
  soundEnabled = true,
  mapHeightPx = 220,
  minBlockPx = 6,
  forceSide,
  maxStackRows = 3,
}: MiniMapProps) {
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const clickAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const [measuredH, setMeasuredH] = React.useState<number>(mapHeightPx);

  // FIX: robust height measurement + parent observation + window resize
  React.useEffect(() => {
    const el = rootRef.current;
    if (!el) return;

    const updateHeight = () => {
      const h = el.offsetHeight || el.clientHeight || mapHeightPx;
      if (typeof h === "number" && h > 0) setMeasuredH(h);
    };

    const parent = el.parentElement;
    const ro = new ResizeObserver(() => updateHeight());
    if (parent) ro.observe(parent);
    ro.observe(el);

    updateHeight();
    window.addEventListener("resize", updateHeight);

    return () => {
      ro.disconnect();
      window.removeEventListener("resize", updateHeight);
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
      el.play().catch(() => {});
    } catch {}
  };

  const blocks = React.useMemo(() => {
    const H = Math.max(1, measuredH);
    const L = Math.max(1, totalLines);

    type Block = {
      key: string;
      type: ChangeType;
      side: Side;
      line: number;
      span: number;
      label?: string;
      topPx: number;
      heightPx: number;
    };

    const result: Block[] = [];
    const sorted = [...changes].sort((a, b) => a.lineNumber - b.lineNumber);
    const rowBottoms: number[] = [];

    for (let i = 0; i < sorted.length; i++) {
      const c = sorted[i];
      const span = Math.max(1, c.span ?? 1);
      const start = Math.max(1, Math.min(c.lineNumber, L));

      const heightPx = Math.max(minBlockPx, (span / L) * H);
      let top = ((start - 1) / L) * H;
      top = Math.min(Math.max(0, top), H - heightPx);

      let row = 0;
      for (; row < rowBottoms.length; row++) {
        if (top >= rowBottoms[row] + ROW_OFFSET_PX) break;
      }
      if (row === rowBottoms.length) {
        if (rowBottoms.length < maxStackRows) {
          rowBottoms.push(-Infinity);
        } else {
          let best = 0;
          for (let r = 1; r < rowBottoms.length; r++) if (rowBottoms[r] < rowBottoms[best]) best = r;
          row = best;
          top = Math.min(H - heightPx, Math.max(0, rowBottoms[row] + ROW_OFFSET_PX));
        }
      }

      const topWithOffset = Math.min(H - heightPx, Math.max(0, top + row * ROW_OFFSET_PX));
      rowBottoms[row] = topWithOffset + heightPx;

      result.push({
        key: `${i}-${start}-${span}-${c.type}-${c.side}`,
        type: c.type,
        side: c.side,
        line: start,
        span,
        label: c.label,
        topPx: topWithOffset,
        heightPx,
      });
    }

    return result;
  }, [changes, measuredH, minBlockPx, totalLines, maxStackRows]);

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
          title={`${b.label || b.type} @ lines ${b.line}-${b.line + b.span - 1}`}
          onClick={(e) => {
            e.preventDefault();
            playClick();
            onJump({ side: forceSide ?? b.side, line: b.line });
          }}
          className="absolute left-0 right-0 transition-[filter,transform] hover:brightness-110 active:brightness-125"
          style={{
            top: `${b.topPx}px`,
            height: `${b.heightPx}px`,
            backgroundColor: COLOR[b.type],
            opacity: 1,
            mixBlendMode: "normal",
          }}
          aria-label={`Jump to ${b.type} at lines ${b.line}-${b.line + b.span - 1}`}
        />
      ))}
    </div>
  );
}
