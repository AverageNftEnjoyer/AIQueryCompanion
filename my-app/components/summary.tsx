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
    <Card ref={summaryRef} className="mt-4 sm:mt-5 md:mt-0 scroll-mt-24 bg-card border border-border rounded-md">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 ref={summaryHeaderRef} tabIndex={-1} className="font-heading text-[13px] font-semibold uppercase tracking-[0.06em] text-foreground focus:outline-none">
            Summary
          </h3>
          <Button
            type="button"
            onClick={fetchSummary}
            disabled={summarizing}
            className="inline-flex items-center gap-2 h-[26px] px-2.5 rounded-md border border-foreground text-foreground text-xs font-semibold transition hover:bg-surface-2 disabled:opacity-45 disabled:cursor-not-allowed"
            variant="outline"
          >
            {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            <span>Generate summary</span>
          </Button>
        </div>

        <div className="min-h-[28.15rem] p-1">
          {summarizing && !summary ? (
            <div className="space-y-4">
              <div className="inline-flex items-center gap-2 text-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Generating summary…</span>
              </div>
              <div className="space-y-2">
                <div className="h-3 w-full bg-surface-2 rounded animate-pulse" />
                <div className="h-3 w-[92%] bg-surface-2 rounded animate-pulse" />
                <div className="h-3 w-[88%] bg-surface-2 rounded animate-pulse" />
                <div className="h-3 w-[80%] bg-surface-2 rounded animate-pulse" />
              </div>
            </div>
          ) : summary ? (
            <p className="text-foreground text-sm leading-relaxed break-words whitespace-pre-wrap">{summary}</p>
          ) : (
            <div className="text-muted-foreground text-sm">Click "Generate summary" to produce a detailed write-up.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
