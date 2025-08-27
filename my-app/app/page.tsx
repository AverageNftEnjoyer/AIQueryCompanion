"use client"

import type React from "react"
import { useMemo, useState, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Upload, FileText, Zap, GitCompare, Brain, CheckCircle, AlertCircle, X } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { canonicalizeSQL, generateQueryDiff, type ComparisonResult } from "@/lib/query-differ"
import { QueryComparison } from "@/components/query-comparison"

const CARD_HEIGHT = 580
const MAX_QUERY_CHARS = 50_000 // client-side safety cap

export default function QueryAnalyzer() {
  const [oldQuery, setOldQuery] = useState("")
  const [newQuery, setNewQuery] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisError, setAnalysisError] = useState<string | null>(null)
  const [uploadStatus, setUploadStatus] = useState<{
    type: "old" | "new" | null
    status: "success" | "error" | "uploading" | null
    message: string
    fileName?: string
  }>({ type: null, status: null, message: "" })
  const [dragActive, setDragActive] = useState<{ old: boolean; new: boolean }>({ old: false, new: false })
  const oldFileInputRef = useRef<HTMLInputElement>(null)
  const newFileInputRef = useRef<HTMLInputElement>(null)

  // -------- Live comparison BEFORE analysis (so users see diffs right away) --------
  const comparison: ComparisonResult | null = useMemo(() => {
    if (!oldQuery.trim() || !newQuery.trim()) return null
    return generateQueryDiff(oldQuery, newQuery) // canonicalizes internally
  }, [oldQuery, newQuery])

  const handleFileUpload = async (file: File, queryType: "old" | "new") => {
    setUploadStatus({ type: queryType, status: "uploading", message: "Reading file..." })

    if (!file.name.endsWith(".txt") && !file.name.endsWith(".sql")) {
      setUploadStatus({ type: queryType, status: "error", message: "Please upload a .txt or .sql file" })
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadStatus({ type: queryType, status: "error", message: "File size must be less than 5MB" })
      return
    }

    try {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = (e.target?.result as string) ?? ""
        if (content.trim().length === 0) {
          setUploadStatus({ type: queryType, status: "error", message: "File appears to be empty" })
          return
        }
        if (content.length > MAX_QUERY_CHARS) {
          setUploadStatus({
            type: queryType,
            status: "error",
            message: `File too large for analysis (${content.length.toLocaleString()} > ${MAX_QUERY_CHARS.toLocaleString()} chars)`,
          })
          return
        }
        if (queryType === "old") setOldQuery(content)
        else setNewQuery(content)

        setUploadStatus({
          type: queryType,
          status: "success",
          message: `Successfully loaded ${file.name}`,
          fileName: file.name,
        })
        setTimeout(() => setUploadStatus({ type: null, status: null, message: "" }), 3000)
      }
      reader.onerror = () => setUploadStatus({ type: queryType, status: "error", message: "Error reading file" })
      reader.readAsText(file)
    } catch {
      setUploadStatus({ type: queryType, status: "error", message: "Failed to process file" })
    }
  }

  const handleDragEnter = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault(); e.stopPropagation()
    setDragActive((prev) => ({ ...prev, [queryType]: true }))
  }
  const handleDragLeave = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault(); e.stopPropagation()
    setDragActive((prev) => ({ ...prev, [queryType]: false }))
  }
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.stopPropagation() }
  const handleDrop = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault(); e.stopPropagation()
    setDragActive((prev) => ({ ...prev, [queryType]: false }))
    const files = e.dataTransfer.files
    if (files && files[0]) handleFileUpload(files[0], queryType)
  }
  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>, queryType: "old" | "new") => {
    const file = event.target.files?.[0]
    if (file) handleFileUpload(file, queryType)
  }
  const clearQuery = (queryType: "old" | "new") => {
    if (queryType === "old") { setOldQuery(""); if (oldFileInputRef.current) oldFileInputRef.current.value = "" }
    else { setNewQuery(""); if (newFileInputRef.current) newFileInputRef.current.value = "" }
    setUploadStatus({ type: null, status: null, message: "" })
  }

  const resetAll = () => {
    setOldQuery("")
    setNewQuery("")
    setAnalysisError(null)
    setUploadStatus({ type: null, status: null, message: "" })
    if (oldFileInputRef.current) oldFileInputRef.current.value = ""
    if (newFileInputRef.current) newFileInputRef.current.value = ""
    window.scrollTo({ top: 0, behavior: "smooth" })
  }

  // Analyze → stash and redirect to /results (results page performs the API call)
  const handleAnalyze = () => {
    if (!oldQuery.trim() || !newQuery.trim()) {
      alert("Please provide both queries before analyzing")
      return
    }
    if (oldQuery.length > MAX_QUERY_CHARS || newQuery.length > MAX_QUERY_CHARS) {
      setAnalysisError(
        `Each query must be ≤ ${MAX_QUERY_CHARS.toLocaleString()} characters. ` +
        `Current sizes: old=${oldQuery.length.toLocaleString()} new=${newQuery.length.toLocaleString()}`
      )
      return
    }

    setIsAnalyzing(true)
    setAnalysisError(null)

    // Canonicalize locally so both pages show the same text/line numbers
    const canonOld = canonicalizeSQL(oldQuery)
    const canonNew = canonicalizeSQL(newQuery)

    // Reflect canonical text in the editors (optional)
    setOldQuery(canonOld)
    setNewQuery(canonNew)

    // Stash payload for results page & navigate
    sessionStorage.setItem("qa:payload", JSON.stringify({ oldQuery: canonOld, newQuery: canonNew }))
    window.location.href = "/results"
  }

  const charCountBad = (s: string) => s.length > MAX_QUERY_CHARS
  const bothPresent = oldQuery.trim().length > 0 && newQuery.trim().length > 0

  return (
    <div className="min-h-screen relative bg-neutral-950">
      {/* Toned-down professional grid background */}
      <div className="pointer-events-none absolute inset-0 opacity-90">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(120,119,198,0.08),transparent_60%),radial-gradient(ellipse_at_bottom,_rgba(16,185,129,0.08),transparent_60%)]" />
        <div className="absolute inset-0 mix-blend-overlay bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(255,255,255,0.04)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(255,255,255,0.04)_24px)]" />
      </div>

      <div className="relative z-10">
        <header className="border-b border-white/10 bg-black/30 backdrop-blur">
          <div className="container mx-auto px-6 py-5">
            <div className="flex items-center justify-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 border border-white/10">
                <GitCompare className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl md:text-2xl font-heading font-semibold text-white">Oracle Query Analyzer</h1>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-6 py-10">
          {uploadStatus.status && (
            <Alert
              className={`mb-8 bg-black/40 backdrop-blur border-white/15 ${
                uploadStatus.status === "error" ? "border-red-500/40" : "border-emerald-500/40"
              }`}
            >
              <div className="flex items-center gap-3">
                {uploadStatus.status === "success" && <CheckCircle className="w-5 h-5 text-emerald-400" />}
                {uploadStatus.status === "error" && <AlertCircle className="w-5 h-5 text-red-400" />}
                {uploadStatus.status === "uploading" && <Brain className="w-5 h-5 animate-pulse text-indigo-300" />}
                <AlertDescription className="flex-1 text-gray-200">{uploadStatus.message}</AlertDescription>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUploadStatus({ type: null, status: null, message: "" })}
                  className="text-gray-400 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </Alert>
          )}

          {analysisError && (
            <Alert className="mb-8 bg-black/40 backdrop-blur border-red-500/40">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <AlertDescription className="flex-1 text-gray-200">
                <strong>Analysis Error:</strong> {analysisError}
              </AlertDescription>
              <Button variant="ghost" size="sm" onClick={() => setAnalysisError(null)} className="text-gray-400 hover:text-white">
                <X className="w-4 h-4" />
              </Button>
            </Alert>
          )}

          <div className="grid lg:grid-cols-2 gap-8 mb-10">
            {/* Original Query */}
            <div>
              <h3 className="text-sm font-medium text-white/80 mb-3">Original Query</h3>
              <Card className={`bg-white border-gray-200 shadow-lg flex flex-col ${charCountBad(oldQuery) ? "ring-2 ring-red-400" : ""}`} style={{ height: CARD_HEIGHT }}>
                <CardContent className="p-5 flex-1 flex flex-col min-h-0">
                  <div className="flex-1 min-h-0">
                    <Textarea
                      placeholder="Paste your original Oracle SQL query here..."
                      value={oldQuery}
                      onChange={(e) => setOldQuery(e.target.value)}
                      spellCheck={false}
                      className="h-full border-0 bg-white text-gray-800 placeholder:text-gray-500 font-mono text-sm resize-none focus:ring-0 focus:outline-none overflow-y-auto pt-2 pb-1 leading-tight"
                      onDragEnter={(e) => handleDragEnter(e, "old")}
                      onDragOver={handleDragOver}
                      onDragLeave={(e) => handleDragLeave(e, "old")}
                      onDrop={(e) => handleDrop(e, "old")}
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-3 mt-4 border-t border-gray-200">
                    <Button variant="ghost" size="sm" onClick={() => oldFileInputRef.current?.click()} className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2">
                      <Upload className="w-4 h-4" /> Attach
                    </Button>
                    <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2">
                      <FileText className="w-4 h-4" /> SQL
                    </Button>
                    {oldQuery && (
                      <Button variant="ghost" size="sm" onClick={() => clearQuery("old")} className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full w-8 h-8 p-0">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <input
                    ref={oldFileInputRef}
                    type="file"
                    accept=".txt,.sql"
                    onChange={(e) => handleFileInputChange(e, "old")}
                    className="hidden"
                  />
                  {charCountBad(oldQuery) && (
                    <p className="mt-2 text-xs text-red-600">
                      {oldQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Updated Query */}
            <div>
              <h3 className="text-sm font-medium text-white/80 mb-3">Updated Query</h3>
              <Card className={`bg-white border-gray-200 shadow-lg flex flex-col ${charCountBad(newQuery) ? "ring-2 ring-red-400" : ""}`} style={{ height: CARD_HEIGHT }}>
                <CardContent className="p-5 flex-1 flex flex-col min-h-0">
                  <div className="flex-1 min-h-0">
                    <Textarea
                      placeholder="Paste your updated Oracle SQL query here..."
                      value={newQuery}
                      onChange={(e) => setNewQuery(e.target.value)}
                      spellCheck={false}
                      className="h-full border-0 bg-white text-gray-800 placeholder:text-gray-500 font-mono text-sm resize-none focus:ring-0 focus:outline-none overflow-y-auto pt-2 pb-1 leading-tight"
                      onDragEnter={(e) => handleDragEnter(e, "new")}
                      onDragOver={handleDragOver}
                      onDragLeave={(e) => handleDragLeave(e, "new")}
                      onDrop={(e) => handleDrop(e, "new")}
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-3 mt-4 border-t border-gray-200">
                    <Button variant="ghost" size="sm" onClick={() => newFileInputRef.current?.click()} className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2">
                      <Upload className="w-4 h-4" /> Attach
                    </Button>
                    <Button variant="ghost" size="sm" className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2">
                      <FileText className="w-4 h-4" /> SQL
                    </Button>
                    {newQuery && (
                      <Button variant="ghost" size="sm" onClick={() => clearQuery("new")} className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full w-8 h-8 p-0">
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                  <input
                    ref={newFileInputRef}
                    type="file"
                    accept=".txt,.sql"
                    onChange={(e) => handleFileInputChange(e, "new")}
                    className="hidden"
                  />
                  {charCountBad(newQuery) && (
                    <p className="mt-2 text-xs text-red-600">
                      {newQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          {/* Analyze + Reset row */}
          <div className="flex items-center justify-center gap-3 mb-8">
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !oldQuery.trim() || !newQuery.trim() || charCountBad(oldQuery) || charCountBad(newQuery)}
              size="lg"
              className="px-8 py-3 font-heading font-medium text-base rounded-md bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white border border-white/10 shadow-md transition-all"
              title={(!oldQuery.trim() || !newQuery.trim()) ? "Paste both queries to enable" : undefined}
            >
              {isAnalyzing ? (
                <div className="flex items-center gap-3">
                  <div className="flex items-end gap-0.5 mr-1">
                    <span className="w-1.5 h-3 bg-white/90 rounded-sm animate-bounce" />
                    <span className="w-1.5 h-4 bg-white/80 rounded-sm animate-bounce" style={{ animationDelay: "120ms" }} />
                    <span className="w-1.5 h-5 bg-white/70 rounded-sm animate-bounce" style={{ animationDelay: "240ms" }} />
                  </div>
                  <span className="relative">
                    <span className="opacity-90">Analyzing</span>
                    <span className="absolute inset-0 bg-white/10 blur-sm rounded-sm animate-pulse" />
                  </span>
                </div>
              ) : (
                <>
                  <Zap className="w-5 h-5 mr-2" /> Analyze with AI
                </>
              )}
            </Button>

            {(oldQuery || newQuery) && (
              <Button
                type="button"
                variant="outline"
                onClick={resetAll}
                className="border-white/15 text-white/90 hover:bg-white/10"
                title="Start a new analysis"
              >
                <X className="w-5 h-5" />
              </Button>
            )}
          </div>

          {/* Live Comparison Preview (visible even before AI analysis) */}
          {comparison && (
            <div className="mb-10">
              <h3 className="text-sm font-medium text-white/80 mb-3">Live Comparison Preview</h3>
              <QueryComparison oldQuery={oldQuery} newQuery={newQuery} />
            </div>
          )}
        </main>
      </div>
    </div>
  )
}
