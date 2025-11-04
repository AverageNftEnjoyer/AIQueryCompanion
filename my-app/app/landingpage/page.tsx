"use client";

import type React from "react";
import { Suspense, useMemo, useRef, useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Upload,
  FileText,
  Zap,
  GitCompare,
  CheckCircle,
  AlertCircle,
  X,
  Brain,
  Home,
  Bell,
  BellOff,
  Link2,
  Sun,
  Moon,
  BarChart3,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useUserPrefs } from "@/hooks/user-prefs";
import Waves from "@/components/waves";

export const dynamic = "force-dynamic";
const MAX_QUERY_CHARS = 140_000;

type BusyMode = "analyze" | "compare" | null;
type LandingMode = "analyze" | "compare";

/** ---------- Top-level page exports a Suspense wrapper ---------- */
export default function LandingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-sm text-gray-500">Loading…</div>}>
      <QueryAnalyzer />
    </Suspense>
  );
}

function QueryAnalyzer() {
  const search = useSearchParams();
  const initialMode = (search.get("mode") === "analyze" ? "analyze" : "compare") as LandingMode;
  const [landingMode] = useState<LandingMode>(initialMode);

  // ===== Shared user prefs =====
  const { isLight, soundOn, syncEnabled, setIsLight, setSoundOn, setSyncEnabled } = useUserPrefs();

  const switchAudioRef = useRef<HTMLAudioElement | null>(null);
  const playSwitch = () => {
    if (!soundOn) return;
    const el = switchAudioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = 0.5;
      el.play().catch(() => {});
    } catch {}
  };

  const handleToggleSound = useCallback(() => {
    setSoundOn((v) => {
      const next = !v;
      if (!v) setTimeout(playSwitch, 0);
      return next;
    });
  }, [setSoundOn]);

  const handleToggleSync = useCallback(() => {
    setSyncEnabled((v) => !v);
    playSwitch();
  }, [setSyncEnabled]);

  const toggleLightUI = useCallback(() => {
    setIsLight((v) => !v);
    playSwitch();
  }, [setIsLight]);

  // ===== Theme surfaces =====
  const pageBgClass = isLight ? "bg-white text-slate-900" : "bg-black text-white";
  const headerBgClass = isLight
    ? "bg-white/80 border-slate-200 text-slate-900 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
    : "bg-black/40 border-white/10 text-white";

  // Panels
  const panelCardClass = isLight
    ? "bg-white border-slate-200 shadow-lg"
    : "bg-white/5 border-white/10 backdrop-blur-sm hover:border-white/20 transition";
  const textareaClass = isLight
    ? "h-full border-0 bg-white text-slate-900 placeholder:text-slate-500 font-mono text-sm resize-none focus:ring-0 focus:outline-none overflow-y-auto pt-2 pb-1 leading-tight"
    : "h-full border-0 bg-white/0 text-white placeholder:text-white/60 font-mono text-sm resize-none focus:ring-0 focus:outline-none overflow-y-auto pt-2 pb-1 leading-tight";
  const footerBarClass = isLight ? "border-t border-slate-200" : "border-t border-white/10";
  const footerBtnGhost = isLight
    ? "text-slate-700 hover:text-slate-900 hover:bg-black/5 rounded-lg px-3 py-1 text-sm"
    : "text-white/80 hover:text-white hover:bg-white/10 rounded-lg px-3 py-1 text-sm";

  const primaryBtnClass =
    "px-6 md:px-8 py-3 font-heading font-medium text-base rounded-md text-white border border-white/10 shadow-md transition-all";
  const primaryAnalyze = "bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-500 hover:to-teal-600";
  const primaryCompare = "bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500";

  // ---- State ----
  const [oldQuery, setOldQuery] = useState("");
  const [newQuery, setNewQuery] = useState("");
  const [busyMode, setBusyMode] = useState<BusyMode>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    type: "old" | "new" | null;
    status: "success" | "error" | "uploading" | null;
    message: string;
    fileName?: string;
  }>({ type: null, status: null, message: "" });
  const [dragActive, setDragActive] = useState<{ old: boolean; new: boolean }>({ old: false, new: false });
  const oldFileInputRef = useRef<HTMLInputElement>(null);
  const newFileInputRef = useRef<HTMLInputElement>(null);

  const charCountBadOld = useMemo(() => oldQuery.length > MAX_QUERY_CHARS, [oldQuery]);
  const charCountBadNew = useMemo(() => newQuery.length > MAX_QUERY_CHARS, [newQuery]);

  // ---- File helpers ----
  const handleFileUpload = async (file: File, queryType: "old" | "new") => {
    setUploadStatus({ type: queryType, status: "uploading", message: "Reading file..." });

    if (!file.name.endsWith(".txt") && !file.name.endsWith(".sql")) {
      setUploadStatus({ type: queryType, status: "error", message: "Please upload a .txt or .sql file" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setUploadStatus({ type: queryType, status: "error", message: "File size must be less than 5MB" });
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = (e.target?.result as string) ?? "";
        if (content.trim().length === 0) {
          setUploadStatus({ type: queryType, status: "error", message: "File appears to be empty" });
          return;
        }
        if (content.length > MAX_QUERY_CHARS) {
          setUploadStatus({
            type: queryType,
            status: "error",
            message: `File too large for analysis (${content.length.toLocaleString()} > ${MAX_QUERY_CHARS.toLocaleString()} chars)`,
          });
          return;
        }
        if (queryType === "old") setOldQuery(content);
        else setNewQuery(content);

        setUploadStatus({
          type: queryType,
          status: "success",
          message: `Successfully loaded ${file.name}`,
          fileName: file.name,
        });
        setTimeout(() => setUploadStatus({ type: null, status: null, message: "" }), 3000);
      };
      reader.onerror = () => setUploadStatus({ type: queryType, status: "error", message: "Error reading file" });
      reader.readAsText(file);
    } catch {
      setUploadStatus({ type: queryType, status: "error", message: "Failed to process file" });
    }
  };

  const handleDragEnter = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive((prev) => ({ ...prev, [queryType]: true }));
  };
  const handleDragLeave = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive((prev) => ({ ...prev, [queryType]: false }));
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive((prev) => ({ ...prev, [queryType]: false }));
    const files = e.dataTransfer.files;
    if (files && files[0]) handleFileUpload(files[0], queryType);
  };
  const handleFileInputChange = (event: React.ChangeEvent<HTMLInputElement>, queryType: "old" | "new") => {
    const file = event.target.files?.[0];
    if (file) handleFileUpload(file, queryType);
  };
  const clearQuery = (queryType: "old" | "new") => {
    if (queryType === "old") {
      setOldQuery("");
      if (oldFileInputRef.current) oldFileInputRef.current.value = "";
    } else {
      setNewQuery("");
      if (newFileInputRef.current) newFileInputRef.current.value = "";
    }
    setUploadStatus({ type: null, status: null, message: "" });
  };

  const resetAll = () => {
    setOldQuery("");
    setNewQuery("");
    setAnalysisError(null);
    setUploadStatus({ type: null, status: null, message: "" });
    if (oldFileInputRef.current) oldFileInputRef.current.value = "";
    if (newFileInputRef.current) newFileInputRef.current.value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // ---- Actions ----
  const validateSizePair = (a: string, b: string) => {
    if (a.length > MAX_QUERY_CHARS || b.length > MAX_QUERY_CHARS) {
      setAnalysisError(
        `Each query must be ≤ ${MAX_QUERY_CHARS.toLocaleString()} characters. ` +
          `Current sizes: old=${a.length.toLocaleString()} new=${b.length.toLocaleString()}`
      );
      return false;
    }
    return true;
  };

  const handleAnalyze = () => {
    const src = newQuery.trim() ? newQuery : oldQuery.trim();
    if (!src) {
      alert("Please provide a query before analyzing");
      return;
    }
    if (src.length > MAX_QUERY_CHARS) {
      setAnalysisError(
        `Query must be ≤ ${MAX_QUERY_CHARS.toLocaleString()} characters. Current size: ${src.length.toLocaleString()}`
      );
      return;
    }

    setBusyMode("analyze");
    setAnalysisError(null);
    const raw = src.replace(/\r\n/g, "\n");
    sessionStorage.setItem("qa:payload", JSON.stringify({ mode: "single", singleQuery: raw }));
    sessionStorage.setItem("qa:allowSound", "1");
    window.location.href = "/results";
  };

  const handleCompare = () => {
    if (!oldQuery.trim() || !newQuery.trim()) {
      alert("Please provide both queries to compare");
      return;
    }
    if (!validateSizePair(oldQuery, newQuery)) return;

    setBusyMode("compare");
    setAnalysisError(null);
    const rawOld = oldQuery.replace(/\r\n/g, "\n");
    const rawNew = newQuery.replace(/\r\n/g, "\n");
    sessionStorage.setItem("qa:payload", JSON.stringify({ mode: "compare", oldQuery: rawOld, newQuery: rawNew }));
    sessionStorage.setItem("qa:allowSound", "1");
    window.location.href = "/results";
  };

  /* ---------------- Floating Mascot ---------------- */
  const botAudioRef = useRef<HTMLAudioElement | null>(null);

  const lines = useMemo(
    () => [
      "Welcome back. Drop your SQL here.",
      "Paste your query in the box!",
      "Upload your SQL file and lets go through the results.",
      "If you have two queries, I can compare them side by side.",
      "Not sure what changed? I’ll point it out!",
      "Attach a .sql or .txt file and I’ll handle the rest.",
      "Tip: Keep each query under 120,000 characters for the best experience.",
      "Did you know? You can drag and drop files directly into the box.",
      "I’ll highlight risky areas and suggest improvements.",
      "Paste your query and let’s see what we can learn.",
      "You can switch between light and dark themes anytime using the toggle above.",
      "Mute or unmute sounds with the bell icon in the header.",
    ],
    []
  );
  const [bubbleText, setBubbleText] = useState<string>("");
  const [showBubble, setShowBubble] = useState<boolean>(false);
  const [bubbleKey, setBubbleKey] = useState<number>(0);
  const bubbleTimerRef = useRef<number | null>(null);
  const bubbleDims = useMemo(() => {
    const len = (bubbleText || "").length;
    if (len <= 24) return { minW: 140, maxW: 260 };
    if (len <= 70) return { minW: 180, maxW: 480 };
    return { minW: 220, maxW: 720 };
  }, [bubbleText]);

  useEffect(() => {
    const a = botAudioRef.current;
    if (!a) return;
    a.muted = !soundOn;
    if (!soundOn) {
      try {
        a.pause();
        a.currentTime = 0;
      } catch {}
    }
  }, [soundOn]);

  useEffect(() => {
    return () => {
      if (bubbleTimerRef.current) {
        window.clearTimeout(bubbleTimerRef.current);
        bubbleTimerRef.current = null;
      }
    };
  }, []);

  const playBot = () => {
    if (!soundOn) return;
    const el = botAudioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = 0.6;
      el.play()?.catch(() => {});
    } catch {}
  };

  const handleMascotClick = () => {
    playBot();
    const next = lines[Math.floor(Math.random() * lines.length)];
    setBubbleText(next);
    setShowBubble(true);
    setBubbleKey((k) => k + 1);
    if (bubbleTimerRef.current) {
      window.clearTimeout(bubbleTimerRef.current);
    }
    bubbleTimerRef.current = window.setTimeout(() => {
      setShowBubble(false);
    }, 2600);
  };
  /* ---------------- End Floating Mascot ---------------- */

  return (
    <div className={`min-h-screen relative ${pageBgClass} home-page`}>
      {/* Waves background (black/white theme) */}
      <Waves
        className="pointer-events-none"
        backgroundColor={isLight ? "#ffffff" : "#000000"}
        lineColor={isLight ? "rgba(0,0,0,0.20)" : "rgba(255,255,255,0.22)"}
        waveSpeedX={0.01}
        waveSpeedY={0.006}
        waveAmpX={28}
        waveAmpY={14}
        xGap={12}
        yGap={28}
        friction={0.92}
        tension={0.006}
        maxCursorMove={90}
        style={{ opacity: 0.9 }}
      />

      {/* ---------- Header ---------- */}
      <header className={`relative z-10 border ${headerBgClass} backdrop-blur`}>
        <div className="mx-auto w-full max-w-[1800px] px-3 md:px-4 lg:px-6 py-4">
          <div className="grid grid-cols-3 items-center gap-3">
            {/* Left: Home */}
            <div className="flex">
              <Link
                href="/"
                onClick={() => playSwitch()}
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
                  {landingMode === "analyze" ? "AI-Powered Query Companion — Analyze" : "AI-Powered Query Companion — Compare"}
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

      {/* ---------- Body ---------- */}
      <main className="relative z-10">
        <audio ref={switchAudioRef} src="/switch.mp3" preload="metadata" muted={!soundOn} />
        <audio ref={botAudioRef} src="/bot.mp3" preload="metadata" muted={!soundOn} />

        <div className="container mx-auto px-4 md:px-6 lg:px-8 py-8 md:py-10">
          {uploadStatus.status && (
            <Alert
              className={`mb-6 md:mb-8 ${isLight ? "bg-white" : "bg-black/40"} backdrop-blur border-white/15 ${
                uploadStatus.status === "error" ? "border-red-500/40" : "border-emerald-500/40"
              }`}
            >
              <div className="flex items-center gap-3">
                {uploadStatus.status === "success" && <CheckCircle className="w-5 h-5 text-emerald-500" />}
                {uploadStatus.status === "error" && <AlertCircle className="w-5 h-5 text-red-500" />}
                {uploadStatus.status === "uploading" && <Brain className="w-5 h-5 animate-pulse text-indigo-400" />}
                <AlertDescription className={`${isLight ? "text-gray-800" : "text-gray-200"} flex-1`}>
                  {uploadStatus.message}
                </AlertDescription>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setUploadStatus({ type: null, status: null, message: "" })}
                  className={`${isLight ? "text-gray-600 hover:text-gray-900" : "text-gray-400 hover:text-white"}`}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            </Alert>
          )}

          {analysisError && (
            <Alert className={`mb-6 md:mb-8 ${isLight ? "bg-white border-red-500/40" : "bg-black/40 border-red-500/40"} backdrop-blur`}>
              <AlertCircle className="w-5 h-5 text-red-500" />
              <AlertDescription className={`${isLight ? "text-gray-800" : "text-gray-200"} flex-1`}>
                <strong>Analysis Error:</strong> {analysisError}
              </AlertDescription>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAnalysisError(null)}
                className={`${isLight ? "text-gray-600 hover:text-gray-900" : "text-gray-400 hover:text-white"}`}
              >
                <X className="w-4 h-4" />
              </Button>
            </Alert>
          )}

          {/* ====== BODY VARIANTS ====== */}
          {landingMode === "compare" ? (
            <>
              <div className="max-w-6xl mx-auto">
                <h2 className={`text-3xl md:text-4xl font-light text-center mb-6 md:mb-8 ${isLight ? "text-slate-900" : "text-white"}`}>
                  Compare Queries
                </h2>

                <div className="grid lg:grid-cols-2 gap-6 md:gap-8 mb-6 md:mb-8">
                  {/* Original Query */}
                  <div>
                    <h3 className={`${isLight ? "text-slate-800" : "text-white/85"} text-sm font-medium mb-2 md:mb-3`}>Original Query</h3>
                    <Card className={`${panelCardClass} flex flex-col ${charCountBadOld ? "ring-2 ring-red-400/70" : ""} card-dyn`}>
                      <CardContent className="p-4 md:p-5 flex-1 flex flex-col min_h-0 min-h-0">
                        <div className="flex-1 min-h-0">
                          <Textarea
                            placeholder="Paste your original Oracle SQL query here..."
                            value={oldQuery}
                            onChange={(e) => setOldQuery(e.target.value)}
                            spellCheck={false}
                            className={textareaClass}
                            onDragEnter={(e) => handleDragEnter(e, "old")}
                            onDragOver={handleDragOver}
                            onDragLeave={(e) => handleDragLeave(e, "old")}
                            onDrop={(e) => handleDrop(e, "old")}
                          />
                        </div>
                        <div className={`flex items-center justify-center gap-3 pt-3 mt-4 ${footerBarClass}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => oldFileInputRef.current?.click()}
                            className={footerBtnGhost + " flex items-center gap-2"}
                          >
                            <Upload className="w-4 h-4" /> Attach
                          </Button>
                          <Button variant="ghost" size="sm" className={footerBtnGhost + " flex items-center gap-2"}>
                            <FileText className="w-4 h-4" /> SQL
                          </Button>
                          {oldQuery && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => clearQuery("old")}
                              className={
                                isLight
                                  ? "text-slate-500 hover:text-slate-700 hover:bg-black/5 rounded-full w-8 h-8 p-0"
                                  : "text-white/70 hover:text-white hover:bg-white/10 rounded-full w-8 h-8 p-0"
                              }
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                        <input
                          ref={oldFileInputRef}
                          type="file"
                          accept=".txt,.sql"
                          onChange={(e) => handleFileInputChange(e, "old")}
                          className="hidden"
                        />
                        {charCountBadOld && (
                          <p className="mt-2 text-xs text-red-400">
                            {oldQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Updated Query */}
                  <div>
                    <h3 className={`${isLight ? "text-slate-800" : "text-white/85"} text-sm font-medium mb-2 md:mb-3`}>Updated Query</h3>
                    <Card className={`${panelCardClass} flex flex-col ${charCountBadNew ? "ring-2 ring-red-400/70" : ""} card-dyn`}>
                      <CardContent className="p-4 md:p-5 flex-1 flex flex-col min-h-0">
                        <div className="flex-1 min-h-0">
                          <Textarea
                            placeholder="Paste your updated Oracle SQL query here..."
                            value={newQuery}
                            onChange={(e) => setNewQuery(e.target.value)}
                            spellCheck={false}
                            className={textareaClass}
                            onDragEnter={(e) => handleDragEnter(e, "new")}
                            onDragOver={handleDragOver}
                            onDragLeave={(e) => handleDragLeave(e, "new")}
                            onDrop={(e) => handleDrop(e, "new")}
                          />
                        </div>
                        <div className={`flex items-center justify-center gap-3 pt-3 mt-4 ${footerBarClass}`}>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => newFileInputRef.current?.click()}
                            className={footerBtnGhost + " flex items-center gap-2"}
                          >
                            <Upload className="w-4 h-4" /> Attach
                          </Button>
                          <Button variant="ghost" size="sm" className={footerBtnGhost + " flex items-center gap-2"}>
                            <FileText className="w-4 h-4" /> SQL
                          </Button>
                          {newQuery && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => clearQuery("new")}
                              className={
                                isLight
                                  ? "text-slate-500 hover:text-slate-700 hover:bg-black/5 rounded-full w-8 h-8 p-0"
                                  : "text-white/70 hover:text-white hover:bg-white/10 rounded-full w-8 h-8 p-0"
                              }
                            >
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                        <input
                          ref={newFileInputRef}
                          type="file"
                          accept=".txt,.sql"
                          onChange={(e) => handleFileInputChange(e, "new")}
                          className="hidden"
                        />
                        {charCountBadNew && (
                          <p className="mt-2 text-xs text-red-400">
                            {newQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                          </p>
                        )}
                      </CardContent>
                    </Card>
                  </div>
                </div>
              </div>

              {/* Compare Button */}
              <div className="sticky-buttons">
                <div className="flex items-center justify-center gap-3">
                  <Button
                    onClick={handleCompare}
                    disabled={busyMode !== null || !oldQuery.trim() || !newQuery.trim() || charCountBadOld || charCountBadNew}
                    size="lg"
                    className={`${primaryBtnClass} ${primaryCompare}`}
                    title={!oldQuery.trim() || !newQuery.trim() ? "Paste both queries to enable" : undefined}
                  >
                    {busyMode === "compare" ? (
                      <div className="flex items-center gap-3">
                        <div className="flex items-end gap-0.5 mr-1">
                          <span className="w-1.5 h-3 bg-white/90 rounded-sm animate-bounce" />
                          <span className="w-1.5 h-4 bg-white/80 rounded-sm animate-bounce" style={{ animationDelay: "120ms" }} />
                          <span className="w-1.5 h-5 bg-white/70 rounded-sm animate-bounce" style={{ animationDelay: "240ms" }} />
                        </div>
                        <span className="relative">
                          <span className="opacity-90">Comparing</span>
                          <span className="absolute inset-0 bg-white/10 blur-sm rounded-sm animate-pulse" />
                        </span>
                      </div>
                    ) : (
                      <>
                        <GitCompare className="w-5 h-5 mr-2" /> Compare
                      </>
                    )}
                  </Button>

                  {(oldQuery || newQuery) && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetAll}
                      className={isLight ? "border-slate-200 text-slate-800 hover:bg-black/5" : "border-white/15 text-white/90 hover:bg-white/10"}
                      title="Start a new comparison"
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  )}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="max-w-3xl mx-auto">
                <h2 className={`text-3xl md:text-4xl font-light text-center mb-6 md:mb-8 ${isLight ? "text-slate-900" : "text-white"}`}>
                  Analyze a Single Query
                </h2>

                <div className="mb-6 md:mb-8">
                  <h3 className={`${isLight ? "text-slate-800" : "text-white/85"} text-sm font-medium mb-2 md:mb-3`}>Upload Query</h3>
                  <Card className={`${panelCardClass} flex flex-col ${charCountBadNew ? "ring-2 ring-red-400/70" : ""} card-dyn`}>
                    <CardContent className="p-4 md:p-5 flex-1 flex flex-col min-h-0">
                      <div className="flex-1 min-h-0">
                        <Textarea
                          placeholder="Paste your Oracle SQL query here..."
                          value={newQuery}
                          onChange={(e) => setNewQuery(e.target.value)}
                          spellCheck={false}
                          className={textareaClass}
                          onDragEnter={(e) => handleDragEnter(e, "new")}
                          onDragOver={handleDragOver}
                          onDragLeave={(e) => handleDragLeave(e, "new")}
                          onDrop={(e) => handleDrop(e, "new")}
                        />
                      </div>
                      <div className={`flex items-center justify-center gap-3 pt-3 mt-4 ${footerBarClass}`}>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => newFileInputRef.current?.click()}
                          className={footerBtnGhost + " flex items-center gap-2"}
                        >
                          <Upload className="w-4 h-4" /> Attach
                        </Button>
                        <Button variant="ghost" size="sm" className={footerBtnGhost + " flex items-center gap-2"}>
                          <FileText className="w-4 h-4" /> SQL
                        </Button>
                        {newQuery && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => clearQuery("new")}
                            className={
                              isLight
                                ? "text-slate-500 hover:text-slate-700 hover:bg-black/5 rounded-full w-8 h-8 p-0"
                                : "text-white/70 hover:text-white hover:bg-white/10 rounded-full w-8 h-8 p-0"
                            }
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                      <input
                        ref={newFileInputRef}
                        type="file"
                        accept=".txt,.sql"
                        onChange={(e) => handleFileInputChange(e, "new")}
                        className="hidden"
                      />
                      {charCountBadNew && (
                        <p className="mt-2 text-xs text-red-400">
                          {newQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* Analyze Button */}
              <div className="sticky-buttons">
                <div className="flex items-center justify-center gap-3">
                  <Button
                    onClick={handleAnalyze}
                    disabled={busyMode !== null || !newQuery.trim() || charCountBadNew}
                    size="lg"
                    className={`${primaryBtnClass} ${primaryAnalyze}`}
                    title={!newQuery.trim() ? "Paste a query to enable" : undefined}
                  >
                    {busyMode === "analyze" ? (
                      <div className="flex items-center gap-3">
                        <div className="flex items-end gap-0.5 mr-1">
                          <span className="w-1.5 h-3 bg-white/90 rounded-sm animate-bounce" />
                          <span className="w-1.5 h-4 bg-white/80 rounded-sm animate-bounce" style={{ animationDelay: "120ms" }} />
                          <span className="w-1.5 h-5 bg-white/70 rounded-sm animate-bounce" style={{ animationDelay: "240ms" }} />
                        </div>
                        <span className="relative">
                          <span className="opacity-90">Analyzing</span>
                          <span className="absolute inset-0 bg-white/10 blur-sm rounded-sm animate-pulse" />
                        </span>
                      </div>
                    ) : (
                      <>
                        <Zap className="w-5 h-5 mr-2" /> Analyze
                      </>
                    )}
                  </Button>

                  {newQuery && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={resetAll}
                      className={isLight ? "border-slate-200 text-slate-800 hover:bg-black/5" : "border-white/15 text-white/90 hover:bg-white/10"}
                      title="Start a new analysis"
                    >
                      <X className="w-5 h-5" />
                    </Button>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Floating mascot + speech bubble */}
        <div
          className="
            mascot-wrap
            fixed
            bottom-2 sm:bottom-3 md:bottom-4
            right-[-8px] sm:right-[-12px] md:right-[-18px] lg:right-[-24px]
            z-[60]
            select-none
          "
        >
          {showBubble && (
            <div
              key={bubbleKey}
              className={`pointer-events-none absolute right-28 bottom-[calc(90%)]
                inline-block w-auto
                ${isLight ? "bg-white text-slate-900 border-slate-200" : "bg-neutral-900/90 text-white border-white/10"}
                border shadow-xl rounded-xl px-4 py-3 animate-speech-pop`}
              style={{
                filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.35))",
                minWidth: `${bubbleDims.minW}px`,
                maxWidth: `${bubbleDims.maxW}px`,
              }}
              aria-live="polite"
            >
              <span
                className="block text-sm md:text-[0.95rem] leading-normal break-words whitespace-normal [text-wrap:pretty]"
                style={{ hyphens: "auto", wordBreak: "break-word" }}
              >
                {bubbleText}
              </span>

              <span
                className={`absolute -bottom-1.5 right-8 w-3 h-3 rotate-45 
                  ${isLight ? "bg-white border-r border-b border-slate-200" : "bg-neutral-900/90 border-r border-b border-white/10"}`}
              />
            </div>
          )}

          <button type="button" onClick={handleMascotClick} aria-label="Play bot sound" className="block">
            <Image
              src="/icon.png"
              alt="Query Companion"
              width={256}
              height={256}
              priority
              draggable={false}
              className="
                block
                w-56 h-56 md:w-64 md:h-64
                rounded-2xl
                animate-mascot-float
              "
              style={{
                filter: "drop-shadow(0 0 6px rgba(0,0,0,0.45))",
                outline: "none",
              }}
              sizes="(min-width: 768px) 16rem, 14rem"
            />
          </button>
        </div>

        <style>{`
          @keyframes slide-up { 0%{opacity:0; transform:translateY(30px);} 100%{opacity:1; transform:translateY(0);} }
          @keyframes bounce-subtle { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-5px);} }
          .animate-bounce-subtle { animation: bounce-subtle 2s ease-in-out infinite; }
          .animate-slide-up { animation: slide-up .8s ease-out; }

          /* Responsive card height so buttons remain visible on laptops/short screens */
          .card-dyn { height: 580px; }
          @media (max-height: 900px) {
            .card-dyn { height: 520px; }
          }
          @media (max-height: 800px) {
            .card-dyn { height: 460px; }
          }
          @media (max-height: 720px) {
            .card-dyn { height: 420px; }
          }

          .sticky-buttons {
          position: sticky;
          bottom: 14px;
          z-index: 30;
          padding: 8px 0;
          background: transparent;
          backdrop-filter: none;
          -webkit-backdrop-filter: none;
        }

          /* Floating icon subtle idle motion */
          @keyframes mascot-float {
            0%, 100% { transform: translateY(0); }
            50%      { transform: translateY(-6px); }
          }
          .animate-mascot-float { animation: mascot-float 3s ease-in-out infinite; }

          /* Speech bubble pop */
          @keyframes speech-pop {
            0%   { opacity: 0; transform: translateY(8px) scale(.95); }
            60%  { opacity: 1; transform: translateY(-2px) scale(1.02); }
            100% { opacity: 1; transform: translateY(0) scale(1); }
          }
          .animate-speech-pop { animation: speech-pop .28s cubic-bezier(.2,.8,.2,1) both; }

          @media (max-width: 1536px) and (min-width: 1024px) {
            html { zoom: .90; }
          }
          @media (max-width: 1366px) and (min-width: 1024px) {
            html { zoom: .85; }
          }

          @media (max-width: 1536px) {
            .mascot-wrap { right: -24px !important; bottom: 6px !important; }
          }
          @media (max-width: 1366px) {
            .mascot-wrap { right: -32px !important; bottom: 6px !important; }
          }
        `}</style>
      </main>
    </div>
  );
}
