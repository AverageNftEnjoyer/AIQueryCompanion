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

type ChatMessage = { role: "user" | "assistant"; content: string };

interface Props {
  isLight: boolean;
  canonicalOld: string;
  canonicalNew: string;
  cmpRef?: React.RefObject<QueryComparisonHandle>;
  onJump?: (side: Exclude<Side, "both">, line: number) => void;
  fullHeight?: boolean;

  externalMessages: ChatMessage[];
  setExternalMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  externalLoading: boolean;
  setExternalLoading: React.Dispatch<React.SetStateAction<boolean>>;

  // NEW: fully controlled per-session state
  externalSession: PanelSession;
  setExternalSession: React.Dispatch<React.SetStateAction<PanelSession>>;
}

const toLF = (s: string) => s.replace(/\r\n/g, "\n");

export default function AnalysisPanel({
  isLight: _isLight,
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
  const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);
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
      const page = await prepPage(0);
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
    } catch (e: unknown) {
      setExternalSession((p) => ({ ...p, streaming: false, error: errorMessage(e, "Unexpected error while analyzing changes.") }));
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
      const items: unknown[] = Array.isArray(data?.analysis?.changes) ? data.analysis.changes : [];
      const normalized: HardcodeFinding[] = items.map((it) => {
        const record = (typeof it === "object" && it !== null ? it : {}) as Record<string, unknown>;
        const ln =
          typeof record.lineNumberNew === "number"
            ? record.lineNumberNew
            : typeof record.lineNumber === "number"
            ? record.lineNumber
            : 0;
        const desc = String(record.description ?? "unknown");
        const serverSeverity = (record.severity as "block" | "warn" | "info" | undefined) || undefined;
        const severity: "error" | "warn" | "info" = (() => {
          if (serverSeverity === "block") return "error";
          if (serverSeverity === "warn") return "warn";
          if (serverSeverity === "info") return "info";
          const dl = desc.toLowerCase();
          if (dl.includes("secret/credential") || dl.includes("env-or-schema")) return "error";
          if (record.syntax === "bad") return "warn";
          return "info";
        })();
        return {
          kind: desc,
          detail: String(record.explanation ?? ""),
          lineNumber: Number(ln),
          side: "new",
          severity,
        };
      });
      setExternalSession((p) => ({ ...p, hcFindings: normalized, hcLoading: false }));
    } catch (e: unknown) {
      setExternalSession((p) => ({ ...p, hcLoading: false, hcError: errorMessage(e, "Unexpected error while scanning for hardcoding.") }));
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
    } catch (e: unknown) {
      if (e instanceof Error && e.name === "AbortError") return;
      setExternalSession((p) => ({ ...p, sumLoading: false, sumError: errorMessage(e, "Unexpected error while generating summary.") }));
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
      className={`mt-4 sm:mt-5 md:mt-0 scroll-mt-24 bg-card border border-border rounded-md ${
        fullHeight ? "h-full" : ""
      }`}
    >
      <CardContent className={`p-0 ${fullHeight ? "h-full flex flex-col min-h-0" : ""}`}>
        <audio ref={clickAudioRef} src="/minimapbar.mp3" preload="auto" muted={!soundEnabled} />

        <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-border shrink-0">
          <h3 className="font-heading text-[13px] font-semibold uppercase tracking-[0.06em] text-foreground">AI tools</h3>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {canonicalOld && (
                <button
                  type="button"
                  onClick={() => setExternalSession((p) => ({ ...p, mode: "analysis" }))}
                  className={`h-[26px] px-2.5 text-xs border-l border-border first:border-l-0 transition ${
                    externalSession.mode === "analysis" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-surface-2"
                  }`}
                  title="Model-driven change analysis"
                >
                  Analysis
                </button>
              )}
              <button
                type="button"
                onClick={() => setExternalSession((p) => ({ ...p, mode: "hardcode" }))}
                className={`h-[26px] px-2.5 text-xs border-l border-border first:border-l-0 transition ${
                  externalSession.mode === "hardcode" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-surface-2"
                }`}
              >
                Hardcoding
              </button>
              <button
                type="button"
                onClick={() => setExternalSession((p) => ({ ...p, mode: "summary" }))}
                className={`h-[26px] px-2.5 text-xs border-l border-border first:border-l-0 transition ${
                  externalSession.mode === "summary" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-surface-2"
                }`}
              >
                Summary
              </button>
              <button
                type="button"
                onClick={() => setExternalSession((p) => ({ ...p, mode: "chat" }))}
                className={`h-[26px] px-2.5 text-xs border-l border-border first:border-l-0 transition ${
                  externalSession.mode === "chat" ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-surface-2"
                }`}
              >
                Chat
              </button>
            </div>
            {showGenerateButton && (
              <button
                onClick={handleGenerate}
                disabled={generateDisabled}
                title="Generate"
                className="h-[26px] px-2.5 rounded-md border border-foreground text-xs font-semibold text-foreground transition hover:bg-surface-2 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Generate
              </button>
            )}
          </div>
        </div>

        <div
          className={`${
            fullHeight ? "flex-1 min-h-0" : "h-[27.7rem]"
          } overflow-y-auto`}
        >
          {externalSession.mode === "analysis" ? (
            externalSession.error ? (
              <div className="m-3.5 rounded-md border border-destructive bg-diff-del-bg p-4 text-sm text-destructive">
                {externalSession.error}
              </div>
            ) : externalSession.streaming && externalSession.changes.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center space-y-5 py-10 text-center text-foreground">
                <div className="relative h-14 w-14">
                  <div className="absolute inset-0 rounded-full border-2 border-border animate-[spin_2.2s_linear_infinite]" />
                  <div className="absolute inset-2 rounded-full border-t-2 border-[var(--primary)] animate-[spin_1.2s_linear_infinite]" />
                  <div className="absolute inset-4 rounded-full bg-surface-2 animate-pulse" />
                </div>
                <div className="text-sm font-medium transition-opacity duration-500">
                  {analysisMessages[analysisMsgIdx]}
                </div>
                <style>{`
                  @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
              </div>
            ) : externalSession.changes.length > 0 ? (
              <div>
                {externalSession.changes.map((chg, i) => {
                  const sideForJump: Exclude<Side, "both"> = chg.side === "old" ? "old" : "new";
                  const dispLine =
                    sideForJump === "old"
                      ? toDisplayLine("old", chg.lineNumber)
                      : toDisplayLine("new", chg.lineNumber);
                  const chipClass =
                    chg.type === "addition"
                      ? "bg-diff-add-bg text-diff-add-fg"
                      : chg.type === "deletion"
                      ? "bg-diff-del-bg text-diff-del-fg"
                      : "bg-diff-mod-bg text-diff-mod-fg";
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
                      className="flex w-full items-start gap-3.5 border-b border-border px-3.5 py-3 text-left transition hover:bg-surface-2 focus:outline-none focus:ring-0"
                    >
                      <div className="flex w-[104px] shrink-0 flex-col items-start gap-1">
                        <span className="font-mono text-[11px] text-muted-foreground">Line {dispLine}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-[0.04em] ${chipClass}`}>
                          {chg.type}
                        </span>
                        <div className="flex flex-col gap-0.5 pt-1">
                          <span className={`text-[10px] font-semibold ${chg.syntax === "good" ? "text-diff-add-fg" : "text-diff-del-fg"}`}>
                            Syntax {chg.syntax === "good" ? "Good" : "Bad"}
                          </span>
                          <span className={`text-[10px] font-semibold ${chg.performance === "good" ? "text-diff-add-fg" : "text-diff-del-fg"}`}>
                            Perf {chg.performance === "good" ? "Good" : "Bad"}
                          </span>
                        </div>
                      </div>
                      <div className="flex-1">
                        {chg.explanation === "Pending…" ? (
                          <div className="space-y-2" aria-busy="true" aria-live="polite">
                            <div className="h-3 w-[95%] animate-pulse rounded bg-surface-2" />
                            <div className="h-3 w-[90%] animate-pulse rounded bg-surface-2" />
                            <div className="h-3 w-[88%] animate-pulse rounded bg-surface-2" />
                            <div className="h-3 w-[82%] animate-pulse rounded bg-surface-2" />
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap text-xs leading-[1.55] text-foreground transition-opacity duration-300">
                            {chg.explanation}
                          </p>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3.5 py-3 text-sm text-muted-foreground">{externalSession.analysisBanner}</div>
            )
          ) : externalSession.mode === "hardcode" ? (
            externalSession.hcError ? (
              <div className="m-3.5 rounded-md border border-destructive bg-diff-del-bg p-4 text-sm text-destructive">
                {externalSession.hcError}
              </div>
            ) : externalSession.hcLoading ? (
              <div className="flex h-full flex-col items-center justify-center space-y-5 py-10 text-center text-foreground">
                <div className="relative h-16 w-16">
                  <div className="absolute inset-0 rounded-full bg-surface-2 opacity-60 animate-ping" />
                  <div className="absolute inset-0 rounded-full border-2 border-dashed border-border animate-[spin_6s_linear_infinite]" />
                  <div className="absolute inset-3 rounded-full border-t-2 border-[var(--primary)] animate-[spin_1.4s_linear_infinite]" />
                </div>
                <div className="text-sm font-medium transition-opacity duration-500">
                  {hcMessages[hcMsgIdx]}
                </div>
                <style>{`
                  @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
              </div>
            ) : externalSession.hcFindings.length > 0 ? (
              <div>
                {externalSession.hcFindings.map((f, i) => {
                  const dispLine = toDisplayLine("new", f.lineNumber);
                  const chipClass =
                    f.severity === "error"
                      ? "bg-diff-del-bg text-diff-del-fg"
                      : f.severity === "warn"
                      ? "bg-diff-mod-bg text-diff-mod-fg"
                      : "border border-border text-muted-foreground";
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
                      className="flex w-full items-start gap-3.5 border-b border-border px-3.5 py-3 text-left transition hover:bg-surface-2 focus:outline-none focus:ring-0"
                    >
                      <div className="flex w-[104px] shrink-0 flex-col items-start gap-1">
                        <span className="font-mono text-[11px] text-muted-foreground">Line {dispLine}</span>
                        <span className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-[0.04em] ${chipClass}`}>
                          {f.severity === "error" ? "Flagged" : f.severity === "warn" ? "Review" : "Info"}
                        </span>
                      </div>
                      <div className="flex-1">
                        <p className="whitespace-pre-wrap text-xs leading-[1.55] text-foreground">{f.detail}</p>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="px-3.5 py-3 text-sm text-muted-foreground">Run Generate to scan for hardcoded values or configuration issues.</div>
            )
          ) : externalSession.mode === "summary" ? (
            externalSession.sumError ? (
              <div className="m-3.5 rounded-md border border-destructive bg-diff-del-bg p-4 text-sm text-destructive">
                {externalSession.sumError}
              </div>
            ) : externalSession.sumLoading ? (
              <div className="flex h-full flex-col items-center justify-center space-y-5 py-10 text-center text-foreground">
                <div className="relative h-16 w-16">
                  <div className="absolute inset-0 rounded-md bg-surface-2 animate-pulse" />
                  <div className="absolute inset-0 rounded-md border border-border" />
                  <div className="absolute left-2 right-2 top-3 h-2 rounded bg-surface-2 animate-[shimmer_1.5s_ease_infinite]" />
                  <div className="absolute left-2 right-4 top-6 h-2 rounded bg-surface-2 animate-[shimmer_1.6s_ease_infinite]" />
                  <div className="absolute left-2 right-8 top-9 h-2 rounded bg-surface-2 animate-[shimmer_1.7s_ease_infinite]" />
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
              <p className="whitespace-pre-wrap px-3.5 py-3 text-sm leading-relaxed text-foreground">{externalSession.summaryText}</p>
            ) : (
              <div className="px-3.5 py-3 text-sm text-muted-foreground">Click Generate to produce a concise overview.</div>
            )
          ) : (
            <div className="h-full p-3.5">
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
