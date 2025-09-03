"use client"

import * as React from "react"

type ChangeType = "addition" | "modification" | "deletion"
type Side = "old" | "new" | "both"

export interface MiniChange {
  type: ChangeType
  lineNumber: number
  side: Side
  span?: number
  label?: string
}

interface MiniMapProps {
  totalLines: number
  changes: MiniChange[]
  onJump: (opts: { side: Side; line: number }) => void
  className?: string
  /** Optional: override sound source; defaults to /minimapbar.mp3 */
  soundSrc?: string
}

const colorFor = (t: ChangeType) =>
  t === "addition"
    ? "bg-emerald-500/70 hover:bg-emerald-500"
    : t === "deletion"
    ? "bg-rose-500/70 hover:bg-rose-500"
    : "bg-amber-500/70 hover:bg-amber-500"

export function MiniMap({
  totalLines,
  changes,
  onJump,
  className,
  soundSrc = "/minimapbar.mp3",
}: MiniMapProps) {
  const minBlock = 5
  const clickAudioRef = React.useRef<HTMLAudioElement | null>(null)

  const playClick = () => {
    const el = clickAudioRef.current
    if (!el) return
    try {
      el.pause()
      el.currentTime = 0
      el.volume = 0.6
      el.play().catch(() => {})
    } catch {}
  }

  return (
    <div
      className={[
        "relative w-5 rounded-md bg-white/5 border border-white/10 overflow-hidden",
        "cursor-pointer hover:border-white/20",
        className || "",
      ].join(" ")}
      role="navigation"
      aria-label="Change minimap"
    >
      {/* Preload the click sound */}
      <audio ref={clickAudioRef} src={soundSrc} preload="auto" />

      {changes.map((c, i) => {
        const span = Math.max(1, c.span ?? 1)
        const topPct = (c.lineNumber / Math.max(1, totalLines)) * 100
        const hPx = Math.max(minBlock, (span / Math.max(1, totalLines)) * 220)

        return (
          <button
            key={i}
            title={`${c.label || c.type} @ line ${c.lineNumber}`}
            onClick={(e) => {
              e.preventDefault()
              playClick()
              onJump({ side: c.side, line: c.lineNumber })
            }}
            className={`absolute left-0 right-0 ${colorFor(c.type)} transition-opacity`}
            style={{
              top: `calc(${topPct}% - ${hPx / 2}px)`,
              height: `${hPx}px`,
              opacity: 0.9,
            }}
            aria-label={`Jump to ${c.type} at line ${c.lineNumber}`}
          />
        )
      })}
    </div>
  )
}
