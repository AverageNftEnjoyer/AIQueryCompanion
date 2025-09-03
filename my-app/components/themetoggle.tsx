"use client"

import * as React from "react"
import { Moon, Sun } from "lucide-react"
import { useTheme } from "next-themes"

type Props = {
  onClickSound?: () => void
  className?: string
}

export function ThemeToggle({ onClickSound, className }: Props) {
  const { setTheme, resolvedTheme } = useTheme()
  const [mounted, setMounted] = React.useState(false)
  React.useEffect(() => setMounted(true), [])
  if (!mounted) return null

  const isDark = resolvedTheme === "dark"

  const handleClick = () => {
    setTheme(isDark ? "light" : "dark")
    onClickSound?.()
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={isDark}
      title={isDark ? "Switch to light" : "Switch to dark"}
      className={[
        "inline-flex items-center justify-center w-8 h-8 rounded-lg",
        "transition border border-transparent",
        "hover:bg-white/10",           // subtle hover hue (not bright)
        "focus:outline-none focus-visible:ring-0",
        className || ""
      ].join(" ")}
    >
      {/* Light mode icon */}
      <Sun className={`h-5 w-5 transition ${isDark ? "hidden" : "text-white"}`} />
      {/* Dark mode icon */}
      <Moon className={`h-5 w-5 transition ${isDark ? "text-white" : "hidden"}`} />
      <span className="sr-only">Toggle theme</span>
    </button>
  )
}
