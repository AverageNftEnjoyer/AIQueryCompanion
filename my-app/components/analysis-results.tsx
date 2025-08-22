"use client"

import { useState } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Brain,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle,
  Info,
  Download,
  Share2,
  ChevronDown,
  ChevronRight,
  Clock,
  Database,
  Zap,
  Shield,
} from "lucide-react"

interface AnalysisResult {
  summary: string
  changes: Array<{
    type: "addition" | "modification" | "deletion"
    description: string
    explanation: string
    impact: string
  }>
  recommendations: Array<{
    type: "optimization" | "best_practice" | "warning"
    title: string
    description: string
  }>
  riskAssessment: "Low" | "Medium" | "High"
  performanceImpact: "Positive" | "Negative" | "Neutral"
}

interface AnalysisResultsProps {
  result: AnalysisResult
  className?: string
}

export function AnalysisResults({ result, className }: AnalysisResultsProps) {
  const [expandedChanges, setExpandedChanges] = useState<number[]>([])
  const [expandedRecommendations, setExpandedRecommendations] = useState<number[]>([])

  const toggleChange = (index: number) => {
    setExpandedChanges((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]))
  }

  const toggleRecommendation = (index: number) => {
    setExpandedRecommendations((prev) => (prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index]))
  }

  const exportResults = () => {
    const exportData = {
      timestamp: new Date().toISOString(),
      summary: result.summary,
      riskAssessment: result.riskAssessment,
      performanceImpact: result.performanceImpact,
      changes: result.changes,
      recommendations: result.recommendations,
    }

    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `query-analysis-${new Date().toISOString().split("T")[0]}.json`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const getRiskColor = (risk: string) => {
    switch (risk) {
      case "High":
        return "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
      case "Medium":
        return "text-yellow-600 bg-yellow-50 border-yellow-200 dark:bg-yellow-950/20 dark:border-yellow-800"
      case "Low":
        return "text-green-600 bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
      default:
        return "text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-950/20 dark:border-gray-800"
    }
  }

  const getPerformanceColor = (impact: string) => {
    switch (impact) {
      case "Positive":
        return "text-green-600 bg-green-50 border-green-200 dark:bg-green-950/20 dark:border-green-800"
      case "Negative":
        return "text-red-600 bg-red-50 border-red-200 dark:bg-red-950/20 dark:border-red-800"
      case "Neutral":
        return "text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-950/20 dark:border-gray-800"
      default:
        return "text-gray-600 bg-gray-50 border-gray-200 dark:bg-gray-950/20 dark:border-gray-800"
    }
  }

  const getChangeIcon = (type: string) => {
    switch (type) {
      case "addition":
        return <TrendingUp className="w-4 h-4 text-green-600" />
      case "deletion":
        return <TrendingDown className="w-4 h-4 text-red-600" />
      case "modification":
        return <Zap className="w-4 h-4 text-blue-600" />
      default:
        return <Info className="w-4 h-4 text-gray-600" />
    }
  }

  const getRecommendationIcon = (type: string) => {
    switch (type) {
      case "warning":
        return <AlertTriangle className="w-4 h-4 text-yellow-600" />
      case "optimization":
        return <TrendingUp className="w-4 h-4 text-blue-600" />
      case "best_practice":
        return <CheckCircle className="w-4 h-4 text-green-600" />
      default:
        return <Info className="w-4 h-4 text-gray-600" />
    }
  }

  return (
    <div className={className}>
      <Card className="border-primary/20 shadow-lg">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Brain className="w-6 h-6 text-primary" />
              </div>
              <div>
                <CardTitle className="font-heading text-xl">AI Analysis Results</CardTitle>
                <CardDescription className="mt-1">{result.summary}</CardDescription>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={exportResults}>
                <Download className="w-4 h-4 mr-2" />
                Export
              </Button>
              <Button variant="outline" size="sm">
                <Share2 className="w-4 h-4 mr-2" />
                Share
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Overview Dashboard */}
          <div className="grid md:grid-cols-2 gap-4">
            <Card className={`border ${getRiskColor(result.riskAssessment)}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Shield className="w-5 h-5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Risk Assessment</p>
                    <p className="text-lg font-bold">{result.riskAssessment}</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className={`border ${getPerformanceColor(result.performanceImpact)}`}>
              <CardContent className="p-4">
                <div className="flex items-center gap-3">
                  <Database className="w-5 h-5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Performance Impact</p>
                    <p className="text-lg font-bold">{result.performanceImpact}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Analysis Tabs */}
          <Tabs defaultValue="changes" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="changes" className="flex items-center gap-2">
                <Zap className="w-4 h-4" />
                Changes ({result.changes.length})
              </TabsTrigger>
              <TabsTrigger value="recommendations" className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4" />
                Recommendations ({result.recommendations.length})
              </TabsTrigger>
            </TabsList>

            <TabsContent value="changes" className="space-y-4 mt-6">
              {result.changes.length > 0 ? (
                <div className="space-y-3">
                  {result.changes.map((change, index) => (
                    <Card key={index} className="border-border">
                      <Collapsible>
                        <CollapsibleTrigger className="w-full" onClick={() => toggleChange(index)}>
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                {getChangeIcon(change.type)}
                                <div className="text-left">
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={`${
                                        change.type === "addition"
                                          ? "text-green-600 border-green-600"
                                          : change.type === "deletion"
                                            ? "text-red-600 border-red-600"
                                            : "text-blue-600 border-blue-600"
                                      }`}
                                    >
                                      {change.type}
                                    </Badge>
                                    <span className="font-medium text-sm">{change.description}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">Click to view details</p>
                                </div>
                              </div>
                              {expandedChanges.includes(index) ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </div>
                          </CardContent>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-0 px-4 pb-4">
                            <div className="border-t border-border pt-4 space-y-3">
                              <div>
                                <h4 className="font-medium text-sm mb-2">Explanation</h4>
                                <p className="text-sm text-muted-foreground">{change.explanation}</p>
                              </div>
                              <div>
                                <h4 className="font-medium text-sm mb-2">Impact</h4>
                                <p className="text-sm text-muted-foreground">{change.impact}</p>
                              </div>
                            </div>
                          </CardContent>
                        </CollapsibleContent>
                      </Collapsible>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="p-8 text-center">
                    <Info className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No changes detected between the queries.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="recommendations" className="space-y-4 mt-6">
              {result.recommendations.length > 0 ? (
                <div className="space-y-3">
                  {result.recommendations.map((rec, index) => (
                    <Card key={index} className="border-border">
                      <Collapsible>
                        <CollapsibleTrigger className="w-full" onClick={() => toggleRecommendation(index)}>
                          <CardContent className="p-4">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                {getRecommendationIcon(rec.type)}
                                <div className="text-left">
                                  <div className="flex items-center gap-2">
                                    <Badge
                                      variant="outline"
                                      className={`${
                                        rec.type === "warning"
                                          ? "text-yellow-600 border-yellow-600"
                                          : rec.type === "optimization"
                                            ? "text-blue-600 border-blue-600"
                                            : "text-green-600 border-green-600"
                                      }`}
                                    >
                                      {rec.type.replace("_", " ")}
                                    </Badge>
                                    <span className="font-medium text-sm">{rec.title}</span>
                                  </div>
                                  <p className="text-xs text-muted-foreground mt-1">Click to view details</p>
                                </div>
                              </div>
                              {expandedRecommendations.includes(index) ? (
                                <ChevronDown className="w-4 h-4" />
                              ) : (
                                <ChevronRight className="w-4 h-4" />
                              )}
                            </div>
                          </CardContent>
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <CardContent className="pt-0 px-4 pb-4">
                            <div className="border-t border-border pt-4">
                              <p className="text-sm text-muted-foreground">{rec.description}</p>
                            </div>
                          </CardContent>
                        </CollapsibleContent>
                      </Collapsible>
                    </Card>
                  ))}
                </div>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="p-8 text-center">
                    <CheckCircle className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
                    <p className="text-muted-foreground">No specific recommendations at this time.</p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>

          {/* Analysis Metadata */}
          <Card className="bg-muted/30">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="w-4 h-4" />
                <span>Analysis completed at {new Date().toLocaleString()}</span>
              </div>
            </CardContent>
          </Card>
        </CardContent>
      </Card>
    </div>
  )
}
