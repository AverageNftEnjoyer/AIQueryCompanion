"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Send } from "lucide-react";

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";
type GoodBad = "good" | "bad";

interface ChangeItem {
  type: ChangeType;
  description: string;
  explanation: string;
  lineNumber: number;
  side: Side;
  syntax: GoodBad;
  performance: GoodBad;
  span?: number;
  index?: number;
}

interface Props {
  isLight: boolean;
  canonicalOld: string;
  canonicalNew: string;
}

export default function AnalysisPanel({ isLight, canonicalOld, canonicalNew }: Props) {
  const [streaming, setStreaming] = React.useState(false);
  const [summary, setSummary] = React.useState<string>("Click “Generate Analysis” to review each change.");
  const [changes, setChanges] = React.useState<ChangeItem[]>([]);
  const [error, setError] = React.useState<string | null>(null);

  const bgCard = "bg-white border-slate-200 ring-1 ring-black/5 shadow-[0_1px_0_rgba(0,0,0,0.05),0_10px_30px_rgba(0,0,0,0.10)]";

  async function handleRun() {
    if (!canonicalNew || streaming) return;

    setStreaming(true);
    setError(null);
    setSummary("Preparing changes…");

    try {
      // 1) Fetch placeholders via your existing analyzer (prepOnly)
      const PAGE_SIZE = 24;
      async function prepPage(cursor: number) {
        const res = await fetch(`/api/analyze?cursor=${cursor}&limit=${PAGE_SIZE}&prepOnly=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldQuery: canonicalOld, newQuery: canonicalNew }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.error || `Prep failed (${res.status})`);
        return data;
      }

      let page = await prepPage(0);
      let placeholders: ChangeItem[] = page?.analysis?.changes ?? [];
      let nextCursor: number | null = page?.page?.nextCursor ?? null;
      const total: number = page?.page?.total ?? placeholders.length;

      while (nextCursor !== null) {
        const p = await prepPage(nextCursor);
        placeholders = placeholders.concat(p?.analysis?.changes ?? []);
        nextCursor = p?.page?.nextCursor ?? null;
      }

      // De-dupe and sort by index if available
      const byIndex = new Map<number, ChangeItem>();
      for (const c of placeholders) {
        const pending = { ...c, explanation: "Pending…" as const };
        if (typeof pending.index === "number") byIndex.set(pending.index, pending);
      }
      const merged = Array.from(byIndex.values()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      setChanges(merged);
      setSummary(`Streaming ${total} changes… 0 explained.`);

      // 2) For each change, call your analyze route in item mode for a 2–6 line summary
      let explained = 0;
      for (let i = 0; i < merged.length; i++) {
        const item = merged[i];
        if (typeof item.index !== "number") continue;

        const res = await fetch(`/api/analyze?mode=item&index=${item.index}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // keep it concise like you wanted (2–6 lines)
            "x-analysis-detail": "fast",
          },
          body: JSON.stringify({
            oldQuery: canonicalOld,
            newQuery: canonicalNew,
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.analysis?.changes?.[0]) {
          const inc = data.analysis.changes[0] as Partial<ChangeItem> & { explanation?: string };
          const explanation = (inc.explanation && String(inc.explanation)) || "No analysis was produced.";
          const syntax = (inc.syntax === "bad" ? "bad" : "good") as GoodBad;
          const performance = (inc.performance === "bad" ? "bad" : "good") as GoodBad;

          setChanges((prev) => {
            const map = new Map<number, ChangeItem>();
            for (const c of prev) if (typeof c.index === "number") map.set(c.index, c);
            map.set(item.index!, { ...item, explanation, syntax, performance });
            const next = Array.from(map.values()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
            return next;
          });
          explained++;
          setSummary(`Streaming ${total} changes… ${explained} explained.`);
        } else {
          // graceful fallback
          setChanges((prev) => {
            const map = new Map<number, ChangeItem>();
            for (const c of prev) if (typeof c.index === "number") map.set(c.index, c);
            map.set(item.index!, {
              ...item,
              explanation:
                data?.error ||
                "Couldn’t parse analysis output. Consider widening context or retrying.",
              syntax: "bad",
              performance: "bad",
            });
            const next = Array.from(map.values()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
            return next;
          });
          explained++;
          setSummary(`Streaming ${total} changes… ${explained} explained.`);
        }

        // Let paint happen
        await new Promise((r) => setTimeout(r, 0));
      }

      setStreaming(false);
    } catch (e: any) {
      setStreaming(false);
      setError(e?.message || "Unexpected error while analyzing changes.");
    }
  }

  return (
    <Card className={`${bgCard} dark:ring-0 dark:border-gray-200 dark:shadow-lg`}>
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-900 font-semibold">
            AI Analysis {streaming && <span className="text-xs text-gray-500 ml-2">• In Progress…</span>}
          </h3>

        <button
            type="button"
            onClick={handleRun}
            disabled={streaming || !canonicalNew}
            title="Generate analysis"
            className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-gray-300 bg-gray-100 text-gray-900 shadow-sm hover:bg-white transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            <span className="text-sm">Generate Analysis</span>
          </button>
        </div>

        <div className="h-[27.6rem] scroll-overlay focus:outline-none pr-3" tabIndex={0}>
          {error ? (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">
              {error}
            </div>
          ) : (
            <div className="space-y-4">
              {changes.length > 0 ? (
                changes.map((chg, index) => (
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

                      <div className="flex-1">
                        {chg.explanation === "Pending…" ? (
                          <div className="space-y-2" aria-busy="true" aria-live="polite">
                            <div className="h-3 w-[95%] bg-gray-200 rounded animate-pulse" />
                            <div className="h-3 w-[90%] bg-gray-200 rounded animate-pulse" />
                            <div className="h-3 w-[88%] bg-gray-200 rounded animate-pulse" />
                            <div className="h-3 w-[82%] bg-gray-200 rounded animate-pulse" />
                          </div>
                        ) : (
                          <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{chg.explanation}</p>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
                  <p className="leading-relaxed">{summary}</p>
                </div>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
