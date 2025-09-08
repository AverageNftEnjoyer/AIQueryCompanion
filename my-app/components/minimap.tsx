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
  soundSrc?: string
  soundEnabled?: boolean

  mapHeightPx?: number
  minBlockPx?: number

  /** Optional override: force all jumps to go to this side */
  forceSide?: Side
}

const SOLID_COLOR: Record<ChangeType, string> = {
  addition: "#10b981",     // green
  modification: "#f59e0b", // yellow
  deletion: "#ef4444",     // red
}

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
}: MiniMapProps) {
  const clickAudioRef = React.useRef<HTMLAudioElement | null>(null)

  const playClick = () => {
    if (!soundEnabled) return
    const el = clickAudioRef.current
    if (!el) return
    try {
      el.muted = false
      el.pause()
      el.currentTime = 0
      el.volume = 0.6
      el.play().catch(() => {})
    } catch {}
  }

  React.useEffect(() => {
    const el = clickAudioRef.current
    if (!el) return
    el.muted = !soundEnabled
    if (!soundEnabled) {
      try {
        el.pause()
        el.currentTime = 0
      } catch {}
    }
  }, [soundEnabled])

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
      <audio ref={clickAudioRef} src={soundSrc} preload="auto" muted={!soundEnabled} />

      {changes.map((c, i) => {
        const span = Math.max(1, c.span ?? 1)
        const centerLine = c.lineNumber + (span - 1) / 2
        const topPct = (centerLine / Math.max(1, totalLines)) * 100

        const hPx = Math.max(
            minBlockPx,
            (span / Math.max(1, totalLines)) * mapHeightPx
          )

        return (
          <button
            key={i}
            title={`${c.label || c.type} @ lines ${c.lineNumber}-${c.lineNumber + span - 1}`}
            onClick={(e) => {
              e.preventDefault()
              playClick()
              onJump({
                side: forceSide ?? (c.side as Side),
                line: c.lineNumber,
              })
            }}
            className="absolute left-0 right-0 transition-[filter,transform] hover:brightness-110 active:brightness-125"
            style={{
              top: `calc(${topPct}% - ${hPx / 2}px)`,
              height: `${hPx}px`,
              backgroundColor: SOLID_COLOR[c.type],
              opacity: 1,
              mixBlendMode: "normal",
            }}
            aria-label={`Jump to ${c.type} at lines ${c.lineNumber}-${c.lineNumber + span - 1}`}
          />
        )
      })}
    </div>
  )
}
