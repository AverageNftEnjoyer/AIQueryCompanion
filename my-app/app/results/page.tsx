// /app/results.tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MiniMap } from "@/components/minimap";
import {
  Home,
  Bell,
  BellOff,
  Zap,
  AlertCircle,
  BarChart3,
  ChevronDown,
  Loader2,
  Link2,
  Sun,
  Moon,
  Send,
} from "lucide-react";
import { QueryComparison, type QueryComparisonHandle } from "@/components/query-comparison";
import { generateQueryDiff, canonicalizeSQL, type ComparisonResult } from "@/lib/query-differ";
import ChatPanel from "@/components/chatpanel";

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";
type GoodBad = "good" | "bad";
type Audience = "stakeholder" | "developer";
type AnalysisMode = "fast" | "expert";

interface AnalysisResult {
  summary: string;
  changes: Array<{
    type: ChangeType;
    description: string;
    explanation: string;
    lineNumber: number;
    side: Side;
    syntax: GoodBad;
    performance: GoodBad;
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

const MAX_QUERY_CHARS = 120_000;

const gridBg = (
  <div className="pointer-events-none absolute inset-0 opacity-90">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(120,119,198,0.08),transparent_60%),radial-gradient(ellipse_at_bottom,_rgba(16,185,129,0.08),transparent_60%)]" />
    <div className="absolute inset-0 mix-blend-overlay bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(255,255,255,0.04)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(255,255,255,0.04)_24px)]" />
  </div>
);
const gridBgLight = (
  <div className="pointer-events-none absolute inset-0 opacity-80">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(0,0,0,0.035),transparent_60%),radial-gradient(ellipse_at_bottom,_rgba(0,0,0,0.035),transparent_60%)]" />
    <div className="absolute inset-0 mix-blend-overlay bg-[repeating-linear-gradient(0deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px),repeating-linear-gradient(90deg,transparent,transparent_23px,rgba(0,0,0,0.03)_24px)]" />
  </div>
);

function deriveDisplayChanges(analysis: AnalysisResult | null) {
  if (!analysis) return [];
  return analysis.changes.slice().sort((a, b) => (a.lineNumber ?? 0) - (b.lineNumber ?? 0));
}

function toMiniChanges(analysis: AnalysisResult | null) {
  if (!analysis) return [];
  return analysis.changes.map((c) => ({
    type: c.type,
    side: c.side,
    lineNumber: c.lineNumber,
    span: c.span ?? 1,
    label: c.description,
  }));
}

function FancyLoader({ isLight }: { isLight: boolean }) {
  const messages = [
    "Generating semantic diff, risk notes, and explanations…",
    "Analyzing SQL syntax and detecting anomalies…",
    "Measuring potential performance impact of changes…",
    "Evaluating best practices and optimization hints…",
    "Assessing overall query risk level and stability…",
    "Scanning subqueries and nested joins for complexity…",
    "Checking index usage and key distribution…",
    "Reviewing SELECT, WHERE, and JOIN clauses for efficiency…",
    "Validating grouping, ordering, and aggregation logic…",
    "Cross-referencing schema metadata and column types…",
    "Compiling final report with recommendations and risk score…",
  ];

  const [index, setIndex] = useState(0);
  const [fading, setFading] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    const tick = () => {
      setFading(true);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        setIndex((i) => (i + 1) % messages.length);
        setFading(false);
      }, 250);
    };
    const id = window.setInterval(tick, 4000);
    tick();
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      window.clearInterval(id);
    };
  }, []);

  const barBase = "rounded-sm animate-bounce";
  const barShade1 = isLight ? "bg-gray-800" : "bg-white/90";
  const barShade2 = isLight ? "bg-gray-700" : "bg-white/80";
  const barShade3 = isLight ? "bg-gray-600" : "bg-white/70";

  const cardBg = isLight ? "bg-black/5 border-black/10" : "bg-white/5 border-white/10";
  const pulseBg = isLight ? "bg-black/10" : "bg-white/10";
  const textColor = isLight ? "text-gray-700" : "text-white/70";

  return (
    <div className="w-full flex flex-col items-center justify-center py-16">
      <div className="flex items-end gap-1.5 mb-6">
        <span className={`w-2 h-5 ${barShade1} ${barBase}`} />
        <span className={`w-2 h-7 ${barShade2} ${barBase}`} style={{ animationDelay: "120ms" }} />
        <span className={`w-2 h-9 ${barShade3} ${barBase}`} style={{ animationDelay: "240ms" }} />
        <span className={`w-2 h-7 ${barShade2} ${barBase}`} style={{ animationDelay: "360ms" }} />
        <span className={`w-2 h-5 ${barShade1} ${barBase}`} style={{ animationDelay: "480ms" }} />
      </div>

      <div className={`w-full max-w-3xl rounded-xl border ${cardBg} backdrop-blur p-6`}>
        <div className={`h-4 w-40 ${pulseBg} rounded mb-4 animate-pulse`} />
        <div className="space-y-2">
          <div className={`h-3 w-full ${pulseBg} rounded animate-pulse`} />
          <div className={`h-3 w-[92%] ${pulseBg} rounded animate-pulse`} />
          <div className={`h-3 w-[84%] ${pulseBg} rounded animate-pulse`} />
        </div>
        <div className={`mt-6 flex items-center gap-2 ${textColor}`} aria-live="polite">
          <Zap className="w-4 h-4 animate-pulse" />
          <span className={`transition-opacity duration-300 ${fading ? "opacity-0" : "opacity-100"}`}>{messages[index]}</span>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const [oldQuery, setOldQuery] = useState<string>("");
  const [newQuery, setNewQuery] = useState<string>("");
  const [analysis, setAnalysis] = useState<AnalysisResult>({
    summary: "",
    changes: [],
    recommendations: [],
    riskAssessment: "Low",
    performanceImpact: "Neutral",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [analysisStarted, setAnalysisStarted] = useState(false); // gate for streaming explanations
  const startedRef = useRef(false);

  const doneAudioRef = useRef<HTMLAudioElement | null>(null);
  const switchAudioRef = useRef<HTMLAudioElement | null>(null);
  const miniClickAudioRef = useRef<HTMLAudioElement | null>(null);
  const cmpRef = useRef<QueryComparisonHandle>(null);
  const [typeFilter, setTypeFilter] = useState<ChangeType | "all">(
    (typeof window !== "undefined" && (localStorage.getItem("qa:typeFilter") as any)) || "all"
  );
  const [sideFilter, setSideFilter] = useState<Side | "all">(
    (typeof window !== "undefined" && (localStorage.getItem("qa:sideFilter") as any)) || "all"
  );

  const [syncEnabled, setSyncEnabled] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return localStorage.getItem("qa:syncScroll") !== "0";
  });

  const [audience, setAudience] = useState<Audience>("stakeholder");
  const [summaryStakeholder, setSummaryStakeholder] = useState<string>("");
  const [summaryDeveloper, setSummaryDeveloper] = useState<string>("");
  const [summarizing, setSummarizing] = useState<boolean>(false);
  const [loadingAudience, setLoadingAudience] = useState<Audience | null>(null);

  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("expert"); // Fast/Expert toggle

  const totalOldLines = useMemo(() => (oldQuery ? oldQuery.split("\n").length : 0), [oldQuery]);
  const totalNewLines = useMemo(() => (newQuery ? newQuery.split("\n").length : 0), [newQuery]);

  const allMiniChanges = useMemo(() => toMiniChanges(analysis), [analysis]);
  const miniOld = useMemo(() => allMiniChanges.filter((c) => c.side === "old"), [allMiniChanges]);
  const miniNew = useMemo(() => allMiniChanges.filter((c) => c.side !== "old"), [allMiniChanges]);

  const summaryRef = useRef<HTMLDivElement | null>(null);
  const summaryHeaderRef = useRef<HTMLHeadingElement | null>(null);
  const summarizeAbortRef = useRef<AbortController | null>(null);

  const [soundOn, setSoundOn] = useState(true);
  const [lightUI, setLightUI] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    const saved = localStorage.getItem("qa:lightUI");
    return saved === "1";
  });
  const analysisDoneSoundPlayedRef = useRef(false);
  const resumeHandlerRef = useRef<((e?: any) => void) | null>(null);
  const clearResumeHandler = () => {
    if (resumeHandlerRef.current) {
      window.removeEventListener("pointerdown", resumeHandlerRef.current);
      window.removeEventListener("keydown", resumeHandlerRef.current);
      resumeHandlerRef.current = null;
    }
  };

  const scrollChatToBottom = () => {}; // no-op (chat is now isolated in ChatPanel)

  const playSfx = (ref: React.RefObject<HTMLAudioElement>) => {
    if (!soundOn) return;
    const el = ref.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = 0.5;
      el.play().catch(() => {});
    } catch {}
  };

  const playMiniClick = () => {
    if (!soundOn) return;
    const el = miniClickAudioRef.current;
    if (!el) return;
    try {
      el.muted = false;
      el.pause();
      el.currentTime = 0;
      el.volume = 0.6;
      el.play().catch(() => {});
    } catch {}
  };

  const playDoneSound = async () => {
    if (!soundOn) return;
    const el = doneAudioRef.current;
    if (!el) return;
    try {
      clearResumeHandler();
      el.pause();
      el.currentTime = 0;
      el.volume = 0.5;
      await el.play();
    } catch {
      const resume = () => {
        el!.play().finally(() => {
          clearResumeHandler();
        });
      };
      resumeHandlerRef.current = resume;
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
    }
  };

  // ===== INITIAL LOAD: load queries and PREPARE CHANGES ONLY (no summaries, no explanations) =====
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const raw = typeof window !== "undefined" ? sessionStorage.getItem("qa:payload") : null;
    if (!raw) {
      router.push("/");
      return;
    }

    let parsed: { oldQuery: string; newQuery: string } | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      router.push("/");
      return;
    }
    if (!parsed?.oldQuery || !parsed?.newQuery) {
      router.push("/");
      return;
    }
    if (parsed.oldQuery.length > MAX_QUERY_CHARS || parsed.newQuery.length > MAX_QUERY_CHARS) {
      setError(`Queries exceed ${MAX_QUERY_CHARS.toLocaleString()} characters. Please shorten and retry.`);
      setLoading(false);
      return;
    }

    setOldQuery(parsed.oldQuery);
    setNewQuery(parsed.newQuery);

    (async () => {
      setLoading(false);

      const canonOld = canonicalizeSQL(parsed!.oldQuery);
      const canonNew = canonicalizeSQL(parsed!.newQuery);

      // === PREPARE CHANGES ONLY (no explanations yet) ===
      try {
        const PAGE_SIZE = 24;
        const prepRes = await fetch(`/api/analyze?cursor=0&limit=${PAGE_SIZE}&prepOnly=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldQuery: canonOld, newQuery: canonNew }),
        });
        const prepData = await prepRes.json().catch(() => ({}));
        if (!prepRes.ok) throw new Error((prepData as any)?.error || `Prep failed (${prepRes.status})`);

        let placeholders = (prepData?.analysis?.changes ?? []) as AnalysisResult["changes"];
        let nextCursor: number | null = prepData?.page?.nextCursor ?? null;
        while (nextCursor !== null) {
          const r = await fetch(`/api/analyze?cursor=${nextCursor}&limit=${PAGE_SIZE}&prepOnly=1`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oldQuery: canonOld, newQuery: canonNew }),
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error((j as any)?.error || `Prep page failed (${r.status})`);
          placeholders = placeholders.concat(j?.analysis?.changes ?? []);
          nextCursor = j?.page?.nextCursor ?? null;
        }

        // Keep explanations flagged as pending — UI will show placeholders until "Generate Analysis"
        const prepared = placeholders.map((c) => ({
          ...c,
          explanation: "Pending…",
        }));

        const byIndex = new Map<number, AnalysisResult["changes"][number]>();
        for (const c of prepared) if (typeof c.index === "number") byIndex.set(c.index, c);
        const mergedPlaceholders = Array.from(byIndex.values()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

        setAnalysis((prev) => ({
          ...prev,
          summary: "Analysis is ready. Click “Generate Analysis” (Fast/Expert) to stream detailed explanations.",
          changes: mergedPlaceholders,
        }));
      } catch (e: any) {
        setError(e?.message || "Unexpected error");
      }
    })();
  }, [router]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sound toggles & persistence
  useEffect(() => {
    const audios = [doneAudioRef.current, switchAudioRef.current, miniClickAudioRef.current].filter(Boolean) as HTMLAudioElement[];
    audios.forEach((a) => (a.muted = !soundOn));
    if (!soundOn) {
      audios.forEach((a) => {
        try {
          a.pause();
          a.currentTime = 0;
        } catch {}
      });
      clearResumeHandler();
    }
  }, [soundOn]);

  useEffect(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("qa:soundOn") : null;
    if (saved === "0") setSoundOn(false);
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("qa:typeFilter", typeFilter);
  }, [typeFilter]);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("qa:sideFilter", sideFilter);
  }, [sideFilter]);

  // NOTE: Removed the global "auto play when streaming ends" effect to avoid double chimes.

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("qa:audience", audience);
  }, [audience]);

  const canonicalOld = useMemo(() => (oldQuery ? canonicalizeSQL(oldQuery) : ""), [oldQuery]);
  const canonicalNew = useMemo(() => (newQuery ? canonicalizeSQL(newQuery) : ""), [newQuery]);

  const stats = useMemo(() => {
    if (!canonicalOld || !canonicalNew) return null;
    const diff: ComparisonResult = generateQueryDiff(canonicalOld, canonicalNew);
    return diff.stats;
  }, [canonicalOld, canonicalNew]);

  const displayChanges = useMemo(() => {
    const items = deriveDisplayChanges(analysis);
    return items.filter(
      (chg) => (typeFilter === "all" || chg.type === typeFilter) && (sideFilter === "all" || chg.side === sideFilter)
    );
  }, [analysis, typeFilter, sideFilter]);

  // ===== Summary fetcher (manual only) =====
  async function fetchSummary(forAudience: Audience) {
    if (summarizeAbortRef.current) summarizeAbortRef.current.abort();
    summarizeAbortRef.current = new AbortController();

    setSummarizing(true);
    setLoadingAudience(forAudience);
    try {
      const res = await fetch(`/api/summarize?audience=${forAudience}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newQuery: canonicalNew,
          analysis,
          audience: forAudience,
        }),
        signal: summarizeAbortRef.current.signal,
      });
      if (res.ok) {
        const data = await res.json();
        const t = String(data?.tldr || "");
        if (forAudience === "stakeholder") setSummaryStakeholder(t);
        else setSummaryDeveloper(t);
        setTimeout(() => {
          summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          summaryHeaderRef.current?.focus();
        }, 100);
      } else {
        const fallback =
          "This query prepares a concise business-facing dataset. It selects and joins the core tables, filters to the scope that matters for reporting, and applies grouping or ordering to make totals and trends easy to read. The output is intended for dashboards or scheduled reports and supports day-to-day monitoring and planning. Data is expected to be reasonably fresh and to run within normal batch windows.";
        if (forAudience === "stakeholder") setSummaryStakeholder(fallback);
        else setSummaryDeveloper(fallback);
        setTimeout(() => {
          summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          summaryHeaderRef.current?.focus();
        }, 100);
      }
      // (Removed playDoneSound for summaries)
    } catch (e: any) {
      if (e?.name !== "AbortError") {
        const fallback =
          "This query prepares a concise business-facing dataset. It selects and joins the core tables, filters to the scope that matters for reporting, and applies grouping or ordering to make totals and trends easy to read. The output is intended for dashboards or scheduled reports and supports day-to-day monitoring and planning. Data is expected to be reasonably fresh and to run within normal batch windows.";
        if (forAudience === "stakeholder") setSummaryStakeholder(fallback);
        else setSummaryDeveloper(fallback);
        setTimeout(() => {
          summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
          summaryHeaderRef.current?.focus();
        }, 100);
        // (Removed playDoneSound for summaries)
      }
    } finally {
      setSummarizing(false);
      setLoadingAudience(null);
    }
  }

  const handleSwitchAudience = async (nextAudience: Audience) => {
    setAudience(nextAudience);
    playSfx(switchAudioRef); // use switch sound on toggle
    // Do not auto-generate; user must click "Generate Summary"
    setTimeout(() => {
      summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      summaryHeaderRef.current?.focus();
    }, 80);
  };

  const currentSummary = audience === "stakeholder" ? summaryStakeholder : summaryDeveloper;

  const handleToggleSync = () => {
    setSyncEnabled((v) => {
      const next = !v;
      if (typeof window !== "undefined") localStorage.setItem("qa:syncScroll", next ? "1" : "0");
      playSfx(switchAudioRef);
      return next;
    });
  };

  const toggleLightUI = () => {
    setLightUI((v) => {
      const next = !v;
      if (typeof window !== "undefined") localStorage.setItem("qa:lightUI", next ? "1" : "0");
      return next;
    });
    playSfx(switchAudioRef);
  };

  const handleToggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") localStorage.setItem("qa:soundOn", next ? "1" : "0");
      if (next) {
        const el = switchAudioRef.current;
        if (el) {
          try {
            el.muted = false;
            el.pause();
            el.currentTime = 0;
            el.volume = 0.5;
            el.play().catch(() => {});
          } catch {}
        }
      } else {
        clearResumeHandler();
        [doneAudioRef.current, switchAudioRef.current, miniClickAudioRef.current].forEach((a) => {
          try {
            if (a) {
              a.muted = true;
              a.pause();
              a.currentTime = 0;
            }
          } catch {}
        });
      }
      return next;
    });
  };

  const isLight = lightUI;
  const pageBgClass = isLight ? "bg-slate-100 text-slate-900" : "bg-neutral-950 text-white";
  const headerBgClass = isLight
    ? "bg-slate-50/95 border-slate-200 text-slate-900 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
    : "bg-black/30 border-white/10 text-white";
  const chipText = isLight ? "text-slate-700" : "text-white/80";

  // ===== Generate Analysis handler (streams detailed explanations) =====
  const runAnalysis = async () => {
    if (streaming) return;
    if (!canonicalOld || !canonicalNew) return;

    setAnalysisStarted(true);
    analysisDoneSoundPlayedRef.current = false; // reset completion chime
    setStreaming(true);
    setError(null);

    try {
      const PAGE_SIZE = 24;

      // Re-prep (safe) to get total page count
      const prepRes = await fetch(`/api/analyze?cursor=0&limit=${PAGE_SIZE}&prepOnly=1&mode=${analysisMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldQuery: canonicalOld, newQuery: canonicalNew }),
      });
      const prepData = await prepRes.json().catch(() => ({}));
      if (!prepRes.ok) throw new Error((prepData as any)?.error || `Prep failed (${prepRes.status})`);

      const total = prepData?.page?.total ?? 0;

      let placeholders = (prepData?.analysis?.changes ?? []) as AnalysisResult["changes"];
      let nextCursor: number | null = prepData?.page?.nextCursor ?? null;
      while (nextCursor !== null) {
        const r = await fetch(`/api/analyze?cursor=${nextCursor}&limit=${PAGE_SIZE}&prepOnly=1&mode=${analysisMode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldQuery: canonicalOld, newQuery: canonicalNew }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((j as any)?.error || `Prep page failed (${r.status})`);
        placeholders = placeholders.concat(j?.analysis?.changes ?? []);
        nextCursor = j?.page?.nextCursor ?? null;
      }

      const byIndex = new Map<number, AnalysisResult["changes"][number]>();
      for (const c of placeholders) if (typeof c.index === "number") byIndex.set(c.index, c);
      const mergedPlaceholders = Array.from(byIndex.values()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));

      setAnalysis((prev) => ({
        ...prev,
        summary: `Streaming ${total} changes… 0 explained.`,
        changes: mergedPlaceholders,
      }));

      for (let i = 0; i < total; i++) {
        const r = await fetch(`/api/analyze?mode=item&index=${i}&analysisMode=${analysisMode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldQuery: canonicalOld, newQuery: canonicalNew }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) continue;

        const [incoming] = j?.analysis?.changes ?? [];
        if (!incoming || typeof incoming.index !== "number") continue;

        setAnalysis((prev) => {
          const map = new Map<number, AnalysisResult["changes"][number]>();
          for (const c of prev.changes) if (typeof c.index === "number") map.set(c.index, c);
          map.set(incoming.index, incoming);
          const merged = Array.from(map.values()).sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
          const done = merged.filter((m) => m.explanation && m.explanation !== "Pending…").length;
          return { ...prev, summary: `Streaming ${total} changes… ${done} explained.`, changes: merged };
        });

        await new Promise((res) => setTimeout(res, 0));
      }

      setStreaming(false);

      // ✅ Play "done" sound exactly once, only after ALL items complete
      if (!analysisDoneSoundPlayedRef.current) {
        analysisDoneSoundPlayedRef.current = true;
        playDoneSound();
      }
    } catch (e: any) {
      setStreaming(false);
      setError(e?.message || "Unexpected error");
    }
  };

  return (
    <div className={`min-h-screen relative ${pageBgClass}`}>
      {isLight ? gridBgLight : gridBg}

      <header className={`relative z-10 border ${headerBgClass} backdrop-blur`}>
        <div className="mx-auto w-full max-w-[1800px] px-3 md:px-4 lg:px-6 py-4">
          <div className="grid grid-cols-3 items-center gap-3">
            {/* Left: Home */}
            <div className="flex">
              <Link
                href="/"
                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg transition border ${
                  isLight
                    ? "bg-black/5 hover:bg-black/10 border-black/10 text-gray-700"
                    : "bg-white/5 hover:bg-white/10 border-white/10 text-white"
                }`}
              >
                <Home className="w-5 h-5" />
              </Link>
            </div>

            {/* Center: Title */}
            <div className="flex items-center justify-center">
              <span className={`inline-flex items-center gap-2 ${isLight ? "text-gray-700" : "text-white"}`}>
                <BarChart3 className="w-5 h-5" />
                <span className="font-heading font-semibold text-lg">AI-Powered Query Companion</span>
              </span>
            </div>

            {/* Right Controls */}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleToggleSync}
                title="Toggle synced scrolling"
                className={`relative p-2 rounded-full transition ${isLight ? "hover:bg-black/10" : "hover:bg-white/10"}`}
              >
                <Link2
                  className={`h-5 w-5 transition ${
                    isLight ? (syncEnabled ? "text-gray-700" : "text-gray-400") : syncEnabled ? "text-white" : "text-white/60"
                  }`}
                />
              </button>

              <button
                type="button"
                onClick={toggleLightUI}
                title={isLight ? "Switch to Dark Background" : "Switch to Light Background"}
                className={`relative p-2 rounded-full transition ${isLight ? "hover:bg-black/10" : "hover:bg-white/10"}`}
              >
                {isLight ? <Sun className="h-5 w-5 text-gray-700" /> : <Moon className="h-5 w-5 text-white" />}
              </button>

              <button
                type="button"
                onClick={handleToggleSound}
                aria-pressed={soundOn}
                title={soundOn ? "Mute sounds" : "Enable sounds"}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition border border-transparent ${
                  isLight ? "hover:bg-black/10" : "hover:bg-white/10"
                } focus:outline-none focus-visible:ring-0`}
              >
                {soundOn ? (
                  <Bell className={`h-5 w-5 ${isLight ? "text-gray-700" : "text-white"}`} />
                ) : (
                  <BellOff className={`h-5 w-5 ${isLight ? "text-gray-400" : "text-white/60"}`} />
                )}
                <span className="sr-only">{soundOn ? "Mute sounds" : "Enable sounds"}</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10">
        <audio ref={doneAudioRef} src="/loadingdone.mp3" preload="metadata" muted={!soundOn} />
        <audio ref={switchAudioRef} src="/switch.mp3" preload="metadata" muted={!soundOn} />
        <audio ref={miniClickAudioRef} src="/minimapbar.mp3" preload="metadata" muted={!soundOn} />

        <div className="mx-auto w-full max-w-[1800px] px-3 md:px-4 lg:px-6 pt-2 pb-24 md:pb-10">
          {loading && !error && <FancyLoader isLight={isLight} />}

          {!loading && error && (
            <Alert className={`${isLight ? "bg-white border-red-500/40" : "bg-black/40"} backdrop-blur text-inherit`}>
              <AlertCircle className={`w-5 h-5 ${isLight ? "text-red-600" : "text-red-400"}`} />
              <AlertDescription className="flex-1">
                <strong className={isLight ? "text-red-700" : "text-red-300"}>Error:</strong> {error}
              </AlertDescription>
              <Button
                asChild
                variant="outline"
                className={`${
                  isLight ? "border-black/20 text-gray-900 hover:bg-black/10" : "border-white/20 text-white/90 hover:bg-white/10"
                }`}
              >
                <Link href="/">Go Home</Link>
              </Button>
            </Alert>
          )}

          {!loading && !error && (
            <div className="space-y-8">
              {/* Stat chips */}
              {stats && (
                <section className="mt-0 mb-2">
                  <div className={`flex items-center justify-center gap-2 text-xs ${chipText}`}>
                    <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30">
                      {stats.additions} additions
                    </span>
                    <span className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30">
                      {stats.modifications} modifications
                    </span>
                    <span className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30">
                      {stats.deletions} deletions
                    </span>
                    <span className={`px-2 py-1 rounded ${isLight ? "bg-black/5 border-black/15" : "bg-white/10 border-white/20"}`}>
                      {stats.unchanged} unchanged
                    </span>
                  </div>
                </section>
              )}

              {/* Diff + MiniMap */}
              <section className="mt-1">
                <div className="flex items-stretch gap-3 h-[72vh] md:h-[78vh] lg:h-[82vh] xl:h-[86vh] min-h-0">
                  {/* Query Comparison */}
                  <div className="flex-1 min-w-0 h-full rounded-xl overflow-hidden">
                    <QueryComparison ref={cmpRef} oldQuery={oldQuery} newQuery={newQuery} showTitle={false} syncScrollEnabled={syncEnabled} />
                  </div>
                  {/* Dual minimaps */}
                  <div className="hidden lg:flex h-full items-stretch gap-2">
                    {/* OLD minimap */}
                    <MiniMap
                      totalLines={totalOldLines}
                      changes={miniOld}
                      forceSide="old"
                      onJump={({ line }) => cmpRef.current?.scrollTo({ side: "old", line })}
                      className={`w-6 h-full rounded-md
                          ${
                            isLight
                              ? "bg-white border border-black ring-2 ring-black/30 hover:ring-black/40"
                              : "bg-white/5 border border-white/10 hover:border-white/20"
                          }`}
                      soundEnabled={soundOn}
                    />

                    {/* NEW minimap */}
                    <MiniMap
                      totalLines={totalNewLines}
                      changes={miniNew}
                      forceSide="new"
                      onJump={({ line }) => cmpRef.current?.scrollTo({ side: "new", line })}
                      className={`w-6 h-full rounded-md
                          ${
                            isLight
                              ? "bg-white border border-black ring-2 ring-black/30 hover:ring-black/40"
                              : "bg-white/5 border border-white/10 hover:border-white/20"
                          }`}
                      soundEnabled={soundOn}
                    />
                  </div>
                </div>
                <div className={`relative z-20 flex items-center justify-center text-xs mt-3 ${isLight ? "text-gray-500" : "text-white/60"}`}>
                  <ChevronDown className="w-4 h-4 mr-1 animate-bounce" />
                  Scroll for Changes & AI Analysis
                </div>
              </section>

              {/* Lower panels: (Changes, Summary) | (AI Analysis, Query Companion) */}
              <section className="mt-6 md:mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                {/* LEFT COLUMN */}
                <div className="space-y-5 sm:space-y-6 md:space-y-8">
                  <Card className="bg-white border-slate-200 ring-1 ring-black/5 shadow-[0_1px_0_rgba(0,0,0,0.05),0_10px_30px_rgba(0,0,0,0.10)] dark:ring-0 dark:border-gray-200 dark:shadow-lg">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-slate-900 font-semibold">Changes</h3>
                        <div className="flex items-center gap-2">
                          {(typeFilter !== "all" || sideFilter !== "all") && (
                            <button
                              type="button"
                              onClick={() => {
                                setTypeFilter("all");
                                setSideFilter("all");
                              }}
                              className="h-8 px-3 text-sm rounded border border-gray-300 bg-white text-black"
                              title="Clear filters"
                            >
                              Clear
                            </button>
                          )}
                          <label className="sr-only" htmlFor="typeFilter">
                            Filter by type
                          </label>
                          <select
                            id="typeFilter"
                            className="h-8 px-2 rounded border border-gray-300 text-sm bg-white text-black"
                            value={typeFilter}
                            onChange={(e) => setTypeFilter(e.target.value as any)}
                            title="Filter by type"
                          >
                            <option value="all">All Types</option>
                            <option value="addition">Additions</option>
                            <option value="modification">Modifications</option>
                            <option value="deletion">Deletions</option>
                          </select>

                          <label className="sr-only" htmlFor="sideFilter">
                            Filter by side
                          </label>
                          <select
                            id="sideFilter"
                            className="h-8 px-2 rounded border border-gray-300 text-sm bg-white text-black"
                            value={sideFilter}
                            onChange={(e) => setSideFilter(e.target.value as any)}
                            title="Filter by side"
                          >
                            <option value="all">Both</option>
                            <option value="old">Old only</option>
                            <option value="new">New only</option>
                          </select>
                        </div>
                      </div>

                      <div className="h-[28rem] scroll-overlay focus:outline-none pr-3" tabIndex={0}>
                        {displayChanges.length > 0 ? (
                          <div className="space-y-3">
                            {displayChanges.map((chg, index) => {
                              const jumpSide: "old" | "new" | "both" =
                                chg.side === "both" ? "both" : chg.side === "old" ? "old" : "new";
                              return (
                                <button
                                  key={index}
                                  className="group w-full text-left bg-gray-50 border border-gray-200 rounded-lg p-3 cursor-pointer transition hover:bg-amber-50 hover:border-amber-300 hover:shadow-sm active:bg-amber-100 active:border-amber-300 focus:outline-none focus:ring-0"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    playMiniClick();
                                    cmpRef.current?.scrollTo({ side: jumpSide, line: chg.lineNumber });
                                    window.scrollTo({ top: 0, behavior: "smooth" });
                                    (e.currentTarget as HTMLButtonElement).blur();
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                      e.preventDefault();
                                      playMiniClick();
                                      cmpRef.current?.scrollTo({ side: jumpSide, line: chg.lineNumber });
                                      (e.currentTarget as HTMLButtonElement).blur();
                                    }
                                  }}
                                >
                                  <div className="flex items-center gap-2 mb-2">
                                    <span
                                      className={`px-2 py-1 rounded text-xs font-medium transition ${
                                        chg.type === "addition"
                                          ? "bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200"
                                          : chg.type === "deletion"
                                          ? "bg-rose-100 text-rose-700 group-hover:bg-rose-200"
                                          : "bg-amber-100 text-amber-700 group-hover:bg-amber-200"
                                      }`}
                                    >
                                      {chg.type}
                                    </span>
                                    <span className="text-xs text-gray-500">
                                      {chg.side} · line {chg.lineNumber}
                                    </span>
                                  </div>
                                  <p className="text-gray-800 text-sm">{chg.description}</p>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="flex items-center justify-center h-full text-gray-500">
                            <p>No changes detected.</p>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>

                  {/* ===== Summary Card (manual generation only) ===== */}
                  <Card ref={summaryRef} className="mt-4 sm:mt-5 md:mt-0 scroll-mt-24 bg-slate-50 border-slate-200 shadow-lg">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 ref={summaryHeaderRef} tabIndex={-1} className="text-slate-900 font-semibold focus:outline-none">
                          Summary
                        </h3>

                        {/* Controls: Generate Summary + audience toggle */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fetchSummary(audience)}
                            disabled={summarizing || !!loadingAudience}
                            title="Generate summary"
                            className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-gray-300 bg-gray-100 text-gray-900 shadow-sm hover:bg-white transition disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {summarizing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            <span className="text-sm">Generate Summary</span>
                          </button>

                          <div className="inline-flex rounded-full border border-gray-300 bg-gray-100 p-0.5">
                            <button
                              type="button"
                              onClick={() => handleSwitchAudience("stakeholder")}
                              disabled={loadingAudience === "stakeholder"}
                              className={`px-3 h-8 rounded-full text-sm transition
                                ${audience === "stakeholder" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"}
                              `}
                              title="Stakeholder-friendly summary"
                            >
                              {loadingAudience === "stakeholder" ? (
                                <span className="inline-flex items-center gap-1">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Stakeholder
                                </span>
                              ) : (
                                "Stakeholder"
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSwitchAudience("developer")}
                              disabled={loadingAudience === "developer"}
                              className={`px-3 h-8 rounded-full text-sm transition
                                ${audience === "developer" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"}
                              `}
                              title="Developer-focused summary"
                            >
                              {loadingAudience === "developer" ? (
                                <span className="inline-flex items-center gap-1">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Developer
                                </span>
                              ) : (
                                "Developer"
                              )}
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="min-h-[28rem] bg-gray-50 border border-gray-200 rounded-lg p-4">
                        {!currentSummary && (summarizing || loadingAudience) ? (
                          <div className="space-y-4">
                            <div className="inline-flex items-center gap-2 text-gray-700">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>Generating {audience} summary…</span>
                            </div>
                            <div className="space-y-2">
                              <div className="h-3 w-full bg-gray-200 rounded animate-pulse" />
                              <div className="h-3 w-[92%] bg-gray-200 rounded animate-pulse" />
                              <div className="h-3 w-[88%] bg-gray-200 rounded animate-pulse" />
                              <div className="h-3 w-[80%] bg-gray-200 rounded animate-pulse" />
                            </div>
                          </div>
                        ) : currentSummary ? (
                          <p className="text-gray-800 text-sm leading-relaxed">{currentSummary}</p>
                        ) : (
                          <div className="text-gray-600 text-sm">The {audience} summary will appear here.</div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* RIGHT COLUMN */}
                <div className="space-y-5 sm:space-y-6 md:space-y-8">
                  {/* AI Analysis */}
                  <Card className="bg-white border-slate-200 ring-1 ring-black/5 shadow-[0_1px_0_rgba(0,0,0,0.05),0_10px_30px_rgba(0,0,0,0.10)] dark:ring-0 dark:border-gray-200 dark:shadow-lg">
                    <CardContent className="p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-slate-900 font-semibold">
                          AI Analysis {streaming && <span className="text-xs text-gray-500 ml-2">• In Progress..</span>}
                        </h3>

                        {/* Controls — Generate Analysis button + Fast/Expert toggle */}
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={runAnalysis}
                            disabled={streaming || !canonicalNew}
                            title="Generate analysis"
                            className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-gray-300 bg-gray-100 text-gray-900 shadow-sm hover:bg-white transition disabled:opacity-60 disabled:cursor-not-allowed"
                          >
                            {streaming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            <span className="text-sm">Generate Analysis</span>
                          </button>

                          <div className="inline-flex rounded-full border border-gray-300 bg-gray-100 p-0.5">
                            <button
                              type="button"
                              onClick={() => {
                                setAnalysisMode("fast");
                                playSfx(switchAudioRef);
                              }}
                              className={`px-3 h-8 rounded-full text-sm transition ${
                                analysisMode === "fast" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
                              }`}
                              title="Fast mode (quick pass)"
                            >
                              Fast
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAnalysisMode("expert");
                                playSfx(switchAudioRef);
                              }}
                              className={`px-3 h-8 rounded-full text-sm transition ${
                                analysisMode === "expert" ? "bg-white text-gray-900 shadow" : "text-gray-600 hover:text-gray-900"
                              }`}
                              title="Expert mode (deeper pass)"
                            >
                              Expert
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="h-[27.6rem] scroll-overlay focus:outline-none pr-3" tabIndex={0}>
                        <div className="space-y-4">
                          {displayChanges.length > 0 ? (
                            displayChanges.map((chg, index) => (
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
                                    {/* Before user runs analysis: show placeholder text per change */}
                                    {!analysisStarted ? (
                                      <p className="text-gray-700 text-sm">Generate Analysis for further details on this change.</p>
                                    ) : chg.explanation === "Pending…" ? (
                                      <div className="space-y-2" aria-busy="true" aria-live="polite">
                                        <div className="h-3 w-[95%] bg-gray-200 rounded animate-pulse" />
                                        <div className="h-3 w-[90%] bg-gray-200 rounded animate-pulse" />
                                        <div className="h-3 w-[88%] bg-gray-200 rounded animate-pulse" />
                                        <div className="h-3 w-[82%] bg-gray-200 rounded animate-pulse" />
                                      </div>
                                    ) : (
                                      <p className="text-gray-800 text-sm leading-relaxed">{chg.explanation}</p>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))
                          ) : (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-700">
                              <p className="leading-relaxed">{analysis.summary}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Query Companion*/}
                  <Card className="bg-white border-slate-200 ring-1 ring-black/5 shadow dark:ring-0 dark:border-gray-200 dark:shadow-lg">
                    <CardContent className="p-0">
                      <ChatPanel
                          rawOld={oldQuery}
                          rawNew={newQuery}
                          changeCount={analysis?.changes?.length ?? 0}
                          stats={stats ?? null}
                        />
                    </CardContent>
                  </Card>
                </div>
              </section>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
