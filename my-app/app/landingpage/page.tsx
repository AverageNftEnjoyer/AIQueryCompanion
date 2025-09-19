
// /app/landingpage.tsx
"use client";

import type React from "react";
import { Suspense, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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

export const dynamic = "force-dynamic";

const CARD_HEIGHT = 580;
const MAX_QUERY_CHARS = 120_000;

type BusyMode = "analyze" | "compare" | null;
type LandingMode = "analyze" | "compare";

/** ---------- Top-level page exports a Suspense wrapper (fixes Vercel error) ---------- */
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

  const [lightUI, setLightUI] = useState<boolean>(false);
  const [soundOn, setSoundOn] = useState(true);
  const [syncEnabled, setSyncEnabled] = useState(true); 

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

  const handleToggleSound = () => {
    setSoundOn((v) => {
      const next = !v;
      if (!v) setTimeout(playSwitch, 0);
      return next;
    });
  };
  const handleToggleSync = () => {
    setSyncEnabled((v) => !v);
    playSwitch();
  };
  const toggleLightUI = () => {
    setLightUI((v) => !v);
    playSwitch();
  };

  const isLight = lightUI;
  const pageBgClass = isLight ? "bg-slate-100 text-slate-900" : "bg-neutral-950 text-white";
  const headerBgClass = isLight
    ? "bg-slate-50/95 border-slate-200 text-slate-900 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
    : "bg-black/30 border-white/10 text-white";

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

  // Only count chars for the fields relevant to the current mode
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

  // Analyze (SINGLE) — used when landingMode === "analyze"
  const handleAnalyze = () => {
    const src = newQuery.trim() ? newQuery : oldQuery.trim(); // fallback if needed
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

    // ⬇️ Preserve indentation: normalize only line endings, no reformatting
    const raw = src.replace(/\r\n/g, "\n");

    // Results page expects { mode: "single", singleQuery: string }
    sessionStorage.setItem("qa:payload", JSON.stringify({ mode: "single", singleQuery: raw }));
    sessionStorage.setItem("qa:allowSound", "1");
    window.location.href = "/results";
  };

  // Compare (DUAL) — used when landingMode === "compare"
  const handleCompare = () => {
    if (!oldQuery.trim() || !newQuery.trim()) {
      alert("Please provide both queries to compare");
      return;
    }
    if (!validateSizePair(oldQuery, newQuery)) return;

    setBusyMode("compare");
    setAnalysisError(null);

    // ⬇️ Preserve indentation: normalize only line endings, no reformatting
    const rawOld = oldQuery.replace(/\r\n/g, "\n");
    const rawNew = newQuery.replace(/\r\n/g, "\n");

    // Results page expects { mode: "compare", oldQuery, newQuery }
    sessionStorage.setItem("qa:payload", JSON.stringify({ mode: "compare", oldQuery: rawOld, newQuery: rawNew }));
    sessionStorage.setItem("qa:allowSound", "1");
    window.location.href = "/results";
  };

  return (
    <div className={`min-h-screen relative ${pageBgClass}`}>
      {isLight ? gridBgLight : gridBg}

      {/* ---------- Header replicated from Results/Home ---------- */}
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
                <BarChart3 className="w-5 h-5" />
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

        <div className="container mx-auto px-6 py-10">
          {uploadStatus.status && (
            <Alert
              className={`mb-8 ${isLight ? "bg-white" : "bg-black/40"} backdrop-blur border-white/15 ${
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
            <Alert className={`mb-8 ${isLight ? "bg-white border-red-500/40" : "bg-black/40 border-red-500/40"} backdrop-blur`}>
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
              <div className="grid lg:grid-cols-2 gap-8 mb-10">
                {/* Original Query */}
                <div>
                  <h3 className={`${isLight ? "text-slate-800" : "text-white/80"} text-sm font-medium mb-3`}>
                    Original Query
                  </h3>
                  <Card
                    className={`bg-white border-gray-200 shadow-lg flex flex-col ${charCountBadOld ? "ring-2 ring-red-400" : ""}`}
                    style={{ height: CARD_HEIGHT }}
                  >
                    <CardContent className="p-5 flex-1 flex flex-col min-h-0">
                      <div className="flex-1 min-h-0">
                        <Textarea
                          placeholder="Paste your original Oracle SQL query here..."
                          value={oldQuery}
                          onChange={(e) => setOldQuery(e.target.value)}
                          spellCheck={false}
                          className="h-full border-0 bg-white text-gray-800 placeholder:text-gray-500 font-mono text-sm resize-none focus:ring-0 focus:outline-none overflow-y-auto pt-2 pb-1 leading-tight"
                          onDragEnter={(e) => handleDragEnter(e, "old")}
                          onDragOver={handleDragOver}
                          onDragLeave={(e) => handleDragLeave(e, "old")}
                          onDrop={(e) => handleDrop(e, "old")}
                        />
                      </div>
                      <div className="flex items-center justify-center gap-3 pt-3 mt-4 border-t border-gray-200">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => oldFileInputRef.current?.click()}
                          className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                        >
                          <Upload className="w-4 h-4" /> Attach
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                        >
                          <FileText className="w-4 h-4" /> SQL
                        </Button>
                        {oldQuery && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => clearQuery("old")}
                            className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full w-8 h-8 p-0"
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
                        <p className="mt-2 text-xs text-red-600">
                          {oldQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Updated Query */}
                <div>
                  <h3 className={`${isLight ? "text-slate-800" : "text-white/80"} text-sm font-medium mb-3`}>
                    Updated Query
                  </h3>
                  <Card
                    className={`bg-white border-gray-200 shadow-lg flex flex-col ${charCountBadNew ? "ring-2 ring-red-400" : ""}`}
                    style={{ height: CARD_HEIGHT }}
                  >
                    <CardContent className="p-5 flex-1 flex flex-col min-h-0">
                      <div className="flex-1 min-h-0">
                        <Textarea
                          placeholder="Paste your updated Oracle SQL query here..."
                          value={newQuery}
                          onChange={(e) => setNewQuery(e.target.value)}
                          spellCheck={false}
                          className="h-full border-0 bg-white text-gray-800 placeholder:text-gray-500 font-mono text-sm resize-none focus:ring-0 focus:outline-none overflow-y-auto pt-2 pb-1 leading-tight"
                          onDragEnter={(e) => handleDragEnter(e, "new")}
                          onDragOver={handleDragOver}
                          onDragLeave={(e) => handleDragLeave(e, "new")}
                          onDrop={(e) => handleDrop(e, "new")}
                        />
                      </div>
                      <div className="flex items-center justify-center gap-3 pt-3 mt-4 border-t border-gray-200">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => newFileInputRef.current?.click()}
                          className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                        >
                          <Upload className="w-4 h-4" /> Attach
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                        >
                          <FileText className="w-4 h-4" /> SQL
                        </Button>
                        {newQuery && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => clearQuery("new")}
                            className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full w-8 h-8 p-0"
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
                        <p className="mt-2 text-xs text-red-600">
                          {newQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </div>

              {/* Compare Button ONLY */}
              <div className="flex items-center justify-center gap-3 mb-8">
                <Button
                  onClick={handleCompare}
                  disabled={busyMode !== null || !oldQuery.trim() || !newQuery.trim() || charCountBadOld || charCountBadNew}
                  size="lg"
                  className="px-8 py-3 font-heading font-medium text-base rounded-md bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white border border-white/10 shadow-md transition-all"
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
                    className="border-white/15 text-white/90 hover:bg-white/10"
                    title="Start a new comparison"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              {/* Analyze SINGLE: one upload box labeled "Upload Query" */}
              <div className="mb-10 mx-auto lg:w-1/2">
                <h3 className={`${isLight ? "text-slate-800" : "text-white/80"} text-sm font-medium mb-3`}>Upload Query</h3>
                <Card
                  className={`bg-white border-gray-200 shadow-lg flex flex-col ${charCountBadNew ? "ring-2 ring-red-400" : ""}`}
                  style={{ height: CARD_HEIGHT }}
                >
                  <CardContent className="p-5 flex-1 flex flex-col min-h-0">
                    <div className="flex-1 min-h-0">
                      <Textarea
                        placeholder="Paste your Oracle SQL query here..."
                        value={newQuery}
                        onChange={(e) => setNewQuery(e.target.value)}
                        spellCheck={false}
                        className="h-full border-0 bg-white text-gray-800 placeholder:text-gray-500 font-mono text-sm resize-none focus:ring-0 focus:outline-none overflow-y-auto pt-2 pb-1 leading-tight"
                        onDragEnter={(e) => handleDragEnter(e, "new")}
                        onDragOver={handleDragOver}
                        onDragLeave={(e) => handleDragLeave(e, "new")}
                        onDrop={(e) => handleDrop(e, "new")}
                      />
                    </div>
                    <div className="flex items-center justify-center gap-3 pt-3 mt-4 border-t border-gray-200">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => newFileInputRef.current?.click()}
                        className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                      >
                        <Upload className="w-4 h-4" /> Attach
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 rounded-lg px-3 py-1 text-sm flex items-center gap-2"
                      >
                        <FileText className="w-4 h-4" /> SQL
                      </Button>
                      {newQuery && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => clearQuery("new")}
                          className="text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-full w-8 h-8 p-0"
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
                      <p className="mt-2 text-xs text-red-600">
                        {newQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Analyze Button ONLY */}
              <div className="flex items-center justify-center gap-3 mb-8">
                <Button
                  onClick={handleAnalyze}
                  disabled={busyMode !== null || !newQuery.trim() || charCountBadNew}
                  size="lg"
                  className="px-8 py-3 font-heading font-medium text-base rounded-md bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500 text-white border border-white/10 shadow-md transition-all"
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
                    className="border-white/15 text-white/90 hover:bg-white/10"
                    title="Start a new analysis"
                  >
                    <X className="w-5 h-5" />
                  </Button>
                )}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
