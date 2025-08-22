"use client"

import type React from "react"

import { useState, useRef } from "react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Upload, FileText, Zap, GitCompare, Brain, CheckCircle, AlertCircle, X } from "lucide-react"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface AnalysisResult {
  summary: string
  diffLines?: Array<{
    type: "added" | "removed" | "modified"
    content?: string
    oldContent?: string
    newContent?: string
    lineNumber: number
  }>
  updatedQuery: string
  changes: Array<{
    type: "addition" | "modification" | "deletion"
    description: string
    explanation: string
  }>
  recommendations: Array<{
    type: "optimization" | "best_practice" | "warning" | "analysis"
    title: string
    description: string
  }>
  lineAnalysis?: Array<{
    lineNumber: number
    explanation: string
  }>
}

const CARD_HEIGHT = 600; // px — keeps both columns identical height

export default function QueryAnalyzer() {
  const [oldQuery, setOldQuery] = useState("")
  const [newQuery, setNewQuery] = useState("")
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null)
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

  const handleFileUpload = async (file: File, queryType: "old" | "new") => {
    setUploadStatus({ type: queryType, status: "uploading", message: "Reading file..." })

    if (!file.name.endsWith(".txt") && !file.name.endsWith(".sql")) {
      setUploadStatus({
        type: queryType,
        status: "error",
        message: "Please upload a .txt or .sql file",
      })
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      setUploadStatus({
        type: queryType,
        status: "error",
        message: "File size must be less than 5MB",
      })
      return
    }

    try {
      const reader = new FileReader()
      reader.onload = (e) => {
        const content = e.target?.result as string
        if (content.trim().length === 0) {
          setUploadStatus({
            type: queryType,
            status: "error",
            message: "File appears to be empty",
          })
          return
        }

        if (queryType === "old") {
          setOldQuery(content)
        } else {
          setNewQuery(content)
        }

        setUploadStatus({
          type: queryType,
          status: "success",
          message: `Successfully loaded ${file.name}`,
          fileName: file.name,
        })

        setTimeout(() => {
          setUploadStatus({ type: null, status: null, message: "" })
        }, 3000)
      }

      reader.onerror = () => {
        setUploadStatus({
          type: queryType,
          status: "error",
          message: "Error reading file",
        })
      }

      reader.readAsText(file)
    } catch (error) {
      setUploadStatus({
        type: queryType,
        status: "error",
        message: "Failed to process file",
      })
    }
  }

  const handleDragEnter = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive((prev) => ({ ...prev, [queryType]: true }))
  }

  const handleDragLeave = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive((prev) => ({ ...prev, [queryType]: false }))
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive((prev) => ({ ...prev, [queryType]: false }))

    const files = e.dataTransfer.files
    if (files && files[0]) {
      handleFileUpload(files[0], queryType)
    }
  }

  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>, queryType: "old" | "new") => {
    const file = event.target.files?.[0]
    if (file) {
      handleFileUpload(file, queryType)
    }
  }

  const clearQuery = (queryType: "old" | "new") => {
    if (queryType === "old") {
      setOldQuery("")
      if (oldFileInputRef.current) oldFileInputRef.current.value = ""
    } else {
      setNewQuery("")
      if (newFileInputRef.current) newFileInputRef.current.value = ""
    }
    setUploadStatus({ type: null, status: null, message: "" })
  }

  const handleAnalyze = async () => {
    if (!oldQuery.trim() || !newQuery.trim()) {
      alert("Please provide both queries before analyzing")
      return
    }

    setIsAnalyzing(true)
    setAnalysisError(null)
    setAnalysisResult(null)

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          oldQuery: oldQuery.trim(),
          newQuery: newQuery.trim(),
        }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || "Analysis failed")
      }

      setAnalysisResult(data.analysis)
    } catch (error) {
      console.error("Analysis error:", error)
      setAnalysisError(error instanceof Error ? error.message : "An unexpected error occurred")
    } finally {
      setIsAnalyzing(false)
    }
  }

  const renderQueryWithDiff = (
    query: string,
    diffLines?: Array<{ type: "added" | "removed" | "modified"; lineNumber: number }>,
  ) => {
    return (
      <div className="space-y-1">
        {query.split("\n").map((line, index) => {
          const diffLine = diffLines?.find((d) => d.lineNumber === index + 1)
          return (
            <div
              key={index}
              className={`px-2 py-1 rounded text-sm font-mono ${
                diffLine?.type === "added"
                  ? "bg-green-100 border-l-4 border-green-500"
                  : diffLine?.type === "removed"
                    ? "bg-red-100 border-l-4 border-red-500"
                    : diffLine?.type === "modified"
                      ? "bg-yellow-100 border-l-4 border-yellow-500"
                      : "bg-transparent"
              }`}
            >
              <span className="text-gray-500 text-xs mr-3">{index + 1}</span>
              <span className="text-gray-800 whitespace-pre-wrap break-words">{line}</span>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      <div className="absolute inset-0 overflow-hidden">
        <div className="aurora aurora-1"></div>
        <div className="aurora aurora-2"></div>
        <div className="aurora aurora-3"></div>
        <div className="aurora aurora-4"></div>
      </div>

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="floating-star star-1 animate-pulse"></div>
        <div className="floating-star star-2 animate-bounce"></div>
        <div className="floating-star star-3 animate-pulse delay-300"></div>
        <div className="floating-star star-4 animate-bounce delay-700"></div>
        <div className="floating-star star-5 animate-pulse delay-1000"></div>
        <div className="floating-star star-6 animate-bounce delay-1500"></div>
      </div>

      <div className="relative z-10">
        <header className="border-b border-white/10 bg-black/20 backdrop-blur-lg">
          <div className="container mx-auto px-6 py-6">
            <div className="flex items-center justify-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-gradient-to-r from-purple-500/20 to-green-500/20 border border-white/10">
                <GitCompare className="w-6 h-6 text-white" />
              </div>
              <div className="text-center">
                <h1 className="text-2xl font-heading font-bold bg-gradient-to-r from-white via-purple-200 to-green-200 bg-clip-text text-transparent">
                  Oracle Query Analyzer
                </h1>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-6 py-12">
          {uploadStatus.status && (
            <Alert
              className={`mb-8 bg-black/40 backdrop-blur-lg border-white/20 ${uploadStatus.status === "error" ? "border-red-500/50" : "border-purple-500/50"}`}
            >
              <div className="flex items-center gap-3">
                {uploadStatus.status === "success" && <CheckCircle className="w-5 h-5 text-green-400" />}
                {uploadStatus.status === "error" && <AlertCircle className="w-5 h-5 text-red-400" />}
                {uploadStatus.status === "uploading" && <Brain className="w-5 h-5 animate-pulse text-purple-400" />}
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
            <Alert className="mb-8 bg-black/40 backdrop-blur-lg border-red-500/50">
              <AlertCircle className="w-5 h-5 text-red-400" />
              <AlertDescription className="flex-1 text-gray-200">
                <strong>Analysis Error:</strong> {analysisError}
              </AlertDescription>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAnalysisError(null)}
                className="text-gray-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </Button>
            </Alert>
          )}

          <div className="grid lg:grid-cols-2 gap-8 mb-12">
            {/* Original Query */}
            <div>
              <h3 className="text-lg font-semibold text-white mb-4">Original Query</h3>
              <Card className="bg-white border-gray-200 shadow-xl flex flex-col" style={{ height: CARD_HEIGHT }}>
                <CardContent className="p-6 flex-1 flex flex-col min-h-0">
                  <div className="flex-1 min-h-0">
                    <Textarea
                      placeholder="Paste your original Oracle SQL query here..."
                      value={oldQuery}
                      onChange={(e) => setOldQuery(e.target.value)}
                      spellCheck={false}
                      className="h-full border-0 bg-white text-gray-800 placeholder:text-gray-500 font-mono text-sm resize-none focus:ring-0 focus:outline-none overflow-y-auto pt-2 pb-1 leading-tight"
                    />
                  </div>
                  <div className="flex items-center justify-center gap-3 pt-3 mt-4 border-t border-gray-200">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => oldFileInputRef.current?.click()}
                      className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                    >
                      <Upload className="w-4 h-4" />
                      Attach
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                    >
                      <FileText className="w-4 h-4" />
                      SQL
                    </Button>
                    {oldQuery && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => clearQuery("old")}
                        className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full w-8 h-8 p-0"
                      >
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
                </CardContent>
              </Card>
            </div>

            {/* Updated Query */}
            <div>
              <h3 className="text-lg font-semibold text-white mb-4">Updated Query</h3>
              <Card className="bg-white border-gray-200 shadow-xl flex flex-col" style={{ height: CARD_HEIGHT }}>
                <CardContent className="p-6 flex-1 flex flex-col min-h-0">
                  {!analysisResult ? (
                    <>
                      <div className="flex-1 min-h-0">
                        <Textarea
                          placeholder="Paste your updated Oracle SQL query here..."
                          value={newQuery}
                          onChange={(e) => setNewQuery(e.target.value)}
                          spellCheck={false}
                          className="h-full border-0 bg-white text-gray-800 placeholder:text-gray-500 font-mono text-sm resize-none focus:ring-0 focus:outline-none overflow-y-auto pt-2 pb-1 leading-tight"
                        />
                      </div>
                      <div className="flex items-center justify-center gap-3 pt-3 mt-4 border-t border-gray-200">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => newFileInputRef.current?.click()}
                          className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                        >
                          <Upload className="w-4 h-4" />
                          Attach
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                        >
                          <FileText className="w-4 h-4" />
                          SQL
                        </Button>
                        {newQuery && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => clearQuery("new")}
                            className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full w-8 h-8 p-0"
                          >
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
                    </>
                  ) : (
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      {renderQueryWithDiff(analysisResult.updatedQuery, analysisResult.diffLines)}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="text-center mb-12">
            <Button
              onClick={handleAnalyze}
              disabled={isAnalyzing || !oldQuery.trim() || !newQuery.trim()}
              size="lg"
              className="px-12 py-4 font-heading font-semibold text-lg bg-gradient-to-r from-purple-600 to-green-600 hover:from-purple-500 hover:to-green-500 border-0 shadow-lg hover:shadow-xl transition-all duration-300"
            >
              {isAnalyzing ? (
                <>
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Zap className="w-6 h-6 text-white animate-pulse" />
                    </div>
                    <span className="flex items-center gap-1">
                      Analyzing Queries
                      <span className="animate-pulse">.</span>
                      <span className="animate-pulse delay-200">.</span>
                      <span className="animate-pulse delay-500">.</span>
                    </span>
                  </div>
                </>
              ) : (
                <>
                  <Zap className="w-6 h-6 mr-3" />
                  Analyze with AI
                </>
              )}
            </Button>
          </div>

          {analysisResult && (
            <>
              {/* Changes */}
              <div className="grid lg:grid-cols-2 gap-8 mb-8">
                {/* Changes */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">Changes</h3>
                  <Card className="bg-white border-gray-200 shadow-xl">
                    <CardContent className="p-6">
                      <div className="h-96 overflow-y-auto">
                        {analysisResult.changes && analysisResult.changes.length > 0 ? (
                          <div className="space-y-3">
                            {analysisResult.changes.map((change, index) => (
                              <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                                <div className="flex items-center gap-2 mb-2">
                                  <span
                                    className={`px-2 py-1 rounded text-xs font-medium ${
                                      change.type === "addition"
                                        ? "bg-green-100 text-green-700"
                                        : change.type === "deletion"
                                          ? "bg-red-100 text-red-700"
                                          : "bg-yellow-100 text-yellow-700"
                                    }`}
                                  >
                                    {change.type}
                                  </span>
                                </div>
                                <p className="text-gray-700 text-sm mb-1">{change.description}</p>
                                <p className="text-gray-600 text-xs">{change.explanation}</p>
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
                </div>

                {/* AI Analysis */}
                <div>
                  <h3 className="text-lg font-semibold text-white mb-4">AI Analysis</h3>
                  <Card className="bg-white border-gray-200 shadow-xl">
                    <CardContent className="p-6">
                      <div className="h-96 overflow-y-auto">
                        <div className="space-y-4">
                          {analysisResult.lineAnalysis && analysisResult.lineAnalysis.length > 0 ? (
                            analysisResult.lineAnalysis.map((analysis, index) => (
                              <div key={index} className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                                <div className="flex items-start gap-3">
                                  <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-medium">
                                    Line {analysis.lineNumber}
                                  </span>
                                  <p className="text-gray-700 text-sm leading-relaxed flex-1">{analysis.explanation}</p>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                              <p className="text-gray-700 text-sm leading-relaxed">{analysisResult.summary}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </div>
            </>
          )}
        </main>
      </div>
    </div>
  )
}
