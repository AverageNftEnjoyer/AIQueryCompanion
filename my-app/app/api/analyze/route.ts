import { type NextRequest, NextResponse } from "next/server"
import { generateText } from "ai"
import { xai } from "@ai-sdk/xai"

export async function POST(request: NextRequest) {
  try {
    console.log("[v0] Starting analysis request")

    const apiKey = process.env.XAI_API_KEY
    console.log("[v0] XAI_API_KEY available:", !!apiKey)

    if (!apiKey) {
      console.log("[v0] Missing XAI_API_KEY")
      return NextResponse.json({ error: "Grok API key is not configured" }, { status: 500 })
    }

    const { oldQuery, newQuery } = await request.json()
    console.log("[v0] Received queries - Old length:", oldQuery?.length, "New length:", newQuery?.length)

    if (!oldQuery || !newQuery) {
      console.log("[v0] Missing queries")
      return NextResponse.json({ error: "Both old and new queries are required" }, { status: 400 })
    }

    console.log("[v0] Calling Grok API...")

    const { text } = await generateText({
      model: xai("grok-2-1212", { apiKey }),
      system: `You are an expert Oracle SQL analyst. Compare two SQL queries and provide clear explanations of what each change does.

For each changed line, explain:
- What the change is (what was added, removed, or modified)
- What this change accomplishes or affects
- How it relates to the overall query functionality

Focus on explaining WHAT each change does rather than technical impact. Be conversational and educational.`,
      prompt: `Compare these Oracle SQL queries and explain what each change does:

OLD QUERY:
${oldQuery}

NEW QUERY:
${newQuery}

For each line that changed, provide exactly this format:
Line X: [Explain what this change does and what it relates to in 2-4 sentences]

Focus on what the change accomplishes, not technical details.`,
      temperature: 0.3,
      maxTokens: 2000,
    })

    console.log("[v0] Grok API response received, length:", text?.length)

    const lines1 = oldQuery.split("\n")
    const lines2 = newQuery.split("\n")
    const maxLines = Math.max(lines1.length, lines2.length)

    const diffLines = []
    for (let i = 0; i < maxLines; i++) {
      const oldLine = lines1[i] || ""
      const newLine = lines2[i] || ""

      if (oldLine !== newLine) {
        if (oldLine && !newLine) {
          diffLines.push({ type: "removed", content: oldLine, lineNumber: i + 1 })
        } else if (!oldLine && newLine) {
          diffLines.push({ type: "added", content: newLine, lineNumber: i + 1 })
        } else {
          diffLines.push({ type: "modified", oldContent: oldLine, newContent: newLine, lineNumber: i + 1 })
        }
      }
    }

    const lineAnalysis = []
    const lines = text.split("\n")
    for (const line of lines) {
      const match = line.match(/Line (\d+):\s*(.+)/)
      if (match) {
        lineAnalysis.push({
          lineNumber: Number.parseInt(match[1]),
          explanation: match[2].trim(),
        })
      }
    }

    const analysisResult = {
      summary: text,
      diffLines: diffLines,
      updatedQuery: newQuery,
      changes: diffLines.map((line) => ({
        type: line.type === "added" ? "addition" : line.type === "removed" ? "deletion" : "modification",
        description: `Line ${line.lineNumber}: ${line.type === "modified" ? "Modified" : line.type === "added" ? "Added" : "Removed"}`,
        explanation:
          line.type === "modified"
            ? `Changed from "${line.oldContent}" to "${line.newContent}"`
            : line.type === "added"
              ? `Added: "${line.content}"`
              : `Removed: "${line.content}"`,
      })),
      lineAnalysis:
        lineAnalysis.length > 0
          ? lineAnalysis
          : [
              {
                lineNumber: 1,
                explanation:
                  "Analysis completed. The AI has reviewed both queries and identified the key differences between them.",
              },
            ],
      recommendations: [
        {
          type: "analysis",
          title: "AI Analysis Complete",
          description: "Review the detailed analysis above for comprehensive insights.",
        },
      ],
    }

    console.log("[v0] Returning successful response")
    return NextResponse.json({
      success: true,
      analysis: analysisResult,
    })
  } catch (error: any) {
    console.error("[v0] Analysis error occurred:")
    console.error("[v0] Error message:", error?.message)
    console.error("[v0] Error code:", error?.code)
    console.error("[v0] Error status:", error?.status)
    console.error("[v0] Full error:", JSON.stringify(error, null, 2))

    let errorMessage = "Failed to analyze queries. Please try again."
    let errorType = "general"

    if (error?.message?.includes("exceeded your current quota")) {
      errorMessage = "Grok API quota exceeded. Please check your xAI account billing and usage limits."
      errorType = "quota_exceeded"
    } else if (error?.message?.includes("invalid api key") || error?.message?.includes("unauthorized")) {
      errorMessage = "Invalid Grok API key. Please check your XAI_API_KEY in Project Settings."
      errorType = "invalid_key"
    } else if (error?.message?.includes("rate limit")) {
      errorMessage = "Rate limit exceeded. Please wait a moment and try again."
      errorType = "rate_limit"
    } else if (error?.message?.includes("network") || error?.code === "ENOTFOUND") {
      errorMessage = "Network error. Please check your internet connection and try again."
      errorType = "network_error"
    } else if (error?.message?.includes("model")) {
      errorMessage = "Model configuration error. The Grok model may be unavailable."
      errorType = "model_error"
    }

    console.log("[v0] Returning error response:", errorMessage)

    return NextResponse.json(
      {
        error: errorMessage,
        errorType,
        details: error?.message || "Unknown error occurred",
      },
      { status: 500 },
    )
  }
}
