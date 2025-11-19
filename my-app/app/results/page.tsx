"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
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
  Link2,
  Sun,
  Moon,
} from "lucide-react";
import { QueryComparison, type QueryComparisonHandle } from "@/components/query-comparison";
import {
  generateQueryDiff,
  buildAlignedRows,
  type ComparisonResult,
  type AlignedRow,
} from "@/lib/query-differ";
import AnalysisPanel from "@/components/analysis";
import { useUserPrefs } from "@/hooks/user-prefs";
import { Changes } from "@/components/changes";

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";
type AnalysisMode = "fast" | "expert";
type Mode = "single" | "compare";

type PairItem = { oldQuery: string; newQuery: string; oldName?: string; newName?: string };
type FileItem = { id: number; name: string; content: string };
type SingleIncoming = { name: string; content: string };

const MAX_QUERY_CHARS = 140_000;

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

// ===== Session payload stored per file/session =====
export type PanelSession = {
  // AI Tools tab + states
  mode: "analysis" | "hardcode" | "summary" | "chat";
  // Analysis
  streaming: boolean;
  analysisBanner: string;
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
    severity?: "block" | "warn" | "info";
  }>;
  error: string | null;
  // Hardcode
  hcLoading: boolean;
  hcError: string | null;
  hcFindings: Array<{
    kind: string;
    detail: string;
    lineNumber: number;
    side: "old" | "new" | "both";
    severity?: "info" | "warn" | "error";
  }>;
  // Summary
  sumLoading: boolean;
  sumError: string | null;
  summaryText: string;

  // Chat
  chatMessages: { role: "user" | "assistant" | "system"; content: string }[];
  chatLoading: boolean;
};

function makeEmptyPanelSession(): PanelSession {
  return {
    mode: "analysis",
    streaming: false,
    analysisBanner: "Click Generate to review each change.",
    changes: [],
    error: null,
    hcLoading: false,
    hcError: null,
    hcFindings: [],
    sumLoading: false,
    sumError: null,
    summaryText: "",
    chatMessages: [{ role: "assistant", content: "Hello! How can I assist you today?" }],
    chatLoading: false,
  };
}

function SingleQueryView({
  query,
  isLight,
  scrollRef,
}: {
  query: string;
  isLight: boolean;
  scrollRef: React.RefObject<HTMLDivElement>;
}) {
  const lines = useMemo(() => {
    const t = query.endsWith("\n") ? query.slice(0, -1) : query;
    return t ? t.split("\n") : [];
  }, [query]);

  return (
    <div className="flex-1 min-w-0 h-full rounded-xl overflow-hidden">
      <Card className="h-full bg-white border-slate-200 ring-1 ring-black/5 shadow-[0_1px_0_rgba(0,0,0,0.05),0_10px_30px_rgba(0,0,0,0.10)]">
        <CardContent className="p-5 h-full min-h-0 flex flex-col">
          <div
            ref={scrollRef}
            className="flex-1 min-h-0 rounded-lg border border-slate-200 bg-slate-50 overflow-auto hover-scroll focus:outline-none"
            style={{ scrollbarGutter: "stable" }}
            data-single-container="1"
          >
            <div
              className="relative w-max min-w-full p-2 font-mono text-[12px] leading-[1.22] text-slate-800"
              style={{ fontVariantLigatures: "none", MozTabSize: 4 as any, OTabSize: 4 as any, tabSize: 4 as any }}
            >
              {lines.length ? (
                lines.map((line, idx) => (
                  <div key={idx} data-side="single" data-line={idx + 1} id={`single-line-${idx + 1}`} className="group flex items-start gap-2 px-2 py-[2px] rounded">
                    <span className="sticky left-0 z-10 w-10 pr-2 text-right select-none text-slate-500 bg-transparent">
                      {idx + 1}
                    </span>
                    <code className="block whitespace-pre pr-2 leading-[1.22]">{line}</code>
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
          <div className={`h-3 w/full ${pulseBg} rounded animate-pulse`} />
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

type SessionBlob = {
  panel: PanelSession;
};

export default function ResultsPage() {
  const router = useRouter();

  const [mode, setMode] = useState<Mode>("compare");
  const [singleQuery, setSingleQuery] = useState<string>("");

  const [oldQuery, setOldQuery] = useState<string>("");
  const [newQuery, setNewQuery] = useState<string>("");

  const [files, setFiles] = useState<FileItem[]>([]);
  const [oldSel, setOldSel] = useState<number>(-1);
  const [newSel, setNewSel] = useState<number>(-1);
  const [singleSel, setSingleSel] = useState<number>(-1);

  // session cache keyed by stable session keys
  const sessionRef = useRef<Map<string, SessionBlob>>(new Map());
  const currentSessionKeyRef = useRef<string>("");

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const doneAudioRef = useRef<HTMLAudioElement | null>(null);
  const switchAudioRef = useRef<HTMLAudioElement | null>(null);
  const miniClickAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatbotAudioRef = useRef<HTMLAudioElement | null>(null);

  const cmpRef = useRef<QueryComparisonHandle>(null);
  const comparisonSectionRef = useRef<HTMLDivElement | null>(null);
  const singleScrollRef = useRef<HTMLDivElement | null>(null);

  const { isLight, soundOn, syncEnabled, setIsLight, setSoundOn, setSyncEnabled } = useUserPrefs();

  const topPaneHeights =
    mode === "single"
      ? "h:[88svh] md:h-[90dvh] lg:h-[92dvh] 2xl:h-[86dvh] min-h-[560px] max-h-[1400px]"
      : "h-[80svh] md:h-[88dvh] lg:h-[90dvh] 2xl:h-[84dvh] min-h-[560px] max-h-[1400px]";

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

  const [analysisMode] = useState<AnalysisMode>("expert");
  const SUSTAIN_MS = 4000;

  const fileKey = (f: FileItem) => `${f.name}::${f.content.length}:${f.content.slice(0, 64)}`;
  const sessionKeySingle = (f: FileItem) => `single:${fileKey(f)}`;
  const sessionKeyPair = (fo: FileItem, fn: FileItem) => `pair:${fileKey(fo)}→${fileKey(fn)}`;

  const getOrInitPanel = useCallback((key: string) => {
    const existing = sessionRef.current.get(key);
    if (existing) return existing.panel;
    const fresh = makeEmptyPanelSession();
    sessionRef.current.set(key, { panel: fresh });
    return fresh;
  }, []);

  const saveCurrentSession = () => {
    const k = currentSessionKeyRef.current;
    if (!k) return;
    // state is already kept in sessionRef via React setters below
  };
  const loadSession = (k: string) => {
    currentSessionKeyRef.current = k;
  };

  const jumpSingle = (line: number) => {
    const container = singleScrollRef.current;
    if (!container) return;

    const el =
      (container.querySelector(`[data-side="single"][data-line="${line}"]`) as HTMLElement | null) ||
      (document.getElementById(`single-line-${line}`) as HTMLElement | null);

    if (!el) return;

    const top = el.offsetTop - (parseInt(getComputedStyle(container).paddingTop || "0", 10) || 0) - 24;

    try {
      container.scrollTo({ top, behavior: "smooth" });
    } catch {
      container.scrollTop = top;
    }

    el.classList.add("qa-persist-highlight");
    window.setTimeout(() => el.classList.remove("qa-persist-highlight"), SUSTAIN_MS);

    if (soundOn) {
      try {
        const elS = miniClickAudioRef.current;
        if (elS) {
          elS.muted = false;
          elS.pause();
          elS.currentTime = 0;
          elS.volume = 0.6;
          elS.play().catch(() => {});
        }
      } catch {}
    }
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

  const jumpAndFlash = (side: "old" | "new" | "both", line: number) => {
    if (mode === "single") {
      jumpSingle(line);
      return;
    }
    comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    const targetSide = side === "both" ? "new" : side;
    cmpRef.current?.scrollTo({ side: targetSide, line });
    cmpRef.current?.flashRange?.(targetSide, line, line);

    requestAnimationFrame(() => {
      const el =
        (document.querySelector(`[data-qc-side="${targetSide}"][data-line="${line}"]`) as HTMLElement | null) ||
        (document.querySelector(`[data-side="${targetSide}"][data-line="${line}"]`) as HTMLElement | null);

      if (el) {
        el.classList.add("qa-persist-highlight");
        setTimeout(() => el.classList.remove("qa-persist-highlight"), SUSTAIN_MS);
      }
    });

    playMiniClick();
  };

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
          (clearResumeHandler as any)();
        });
      };
      (clearResumeHandler as any).handler = resume;
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
    }
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

  // payload intake + catalog build
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const raw = typeof window !== "undefined" ? sessionStorage.getItem("qa:payload") : null;
    if (!raw) {
      router.push("/");
      return;
    }

    type Payload =
      | { mode: "single"; singleQuery?: string; newQuery?: string; oldQuery?: string; files?: SingleIncoming[] }
      | { mode: "compare"; oldQuery: string; newQuery: string; oldName?: string; newName?: string }
      | { mode: "compare-multi"; pairs: PairItem[] }
      | Record<string, any>;

    let parsed: Payload | null = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      router.push("/");
      return;
    }

    const normalizeEOL = (s: string) => s.replace(/\r\n/g, "\n");

    if (!parsed) {
      router.push("/");
      return;
    }

    const catalog: FileItem[] = [];
    const pushUnique = (name: string, content: string) => {
      const key = `${name}::${content.length}:${content.slice(0, 64)}`;
      const exists = catalog.some((f) => `${f.name}::${f.content.length}:${f.content.slice(0, 64)}` === key);
      if (!exists) catalog.push({ id: catalog.length, name, content });
    };
    const findId = (name: string, content: string) => {
      const key = `${name}::${content.length}:${content.slice(0, 64)}`;
      const found = catalog.find((f) => `${f.name}::${f.content.length}:${f.content.slice(0, 64)}` === key);
      return found?.id ?? -1;
    };

    // SINGLE
    if ((parsed as any).mode === "single") {
      let incoming: SingleIncoming[] | undefined = (parsed as any).files;

      if (!incoming) {
        const arrCandidates = Object.values(parsed).filter(Array.isArray) as any[][];
        for (const arr of arrCandidates) {
          if (arr?.length && typeof arr[0] === "object" && "name" in arr[0] && "content" in arr[0]) {
            incoming = arr as SingleIncoming[];
            break;
          }
        }
      }

      if (incoming && incoming.length) {
        const normalized = incoming
          .map((f, i) => ({
            name: f?.name || `Query_${i + 1}.sql`,
            content: normalizeEOL(String(f?.content || "")),
          }))
          .filter((f) => f.content && f.content.length <= MAX_QUERY_CHARS);

        normalized.forEach((f) => pushUnique(f.name, f.content));

        if (catalog.length) {
          setFiles(catalog);
          setMode("single");

          const first = catalog[0];
          setSingleSel(first.id);
          setSingleQuery(first.content);
          setNewQuery(first.content);
          setOldQuery("");

          const k = sessionKeySingle(first);
          currentSessionKeyRef.current = k;
          getOrInitPanel(k);
          setLoading(false);
          return;
        }
      }

      const qRaw =
        String((parsed as any)?.singleQuery ||
               (parsed as any)?.newQuery ||
               (parsed as any)?.oldQuery ||
               "");
      const q = normalizeEOL(qRaw);
      if (!q || q.length > MAX_QUERY_CHARS) {
        router.push("/");
        return;
      }

      pushUnique("Query_1.sql", q);

      const first = catalog[0];
      setFiles(catalog);
      setMode("single");
      setSingleSel(first.id);
      setSingleQuery(first.content);
      setNewQuery(first.content);
      setOldQuery("");

      const k = sessionKeySingle(first);
      currentSessionKeyRef.current = k;
      getOrInitPanel(k);
      setLoading(false);
      return;
    }

    // COMPARE MULTI
    if ((parsed as any).mode === "compare-multi") {
      const incomingPairs = ((parsed as any).pairs || []) as PairItem[];
      const cleaned = incomingPairs
        .map((p, i) => ({
          oldQuery: normalizeEOL(String(p.oldQuery || "")),
          newQuery: normalizeEOL(String(p.newQuery || "")),
          oldName: p.oldName || `Old_${i + 1}.sql`,
          newName: p.newName || `New_${i + 1}.sql`,
        }))
        .filter((p) => p.oldQuery && p.newQuery && p.oldQuery.length <= MAX_QUERY_CHARS && p.newQuery.length <= MAX_QUERY_CHARS);

      if (!cleaned.length) {
        router.push("/");
        return;
      }

      cleaned.forEach((p) => {
        pushUnique(p.oldName!, p.oldQuery);
        pushUnique(p.newName!, p.newQuery);
      });

      setFiles(catalog);
      setMode("compare");

      const first = (() => {
        const pairs: { oldId: number; newId: number }[] = [];
        cleaned.forEach((p) => {
          const oid = findId(p.oldName!, p.oldQuery);
          const nid = findId(p.newName!, p.newQuery);
          if (oid >= 0 && nid >= 0) pairs.push({ oldId: oid, newId: nid });
        });
        return pairs[0] ?? { oldId: 0, newId: 1 };
      })();

      setOldSel(first.oldId);
      setNewSel(first.newId);
      setOldQuery(catalog[first.oldId].content);
      setNewQuery(catalog[first.newId].content);

      const k = sessionKeyPair(catalog[first.oldId], catalog[first.newId]);
      currentSessionKeyRef.current = k;
      getOrInitPanel(k);
      setLoading(false);
      return;
    }

    // COMPARE (single pair)
    const o = normalizeEOL(String((parsed as any).oldQuery || ""));
    const n = normalizeEOL(String((parsed as any).newQuery || ""));
    if (!o || !n || o.length > MAX_QUERY_CHARS || n.length > MAX_QUERY_CHARS) {
      router.push("/");
      return;
    }

    const on = (parsed as any).oldName || "Old.sql";
    const nn = (parsed as any).newName || "New.sql";
    pushUnique(on, o);
    pushUnique(nn, n);

    setFiles(catalog);
    setMode("compare");
    setOldSel(0);
    setNewSel(1);
    setOldQuery(o);
    setNewQuery(n);

    const k = sessionKeyPair(catalog[0], catalog[1]);
    currentSessionKeyRef.current = k;
    getOrInitPanel(k);
    setLoading(false);
  }, [router, getOrInitPanel]);

  // Sync single-mode selection
  useEffect(() => {
    if (mode !== "single") return;
    if (files.length === 0) return;
    const idx = singleSel >= 0 ? singleSel : 0;
    const f = files.find((x) => x.id === idx) || files[0];
    if (!f) return;

    const nextKey = sessionKeySingle(f);
    if (currentSessionKeyRef.current !== nextKey) {
      saveCurrentSession();
      loadSession(nextKey);
      getOrInitPanel(nextKey);
    }

    currentSessionKeyRef.current = nextKey;
    setSingleQuery(f.content);
    setNewQuery(f.content);
  }, [mode, files, singleSel, getOrInitPanel]);

  // Sync compare-mode selections
  useEffect(() => {
    if (mode !== "compare") return;
    if (!files.length) return;
    const fo = files.find((f) => f.id === oldSel) || files[0];
    const fn = files.find((f) => f.id === newSel) || files[(files.length > 1 ? 1 : 0)];
    if (!fo || !fn) return;

    const nextKey = sessionKeyPair(fo, fn);
    if (currentSessionKeyRef.current !== nextKey) {
      saveCurrentSession();
      loadSession(nextKey);
      getOrInitPanel(nextKey);
    }

    currentSessionKeyRef.current = nextKey;
    setOldQuery(fo.content);
    setNewQuery(fn.content);
    setError(null);
  }, [oldSel, newSel, files, mode, getOrInitPanel]);

  // Stats for chips (compare mode)
  const { additions = 0, modifications = 0, deletions = 0, unchanged = 0 } = useMemo<{
    additions: number;
    modifications: number;
    deletions: number;
    unchanged: number;
  }>(() => {
    const c = mode === "compare" ? generateQueryDiff(oldQuery, newQuery, { basis: "raw" }) : null;
    return {
      additions: c?.stats?.additions ?? 0,
      modifications: c?.stats?.modifications ?? 0,
      deletions: c?.stats?.deletions ?? 0,
      unchanged: c?.stats?.unchanged ?? 0,
    };
  }, [mode, oldQuery, newQuery]);

  const comparison: ComparisonResult | null = useMemo(() => {
    if (mode !== "compare" || !oldQuery || !newQuery) return null;
    return generateQueryDiff(oldQuery, newQuery, { basis: "raw" });
  }, [mode, oldQuery, newQuery]);

  const alignedRows: AlignedRow[] = useMemo(() => (comparison ? buildAlignedRows(comparison) : []), [comparison]);

  const scrollWrapperInstalled = useRef(false);
  useEffect(() => {
    const inst = cmpRef.current as any;
    if (!inst || scrollWrapperInstalled.current) return;

    const originalScrollTo = inst.scrollTo?.bind(inst);
    if (typeof originalScrollTo !== "function") return;

    inst.scrollTo = (opts: { side: "old" | "new"; line: number; flash?: boolean }) => {
      playMiniClick();
      try {
        comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      } catch {}
      originalScrollTo(opts);
      try {
        if (typeof inst.flashRange === "function" && opts?.line) {
          inst.flashRange(opts.side, opts.line, opts.line);
        }
      } catch {}
    };

    scrollWrapperInstalled.current = true;
  }, [cmpRef, soundOn]);

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

  const pageBgClass = isLight ? "bg-slate-100 text-slate-900" : "bg-neutral-950 text-white";
  const headerBgClass = isLight
    ? "bg-slate-50/95 border-slate-200 text-slate-900 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
    : "bg-black/30 border-white/10 text-white";

  // derive current panel session
  const panelSession = sessionRef.current.get(currentSessionKeyRef.current)?.panel ?? makeEmptyPanelSession();
  const setPanelSession = (updater: React.SetStateAction<PanelSession>) => {
    const k = currentSessionKeyRef.current;
    const prev = sessionRef.current.get(k)?.panel ?? makeEmptyPanelSession();
    const next = typeof updater === "function" ? (updater as (p: PanelSession) => PanelSession)(prev) : updater;
    sessionRef.current.set(k, { panel: next });
    // force react to re-render
    setTick((n) => n + 1);
  };
  const [, setTick] = useState(0);

  return (
    <div className={`min-h-screen relative ${pageBgClass}`}>
      {isLight ? gridBgLight : gridBg}

      {/* HEADER — single mode gets a file dropdown; compare mode gets two dropdowns in toolbar below */}
      <header className={`relative z-10 border ${headerBgClass} backdrop-blur`}>
        <div className="mx-auto w-full max-w-[1800px] px-3 md:px-4 lg:px-6 py-3 md:py-2">
          <div className="grid grid-cols-3 items-center gap-3">
            {/* Left: Home */}
            <div className="flex">
              <Link
                href="/"
                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg transition border ${
                  isLight ? "bg-black/5 hover:bg-black/10 border-black/10 text-gray-700" : "bg-white/5 hover:bg-white/10 border-white/10 text-white"
                }`}
              >
                <Home className="w-5 h-5" />
              </Link>
            </div>

            {/* Center: Title */}
            <div className="flex items-center justify-center">
              <span className={`${isLight ? "text-gray-700" : "text-white"} inline-flex items-center gap-2`}>
                <span className="font-heading font-semibold text-lg">{mode === "single" ? "Analysis Mode" : "Compare Mode"}</span>
              </span>
            </div>

            {/* Right: controls + single-mode file dropdown */}
            <div className="flex items-center justify-end gap-2">
              {mode === "single" && files.length > 0 && (
                <select
                  value={singleSel >= 0 ? singleSel : 0}
                  onChange={(e) => setSingleSel(Number(e.target.value))}
                  className={`text-xs sm:text-sm px-2 py-1 rounded-md border min-w-[220px] ${
                    isLight ? "bg-white border-slate-300 text-slate-800" : "bg-neutral-900 border-white/15 text-white"
                  }`}
                  title="Select query"
                >
                  {files.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                onClick={() => setSyncEnabled((v) => !v)}
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
                onClick={() => setIsLight((v) => !v)}
                title={isLight ? "Switch to Dark Background" : "Switch to Light Background"}
                className={`relative p-2 rounded-full transition ${isLight ? "hover:bg-black/10" : "hover:bg-white/10"}`}
              >
                {isLight ? <Sun className="h-5 w-5 text-gray-700" /> : <Moon className="h-5 w-5 text-white" />}
              </button>

              <button
                type="button"
                onClick={() =>
                  setSoundOn((prev) => {
                    const next = !prev;
                    if (!next) {
                      [doneAudioRef.current, switchAudioRef.current, miniClickAudioRef.current, chatbotAudioRef.current].forEach((a) => {
                        try {
                          if (a) {
                            a.muted = true;
                            a.pause();
                            a.currentTime = 0;
                          }
                        } catch {}
                      });
                    } else {
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
                    }
                    return next;
                  })
                }
                aria-pressed={soundOn}
                title={soundOn ? "Mute sounds" : "Enable sounds"}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition border border-transparent ${
                  isLight ? "hover:bg-black/10" : "hover:bg-white/10"
                }`}
              >
                {soundOn ? <Bell className={`h-5 w-5 ${isLight ? "text-gray-700" : "text-white"}`} /> : <BellOff className={`h-5 w-5 ${isLight ? "text-gray-400" : "text-white/60"}`} />}
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

        <div className="mx-auto w-full max-w-[1800px] px-3 md:px-4 lg:px-6 pt-1 pb-20 md:pb-4">
          {loading && !error && <FancyLoader isLight={isLight} />}

          {!loading && error && (
            <Alert className={`${isLight ? "bg-white border-red-500/40" : "bg-black/40"} backdrop-blur text-inherit`}>
              <AlertCircle className={`w-5 h-5 ${isLight ? "text-red-600" : "text-red-400"}`} />
              <AlertDescription className="flex-1">
                <strong className={isLight ? "text-red-700" : "text-red-300"}>Error:</strong> {error}
              </AlertDescription>
              <Button asChild variant="outline" className={`${isLight ? "border-black/20 text-gray-900 hover:bg-black/10" : "border-white/20 text-white/90 hover:bg-white/10"}`}>
                <Link href="/">Go Home</Link>
              </Button>
            </Alert>
          )}

          {!loading && !error && (
            <div className="space-y-6">
              {/* Compare toolbar with centered stat chips */}
              {mode === "compare" && (
                <section className="mt-1">
                  <div
                    className={`sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-3 flex flex-col gap-2 rounded-lg px-3 py-2 ${
                      isLight ? "bg-white border border-slate-200 shadow-sm" : "bg-white/5 border border-white/10"
                    }`}
                  >
                    {/* LEFT: old file */}
                    <div className="justify-self-start">
                      <select
                        value={oldSel}
                        onChange={(e) => setOldSel(Number(e.target.value))}
                        className={`text-xs sm:text-sm px-2 py-1 rounded-md border min-w-[180px] ${
                          isLight ? "bg-white border-slate-300 text-slate-800" : "bg-neutral-900 border-white/15 text-white"
                        }`}
                        title="Old file"
                      >
                        {files.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* CENTER: stat chips */}
                    <div className="justify-self-center flex items-center justify-center gap-2 text-xs">
                      <span className="px-2 py-1 rounded bg-emerald-500/15 border border-emerald-500/30">{additions} additions</span>
                      <span className="px-2 py-1 rounded bg-amber-500/15 border border-amber-500/30">{modifications} modifications</span>
                      <span className="px-2 py-1 rounded bg-rose-500/15 border border-rose-500/30">{deletions} deletions</span>
                      <span className={`px-2 py-1 rounded ${isLight ? "bg-black/5 border-black/15" : "bg-white/10 border-white/20"}`}>{unchanged} unchanged</span>
                    </div>

                    {/* RIGHT: new file */}
                    <div className="justify-self-end">
                      <select
                        value={newSel}
                        onChange={(e) => setNewSel(Number(e.target.value))}
                        className={`text-xs sm:text-sm px-2 py-1 rounded-md border min-w-[180px] ${
                          isLight ? "bg-white border-slate-300 text-slate-800" : "bg-neutral-900 border-white/15 text-white"
                        }`}
                        title="New file"
                      >
                        {files.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </section>
              )}

              <section className="mt-1">
                <div ref={comparisonSectionRef} className={`flex flex-col md:flex-row items-stretch gap-3 ${topPaneHeights} min-h-0`}>
                  {mode === "single" ? (
                    <>
                      <div className="md:flex-[2] min-w-0 h-full">
                        <SingleQueryView query={singleQuery} isLight={isLight} scrollRef={singleScrollRef} />
                      </div>
                      <div className="md:flex-[1] min-w-0 h-full mt-3 md:mt-0">
                        <AnalysisPanel
                          isLight={isLight}
                          canonicalOld={""}
                          canonicalNew={singleQuery}
                          cmpRef={undefined as any}
                          onJump={(side, line) => jumpAndFlash("new", line)}
                          fullHeight
                          externalMessages={panelSession.chatMessages}
                          setExternalMessages={(fn) => setPanelSession((p) => ({ ...p, chatMessages: typeof fn === "function" ? (fn as any)(p.chatMessages) : fn }))}
                          externalLoading={panelSession.chatLoading}
                          setExternalLoading={(v) => setPanelSession((p) => ({ ...p, chatLoading: typeof v === "function" ? (v as any)(p.chatLoading) : v }))}
                          externalSession={panelSession}
                          setExternalSession={setPanelSession}
                        />
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0 h-full rounded-xl overflow-hidden">
                        <QueryComparison ref={cmpRef} oldQuery={oldQuery} newQuery={newQuery} showTitle={false} syncScrollEnabled={syncEnabled} />
                      </div>

                      <div className="hidden md:flex h-full items-stretch gap-2">
                        <MiniMap
                          alignedRows={alignedRows}
                          forceSide="old"
                          onJump={({ line }) => {
                            if (!cmpRef.current) return;
                            playMiniClick();
                            comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            cmpRef.current.scrollTo({ side: "old", line });
                          }}
                          onFlashRange={({ startLine, endLine }) => cmpRef.current?.flashRange?.("old", startLine, endLine)}
                          className={`w-6 h-full rounded-md ${isLight ? "bg-white border border-black ring-2 ring-black/30 hover:ring-black/40" : "bg-white/5 border border-white/10 hover:border-white/20"}`}
                          soundEnabled={soundOn}
                        />
                        <MiniMap
                          alignedRows={alignedRows}
                          forceSide="new"
                          onJump={({ line }) => {
                            if (!cmpRef.current) return;
                            playMiniClick();
                            comparisonSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                            cmpRef.current.scrollTo({ side: "new", line });
                          }}
                          onFlashRange={({ startLine, endLine }) => cmpRef.current?.flashRange?.("new", startLine, endLine)}
                          className={`w-6 h-full rounded-md ${isLight ? "bg-white border border-black ring-2 ring-black/30 hover:ring-black/40" : "bg-white/5 border border-white/10 hover:border-white/20"}`}
                          soundEnabled={soundOn}
                        />
                      </div>
                    </>
                  )}
                </div>
                <div className={`relative z-20 flex items-center justify-center text-xs mt-3 ${isLight ? "text-gray-500" : "text-white/60"}`}>
                  <ChevronDown className="w-4 h-4 mr-1 animate-bounce" />
                  {mode === "single" ? "Use the right panel for AI Tools" : "Scroll for Changes & AI Analysis"}
                </div>
              </section>

              {mode === "compare" ? (
                <section className="mt-6 md:mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
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
                  </div>

                  <div className="space-y-5 sm:space-y-6 md:space-y-8">
                    <AnalysisPanel
                      isLight={isLight}
                      canonicalOld={oldQuery}
                      canonicalNew={newQuery}
                      cmpRef={cmpRef}
                      onJump={(side, line) => jumpAndFlash(side, line)}
                      externalMessages={panelSession.chatMessages}
                      setExternalMessages={(fn) => setPanelSession((p) => ({ ...p, chatMessages: typeof fn === "function" ? (fn as any)(p.chatMessages) : fn }))}
                      externalLoading={panelSession.chatLoading}
                      setExternalLoading={(v) => setPanelSession((p) => ({ ...p, chatLoading: typeof v === "function" ? (v as any)(p.chatLoading) : v }))}
                      externalSession={panelSession}
                      setExternalSession={setPanelSession}
                    />
                  </div>
                </section>
              ) : null}
            </div>
          )}
        </div>
      </main>
      <style>{`
        .chatpanel-fit .h-\\[34rem\\] { height: 100% !important; }
        .qa-persist-highlight {
          background: rgba(250, 204, 21, 0.35) !important;
          box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.55) inset;
          transition: background 150ms ease-in;
        }
      `}</style>
    </div>
  );
}
