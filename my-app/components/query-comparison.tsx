"use client"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { generateQueryDiff, highlightSQLKeywords, type ComparisonResult } from "@/lib/query-differ"
import { Plus, Minus, Equal, BarChart3 } from "lucide-react"

interface QueryComparisonProps {
  oldQuery: string
  newQuery: string
  className?: string
}

export function QueryComparison({ oldQuery, newQuery, className }: QueryComparisonProps) {
  const comparison: ComparisonResult = generateQueryDiff(oldQuery, newQuery)

  return (
    <div className={className}>
      {/* Statistics */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-heading">
            <BarChart3 className="w-5 h-5" />
            Comparison Statistics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-green-600" />
              <Badge variant="outline" className="text-green-600 border-green-600">
                {comparison.stats.additions} Additions
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Minus className="w-4 h-4 text-red-600" />
              <Badge variant="outline" className="text-red-600 border-red-600">
                {comparison.stats.deletions} Deletions
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Equal className="w-4 h-4 text-blue-600" />
              <Badge variant="outline" className="text-blue-600 border-blue-600">
                {comparison.stats.modifications} Modifications
              </Badge>
            </div>
            <div className="flex items-center gap-2">
              <Equal className="w-4 h-4 text-gray-600" />
              <Badge variant="outline" className="text-gray-600 border-gray-600">
                {comparison.stats.unchanged} Unchanged
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Side-by-side comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading">Query Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Original Query */}
            <div>
              <h3 className="font-semibold mb-3 text-muted-foreground">Original Query</h3>
              <ScrollArea className="h-[400px] border rounded-lg">
                <div className="p-4 font-mono text-sm">
                  {comparison.diffs
                    .filter((diff) => diff.type === "deletion" || diff.type === "unchanged")
                    .map((diff, index) => (
                      <div
                        key={`old-${index}`}
                        className={`flex items-start gap-3 py-1 px-2 rounded ${
                          diff.type === "deletion"
                            ? "bg-red-50 dark:bg-red-950/20 border-l-2 border-red-500"
                            : diff.type === "unchanged"
                              ? "bg-gray-50 dark:bg-gray-950/20"
                              : ""
                        }`}
                      >
                        <span className="text-xs text-muted-foreground w-8 flex-shrink-0 mt-0.5">
                          {diff.oldLineNumber}
                        </span>
                        <div className="flex items-center gap-2 flex-1">
                          {diff.type === "deletion" && <Minus className="w-3 h-3 text-red-600 flex-shrink-0" />}
                          {diff.type === "unchanged" && <Equal className="w-3 h-3 text-gray-400 flex-shrink-0" />}
                          <code
                            className="flex-1"
                            dangerouslySetInnerHTML={{
                              __html: highlightSQLKeywords(diff.content),
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>

            {/* New Query */}
            <div>
              <h3 className="font-semibold mb-3 text-muted-foreground">Updated Query</h3>
              <ScrollArea className="h-[400px] border rounded-lg">
                <div className="p-4 font-mono text-sm">
                  {comparison.diffs
                    .filter((diff) => diff.type === "addition" || diff.type === "unchanged")
                    .map((diff, index) => (
                      <div
                        key={`new-${index}`}
                        className={`flex items-start gap-3 py-1 px-2 rounded ${
                          diff.type === "addition"
                            ? "bg-green-50 dark:bg-green-950/20 border-l-2 border-green-500"
                            : diff.type === "unchanged"
                              ? "bg-gray-50 dark:bg-gray-950/20"
                              : ""
                        }`}
                      >
                        <span className="text-xs text-muted-foreground w-8 flex-shrink-0 mt-0.5">
                          {diff.newLineNumber}
                        </span>
                        <div className="flex items-center gap-2 flex-1">
                          {diff.type === "addition" && <Plus className="w-3 h-3 text-green-600 flex-shrink-0" />}
                          {diff.type === "unchanged" && <Equal className="w-3 h-3 text-gray-400 flex-shrink-0" />}
                          <code
                            className="flex-1"
                            dangerouslySetInnerHTML={{
                              __html: highlightSQLKeywords(diff.content),
                            }}
                          />
                        </div>
                      </div>
                    ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
