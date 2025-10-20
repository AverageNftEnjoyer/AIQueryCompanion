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
  ChevronDown,
  Loader2,
  Link2,
  Sun,
  Moon,
  Send,
} from "lucide-react";
import { QueryComparison, type QueryComparisonHandle } from "@/components/query-comparison";
import {
  generateQueryDiff,
  buildAlignedRows,
  renderHighlightedSQL,
  type ComparisonResult,
  type AlignedRow,
} from "@/lib/query-differ";
import ChatPanel from "@/components/chatpanel";
import AnalysisPanel from "@/components/analysis";
import { useUserPrefs } from "@/hooks/user-prefs";
import { Changes } from "@/components/changes";

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";
type GoodBad = "good" | "bad";
type Audience = "stakeholder" | "developer";
type AnalysisMode = "fast" | "expert";
type Mode = "single" | "compare";

interface AnalysisResult {
  summary: string;
  changes: Array<{
    type: ChangeType;
    description: string;
    explanation: string;
    lineNumber: number; // start line (API already grouped if needed)
    side: Side;
    syntax: GoodBad;
    performance: GoodBad;
    span?: number; // present for grouped runs
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

function SingleQueryView({ query, isLight }: { query: string; isLight: boolean }) {
  const lines = useMemo(() => {
    const t = query.endsWith("\n") ? query.slice(0, -1) : query;
    return t ? t.split("\n") : [];
  }, [query]);

  return (
    <div className="flex-1 min-w-0 h-full rounded-xl overflow-hidden">
      <Card
        className={`h-full ${isLight ? "bg-white border-slate-200" : "bg-white border-slate-200"} ring-1 ring-black/5 shadow-[0_1px_0_rgba(0,0,0,0.05),0_10px_30px_rgba(0,0,0,0.10)]`}
      >
        <CardContent className="p-5 h-full min-h-0 flex flex-col">
          <div
            className="flex-1 min-h-0 rounded-lg border border-slate-200 bg-slate-50 overflow-auto hover-scroll focus:outline-none"
            style={{ scrollbarGutter: "stable" }}
          >
            <div
              className="
                relative w-max min-w-full
                p-2
                font-mono
                text-[12px]
                leading-[1.22]
                text-slate-800
              "
              style={{
                fontVariantLigatures: "none",
                MozTabSize: 4 as unknown as string,
                OTabSize: 4 as unknown as string,
                tabSize: 4 as unknown as string,
              }}
            >
              {lines.length ? (
                lines.map((line, idx) => (
                  <div key={idx} className="group flex items-start gap-2 px-2 py-[2px] rounded">
                    <span className="sticky left-0 z-10 w-10 pr-2 text-right select-none text-slate-500 bg-transparent">
                      {idx + 1}
                    </span>
                    <code className="block whitespace-pre pr-2 leading-[1.22]">
                      {renderHighlightedSQL(line)}
                    </code>
                  </div>
                ))
              ) : (
                <div className="text-sm text-slate-500 p-2">No query provided.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
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
          <span className={`transition-opacity duration-300 ${fading ? "opacity-0" : "opacity-100"}`}>
            {messages[index]}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function ResultsPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("compare");
  const [singleQuery, setSingleQuery] = useState<string>("");

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
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const startedRef = useRef(false);

  const doneAudioRef = useRef<HTMLAudioElement | null>(null);
  const switchAudioRef = useRef<HTMLAudioElement | null>(null);
  const miniClickAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatbotAudioRef = useRef<HTMLAudioElement | null>(null);

  const cmpRef = useRef<QueryComparisonHandle>(null);
  const comparisonSectionRef = useRef<HTMLDivElement | null>(null); // scroll target (top of QueryComparison)

  // Preferences
  const { isLight, soundOn, syncEnabled, setIsLight, setSoundOn, setSyncEnabled } = useUserPrefs();

  // Filters (state held here; Changes component just receives values + callbacks)
  const [typeFilter, setTypeFilter] = useState<ChangeType | "all">("all");
  const [sideFilter, setSideFilter] = useState<Side | "all">("all");
  useEffect(() => {
    try {
      const tf = localStorage.getItem("qa:typeFilter");
      if (tf) setTypeFilter(tf as any);
      const sf = localStorage.getItem("qa:sideFilter");
      if (sf) setSideFilter(sf as any);
    } catch {}
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("qa:typeFilter", typeFilter);
  }, [typeFilter]);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("qa:sideFilter", sideFilter);
  }, [sideFilter]);

  // Summary stuff
  const [audience, setAudience] = useState<Audience>("stakeholder");
  const [summaryStakeholder, setSummaryStakeholder] = useState<string>("");
  const [summaryDeveloper, setSummaryDeveloper] = useState<string>("");
  const [summarizing, setSummarizing] = useState<boolean>(false);
  const [loadingAudience, setLoadingAudience] = useState<Audience | null>(null);

  const [analysisMode, setAnalysisMode] = useState<AnalysisMode>("expert");
  const summaryRef = useRef<HTMLDivElement | null>(null);
  const summaryHeaderRef = useRef<HTMLHeadingElement | null>(null);
  const summarizeAbortRef = useRef<AbortController | null>(null);
const SUSTAIN_MS = 4000; // how long to keep the solid highlight

const jumpAndFlash = (side: "old" | "new" | "both", line: number) => {
  // Always scroll page to the comparison (muted or not)
  comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });

  // Jump in the viewer (use new side when 'both')
  const targetSide = side === "both" ? "new" : side;
  cmpRef.current?.scrollTo({ side: targetSide, line });

  // One-time flash (no looping → no flicker)
  cmpRef.current?.flashRange?.(targetSide, line, line);

  // Persist a solid highlight for ~4s without re-triggering flash
  // (relies on your QueryComparison rendering data attrs; adjust selectors if needed)
  requestAnimationFrame(() => {
    const el =
      (document.querySelector(`[data-qc-side="${targetSide}"][data-line="${line}"]`) as HTMLElement | null) ||
      (document.querySelector(`[data-side="${targetSide}"][data-line="${line}"]`) as HTMLElement | null);

    if (el) {
      el.classList.add("qa-persist-highlight");
      setTimeout(() => el.classList.remove("qa-persist-highlight"), SUSTAIN_MS);
    }
  });

  // Respect the bell for audio
  if (soundOn) playMiniClick();
};
  const analysisDoneSoundPlayedRef = useRef(false);

  const clearResumeHandler = (() => {
    let handler: ((e?: any) => void) | null = null;
    return () => {
      if (handler) {
        window.removeEventListener("pointerdown", handler);
        window.removeEventListener("keydown", handler);
        handler = null;
      }
    };
  })();

  const primeAutoplay = async (el: HTMLAudioElement) => {
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = 0.5;
      await el.play();
    } catch {
      const resume = () => {
        el.play().finally(() => {
          clearResumeHandler();
        });
      };
      // @ts-ignore
      (clearResumeHandler as any).handler = resume;
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
    }
  };

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
    await primeAutoplay(el);
  };

  const playChatbotSound = async () => {
    if (!soundOn) return;
    const el = chatbotAudioRef.current;
    if (!el) return;
    await primeAutoplay(el);
  };

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const raw = typeof window !== "undefined" ? sessionStorage.getItem("qa:payload") : null;
    if (!raw) {
      router.push("/");
      return;
    }

    type Payload =
      | { mode: "single"; singleQuery?: string; newQuery?: string; oldQuery?: string }
      | { mode: "compare"; oldQuery: string; newQuery: string };

    let parsed: Payload | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      router.push("/");
      return;
    }

    const normalizeEOL = (s: string) => s.replace(/\r\n/g, "\n");

    if (!parsed || (parsed as any).mode === "single") {
      const qRaw = String((parsed as any)?.singleQuery || (parsed as any)?.newQuery || "");
      const q = normalizeEOL(qRaw);
      if (!q || q.length > MAX_QUERY_CHARS) {
        router.push("/");
        return;
      }
      setMode("single");
      setSingleQuery(q);
      setNewQuery(q);
      setOldQuery("");
      setLoading(false);
      return;
    }

    // compare
    const o = normalizeEOL(String((parsed as any).oldQuery || ""));
    const n = normalizeEOL(String((parsed as any).newQuery || ""));
    if (!o || !n || o.length > MAX_QUERY_CHARS || n.length > MAX_QUERY_CHARS) {
      router.push("/");
      return;
    }
    setMode("compare");
    setOldQuery(o);
    setNewQuery(n);
    setLoading(false);

    // PREPARE CHANGES ONLY — server groups correctly; we render as-is
    (async () => {
      try {
        const PAGE_SIZE = 24;
        const prepRes = await fetch(`/api/analyze?cursor=0&limit=${PAGE_SIZE}&prepOnly=1`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldQuery: o, newQuery: n }), // RAW
        });
        const prepData = await prepRes.json().catch(() => ({}));
        if (!prepRes.ok) throw new Error((prepData as any)?.error || `Prep failed (${prepRes.status})`);

        let placeholders = (prepData?.analysis?.changes ?? []) as AnalysisResult["changes"];
        let nextCursor: number | null = prepData?.page?.nextCursor ?? null;
        while (nextCursor !== null) {
          const r = await fetch(`/api/analyze?cursor=${nextCursor}&limit=${PAGE_SIZE}&prepOnly=1`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ oldQuery: o, newQuery: n }), // RAW
          });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error((j as any)?.error || `Prep page failed (${r.status})`);
          placeholders = placeholders.concat(j?.analysis?.changes ?? []);
          nextCursor = j?.page?.nextCursor ?? null;
        }

        const prepared = placeholders.map((c) => ({ ...c, explanation: "Pending…" }));
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
  }, [router]);

  // Sound toggles & persistence
  useEffect(() => {
    const audios = [
      doneAudioRef.current,
      switchAudioRef.current,
      miniClickAudioRef.current,
      chatbotAudioRef.current,
    ].filter(Boolean) as HTMLAudioElement[];
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

    // 🔇 Also enforce mute for any third-party/internal <audio> tags that play minimapbar.mp3 (e.g., inside <Changes />)
    try {
      const allMini = Array.from(
        document.querySelectorAll<HTMLAudioElement>('audio[src$="minimapbar.mp3"], audio[src*="minimapbar.mp3"]')
      );
      allMini.forEach((a) => {
        a.muted = !soundOn;
        if (!soundOn) {
          try {
            a.pause();
            a.currentTime = 0;
          } catch {}
        }
      });
    } catch {}
  }, [soundOn]);

  // ---- Diff + aligned rows (SOURCE OF TRUTH for QueryComparison + MiniMaps)
  const comparison: ComparisonResult | null = useMemo(() => {
    if (mode !== "compare" || !oldQuery || !newQuery) return null;
    return generateQueryDiff(oldQuery, newQuery, { basis: "raw" });
  }, [mode, oldQuery, newQuery]);

  const alignedRows: AlignedRow[] = useMemo(() => {
    return comparison ? buildAlignedRows(comparison) : [];
  }, [comparison]);

  // Stats for chips
  const stats = useMemo(() => comparison?.stats ?? null, [comparison]);

  // --- Wrap cmpRef scrollTo to uniformly add sound, flash, and scroll up to the comparison area ---
  const scrollWrapperInstalled = useRef(false);
  useEffect(() => {
    const inst = cmpRef.current as any;
    if (!inst || scrollWrapperInstalled.current) return;

    const originalScrollTo = inst.scrollTo?.bind(inst);
    if (typeof originalScrollTo !== "function") return;

    inst.scrollTo = (opts: { side: "old" | "new"; line: number; flash?: boolean }) => {
      // Play click SFX (respects bell)
      playMiniClick();

      // Scroll the viewport to the comparison section first (so the user sees the highlight)
      try {
        comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {}

      // Delegate to actual comparison scroll
      originalScrollTo(opts);

      // Ensure flash on the exact line
      try {
        if (typeof inst.flashRange === "function" && opts?.line) {
          inst.flashRange(opts.side, opts.line, opts.line);
        }
      } catch {}
    };

    scrollWrapperInstalled.current = true;
  }, [cmpRef, soundOn]);

  // Summary fetcher (manual)
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
          newQuery, // RAW
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
      }
    } finally {
      setSummarizing(false);
      setLoadingAudience(null);
    }
  }

  const handleSwitchAudience = async (nextAudience: Audience) => {
    setAudience(nextAudience);
    playSfx(switchAudioRef);
    setTimeout(() => {
      summaryRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      summaryHeaderRef.current?.focus();
    }, 80);
  };

  const handleToggleSync = () => {
    setSyncEnabled((v) => !v);
    playSfx(switchAudioRef);
  };

  const toggleLightUI = () => {
    setIsLight((v) => !v);
    playSfx(switchAudioRef);
  };

  const handleToggleSound = () => {
    setSoundOn((prev) => {
      const next = !prev;
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
        [doneAudioRef.current, switchAudioRef.current, miniClickAudioRef.current, chatbotAudioRef.current].forEach(
          (a) => {
            try {
              if (a) {
                a.muted = true;
                a.pause();
                a.currentTime = 0;
              }
            } catch {}
          }
        );
      }
      return next;
    });
  };

  const pageBgClass = isLight ? "bg-slate-100 text-slate-900" : "bg-neutral-950 text-white";
  const headerBgClass = isLight
    ? "bg-slate-50/95 border-slate-200 text-slate-900 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
    : "bg-black/30 border-white/10 text-white";

  const runAnalysis = async () => {
    if (mode !== "compare") return;
    if (streaming) return;
    if (!oldQuery || !newQuery) return; // RAW guard

    setAnalysisStarted(true);
    analysisDoneSoundPlayedRef.current = false;
    setStreaming(true);
    setError(null);

    try {
      const PAGE_SIZE = 24;

      // Prep placeholders
      const prepRes = await fetch(`/api/analyze?cursor=0&limit=${PAGE_SIZE}&prepOnly=1&mode=${analysisMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldQuery, newQuery }), // RAW
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
          body: JSON.stringify({ oldQuery, newQuery }), // RAW
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

      // Stream each item explanation
      for (let i = 0; i < total; i++) {
        const r = await fetch(`/api/analyze?mode=item&index=${i}&analysisMode=${analysisMode}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldQuery, newQuery }), // RAW
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
        playSfx(doneAudioRef);
        await new Promise((res) => setTimeout(res, 0));
      }

      setStreaming(false);

      if (!analysisDoneSoundPlayedRef.current) {
        analysisDoneSoundPlayedRef.current = true;
        playDoneSound();
      }
    } catch (e: any) {
      setStreaming(false);
      setError(e?.message || "Unexpected error");
    }
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    const originalFetch = window.fetch;

    const wrappedFetch: typeof window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await originalFetch(input as any, init as any);
      try {
        const url = typeof input === "string" ? input : (input as URL).toString();
        const isChatbot = /\/api\/chatbot(?:\/|$|\?)/.test(url);
        if (!isChatbot) return res;
        const clone = res.clone();
        const ctype = clone.headers.get("content-type") || "";
        if (!clone.ok || !/application\/json/i.test(ctype)) return res;
        const data = await clone.json().catch(() => null);
        const play = !!data?.meta?.playSound;
        if (play && soundOn) await playChatbotSound();
      } catch {}
      return res;
    };

    window.fetch = wrappedFetch;
    return () => {
      window.fetch = originalFetch;
    };
  }, [soundOn]);

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
              <span className={`${isLight ? "text-gray-700" : "text-white"} inline-flex items-center gap-2`}>
                <span className="font-heading font-semibold text-lg">
                  {mode === "single" ? "AI-Powered Query Companion — Single Query" : "AI-Powered Query Companion"}
                </span>
              </span>
            </div>

            {/* Right Controls */}
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleToggleSync}
                title="Toggle synced scrolling"
                className={`relative p-2 rounded-full transition ${isLight ? "hover:bg-black/10" : "hover:bg-white/10"}`}
                disabled={mode === "single"}
              >
                <Link2
                  className={`h-5 w-5 transition ${
                    mode === "single"
                      ? isLight
                        ? "text-gray-300"
                        : "text-white/30"
                      : isLight
                      ? syncEnabled
                        ? "text-gray-700"
                        : "text-gray-400"
                      : syncEnabled
                      ? "text-white"
                      : "text-white/60"
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
                }`}
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
        <audio ref={chatbotAudioRef} src="/chatbot.mp3" preload="metadata" muted={!soundOn} />

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
              {/* Stats chips — compare only */}
              {mode === "compare" && stats && (
                <section className="mt-0 mb-2">
                  <div
                    className={`flex items-center justify-center gap-2 text-xs ${
                      isLight ? "text-slate-700" : "text-white/80"
                    }`}
                  >
                    <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30">
                      {stats.additions} additions
                    </span>
                    <span className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30">
                      {stats.modifications} modifications
                    </span>
                    <span className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30">
                      {stats.deletions} deletions
                    </span>
                    <span
                      className={`px-2 py-1 rounded ${
                        isLight ? "bg-black/5 border-black/15" : "bg-white/10 border-white/20"
                      }`}
                    >
                      {stats.unchanged} unchanged
                    </span>
                  </div>
                </section>
              )}

              {/* TOP PANE(S) */}
              <section className="mt-1">
                <div
                  ref={comparisonSectionRef}
                  className="flex flex-col md:flex-row items-stretch gap-3 h-[72vh] md:h-[78vh] lg:h-[82vh] xl:h-[86vh] min-h-0"
                >
                  {mode === "single" ? (
                    <>
                      {/* Left: Single query */}
                      <div className="md:flex-[2] min-w-0 h-full">
                        <SingleQueryView query={singleQuery} isLight={isLight} />
                      </div>

                      {/* Right: Chat only */}
                      <div className="md:flex-[1] min-w-0 h-full mt-3 md:mt-0">
                        <Card className="h-full bg-white border-slate-200 ring-1 ring-black/5 shadow dark:ring-0 dark:border-gray-200 dark:shadow-lg overflow-hidden">
                          <CardContent className="p-0 h-full flex flex-col min-h-0">
                            <div className="chatpanel-fit h-full min-h-0">
                              <ChatPanel rawOld={""} rawNew={singleQuery} changeCount={0} stats={null} />
                            </div>
                          </CardContent>
                        </Card>
                      </div>
                    </>
                  ) : (
                    <>
                      {/* Query Comparison */}
                      <div className="flex-1 min-w-0 h-full rounded-xl overflow-hidden">
                        <QueryComparison
                          ref={cmpRef}
                          oldQuery={oldQuery}
                          newQuery={newQuery}
                          showTitle={false}
                          syncScrollEnabled={syncEnabled}
                        />
                      </div>

                      {/* Dual minimaps (visual-row aligned) */}
                      <div className="hidden lg:flex h-full items-stretch gap-2">
                        <MiniMap
                          alignedRows={alignedRows}
                          forceSide="old"
                          onJump={({ line }) => {
                            if (!cmpRef.current) return;
                            playMiniClick();
                            // Scroll up to the comparison section first
                            comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            cmpRef.current.scrollTo({ side: "old", line });
                          }}
                          onFlashRange={({ startLine, endLine }) => {
                            if (!cmpRef.current) return;
                            cmpRef.current.flashRange?.("old", startLine, endLine);
                          }}
                          className={`w-6 h-full rounded-md ${
                            isLight
                              ? "bg-white border border-black ring-2 ring-black/30 hover:ring-black/40"
                              : "bg-white/5 border border-white/10 hover:border-white/20"
                          }`}
                          soundEnabled={soundOn}
                        />
                        <MiniMap
                          alignedRows={alignedRows}
                          forceSide="new"
                          onJump={({ line }) => {
                            if (!cmpRef.current) return;
                            playMiniClick();
                            // Scroll up to the comparison section first
                            comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            cmpRef.current.scrollTo({ side: "new", line });
                          }}
                          onFlashRange={({ startLine, endLine }) => {
                            if (!cmpRef.current) return;
                            cmpRef.current.flashRange?.("new", startLine, endLine);
                          }}
                          className={`w-6 h-full rounded-md ${
                            isLight
                              ? "bg-white border border-black ring-2 ring-black/30 hover:ring-black/40"
                              : "bg-white/5 border border-white/10 hover:border-white/20"
                          }`}
                          soundEnabled={soundOn}
                        />
                      </div>
                    </>
                  )}
                </div>
                <div
                  className={`relative z-20 flex items-center justify-center text-xs mt-3 ${
                    isLight ? "text-gray-500" : "text-white/60"
                  }`}
                >
                  <ChevronDown className="w-4 h-4 mr-1 animate-bounce" />
                  {mode === "single" ? "Use the right panel to chat" : "Scroll for Changes & AI Analysis"}
                </div>
              </section>

              {/* LOWER PANELS */}
              {mode === "compare" ? (
                <section className="mt-6 md:mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
                  {/* LEFT: Changes + Summary */}
                  <div className="space-y-5 sm:space-y-6 md:space-y-8">
                    <Changes
                      oldQuery={oldQuery}
                      newQuery={newQuery}
                      isLight={isLight}
                      typeFilter={typeFilter}
                      sideFilter={sideFilter}
                      onChangeTypeFilter={setTypeFilter}
                      onChangeSideFilter={setSideFilter}
                      onJump={(side, line) => {
                        if (!cmpRef.current) return;
                        playMiniClick();
                        comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                        cmpRef.current.scrollTo({ side, line, flash: true });
                      }}
                    />

                    {/* Summary */}
                    <Card ref={summaryRef} className="mt-4 sm:mt-5 md:mt-0 scroll-mt-24 bg-slate-50 border-slate-200 shadow-lg">
                      <CardContent className="p-5">
                        <div className="flex items-center justify-between mb-4">
                          <h3
                            ref={summaryHeaderRef}
                            tabIndex={-1}
                            className="text-slate-900 font-semibold focus:outline-none"
                          >
                            Summary
                          </h3>

                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => fetchSummary(audience)}
                              disabled={summarizing || !!loadingAudience}
                              title="Generate summary"
                              className="inline-flex items-center gap-2 h-8 px-3 rounded-full border border-gray-300 bg-gray-100 text-gray-900 shadow-sm hover:bg-white transition disabled:opacity-60 disabled:cursor-not-allowed"
                            >
                              {summarizing ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <Send className="h-3.5 w-3.5" />
                              )}
                              <span className="text-sm">Generate Summary</span>
                            </button>

                            <div className="inline-flex rounded-full border border-gray-300 bg-gray-100 p-0.5">
                              <button
                                type="button"
                                onClick={() => handleSwitchAudience("stakeholder")}
                                disabled={loadingAudience === "stakeholder"}
                                className={`px-3 h-8 rounded-full text-sm transition ${
                                  audience === "stakeholder"
                                    ? "bg-white text-gray-900 shadow"
                                    : "text-gray-600 hover:text-gray-900"
                                }`}
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
                                className={`px-3 h-8 rounded-full text-sm transition ${
                                  audience === "developer"
                                    ? "bg-white text-gray-900 shadow"
                                    : "text-gray-600 hover:text-gray-900"
                                }`}
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
                          {(() => {
                            const currentSummary = audience === "stakeholder" ? summaryStakeholder : summaryDeveloper;
                            if (!currentSummary && (summarizing || loadingAudience)) {
                              return (
                                <div className="space-y-4">
                                  <div className="inline-flex items-center gap-2 text-gray-700">
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                    <span>Generating {audience} summary…</span>
                                  </div>
                                  <div className="space-y-2">
                                    <div className="h-3 w/full bg-gray-200 rounded animate-pulse" />
                                    <div className="h-3 w-[92%] bg-gray-200 rounded animate-pulse" />
                                    <div className="h-3 w-[88%] bg-gray-200 rounded animate-pulse" />
                                    <div className="h-3 w-[80%] bg-gray-200 rounded animate-pulse" />
                                  </div>
                                </div>
                              );
                            }
                            return currentSummary ? (
                              <p className="text-gray-800 text-sm leading-relaxed">{currentSummary}</p>
                            ) : (
                              <div className="text-gray-600 text-sm">The {audience} summary will appear here.</div>
                            );
                          })()}
                        </div>
                      </CardContent>
                    </Card>
                  </div>

                  {/* RIGHT: AI Analysis + Chat */}
                  <div className="space-y-5 sm:space-y-6 md:space-y-8">
                      <AnalysisPanel
                        isLight={isLight}
                        canonicalOld={oldQuery}
                        canonicalNew={newQuery}
                        cmpRef={cmpRef}
                          onJump={(side, line) => jumpAndFlash(side, line)}
                      />

                    {/* Chat */}
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
              ) : null}
            </div>
          )}
        </div>
      </main>

      {/* Global tweak: let ChatPanel grow to its parent in single-mode right column */}
      <style>{`
        .chatpanel-fit .h-\\[34rem\\] { height: 100% !important; }
      `}</style>
    </div>
  );
}
