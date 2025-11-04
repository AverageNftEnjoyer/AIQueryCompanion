"use client";

import { useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Send } from "lucide-react";

interface AnalysisResult {
  summary: string;
  changes: Array<{
    type: "addition" | "modification" | "deletion";
    description: string;
    explanation: string;
    lineNumber: number;
    side: "old" | "new" | "both";
    syntax: "good" | "bad";
    performance: "good" | "bad";
    span?: number;
    index?: number;
    meta?: {
      clauses?: string[];
      change_kind?: string;
      business_impact?: "clear" | "weak" | "none";
      risk?: "low" | "medium" | "high";
      suggestions?: string[];
    };
  }>;
  recommendations: Array<{
    type: "optimization" | "best_practice" | "warning" | "analysis";
    title: string;
    description: string;
  }>;
  riskAssessment?: "Low" | "Medium" | "High";
  performanceImpact?: "Positive" | "Negative" | "Neutral";
}

export default function Summary({
  isLight,
  newQuery,
  analysis,
}: {
  isLight: boolean;
  newQuery: string;
  analysis: AnalysisResult | null;
}) {
  const [summary, setSummary] = useState<string>("");
  const [summarizing, setSummarizing] = useState<boolean>(false);
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const summaryHeaderRef = useRef<HTMLHeadingElement | null>(null);
  const summarizeAbortRef = useRef<AbortController | null>(null);

  async function fetchSummary() {
    if (!newQuery) return;
    if (summarizeAbortRef.current) summarizeAbortRef.current.abort();
    summarizeAbortRef.current = new AbortController();

    setSummarizing(true);

    try {
      const res = await fetch(`/api/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newQuery, analysis }),
        signal: summarizeAbortRef.current.signal,
      });

      if (res.ok) {
        const data = await res.json();
        const t = String(data?.tldr || "").trim();
        setSummary(t);
      } else {
        setSummary("");
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") setSummary("");
    } finally {
      setSummarizing(false);
      setTimeout(() => {
        summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        summaryHeaderRef.current?.focus();
      }, 80);
    }
  }

  return (
    <Card ref={summaryRef} className="mt-4 sm:mt-5 md:mt-0 scroll-mt-24 bg-slate-50 border-slate-200 shadow-lg">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 ref={summaryHeaderRef} tabIndex={-1} className="text-slate-900 font-semibold focus:outline-none">
            Summary
          </h3>
          <Button
            type="button"
            onClick={fetchSummary}
            disabled={summarizing}
            className={`inline-flex items-center gap-2 h-8 px-3 rounded-full border border-gray-300 ${
              isLight ? "bg-gray-100 text-gray-900 hover:bg-white" : "bg-gray-100 text-gray-900 hover:bg-white"
            } shadow-sm transition disabled:opacity-60 disabled:cursor-not-allowed`}
            variant="outline"
          >
            {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            <span className="text-sm">Generate Summary</span>
          </Button>
        </div>

        <div className="min-h-[28.15rem] bg-gray-50 border border-gray-200 rounded-lg p-4">
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
          ) : summary ? (
            <p className="text-gray-800 text-sm leading-relaxed break-words whitespace-pre-wrap">{summary}</p>
          ) : (
            <div className="text-gray-600 text-sm">Click “Generate Summary” to produce a detailed write-up.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
