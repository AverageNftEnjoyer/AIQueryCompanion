"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { MiniMap } from "@/components/minimap";
import { AlertCircle, Zap } from "lucide-react";
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
import { AppHeader } from "@/components/app-header";

type ChangeType = "addition" | "modification" | "deletion";
type Side = "old" | "new" | "both";
type AnalysisMode = "fast" | "expert";
type Mode = "single" | "compare";

type PairItem = { oldQuery: string; newQuery: string; oldName?: string; newName?: string };
type FileItem = { id: number; name: string; content: string };
type SingleIncoming = { name: string; content: string };

const MAX_QUERY_CHARS = 160_000;

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
  chatMessages: { role: "user" | "assistant"; content: string }[];
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
  scrollRef,
}: {
  query: string;
  scrollRef: React.RefObject<HTMLDivElement>;
}) {
  const lines = useMemo(() => {
    const t = query.endsWith("\n") ? query.slice(0, -1) : query;
    return t ? t.split("\n") : [];
  }, [query]);

  return (
    <div className="h-full min-w-0 flex-1 overflow-hidden rounded-md">
      <Card className="h-full rounded-md border border-border bg-card">
        <CardContent className="flex h-full min-h-0 flex-col p-3">
          <div
            ref={scrollRef}
            className="hover-scroll min-h-0 flex-1 overflow-auto rounded-md border border-border bg-code-bg focus:outline-none"
            style={{ scrollbarGutter: "stable" }}
            data-single-container="1"
          >
            <div
              className="relative w-max min-w-full p-2 font-mono text-[12px] leading-[1.22] text-code-fg"
              style={{ fontVariantLigatures: "none", MozTabSize: 4 as any, OTabSize: 4 as any, tabSize: 4 as any }}
            >
              {lines.length ? (
                lines.map((line, idx) => (
                  <div key={idx} data-side="single" data-line={idx + 1} id={`single-line-${idx + 1}`} className="group flex items-start gap-2 px-2 py-[2px]">
                    <span className="sticky left-0 z-10 w-10 select-none pr-2 text-right text-code-gutter">
                      {idx + 1}
                    </span>
                    <code className="block whitespace-pre pr-2 leading-[1.22]">{line}</code>
                  </div>
                ))
              ) : (
                <div className="p-2 text-sm text-muted-foreground">No query provided.</div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function FancyLoader() {
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

  return (
    <div className="flex w-full flex-col items-center justify-center py-16">
      <div className="mb-6 flex items-end gap-1.5">
        <span className="h-5 w-2 animate-bounce rounded-sm bg-primary" />
        <span className="h-7 w-2 animate-bounce rounded-sm bg-primary" style={{ animationDelay: "120ms" }} />
        <span className="h-9 w-2 animate-bounce rounded-sm bg-primary" style={{ animationDelay: "240ms" }} />
        <span className="h-7 w-2 animate-bounce rounded-sm bg-primary" style={{ animationDelay: "360ms" }} />
        <span className="h-5 w-2 animate-bounce rounded-sm bg-primary" style={{ animationDelay: "480ms" }} />
      </div>

      <div className="w-full max-w-3xl rounded-md border border-border bg-card p-6">
        <div className="mb-4 h-4 w-40 animate-pulse rounded bg-surface-2" />
        <div className="space-y-2">
          <div className="h-3 w-full animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-[92%] animate-pulse rounded bg-surface-2" />
          <div className="h-3 w-[84%] animate-pulse rounded bg-surface-2" />
        </div>
        <div className="mt-6 flex items-center gap-2 text-muted-foreground" aria-live="polite">
          <Zap className="h-4 w-4 animate-pulse" />
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

  const topPaneHeights = mode === "single" ? "h-[62dvh] min-h-[420px]" : "h-[42dvh] min-h-[300px]";

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

  const fileSelect =
    mode === "single" && files.length > 0 ? (
      <select
        value={singleSel >= 0 ? singleSel : 0}
        onChange={(e) => setSingleSel(Number(e.target.value))}
        className="mr-1 h-[30px] min-w-[200px] rounded-md border border-border bg-card px-2.5 font-mono text-xs text-foreground"
        title="Select query"
      >
        {files.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
          </option>
        ))}
      </select>
    ) : undefined;

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader
        routeLabel={mode === "single" ? "Analysis mode" : "Compare results"}
        syncEnabled={syncEnabled}
        onToggleSync={() => setSyncEnabled((v) => !v)}
        syncDisabled={mode === "single"}
        isLight={isLight}
        onToggleTheme={() => setIsLight((v) => !v)}
        soundOn={soundOn}
        onToggleSound={() =>
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
        extra={fileSelect}
      />

      <main className="flex-1">
        <audio ref={doneAudioRef} src="/loadingdone.mp3" preload="metadata" muted={!soundOn} />
        <audio ref={switchAudioRef} src="/switch.mp3" preload="metadata" muted={!soundOn} />
        <audio ref={miniClickAudioRef} src="/minimapbar.mp3" preload="metadata" muted={!soundOn} />
        <audio ref={chatbotAudioRef} src="/chatbot.mp3" preload="metadata" muted={!soundOn} />

        <div className="mx-auto w-full max-w-[1800px] px-4 pb-6 pt-4">
          {loading && !error && <FancyLoader />}

          {!loading && error && (
            <Alert className="rounded-md border border-destructive bg-card">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <AlertDescription className="flex-1">
                <strong className="text-destructive">Error:</strong> {error}
              </AlertDescription>
              <Button asChild variant="outline" className="border-border text-foreground hover:bg-surface-2">
                <Link href="/">Go Home</Link>
              </Button>
            </Alert>
          )}

          {!loading && !error && (
            <div className="flex flex-col gap-3">
              {/* Compare toolbar with stat chips */}
              {mode === "compare" && (
                <section className="flex flex-col items-center gap-2 rounded-md border border-border bg-card px-3 py-2 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:items-center sm:gap-3">
                  <div className="justify-self-start">
                    <select
                      value={oldSel}
                      onChange={(e) => setOldSel(Number(e.target.value))}
                      className="h-[30px] min-w-[180px] rounded-md border border-border bg-card px-2.5 font-mono text-xs text-foreground"
                      title="Old file"
                    >
                      {files.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center justify-center gap-2 justify-self-center text-xs">
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-diff-add-bg px-2.5 py-1 font-semibold text-diff-add-fg">
                      <span className="h-2 w-2 rounded-[2px]" style={{ background: "var(--diff-add-edge)" }} />
                      {additions} additions
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-diff-mod-bg px-2.5 py-1 font-semibold text-diff-mod-fg">
                      <span className="h-2 w-2 rounded-[2px]" style={{ background: "var(--diff-mod-edge)" }} />
                      {modifications} modifications
                    </span>
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-diff-del-bg px-2.5 py-1 font-semibold text-diff-del-fg">
                      <span className="h-2 w-2 rounded-[2px]" style={{ background: "var(--diff-del-edge)" }} />
                      {deletions} deletions
                    </span>
                    <span className="rounded-md border border-border px-2.5 py-1 font-semibold text-muted-foreground">
                      {unchanged} unchanged
                    </span>
                  </div>

                  <div className="justify-self-end">
                    <select
                      value={newSel}
                      onChange={(e) => setNewSel(Number(e.target.value))}
                      className="h-[30px] min-w-[180px] rounded-md border border-border bg-card px-2.5 font-mono text-xs text-foreground"
                      title="New file"
                    >
                      {files.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </section>
              )}

              <section>
                <div ref={comparisonSectionRef} className={`flex flex-col items-stretch gap-2 md:flex-row ${topPaneHeights} min-h-0`}>
                  {mode === "single" ? (
                    <>
                      <div className="h-full min-w-0 md:flex-[2]">
                        <SingleQueryView query={singleQuery} scrollRef={singleScrollRef} />
                      </div>
                      <div className="mt-3 h-full min-w-0 md:mt-0 md:flex-[1]">
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
                      <div className="h-full min-w-0 flex-1 overflow-hidden rounded-md">
                        <QueryComparison ref={cmpRef} oldQuery={oldQuery} newQuery={newQuery} showTitle={false} syncScrollEnabled={syncEnabled} />
                      </div>

                      <div className="hidden h-full items-stretch gap-1.5 md:flex">
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
                          className="h-full w-3.5 rounded-md border border-border bg-surface-2"
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
                          className="h-full w-3.5 rounded-md border border-border bg-surface-2"
                          soundEnabled={soundOn}
                        />
                      </div>
                    </>
                  )}
                </div>
              </section>

              {mode === "compare" ? (
                <section className="mt-2 grid grid-cols-1 items-stretch gap-4 lg:grid-cols-2">
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
                </section>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
