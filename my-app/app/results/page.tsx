"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { MiniMap } from "@/components/minimap"
import {
  Home,
  Bell,
  BellOff,
  Zap,
  AlertCircle,
  BarChart3,
  ChevronDown,
  Loader2,
  Link2,
  Sun,
  Moon,
} from "lucide-react"
import { QueryComparison, type QueryComparisonHandle } from "@/components/query-comparison"
import { generateQueryDiff, canonicalizeSQL, type ComparisonResult } from "@/lib/query-differ"

type ChangeType = "addition" | "modification" | "deletion"
type Side = "old" | "new" | "both"
type GoodBad = "good" | "bad"

interface AnalysisResult {
  summary: string
  changes: Array<{
    type: ChangeType
    description: string
    explanation: string
    lineNumber: number
    side: Side
    syntax: GoodBad
    performance: GoodBad
  }>
  recommendations: Array<{
    type: "optimization" | "best_practice" | "warning" | "analysis"
    title: string
    description: string
  }>
  riskAssessment?: "Low" | "Medium" | "High"
  performanceImpact?: "Positive" | "Negative" | "Neutral"
}

const MAX_QUERY_CHARS = 120_000

const gridBg = (
  <div className="pointer-events-none absolute inset-0 opacity-90">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(120,119,198,0.08),transparent_60%),radial-gradient(ellipse_at_bottom,_rgba(16,185,129,0.08),transparent_60%)]" />
    <div className="absolute inset-0 mix-blend-overlay bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(255,255,255,0.04)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(255,255,255,0.04)_24px)]" />
  </div>
)

function deriveDisplayChanges(analysis: AnalysisResult | null) {
  if (!analysis) return []
  return analysis.changes.slice().sort((a, b) => a.lineNumber - b.lineNumber)
}

function toMiniChanges(analysis: AnalysisResult | null) {
  if (!analysis) return []
  return analysis.changes.map((c) => ({
    type: c.type,
    side: c.side,
    lineNumber: c.lineNumber,
    span: 1,
    label: c.description,
  }))
}

function FancyLoader() {
  const messages = [
    "Generating semantic diff, risk notes, and explanations…",
    "Analyzing SQL syntax and detecting anomalies…",
    "Measuring potential performance impact of changes…",
    "Evaluating best practices and optimization hints…",
    "Assessing overall query risk level and stability…",
    "Scanning subqueries and nested joins for complexity…",
    "Checking index usage and key distribution…",
    "Reviewing SELECT, WHERE, and JOIN clauses for efficiency…",
    "Validating grouping, ordering, and aggregation logic…",
    "Cross-referencing schema metadata and column types…",
    "Compiling final report with recommendations and risk score…",
  ]

  const [index, setIndex] = useState(0)
  const [fading, setFading] = useState(false)

  useEffect(() => {
    const id = setInterval(() => {
      setFading(true)
      const t = setTimeout(() => {
        setIndex((i) => (i + 1) % messages.length)
        setFading(false)
      }, 250)
      return () => clearTimeout(t)
    }, 4000)
    return () => clearInterval(id)
  }, [messages.length])

  return (
    <div className="w-full flex flex-col items-center justify-center py-16">
      <div className="flex items-end gap-1.5 mb-6">
        <span className="w-2 h-5 bg-white/90 rounded-sm animate-bounce" />
        <span className="w-2 h-7 bg-white/80 rounded-sm animate-bounce" style={{ animationDelay: "120ms" }} />
        <span className="w-2 h-9 bg-white/70 rounded-sm animate-bounce" style={{ animationDelay: "240ms" }} />
        <span className="w-2 h-7 bg-white/80 rounded-sm animate-bounce" style={{ animationDelay: "360ms" }} />
        <span className="w-2 h-5 bg-white/90 rounded-sm animate-bounce" style={{ animationDelay: "480ms" }} />
      </div>

      <div className="w-full max-w-3xl rounded-xl border border-white/10 bg-white/5 backdrop-blur p-6">
        <div className="h-4 w-40 bg-white/10 rounded mb-4 animate-pulse" />
        <div className="space-y-2">
          <div className="h-3 w-full bg-white/10 rounded animate-pulse" />
          <div className="h-3 w-[92%] bg-white/10 rounded animate-pulse" />
          <div className="h-3 w-[84%] bg-white/10 rounded animate-pulse" />
        </div>
        <div className="mt-6 flex items-center gap-2 text-white/70">
          <Zap className="w-4 h-4 animate-pulse" />
          <span className={`transition-opacity duration-300 ${fading ? "opacity-0" : "opacity-100"}`}>
            {messages[index]}
          </span>
        </div>
      </div>
    </div>
  )
}

export default function ResultsPage() {
  const router = useRouter()
  const [oldQuery, setOldQuery] = useState<string>("")
  const [newQuery, setNewQuery] = useState<string>("")
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const startedRef = useRef(false)

  const doneAudioRef = useRef<HTMLAudioElement | null>(null)
  const switchAudioRef = useRef<HTMLAudioElement | null>(null)
  const cmpRef = useRef<QueryComparisonHandle>(null)

  const [syncEnabled, setSyncEnabled] = useState(true)
  const [summary, setSummary] = useState<string>("")
  const [summarizing, setSummarizing] = useState(false)
  const summaryRef = useRef<HTMLDivElement | null>(null)

  const [soundOn, setSoundOn] = useState(true)
  const [lightUI, setLightUI] = useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return localStorage.getItem("qa:lightUI") === "1"
  })

  const analysisDoneSoundPlayedRef = useRef(false)

  // --- track any deferred "resume to play" handler so we can cancel it on mute ---
  const resumeHandlerRef = useRef<((e?: any) => void) | null>(null)
  const clearResumeHandler = () => {
    if (resumeHandlerRef.current) {
      window.removeEventListener("pointerdown", resumeHandlerRef.current)
      window.removeEventListener("keydown", resumeHandlerRef.current)
      resumeHandlerRef.current = null
    }
  }

  // ---- SFX helper (respects mute) ----
  const playSfx = (ref: React.RefObject<HTMLAudioElement>) => {
    if (!soundOn) return
    const el = ref.current
    if (!el) return
    try {
      el.pause()
      el.currentTime = 0
      el.volume = 0.5
      el.play().catch(() => {})
    } catch {}
  }

  // Done sound with deferred handler tracking
  const playDoneSound = async () => {
    if (!soundOn) return
    const el = doneAudioRef.current
    if (!el) return
    try {
      clearResumeHandler()
      el.pause()
      el.currentTime = 0
      el.volume = 0.5
      await el.play()
    } catch {
      const resume = () => {
        el!.play().finally(() => {
          clearResumeHandler()
        })
      }
      resumeHandlerRef.current = resume
      window.addEventListener("pointerdown", resume, { once: true })
      window.addEventListener("keydown", resume, { once: true })
    }
  }

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true

    const raw = typeof window !== "undefined" ? sessionStorage.getItem("qa:payload") : null
    if (!raw) {
      router.push("/")
      return
    }

    const parsed = JSON.parse(raw) as { oldQuery: string; newQuery: string }
    if (!parsed?.oldQuery || !parsed?.newQuery) {
      router.push("/")
      return
    }
    if (parsed.oldQuery.length > MAX_QUERY_CHARS || parsed.newQuery.length > MAX_QUERY_CHARS) {
      setError(`Queries exceed ${MAX_QUERY_CHARS.toLocaleString()} characters. Please shorten and retry.`)
      setLoading(false)
      return
    }

    setOldQuery(parsed.oldQuery)
    setNewQuery(parsed.newQuery)

    ;(async () => {
      try {
        const res = await fetch("/api/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            oldQuery: canonicalizeSQL(parsed.oldQuery),
            newQuery: canonicalizeSQL(parsed.newQuery),
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data?.error || "Analysis failed")
        setAnalysis(data.analysis as AnalysisResult)
      } catch (e: any) {
        setError(e?.message || "Unexpected error")
      } finally {
        setLoading(false)
      }
    })()
  }, [router])

  // keep <audio> elements in sync with mute and kill pending resumes
  useEffect(() => {
    const audios = [doneAudioRef.current, switchAudioRef.current].filter(Boolean) as HTMLAudioElement[]
    audios.forEach((a) => (a.muted = !soundOn))

    if (!soundOn) {
      audios.forEach((a) => {
        try {
          a.pause()
          a.currentTime = 0
        } catch {}
      })
      clearResumeHandler()
    }
  }, [soundOn])

  // Load persisted sound setting
  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("qa:soundOn") : null
    if (saved === "0") setSoundOn(false)
  }, [])

  // Play "done" when initial analysis completes (only once)
  useEffect(() => {
    if (!loading && !error && analysis && !analysisDoneSoundPlayedRef.current) {
      analysisDoneSoundPlayedRef.current = true
      playDoneSound()
    }
  }, [loading, error, analysis]) // eslint-disable-line react-hooks/exhaustive-deps

  const displayChanges = useMemo(() => deriveDisplayChanges(analysis), [analysis])

  const stats = useMemo(() => {
    if (!oldQuery || !newQuery) return null
    const diff: ComparisonResult = generateQueryDiff(oldQuery, newQuery)
    return diff.stats
  }, [oldQuery, newQuery])

  async function handleGenerateSummary() {
    if (!analysis) return
    setSummarizing(true)
    setSummary("")
    try {
      const res = await fetch("/api/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newQuery: canonicalizeSQL(newQuery),
          analysis,
        }),
      })
      if (res.ok) {
        const data = await res.json()
        setSummary(String(data?.tldr || ""))
        setTimeout(() => {
          summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        }, 100)
      } else {
        setSummary(
          "This query prepares a concise business-facing dataset. It selects and joins the core tables, filters to the scope that matters for reporting, and applies grouping or ordering to make totals and trends easy to read. The output is intended for dashboards or scheduled reports and supports day-to-day monitoring and planning. Data is expected to be reasonably fresh and to run within normal batch windows."
        )
        setTimeout(() => {
          summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        }, 100)
      }
      await playDoneSound()
    } catch {
      setSummary(
        "This query prepares a concise business-facing dataset. It selects and joins the core tables, filters to the scope that matters for reporting, and applies grouping or ordering to make totals and trends easy to read. The output is intended for dashboards or scheduled reports and supports day-to-day monitoring and planning. Data is expected to be reasonably fresh and to run within normal batch windows."
      )
      setTimeout(() => {
        summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 100)
      await playDoneSound()
    } finally {
      setSummarizing(false)
    }
  }

  const handleToggleSync = () => {
    setSyncEnabled((v) => !v)
    playSfx(switchAudioRef)
  }

  const toggleLightUI = () => {
    setLightUI((v) => {
      const next = !v
      if (typeof window !== "undefined") {
        localStorage.setItem("qa:lightUI", next ? "1" : "0")
      }
      return next
    })
    playSfx(switchAudioRef)
  }

  const handleToggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev
      if (typeof window !== "undefined") {
        localStorage.setItem("qa:soundOn", next ? "1" : "0")
      }
      if (next) {
        // play a click immediately when enabling (ignore old state)
        const el = switchAudioRef.current
        if (el) {
          try {
            el.muted = false
            el.pause()
            el.currentTime = 0
            el.volume = 0.5
            el.play().catch(() => {})
          } catch {}
        }
      } else {
        // ensure silence immediately + no deferred resumes
        clearResumeHandler()
        ;[doneAudioRef.current, switchAudioRef.current].forEach((a) => {
          try {
            if (a) {
              a.muted = true
              a.pause()
              a.currentTime = 0
            }
          } catch {}
        })
      }
      return next
    })
  }

  const isLight = lightUI
  const pageBgClass = isLight ? "bg-white text-gray-900" : "bg-neutral-950 text-white"
  const headerBgClass = isLight
    ? "bg-white/90 border-black/10 text-gray-900 shadow-sm"
    : "bg-black/30 border-white/10 text-white"
  const chipText = isLight ? "text-gray-800" : "text-white/80"

  return (
    <div className={`min-h-screen relative ${pageBgClass}`}>
      {!isLight && gridBg}

      <header className={`relative z-10 border ${headerBgClass} backdrop-blur`}>
        <div className="mx-auto w-full max-w-[1800px] px-3 md:px-4 lg:px-6 py-4">
          <div className="grid grid-cols-3 items-center gap-3">
            {/* Left: Home */}
            <div className="flex">
              <Link
                href="/"
                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg transition border ${
                  isLight
                    ? "bg-black/5 hover:bg-black/10 border-black/10 text-gray-700"
                    : "bg-white/5 hover:bg-white/10 border-white/10 text-white"
                }`}
              >
                <Home className="w-5 h-5" />
              </Link>
            </div>

            {/* Center: Title */}
            <div className="flex items-center justify-center">
              <span className={`inline-flex items-center gap-2 ${isLight ? "text-gray-700" : "text-white"}`}>
                <BarChart3 className="w-5 h-5" />
                <span className="font-heading font-semibold text-lg">AI-Powered Query Companion</span>
              </span>
            </div>

            {/* Right: Generate Summary + Sync + Light UI + Sound */}
            <div className="flex items-center justify-end gap-2">
              {/* Sync scroll — icon button */}
              <button
                type="button"
                onClick={handleToggleSync}
                title="Toggle synced scrolling"
                className={`relative p-2 rounded-full transition ${
                  isLight ? "hover:bg-black/10" : "hover:bg-white/10"
                }`}
              >
                <Link2
                  className={`h-5 w-5 transition ${
                    isLight
                      ? syncEnabled
                        ? "text-gray-700"
                        : "text-gray-400"
                      : syncEnabled
                      ? "text-white"
                      : "text-white/60"
                  }`}
                />
              </button>

              {/* Light UI toggle — header & page background only */}
              <button
                type="button"
                onClick={toggleLightUI}
                title={isLight ? "Switch to Dark Background" : "Switch to Light Background"}
                className={`relative p-2 rounded-full transition ${isLight ? "hover:bg-black/10" : "hover:bg-white/10"}`}
              >
                {isLight ? (
                  <Sun className="h-5 w-5 text-gray-700" />
                ) : (
                  <Moon className="h-5 w-5 text-white" />
                )}
              </button>

              {/* Sound toggle */}
              <button
                type="button"
                onClick={handleToggleSound}
                aria-pressed={soundOn}
                title={soundOn ? "Mute sounds" : "Enable sounds"}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition border border-transparent ${
                  isLight ? "hover:bg-black/10" : "hover:bg-white/10"
                } focus:outline-none focus-visible:ring-0`}
              >
                {soundOn ? (
                  <Bell className={`h-5 w-5 ${isLight ? "text-gray-700" : "text-white"}`} />
                ) : (
                  <BellOff className={`h-5 w-5 ${isLight ? "text-gray-400" : "text-white/60"}`} />
                )}
                <span className="sr-only">{soundOn ? "Mute sounds" : "Enable sounds"}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        {/* Muted bound to state as well for belt & suspenders */}
        <audio ref={doneAudioRef} src="/loadingdone.mp3" preload="auto" muted={!soundOn} />
        <audio ref={switchAudioRef} src="/switch.mp3" preload="auto" muted={!soundOn} />

        <div className="mx-auto w-full max-w-[1800px] px-3 md:px-4 lg:px-6 pt-2 pb-8">
          {loading && !error && <FancyLoader />}

          {!loading && error && (
            <Alert className={`${isLight ? "bg-white border-red-500/40" : "bg-black/40"} backdrop-blur text-inherit`}>
              <AlertCircle className={`w-5 h-5 ${isLight ? "text-red-600" : "text-red-400"}`} />
              <AlertDescription className="flex-1">
                <strong className={isLight ? "text-red-700" : "text-red-300"}>Error:</strong> {error}
              </AlertDescription>
              <Button
                asChild
                variant="outline"
                className={`${isLight ? "border-black/20 text-gray-900 hover:bg-black/10" : "border-white/20 text-white/90 hover:bg-white/10"}`}
              >
                <Link href="/">Go Home</Link>
              </Button>
            </Alert>
          )}

          {!loading && !error && analysis && (
            <div className="space-y-8">
              {/* Stat chips */}
              <section className="mt-0 mb-2">
                {stats && (
                  <div className={`flex items-center justify-center gap-2 text-xs ${chipText}`}>
                    <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30">
                      {stats.additions} additions
                    </span>
                    <span className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30">
                      {stats.modifications} modifications
                    </span>
                    <span className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30">
                      {stats.deletions} deletions
                    </span>
                    <span className={`px-2 py-1 rounded ${isLight ? "bg-black/5 border-black/15" : "bg-white/10 border-white/20"}`}>
                      {stats.unchanged} unchanged
                    </span>
                  </div>
                )}
              </section>

              {/* Diff + MiniMap */}
              <section className="mt-1">
                <div className="flex items-stretch gap-3">
                  <div className="flex-1 min-w-0 h-[90vh]">
                    <div className="h-full overflow-auto rounded-xl">
                      <QueryComparison
                        ref={cmpRef}
                        oldQuery={oldQuery}
                        newQuery={newQuery}
                        showTitle={false}
                        syncScrollEnabled={syncEnabled}
                      />
                    </div>
                  </div>

                  <div className="hidden lg:block h-[86vh]">
                    <MiniMap
                      totalLines={Math.max(
                        oldQuery ? oldQuery.split("\n").length : 0,
                        newQuery ? newQuery.split("\n").length : 0
                      )}
                      changes={toMiniChanges(analysis)}
                      onJump={({ side, line }) => cmpRef.current?.scrollTo({ side, line })}
                      className={`w-6 h-full rounded-md
                        ${isLight
                          ? "bg-white border border-black ring-2 ring-black/30 hover:ring-black/40"
                          : "bg-white/5 border border-white/10 hover:border-white/20"
                        }`}
                      soundEnabled={soundOn}
                        />
                  </div>
                </div>

                <div className={`flex items-center justify-center text-xs mt-1 ${isLight ? "text-gray-500" : "text-white/60"}`}>
                  <ChevronDown className="w-4 h-4 mr-1 animate-bounce" />
                  Scroll for Changes & AI Analysis
                </div>
                <div className="mt-4 flex items-center justify-center">
                  <button
                    type="button"
                    onClick={handleGenerateSummary}
                    disabled={summarizing}
                    className={`inline-flex items-center gap-2 px-4 h-9 rounded-full border transition whitespace-nowrap disabled:opacity-60 disabled:cursor-not-allowed ${
                      isLight
                        ? "bg-black/5 hover:bg-black/10 border-black/10 text-gray-700"
                        : "bg-white/5 hover:bg-white/10 border-white/15 text-white"
                    }`}
                    title="Generate a basic summary of the new query"
                  >
                    {summarizing ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Generating…</span>
                      </>
                    ) : (
                      <span className="text-sm">Generate Summary</span>
                    )}
                  </button>
                </div>
                              </section>

              {/* Lower panels */}
              <section className="grid lg:grid-cols-2 gap-8">
                {/* LEFT COLUMN */}
                <div className="space-y-8">
                  <Card className="bg-white border-slate-200 ring-1 ring-black/5 shadow-[0_1px_0_rgba(0,0,0,0.05),0_10px_30px_rgba(0,0,0,0.10)] dark:ring-0 dark:border-gray-200 dark:shadow-lg">
                    <CardContent className="p-5">
                      <h3 className="text-slate-900 font-semibold mb-4">Changes</h3>
                        <div
                          className="h-[28rem] overflow-auto hover-scroll focus:outline-none pr-[12px]"
                          style={{ scrollbarGutter: "stable" }}
                          tabIndex={0}>                     
                          {displayChanges.length > 0 ? (
                          <div className="space-y-3">
                            {displayChanges.map((chg, index) => {
                              const jumpSide: "old" | "new" | "both" =
                                chg.side === "both" ? "both" : chg.side === "old" ? "old" : "new"
                              return (
                                <button
                                  key={index}
                                  className="group w-full text-left bg-gray-50 border border-gray-200 rounded-lg p-3 cursor-pointer transition hover:bg-amber-50 hover:border-amber-300 hover:shadow-sm active:bg-amber-100 active:border-amber-300 focus:outline-none focus:ring-0"
                                  onClick={(e) => {
                                    cmpRef.current?.scrollTo({ side: jumpSide, line: chg.lineNumber })
                                    ;(e.currentTarget as HTMLButtonElement).blur()
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault()
                                      cmpRef.current?.scrollTo({ side: jumpSide, line: chg.lineNumber })
                                      ;(e.currentTarget as HTMLButtonElement).blur()
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
                                      {chg.side} · line {chg.lineNumber}
                                    </span>
                                  </div>
                                  <p className="text-gray-800 text-sm">{chg.description}</p>
                                </button>
                              )
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

                  {(summarizing || summary) && (
                    <Card ref={summaryRef} className="bg-white border-gray-200 shadow-lg">
                      <CardContent className="p-5">
                        <h3 className="text-slate-900 font-semibold mb-4">Summary</h3>
                        <div className="min-h-[28rem] bg-gray-50 border border-gray-200 rounded-lg p-4">
                          {summarizing && !summary ? (
                            <div className="space-y-4">
                              <div className="inline-flex items-center gap-2 text-gray-700">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span>Generating summary…</span>
                              </div>
                              <div className="space-y-2">
                                <div className="h-3 w-full bg-gray-200 rounded animate-pulse" />
                                <div className="h-3 w-[92%] bg-gray-200 rounded animate-pulse" />
                                <div className="h-3 w-[88%] bg-gray-200 rounded animate-pulse" />
                                <div className="h-3 w-[80%] bg-gray-200 rounded animate-pulse" />
                              </div>
                            </div>
                          ) : (
                            <p className="text-gray-800 text-sm leading-relaxed">{summary}</p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </div>

                {/* RIGHT COLUMN */}
                <div className="space-y-8">
                  <Card className="bg-white border-slate-200 ring-1 ring-black/5 shadow-[0_1px_0_rgba(0,0,0,0.05),0_10px_30px_rgba(0,0,0,0.10)] dark:ring-0 dark:border-gray-200 dark:shadow-lg">
                    <CardContent className="p-5">
                      <h3 className="text-slate-900 font-semibold mb-4">AI Analysis</h3>
                        <div
                          className="h-[28rem] overflow-auto hover-scroll focus:outline-none pr-[12px]"
                          style={{ scrollbarGutter: "stable" }}
                          tabIndex={0}>
                        <div className="space-y-4">
                          {displayChanges.length > 0 ? (
                            displayChanges.map((chg, index) => (
                              <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                <div className="flex items-start gap-4">
                                  <div className="shrink-0 flex flex-col items-start gap-1 min-w-[120px]">
                                    <span className="px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700">
                                      Line {chg.lineNumber}
                                    </span>
                                    <span
                                      className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                                        chg.type === "addition"
                                          ? "bg-emerald-100 text-emerald-700"
                                          : chg.type === "deletion"
                                          ? "bg-rose-100 text-rose-700"
                                          : "bg-amber-100 text-amber-700"
                                      }`}
                                    >
                                      {chg.type}
                                    </span>
                                    <div className="flex flex-col gap-1 pt-1">
                                      <span
                                        className={
                                          "px-2 py-0.5 rounded text-[10px] font-medium " +
                                          (chg.syntax === "good" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")
                                        }
                                      >
                                        Syntax: {chg.syntax === "good" ? "Good" : "Bad"}
                                      </span>
                                      <span
                                        className={
                                          "px-2 py-0.5 rounded text-[10px] font-medium " +
                                          (chg.performance === "good" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")
                                        }
                                      >
                                        Performance: {chg.performance === "good" ? "Good" : "Bad"}
                                      </span>
                                    </div>
                                  </div>
                                  <p className="flex-1 text-gray-800 text-sm leading-relaxed">{chg.explanation}</p>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                              <p className="text-gray-700 text-sm leading-relaxed">{analysis.summary}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {false && (
                    <Card className="bg-white border-gray-200 shadow-lg">
                      <CardContent className="p-5">
                        <h3 className="text-slate-900 font-semibold mb-4">[Fourth Panel]</h3>
                        <div className="min-h-[28rem] bg-gray-50 border border-gray-200 rounded-lg p-4" />
                      </CardContent>
                    </Card>
                  )}
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
