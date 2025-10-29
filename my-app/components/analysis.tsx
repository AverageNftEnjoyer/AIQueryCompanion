"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Loader2, Send, Search } from "lucide-react";
import type { QueryComparisonHandle } from "@/components/query-comparison";
import {
  generateQueryDiff,
  buildAlignedRows,
  type ComparisonResult,
  type AlignedRow,
} from "@/lib/query-differ";

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
  severity?: "block" | "warn" | "info";
}

interface HardcodeFinding {
  kind: string;
  detail: string;
  lineNumber: number;
  side: Side;
  severity?: "info" | "warn" | "error";
}

interface Props {
  isLight: boolean;
  canonicalOld: string;
  canonicalNew: string;
  cmpRef?: React.RefObject<QueryComparisonHandle>;
  onJump?: (side: Side, line: number) => void;
}

const toLF = (s: string) => s.replace(/\r\n/g, "\n");

export default function AnalysisPanel({ isLight, canonicalOld, canonicalNew, cmpRef, onJump }: Props) {
  const [streaming, setStreaming] = React.useState(false);
  const [summary, setSummary] = React.useState("Click “Generate Analysis” to review each change.");
  const [changes, setChanges] = React.useState<ChangeItem[]>([]);
  const [pendingChanges, setPendingChanges] = React.useState<number>(0);
  const [error, setError] = React.useState<string | null>(null);

  const [hcLoading, setHcLoading] = React.useState(false);
  const [hcError, setHcError] = React.useState<string | null>(null);
  const [hcFindings, setHcFindings] = React.useState<HardcodeFinding[]>([]);
  const [hcMessage, setHcMessage] = React.useState<string>("Scanning for hardcoded values…");

  const [mode, setMode] = React.useState<"analysis" | "hardcode">("analysis");

  const hcMessages = React.useMemo(
    () => [
      "Scanning for changes and credentials…",
      "Checking for literals and magic numbers…",
      "Reviewing schema and environment references…",
      "Analyzing query parameters for unsafe values…",
      "Finalizing scan report…",
    ],
    []
  );

  const displayOld = React.useMemo(() => toLF(canonicalOld || ""), [canonicalOld]);
  const displayNew = React.useMemo(() => toLF(canonicalNew || ""), [canonicalNew]);

  const comparison: ComparisonResult | null = React.useMemo(() => {
    if (!displayNew) return null;
    return generateQueryDiff(displayOld, displayNew, { basis: "raw" });
  }, [displayOld, displayNew]);

  const alignedRows: AlignedRow[] = React.useMemo(() => {
    return comparison ? buildAlignedRows(comparison) : [];
  }, [comparison]);

  const { newLineToDisplay, oldLineToDisplay } = React.useMemo(() => {
    const n2d = new Map<number, number>();
    const o2d = new Map<number, number>();
    for (const r of alignedRows) {
      const v = r.new?.visualIndex;
      if (typeof v === "number") {
        if (typeof r.new?.lineNumber === "number") n2d.set(r.new.lineNumber, v);
        if (typeof r.old?.lineNumber === "number") o2d.set(r.old.lineNumber, v);
      }
    }
    return { newLineToDisplay: n2d, oldLineToDisplay: o2d };
  }, [alignedRows]);

  const toDisplayLine = React.useCallback(
    (side: Side, line: number) => {
      if (side === "old") return oldLineToDisplay.get(line) ?? line;
      return newLineToDisplay.get(line) ?? line;
    },
    [newLineToDisplay, oldLineToDisplay]
  );

  function handleJump(line: number, side: Side = "new") {
    const dl = toDisplayLine(side, line);
    if (typeof onJump === "function") {
      onJump("new", dl);
      return;
    }
    if (cmpRef?.current) {
      cmpRef.current.scrollTo({ side: "new", line: dl, flash: false });
    }
  }

  async function handleRun() {
    setMode("analysis");
    setStreaming(true);
    setError(null);
    setChanges([]);
    setPendingChanges(0);

    try {
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
      setPendingChanges(total);

      while (nextCursor !== null) {
        const p = await prepPage(nextCursor);
        placeholders = placeholders.concat(p?.analysis?.changes ?? []);
        nextCursor = p?.page?.nextCursor ?? null;
      }

      const byIndex = new Map<number, ChangeItem>();
      for (const c of placeholders) {
        const pending = { ...c, explanation: "Pending…" as const };
        if (typeof pending.index === "number") byIndex.set(pending.index, pending);
      }
      const merged = Array.from(byIndex.values()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      setChanges(merged);
      setSummary(`Streaming ${total} changes… 0 explained.`);

      let explained = 0;
      for (let i = 0; i < merged.length; i++) {
        const item = merged[i];
        if (typeof item.index !== "number") continue;

        const res = await fetch(`/api/analyze?mode=item&index=${item.index}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldQuery: canonicalOld, newQuery: canonicalNew }),
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && data?.analysis?.changes?.[0]) {
          const inc = data.analysis.changes[0] as Partial<ChangeItem>;
          const explanation = inc.explanation || "No analysis was produced.";
          const syntax = inc.syntax === "bad" ? "bad" : "good";
          const performance = inc.performance === "bad" ? "bad" : "good";

          setChanges((prev) =>
            prev.map((p) => (p.index === item.index ? { ...p, explanation, syntax, performance } : p))
          );
          explained++;
          setSummary(`Streaming ${total} changes… ${explained} explained.`);
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      setStreaming(false);
      setPendingChanges(0);
    } catch (e: any) {
      setStreaming(false);
      setError(e?.message || "Unexpected error while analyzing changes.");
    }
  }

  async function handleScanHardcode() {
    setMode("hardcode");
    setHcLoading(true);
    setHcError(null);
    setHcFindings([]);

    let idx = 0;
    setHcMessage(hcMessages[0]);
    const msgInterval = setInterval(() => {
      idx = (idx + 1) % hcMessages.length;
      setHcMessage(hcMessages[idx]);
    }, 3000);

    try {
      const res = await fetch("/api/hardcode?side=new&scanMode=newOnly", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          oldQuery: "",
          newQuery: canonicalNew,
          side: "new",
          scanMode: "newOnly",
        }),
      });

      const data = await res.json().catch(() => ({}));
      clearInterval(msgInterval);

      if (!res.ok) throw new Error(data?.error || `Scan failed (${res.status})`);

      const items = data?.analysis?.changes ?? [];

      const normalized: HardcodeFinding[] = items.map((it: any) => {
        const ln =
          typeof it?.lineNumberNew === "number"
            ? it.lineNumberNew
            : typeof it?.lineNumber === "number"
            ? it.lineNumber
            : 0;

        const desc = String(it?.description ?? "unknown");
        const serverSeverity = (it?.severity as "block" | "warn" | "info" | undefined) || undefined;

        const severity: "error" | "warn" | "info" = (() => {
          if (serverSeverity === "block") return "error";
          if (serverSeverity === "warn") return "warn";
          if (serverSeverity === "info") return "info";
          const dl = desc.toLowerCase();
          if (dl.includes("secret/credential") || dl.includes("env-or-schema")) return "error";
          if (it?.syntax === "bad") return "warn";
          return "info";
        })();

        return {
          kind: desc,
          detail: String(it?.explanation ?? ""),
          lineNumber: Number(ln),
          side: "new",
          severity,
        };
      });

      setHcFindings(normalized);
      setHcLoading(false);
    } catch (e: any) {
      clearInterval(msgInterval);
      setHcLoading(false);
      setHcError(e?.message || "Unexpected error while scanning for hardcoding.");
    }
  }

  return (
    <Card className="mt-4 sm:mt-5 md:mt-0 scroll-mt-24 bg-slate-50 border-slate-200 shadow-lg">
      <CardContent className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-900 font-semibold">AI Tools</h3>

          <div className="flex items-center gap-2">
            {mode === "analysis" ? (
              <button
                onClick={handleRun}
                disabled={streaming || !canonicalNew}
                title="Generate analysis"
                className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-gray-300 bg-gray-100 text-gray-900 shadow-sm hover:bg-white transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                <span className="text-sm">Generate Analysis</span>
              </button>
            ) : (
              <button
                onClick={handleScanHardcode}
                disabled={hcLoading || !canonicalNew}
                title="Scan for hard-coded values"
                className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-gray-300 bg-gray-100 text-gray-900 shadow-sm hover:bg-white transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {hcLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                <span className="text-sm">Scan Hardcoding</span>
              </button>
            )}

            <div className="inline-flex rounded-full border border-gray-300 bg-gray-100 p-0.5">
              <button
                type="button"
                onClick={() => setMode("analysis")}
                className={`px-3 h-8 rounded-full text-sm transition ${
                  mode === "analysis" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
                }`}
                title="Model-driven change analysis"
              >
                Analysis
              </button>
              <button
                type="button"
                onClick={() => setMode("hardcode")}
                className={`px-3 h-8 rounded-full text-sm transition ${
                  mode === "hardcode" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
                }`}
                title="Hardcoding / environment scan"
              >
                Hardcoding
              </button>
            </div>
          </div>
        </div>

        <div className="h-[27.7rem] bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-y-auto">
          {mode === "analysis" ? (
            error ? (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">
                {error}
              </div>
            ) : changes.length > 0 ? (
              <div className="space-y-4">
                {changes.map((chg, i) => {
                  const dispLine =
                    chg.side === "old"
                      ? toDisplayLine("old", chg.lineNumber)
                      : toDisplayLine("new", chg.lineNumber);
                  return (
                    <button
                      key={i}
                      onClick={(e) => {
                        e.preventDefault();
                        handleJump(chg.lineNumber, chg.side === "old" ? "old" : "new");
                        (e.currentTarget as HTMLButtonElement).blur();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          handleJump(chg.lineNumber, chg.side === "old" ? "old" : "new");
                          (e.currentTarget as HTMLButtonElement).blur();
                        }
                      }}
                      className="group w-full text-left bg-gray-50 border border-gray-200 rounded-lg p-4 cursor-pointer transition hover:bg-amber-50 hover:border-amber-300 hover:shadow-sm active:bg-amber-100 active:border-amber-300 focus:outline-none focus:ring-0"
                    >
                      <div className="flex items-start gap-4">
                        <div className="shrink-0 flex flex-col items-start gap-1 min-w-[120px]">
                          <span className="px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700">
                            Line {dispLine}
                          </span>
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                              chg.type === "addition"
                                ? "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200"
                                : chg.type === "deletion"
                                ? "bg-rose-100 text-rose-700 group-hover:bg-rose-200"
                                : "bg-amber-100 text-amber-700 group-hover:bg-amber-200"
                            }`}
                          >
                            {chg.type}
                          </span>
                          <div className="flex flex-col gap-1 pt-1">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                                chg.syntax === "good"
                                  ? "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200"
                                  : "bg-rose-100 text-rose-700 group-hover:bg-rose-200"
                              }`}
                            >
                              Syntax: {chg.syntax === "good" ? "Good" : "Bad"}
                            </span>
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                                chg.performance === "good"
                                  ? "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200"
                                  : "bg-rose-100 text-rose-700 group-hover:bg-rose-200"
                              }`}
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
                            <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap transition-opacity duration-300 opacity-100">
                              {chg.explanation}
                            </p>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="text-gray-700 text-sm">{summary}</div>
            )
          ) : hcError ? (
            <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">
              {hcError}
            </div>
          ) : hcLoading ? (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-700 space-y-4">
              <Loader2 className="h-6 w-6 animate-spin text-gray-600" />
              <p className="text-sm animate-pulse">{hcMessage}</p>
            </div>
          ) : hcFindings.length > 0 ? (
            <div className="space-y-4">
              {hcFindings.map((f, i) => {
                const dispLine = toDisplayLine("new", f.lineNumber);
                return (
                  <button
                    key={i}
                    onClick={(e) => {
                      e.preventDefault();
                      handleJump(f.lineNumber, "new");
                      (e.currentTarget as HTMLButtonElement).blur();
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        handleJump(f.lineNumber, "new");
                        (e.currentTarget as HTMLButtonElement).blur();
                      }
                    }}
                    className="group w-full text-left bg-gray-50 border border-gray-200 rounded-lg p-4 cursor-pointer transition hover:bg-amber-50 hover:border-amber-300 hover:shadow-sm active:bg-amber-100 active:border-amber-300 focus:outline-none focus:ring-0"
                  >
                    <div className="flex items-start gap-4">
                      <div className="shrink-0 flex flex-col items-start gap-1 min-w-[120px]">
                        <span className="px-2 py-1 rounded text-xs font-medium bg-slate-100 text-slate-700">
                          Line {dispLine}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[10px] font-medium transition ${
                            f.severity === "error"
                              ? "bg-rose-100 text-rose-700 group-hover:bg-rose-200"
                              : f.severity === "warn"
                              ? "bg-amber-100 text-amber-700 group-hover:bg-amber-200"
                              : "bg-gray-100 text-gray-700 group-hover:bg-gray-200"
                          }`}
                        >
                          {f.severity === "error" ? "Flagged" : f.severity === "warn" ? "Review" : "Info"}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{f.detail}</p>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="text-gray-600 text-sm">
              Click <em>Scan Hardcoding</em> to detect hardcoded values or configuration issues.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
