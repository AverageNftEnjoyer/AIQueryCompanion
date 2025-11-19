"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import type { QueryComparisonHandle } from "@/components/query-comparison";
import {
  generateQueryDiff,
  buildAlignedRows,
  type ComparisonResult,
  type AlignedRow,
} from "@/lib/query-differ";
import ChatPanel from "@/components/chatpanel";
import type { PanelSession } from "@/app/results/page";

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
  onJump?: (side: Exclude<Side, "both">, line: number) => void;
  fullHeight?: boolean;

  externalMessages: any[];
  setExternalMessages: React.Dispatch<React.SetStateAction<any[]>>;
  externalLoading: boolean;
  setExternalLoading: React.Dispatch<React.SetStateAction<boolean>>;

  // NEW: fully controlled per-session state
  externalSession: PanelSession;
  setExternalSession: React.Dispatch<React.SetStateAction<PanelSession>>;
}

const toLF = (s: string) => s.replace(/\r\n/g, "\n");

export default function AnalysisPanel({
  isLight,
  canonicalOld,
  canonicalNew,
  cmpRef,
  onJump,
  fullHeight,
  externalMessages,
  setExternalMessages,
  externalLoading,
  setExternalLoading,
  externalSession,
  setExternalSession,
}: Props) {
  const clickAudioRef = React.useRef<HTMLAudioElement | null>(null);
  const [soundEnabled] = React.useState(true);
  const playClick = () => {
    if (!soundEnabled) return;
    const el = clickAudioRef.current;
    if (!el) return;
    try {
      el.muted = false;
      el.pause();
      el.currentTime = 0;
      el.volume = 0.6;
      void el.play();
    } catch {}
  };

  const displayOld = React.useMemo(() => toLF(canonicalOld || ""), [canonicalOld]);
  const displayNew = React.useMemo(() => toLF(canonicalNew || ""), [canonicalNew]);

  const comparison: ComparisonResult | null = React.useMemo(() => {
    if (!displayNew) return null;
    return generateQueryDiff(displayOld, displayNew, { basis: "raw" });
  }, [displayOld, displayNew]);

  const alignedRows: AlignedRow[] = React.useMemo(() => {
    return comparison ? buildAlignedRows(comparison) : [];
  }, [comparison]);

  const analysisMessages = React.useMemo(
    () => [
      "Building semantic diff graph…",
      "Evaluating clause-level changes and intent…",
      "Estimating performance impact and plan risk…",
      "Cross-checking join keys, groups, and predicates…",
    ],
    []
  );
  const [analysisMsgIdx, setAnalysisMsgIdx] = React.useState(0);
  React.useEffect(() => {
    if (!externalSession.streaming || externalSession.changes.length > 0) return;
    const id = setInterval(() => setAnalysisMsgIdx((i) => (i + 1) % analysisMessages.length), 3000);
    return () => clearInterval(id);
  }, [externalSession.streaming, externalSession.changes.length, analysisMessages.length]);

  const hcMessages = React.useMemo(
    () => [
      "Scanning for hardcoded literals…",
      "Hunting magic numbers and credentials…",
      "Checking env/schema references…",
      "Reviewing parameters for unsafe values…",
    ],
    []
  );
  const [hcMsgIdx, setHcMsgIdx] = React.useState(0);
  React.useEffect(() => {
    if (!externalSession.hcLoading) return;
    const id = setInterval(() => setHcMsgIdx((i) => (i + 1) % hcMessages.length), 3000);
    return () => clearInterval(id);
  }, [externalSession.hcLoading, hcMessages.length]);

  const summaryMessages = React.useMemo(
    () => [
      "Synthesizing purpose and business context…",
      "Abstracting dataset scope and constraints…",
      "Tracing aggregations and window logic…",
      "Formulating developer-facing guardrails…",
    ],
    []
  );
  const [sumMsgIdx, setSumMsgIdx] = React.useState(0);
  React.useEffect(() => {
    if (!externalSession.sumLoading) return;
    const id = setInterval(() => setSumMsgIdx((i) => (i + 1) % summaryMessages.length), 3000);
    return () => clearInterval(id);
  }, [externalSession.sumLoading, summaryMessages.length]);

  // map raw line numbers to NEW-side display lines (respecting placeholders)
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

  // normalized jump that also scrolls page to query viewport
  function jump(side: Side, rawLine: number) {
    const pane: Exclude<Side, "both"> = side === "old" ? "old" : "new";
    const dl = toDisplayLine(pane, rawLine);

    if (cmpRef?.current) {
      cmpRef.current.scrollTo({
        side: pane,
        line: dl,
        flash: true,
      });
    } else if (onJump) {
      onJump(pane, dl);
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function handleGenerate() {
    if (externalSession.mode === "analysis") return runAnalysis();
    if (externalSession.mode === "hardcode") return runHardcodeScan();
    if (externalSession.mode === "summary") return runSummary();
  }

  async function runAnalysis() {
    setExternalSession((p) => ({ ...p, streaming: true, error: null, changes: [], analysisBanner: "Streaming 0 changes… 0 explained." }));
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
      setExternalSession((p) => ({ ...p, changes: merged, analysisBanner: `Streaming ${total} changes… 0 explained.` }));
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
          setExternalSession((prev) => ({
            ...prev,
            changes: prev.changes.map((p) => (p.index === item.index ? { ...p, explanation, syntax, performance } : p)),
            analysisBanner: `Streaming ${total} changes… ${++explained} explained.`,
          }));
        }
        await new Promise((r) => setTimeout(r, 120));
      }
      setExternalSession((p) => ({ ...p, streaming: false }));
    } catch (e: any) {
      setExternalSession((p) => ({ ...p, streaming: false, error: e?.message || "Unexpected error while analyzing changes." }));
    }
  }

  async function runHardcodeScan() {
    setExternalSession((p) => ({ ...p, hcLoading: true, hcError: null, hcFindings: [] }));
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
      setExternalSession((p) => ({ ...p, hcFindings: normalized, hcLoading: false }));
    } catch (e: any) {
      setExternalSession((p) => ({ ...p, hcLoading: false, hcError: e?.message || "Unexpected error while scanning for hardcoding." }));
    }
  }

  const sumAbortRef = React.useRef<AbortController | null>(null);
  async function runSummary() {
    if (sumAbortRef.current) sumAbortRef.current.abort();
    const ac = new AbortController();
    sumAbortRef.current = ac;
    setExternalSession((p) => ({ ...p, sumLoading: true, sumError: null, summaryText: "" }));
    try {
      const res = await fetch(`/api/summarize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newQuery: canonicalNew, analysis: null }),
        signal: ac.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Summarize failed (${res.status})`);
      const t = String(data?.tldr || "").trim();
      setExternalSession((p) => ({ ...p, sumLoading: false, summaryText: t }));
    } catch (e: any) {
      if (e?.name === "AbortError") return;
      setExternalSession((p) => ({ ...p, sumLoading: false, sumError: e?.message || "Unexpected error while generating summary." }));
    }
  }

  const showGenerateButton =
    externalSession.mode === "analysis" || externalSession.mode === "hardcode" || externalSession.mode === "summary";
  const generateDisabled =
    (externalSession.mode === "analysis" && (externalSession.streaming || !canonicalNew)) ||
    (externalSession.mode === "hardcode" && (externalSession.hcLoading || !canonicalNew)) ||
    (externalSession.mode === "summary" && (externalSession.sumLoading || !canonicalNew));

  return (
    <Card
      className={`mt-4 sm:mt-5 md:mt-0 scroll-mt-24 bg-slate-50 border-slate-200 shadow-lg ${
        fullHeight ? "h-full" : ""
      }`}
    >
      <CardContent className={`p-5 ${fullHeight ? "h-full flex flex-col min-h-0" : ""}`}>
        <audio ref={clickAudioRef} src="/minimapbar.mp3" preload="auto" muted={!soundEnabled} />

        <div className="flex items-center justify-between mb-4">
          <h3 className="text-slate-900 font-semibold">AI Tools</h3>
          <div className="flex items-center gap-2">
            {showGenerateButton && (
              <button
                onClick={handleGenerate}
                disabled={generateDisabled}
                title="Generate"
                className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-gray-300 bg-gray-100 text-gray-900 shadow-sm hover:bg-white transition disabled:opacity-60 disabled:cursor-not-allowed"
              >
                <span className="text-sm">Generate</span>
              </button>
            )}
            <div className="inline-flex rounded-full border border-gray-300 bg-gray-100 p-0.5">
              {canonicalOld && (
                <button
                  type="button"
                  onClick={() => setExternalSession((p) => ({ ...p, mode: "analysis" }))}
                  className={`px-3 h-8 rounded-full text-sm transition ${
                    externalSession.mode === "analysis" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
                  }`}
                  title="Model-driven change analysis"
                >
                  Analysis
                </button>
              )}
              <button
                type="button"
                onClick={() => setExternalSession((p) => ({ ...p, mode: "hardcode" }))}
                className={`px-3 h-8 rounded-full text-sm transition ${
                  externalSession.mode === "hardcode" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Hardcoding
              </button>
              <button
                type="button"
                onClick={() => setExternalSession((p) => ({ ...p, mode: "summary" }))}
                className={`px-3 h-8 rounded-full text-sm transition ${
                  externalSession.mode === "summary" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Summary
              </button>
              <button
                type="button"
                onClick={() => setExternalSession((p) => ({ ...p, mode: "chat" }))}
                className={`px-3 h-8 rounded-full text-sm transition ${
                  externalSession.mode === "chat" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Chat
              </button>
            </div>
          </div>
        </div>

        <div
          className={`${
            fullHeight ? "flex-1 min-h-0" : "h-[27.7rem]"
          } bg-gray-50 border border-gray-200 rounded-lg p-4 overflow-y-auto`}
        >
          {externalSession.mode === "analysis" ? (
            externalSession.error ? (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">
                {externalSession.error}
              </div>
            ) : externalSession.streaming && externalSession.changes.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-700 space-y-5">
                <div className="relative w-14 h-14">
                  <div className="absolute inset-0 rounded-full border-2 border-gray-300/60 animate-[spin_2.2s_linear_infinite]" />
                  <div className="absolute inset-2 rounded-full border-t-2 border-gray-700 animate-[spin_1.2s_linear_infinite]" />
                  <div className="absolute inset-4 rounded-full bg-gray-300/20 animate-pulse" />
                </div>
                <div className="text-sm font-medium transition-opacity duration-500">
                  {analysisMessages[analysisMsgIdx]}
                </div>
                <style>{`
                  @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
              </div>
            ) : externalSession.changes.length > 0 ? (
              <div className="space-y-4">
                {externalSession.changes.map((chg, i) => {
                  const sideForJump: Exclude<Side, "both"> = chg.side === "old" ? "old" : "new";
                  const dispLine =
                    sideForJump === "old"
                      ? toDisplayLine("old", chg.lineNumber)
                      : toDisplayLine("new", chg.lineNumber);
                  return (
                    <button
                      key={i}
                      onClick={(e) => {
                        e.preventDefault();
                        playClick();
                        jump(sideForJump, chg.lineNumber);
                        (e.currentTarget as HTMLButtonElement).blur();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          playClick();
                          jump(sideForJump, chg.lineNumber);
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
              <div className="text-gray-700 text-sm">{externalSession.analysisBanner}</div>
            )
          ) : externalSession.mode === "hardcode" ? (
            externalSession.hcError ? (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">
                {externalSession.hcError}
              </div>
            ) : externalSession.hcLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-700 space-y-5">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-full bg-gray-300 opacity-20 animate-ping" />
                  <div className="absolute inset-0 rounded-full border-2 border-dashed border-gray-400 animate-[spin_6s_linear_infinite]" />
                  <div className="absolute inset-3 rounded-full border-t-2 border-gray-700 animate-[spin_1.4s_linear_infinite]" />
                  <div className="absolute left-1/2 top-0 w-0.5 h-3 bg-gray-700 rounded origin-bottom animate-[spin_1.4s_linear_infinite]" />
                </div>
                <div className="text-sm font-medium transition-opacity duration-500">
                  {hcMessages[hcMsgIdx]}
                </div>
                <style>{`
                  @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
              </div>
            ) : externalSession.hcFindings.length > 0 ? (
              <div className="space-y-4">
                {externalSession.hcFindings.map((f, i) => {
                  const dispLine = toDisplayLine("new", f.lineNumber);
                  return (
                    <button
                      key={i}
                      onClick={(e) => {
                        e.preventDefault();
                        playClick();
                        jump("new", f.lineNumber);
                        (e.currentTarget as HTMLButtonElement).blur();
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          playClick();
                          jump("new", f.lineNumber);
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
              <div className="text-gray-600 text-sm">Run Generate to scan for hardcoded values or configuration issues.</div>
            )
          ) : externalSession.mode === "summary" ? (
            externalSession.sumError ? (
              <div className="bg-rose-50 border border-rose-200 rounded-lg p-4 text-sm text-rose-700">
                {externalSession.sumError}
              </div>
            ) : externalSession.sumLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-700 space-y-5">
                <div className="relative w-16 h-16">
                  <div className="absolute inset-0 rounded-lg bg-gray-300/20 animate-pulse" />
                  <div className="absolute inset-0 rounded-lg border border-gray-300/50" />
                  <div className="absolute left-2 right-2 top-3 h-2 rounded bg-gray-300 animate-[shimmer_1.5s_ease_infinite]" />
                  <div className="absolute left-2 right-4 top-6 h-2 rounded bg-gray-200 animate-[shimmer_1.6s_ease_infinite]" />
                  <div className="absolute left-2 right-8 top-9 h-2 rounded bg-gray-200 animate-[shimmer_1.7s_ease_infinite]" />
                </div>
                <div className="text-sm font-medium transition-opacity duration-500">
                  {summaryMessages[sumMsgIdx]}
                </div>
                <style>{`
                  @keyframes shimmer {
                    0% { transform: translateX(-10%); opacity: .6; }
                    50% { opacity: .9; }
                    100% { transform: translateX(10%); opacity: .6; }
                  }
                `}</style>
              </div>
            ) : externalSession.summaryText ? (
              <p className="text-gray-800 text-sm leading-relaxed whitespace-pre-wrap">{externalSession.summaryText}</p>
            ) : (
              <div className="text-gray-600 text-sm">Click Generate to produce a concise overview.</div>
            )
          ) : (
            <div className="h-full">
              <ChatPanel
                rawOld={canonicalOld}
                rawNew={canonicalNew}
                changeCount={externalSession.changes.length}
                stats={null}
                placeholder="Ask about this query…"
                containerHeightClass="h-[27.7rem] p-0"
                externalMessages={externalMessages}
                setExternalMessages={setExternalMessages}
                externalLoading={externalLoading}
                setExternalLoading={setExternalLoading}
              />
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
