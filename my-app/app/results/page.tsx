"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Card, CardContent } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Home, Zap, AlertCircle, BarChart3 } from "lucide-react"
import { QueryComparison } from "@/components/query-comparison"
import { generateQueryDiff, canonicalizeSQL, type ComparisonResult } from "@/lib/query-differ"

// ---------- Types that mirror /api/analyze response ----------
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

// ---------- Local helpers ----------
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

// ---------- Sleek loader ----------
function FancyLoader() {
  return (
    <div className="w-full flex flex-col items-center justify-center py-16">
      {/* bouncing bars */}
      <div className="flex items-end gap-1.5 mb-6">
        <span className="w-2 h-5 bg-white/90 rounded-sm animate-bounce" />
        <span className="w-2 h-7 bg-white/80 rounded-sm animate-bounce" style={{ animationDelay: "120ms" }} />
        <span className="w-2 h-9 bg-white/70 rounded-sm animate-bounce" style={{ animationDelay: "240ms" }} />
        <span className="w-2 h-7 bg-white/80 rounded-sm animate-bounce" style={{ animationDelay: "360ms" }} />
        <span className="w-2 h-5 bg-white/90 rounded-sm animate-bounce" style={{ animationDelay: "480ms" }} />
      </div>

      {/* shimmer card */}
      <div className="w-full max-w-3xl rounded-xl border border-white/10 bg-white/5 backdrop-blur p-6">
        <div className="h-4 w-40 bg-white/10 rounded mb-4 animate-pulse" />
        <div className="space-y-2">
          <div className="h-3 w-full bg-white/10 rounded animate-pulse" />
          <div className="h-3 w-[92%] bg-white/10 rounded animate-pulse" />
          <div className="h-3 w-[84%] bg-white/10 rounded animate-pulse" />
        </div>
        <div className="mt-6 flex items-center gap-2 text-white/70">
          <Zap className="w-4 h-4 animate-pulse" />
          Generating semantic diff, risk notes, and explanations…
        </div>
      </div>
    </div>
  )
}

// ---------- Results Page ----------
export default function ResultsPage() {
  const router = useRouter()
  const [oldQuery, setOldQuery] = useState<string>("")
  const [newQuery, setNewQuery] = useState<string>("")
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const startedRef = useRef(false)

  // Load payload from sessionStorage, kick off analysis
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

  const displayChanges = useMemo(() => deriveDisplayChanges(analysis), [analysis])

  // For a small header stat line
  const stats = useMemo(() => {
    if (!oldQuery || !newQuery) return null
    const diff: ComparisonResult = generateQueryDiff(oldQuery, newQuery)
    return diff.stats
  }, [oldQuery, newQuery])

  const metricBadge = (label: string, goodBad: GoodBad) => (
    <span
      className={
        "px-2 py-0.5 rounded text-[10px] font-medium " +
        (goodBad === "good"
          ? "bg-emerald-100 text-emerald-700"
          : "bg-rose-100 text-rose-700")
      }
    >
      {label}: {goodBad === "good" ? "Good" : "Bad"}
    </span>
  )

  return (
    <div className="min-h-screen relative bg-neutral-950 text-white">
      {gridBg}

      {/* Centered header title + home + stats */}
      <header className="relative z-10 border-b border-white/10 bg-black/30 backdrop-blur">
        <div className="container mx-auto px-6 py-4">
          <div className="grid grid-cols-3 items-center">
            {/* left: home */}
            <Link
              href="/"
              className="inline-flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 transition"
            >
              <Home className="w-5 h-5 text-white" />
            </Link>

            {/* center: title */}
            <div className="flex items-center justify-center">
              <div className="flex items-center gap-2 text-white">
                <BarChart3 className="w-5 h-5" />
                <span className="font-heading font-semibold">Query Comparison</span>
              </div>
            </div>

            {/* right: stats */}
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
              </div>
            ) : (
              <div />
            )}
          </div>
        </div>
      </header>

      <main className="relative z-10 container mx-auto px-6 py-8">
        {/* Loading */}
        {loading && !error && <FancyLoader />}

        {/* Error */}
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

        {/* Content */}
        {!loading && !error && analysis && (
          <div className="space-y-10">
            {/* Query Comparison */}
            <section>
              <QueryComparison oldQuery={oldQuery} newQuery={newQuery} showTitle={false} />
            </section>

            {/* Changes + AI Analysis */}
            <section className="grid lg:grid-cols-2 gap-8">
              {/* Changes */}
              <Card className="bg-white border-gray-200 shadow-lg">
                <CardContent className="p-5">
                  <h3 className="text-slate-900 font-semibold mb-4">Changes</h3>
                  <div className="h-[28rem] overflow-y-auto">
                    {displayChanges.length > 0 ? (
                      <div className="space-y-3">
                        {displayChanges.map((chg, index) => (
                          <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                            <div className="flex items-center gap-2 mb-2">
                              <span
                                className={`px-2 py-1 rounded text-xs font-medium ${
                                  chg.type === "addition"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : chg.type === "deletion"
                                    ? "bg-rose-100 text-rose-700"
                                    : "bg-amber-100 text-amber-700"
                                }`}
                              >
                                {chg.type}
                              </span>
                              <span className="text-xs text-gray-500">
                                {chg.side === "old" ? "old" : chg.side === "new" ? "new" : "both"} · line {chg.lineNumber}
                              </span>
                            </div>
                            <p className="text-gray-800 text-sm mb-1">{chg.description}</p>
                          </div>
                        ))}
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
                              {/* Left rail: Line badge, change type, then compact metrics */}
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
                                      : "bg-amber-100 text-amber-700" /* modification */
                                  }`}
                                >
                                  {chg.type}
                                </span>
                                {/* Compact metrics */}
                                <div className="flex flex-col gap-1 pt-1">
                                  {metricBadge("Syntax", chg.syntax)}
                                  {metricBadge("Performance", chg.performance)}
                                </div>
                              </div>

                              {/* Explanation */}
                              <p className="flex-1 text-gray-800 text-sm leading-relaxed">
                                {chg.explanation}
                              </p>
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
      </main>
    </div>
  )
}
