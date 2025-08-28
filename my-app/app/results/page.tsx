// /app/results/page.tsx
"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Home, Zap, AlertCircle, BarChart3, ChevronDown } from "lucide-react"
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
      // brief fade-out, then swap, then fade-in
      const t = setTimeout(() => {
        setIndex((i) => (i + 1) % messages.length)
        setFading(false)
      }, 250) // fade-out duration
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
          <span
            className={`transition-opacity duration-300 ${fading ? "opacity-0" : "opacity-100"}`}
          >
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

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const playedRef = useRef(false)
  const cmpRef = useRef<QueryComparisonHandle>(null)
  const [syncEnabled, setSyncEnabled] = useState(true)

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

  useEffect(() => {
    if (!loading && !error && analysis && !playedRef.current) {
      const allowed = typeof window !== "undefined" && sessionStorage.getItem("qa:allowSound") === "1"
      if (allowed) {
        audioRef.current?.play().catch(() => {})
        playedRef.current = true
        sessionStorage.removeItem("qa:allowSound")
      }
    }
  }, [loading, error, analysis])

  const displayChanges = useMemo(() => deriveDisplayChanges(analysis), [analysis])

  const stats = useMemo(() => {
    if (!oldQuery || !newQuery) return null
    const diff: ComparisonResult = generateQueryDiff(oldQuery, newQuery)
    return diff.stats
  }, [oldQuery, newQuery])

  const metricBadge = (label: string, goodBad: GoodBad) => (
    <span
      className={
        "px-2 py-0.5 rounded text-[10px] font-medium " +
        (goodBad === "good" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700")
      }
    >
      {label}: {goodBad === "good" ? "Good" : "Bad"}
    </span>
  )

  return (
    <div className="min-h-screen relative bg-neutral-950 text-white">
      {gridBg}

      <header className="relative z-10 border-b border-white/10 bg-black/30 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <div className="grid grid-cols-3 items-center">
            <Link
              href="/"
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition"
            >
              <Home className="w-5 h-5 text-white" />
            </Link>

            <div className="flex items-center justify-center">
              <div className="flex items-center gap-2 text-white">
                <BarChart3 className="w-5 h-5" />
                <span className="font-heading font-semibold">Query Comparison</span>
              </div>
            </div>

            {stats ? (
              <div className="hidden md:flex items-center justify-end gap-3 text-xs text-white/70">
                <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30">
                  {stats.additions} additions
                </span>
                <span className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30">
                  {stats.modifications} modifications
                </span>
                <span className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30">
                  {stats.deletions} deletions
                </span>
                <span className="px-2 py-1 rounded bg-white/10 border border-white/20">
                  {stats.unchanged} unchanged
                </span>

                {/* Sync toggle (bigger visuals, same length) */}
                <button
                  type="button"
                  onClick={() => setSyncEnabled((v) => !v)}
                  role="switch"
                  aria-checked={syncEnabled}
                  title="Toggle synced scrolling"
                  className="ml-2 inline-flex items-center gap-3 pl-3 pr-1 h-8 rounded-full border border-white/15
                             bg-white/5 hover:bg-white/10 transition whitespace-nowrap"
                >
                  <span className="tracking-tight text-sm leading-none select-none">Sync scroll</span>
                  <span
                    className={`relative w-8 h-5 rounded-full shrink-0 transition
                                ${syncEnabled ? "bg-emerald-500/80" : "bg-white/20"}`}
                  >
                    <span
                      className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow
                                  transition-transform ${syncEnabled ? "translate-x-3" : "translate-x-0"}`}
                    />
                  </span>
                </button>
              </div>
            ) : (
              <div />
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <audio ref={audioRef} src="/loadingdone.mp3" preload="auto" />

        <div className="container mx-auto px-6 py-8">
          {loading && !error && <FancyLoader />}

          {!loading && error && (
            <Alert className="bg-black/40 backdrop-blur border-red-500/40 text-white">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <AlertDescription className="flex-1">
                <strong className="text-red-300">Error:</strong> {error}
              </AlertDescription>
              <Button asChild variant="outline" className="border-white/20 text-white/90 hover:bg-white/10">
                <Link href="/">Go Home</Link>
              </Button>
            </Alert>
          )}

          {!loading && !error && analysis && (
            <div className="space-y-10">
              <section>
                <QueryComparison
                  ref={cmpRef}
                  oldQuery={oldQuery}
                  newQuery={newQuery}
                  showTitle={false}
                  syncScrollEnabled={syncEnabled}
                />
                <div className="flex items-center justify-center text-xs text-white/60 -mt-2">
                  <ChevronDown className="w-4 h-4 mr-1 animate-bounce" />
                  Scroll for Changes & AI Analysis
                </div>
              </section>

              <section className="grid lg:grid-cols-2 gap-8">
                {/* Changes */}
                <Card className="bg-white border-gray-200 shadow-lg">
                  <CardContent className="p-5">
                    <h3 className="text-slate-900 font-semibold mb-4">Changes</h3>
                    <div className="h-[28rem] overflow-y-auto">
                      {displayChanges.length > 0 ? (
                        <div className="space-y-3">
                          {displayChanges.map((chg, index) => {
                            const jumpSide: "old" | "new" | "both" =
                              chg.side === "both" ? "both" : chg.side === "old" ? "old" : "new"
                            return (
                              <button
                                key={index}
                                className="group w-full text-left bg-gray-50 border border-gray-200 rounded-lg p-3 cursor-pointer
                                           transition hover:bg-amber-50 hover:border-amber-300 hover:shadow-sm
                                           active:bg-amber-100 active:border-amber-300 focus:outline-none focus:ring-0"
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

                {/* AI Analysis */}
                <Card className="bg-white border-gray-200 shadow-lg">
                  <CardContent className="p-5">
                    <h3 className="text-slate-900 font-semibold mb-4">AI Analysis</h3>
                    <div className="h-[28rem] overflow-y-auto">
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
                                        (chg.syntax === "good"
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-rose-100 text-rose-700")
                                      }
                                    >
                                      Syntax: {chg.syntax === "good" ? "Good" : "Bad"}
                                    </span>
                                    <span
                                      className={
                                        "px-2 py-0.5 rounded text-[10px] font-medium " +
                                        (chg.performance === "good"
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-rose-100 text-rose-700")
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
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
