"use client";

import type React from "react";
import { Suspense, useMemo, useRef, useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Textarea } from "@/components/ui/textarea";
import {
  Upload,
  FileText,
  CheckCircle,
  AlertCircle,
  X,
  Brain,
  Database,
  Zap,
} from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useUserPrefs } from "@/hooks/user-prefs";
import { AppHeader } from "@/components/app-header";

export const dynamic = "force-dynamic";
const MAX_QUERY_CHARS = 160_000;

type BusyMode = "analyze" | "compare" | null;
type LandingMode = "analyze" | "compare";

export default function LandingPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
      <QueryLensLandingContent />
    </Suspense>
  );
}

function QueryLensLandingContent() {
  const search = useSearchParams();
  const initialMode: LandingMode = search?.get("mode") === "analyze" ? "analyze" : "compare";
  const [landingMode] = useState<LandingMode>(initialMode);

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

  type UFile = { name: string; content: string };

  const [oldQuery, setOldQuery] = useState("");
  const [newQuery, setNewQuery] = useState("");
  const [oldFiles, setOldFiles] = useState<UFile[]>([]);
  const [newFiles, setNewFiles] = useState<UFile[]>([]);
  const [busyMode, setBusyMode] = useState<BusyMode>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{
    type: "old" | "new" | null;
    status: "success" | "error" | "uploading" | null;
    message: string;
    fileName?: string;
  }>({ type: null, status: null, message: "" });
  const [_dragActive, setDragActive] = useState<{ old: boolean; new: boolean }>({ old: false, new: false });
  const oldFileInputRef = useRef<HTMLInputElement>(null);
  const newFileInputRef = useRef<HTMLInputElement>(null);
  const charCountBadOld = useMemo(() => oldQuery.length > MAX_QUERY_CHARS, [oldQuery]);
  const charCountBadNew = useMemo(() => newQuery.length > MAX_QUERY_CHARS, [newQuery]);

  const readOne = (file: File) =>
    new Promise<UFile>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve({ name: file.name, content: String(e.target?.result ?? "") });
      reader.onerror = () => reject(new Error("read error"));
      reader.readAsText(file);
    });

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
      const { content, name } = await readOne(file);
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
      if (queryType === "old") {
        setOldQuery(content);
        setOldFiles((p) => [...p.filter((f) => f.name !== name), { name, content }]);
      } else {
        setNewQuery(content);
        setNewFiles((p) => [...p.filter((f) => f.name !== name), { name, content }]);
      }
      setUploadStatus({ type: queryType, status: "success", message: `Successfully loaded ${name}`, fileName: name });
      setTimeout(() => setUploadStatus({ type: null, status: null, message: "" }), 3000);
    } catch {
      setUploadStatus({ type: queryType, status: "error", message: "Failed to process file" });
    }
  };

  const handleDragEnter = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive((p) => ({ ...p, [queryType]: true }));
  };
  const handleDragLeave = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive((p) => ({ ...p, [queryType]: false }));
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };
  const handleDrop = (e: React.DragEvent, queryType: "old" | "new") => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive((p) => ({ ...p, [queryType]: false }));
    const list = Array.from(e.dataTransfer.files ?? []);
    list.forEach((f) => handleFileUpload(f, queryType));
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>, queryType: "old" | "new") => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    for (const f of files) {
      if (!(f.name.endsWith(".txt") || f.name.endsWith(".sql"))) continue;
      if (f.size > 5 * 1024 * 1024) continue;
      await handleFileUpload(f, queryType);
    }
  };

  const clearQuery = (queryType: "old" | "new") => {
    if (queryType === "old") {
      setOldQuery("");
      if (oldFileInputRef.current) oldFileInputRef.current.value = "";
      setOldFiles([]);
    } else {
      setNewQuery("");
      if (newFileInputRef.current) newFileInputRef.current.value = "";
      setNewFiles([]);
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
    setOldFiles([]);
    setNewFiles([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const validateSizePair = (a: string, b: string) => {
    if (a.length > MAX_QUERY_CHARS || b.length > MAX_QUERY_CHARS) {
      setAnalysisError(
        `Each query must be <= ${MAX_QUERY_CHARS.toLocaleString()} characters. current: old=${a.length.toLocaleString()} new=${b.length.toLocaleString()}`
      );
      return false;
    }
    return true;
  };

  const persistNavigationPayload = (payload: unknown): boolean => {
    try {
      sessionStorage.setItem("qa:payload", JSON.stringify(payload));
      sessionStorage.setItem("qa:allowSound", "1");
      return true;
    } catch {
      setAnalysisError("Unable to save analysis payload in browser storage. Reduce file count or size and try again.");
      return false;
    }
  };

  // ===== Compare helpers (multi) =====
  type QueryPair = { oldQuery: string; newQuery: string; oldName?: string; newName?: string };

  const stem = (n: string) => n.replace(/\.(sql|txt)$/i, "").toLowerCase();
  const buildPairs = () => {
    const bucketByStem = (files: UFile[]) => {
      const out = new Map<string, UFile[]>();
      for (const file of files) {
        const key = stem(file.name);
        const bucket = out.get(key);
        if (bucket) bucket.push(file);
        else out.set(key, [file]);
      }
      return out;
    };

    const byStemOld = bucketByStem(oldFiles);
    const byStemNew = bucketByStem(newFiles);
    const pairs: QueryPair[] = [];
    const unmatchedOld: UFile[] = [];
    const unmatchedNew: UFile[] = [];

    for (const [key, oldBucket] of byStemOld) {
      const newBucket = byStemNew.get(key) ?? [];
      const pairCount = Math.min(oldBucket.length, newBucket.length);
      for (let i = 0; i < pairCount; i++) {
        const oldFile = oldBucket[i];
        const newFile = newBucket[i];
        pairs.push({
          oldQuery: oldFile.content,
          newQuery: newFile.content,
          oldName: oldFile.name,
          newName: newFile.name,
        });
      }
      if (oldBucket.length > newBucket.length) {
        unmatchedOld.push(...oldBucket.slice(pairCount));
      }
    }

    for (const [key, newBucket] of byStemNew) {
      const oldBucket = byStemOld.get(key) ?? [];
      const pairCount = Math.min(oldBucket.length, newBucket.length);
      if (newBucket.length > oldBucket.length) {
        unmatchedNew.push(...newBucket.slice(pairCount));
      }
    }

    // For exactly one old + one new file, allow manual compare even if names differ.
    if (pairs.length === 0 && oldFiles.length === 1 && newFiles.length === 1) {
      return {
        pairs: [
          {
            oldQuery: oldFiles[0].content,
            newQuery: newFiles[0].content,
            oldName: oldFiles[0].name,
            newName: newFiles[0].name,
          },
        ],
        unmatchedOld: [] as UFile[],
        unmatchedNew: [] as UFile[],
      };
    }

    return { pairs, unmatchedOld, unmatchedNew };
  };

  // ===== Actions =====
  const handleAnalyze = () => {
    if (newFiles.length > 0) {
      const items = newFiles
        .map((f) => ({
          name: f.name || "Query.sql",
          content: f.content.replace(/\r\n/g, "\n"),
        }))
        .filter((i) => i.content.trim().length > 0 && i.content.length <= MAX_QUERY_CHARS);

      if (!items.length) {
        alert("Upload at least one non-empty .sql/.txt file within size limits");
        return;
      }

      setBusyMode("analyze");
      if (!persistNavigationPayload({ mode: "single", files: items })) {
        setBusyMode(null);
        return;
      }
      window.location.href = "/results";
      return;
    }

    const src = newQuery.trim() ? newQuery : oldQuery.trim();
    if (!src) {
      alert("Paste a query to analyze");
      return;
    }
    if (src.length > MAX_QUERY_CHARS) {
      setAnalysisError(`Query must be <= ${MAX_QUERY_CHARS.toLocaleString()} characters. current: ${src.length.toLocaleString()}`);
      return;
    }
    setBusyMode("analyze");
    const raw = src.replace(/\r\n/g, "\n");
    if (!persistNavigationPayload({ mode: "single", files: [{ name: "Query_1.sql", content: raw }] })) {
      setBusyMode(null);
      return;
    }
    window.location.href = "/results";
  };

  const handleCompare = () => {
    if (oldFiles.length > 0 || newFiles.length > 0) {
      const { pairs, unmatchedOld, unmatchedNew } = buildPairs();
      if (!pairs.length) {
        alert("No matching file pairs found. Use the same base filename for old/new files.");
        return;
      }
      if (unmatchedOld.length || unmatchedNew.length) {
        setAnalysisError(
          `Matched ${pairs.length} pair(s). Ignored unmatched files: old=${unmatchedOld.length}, new=${unmatchedNew.length}.`
        );
      } else {
        setAnalysisError(null);
      }
      const ok = pairs.every(
        (p) => p.oldQuery && p.newQuery && p.oldQuery.length <= MAX_QUERY_CHARS && p.newQuery.length <= MAX_QUERY_CHARS
      );
      if (!ok) {
        alert("One or more files are empty or exceed size limit");
        return;
      }
      setBusyMode("compare");
      if (!persistNavigationPayload({ mode: "compare-multi", pairs })) {
        setBusyMode(null);
        return;
      }
      window.location.href = "/results";
      return;
    }

    if (!oldQuery.trim() || !newQuery.trim()) {
      alert("Provide both queries");
      return;
    }
    if (!validateSizePair(oldQuery, newQuery)) return;
    setBusyMode("compare");
    if (
      !persistNavigationPayload({
        mode: "compare",
        oldQuery: oldQuery.replace(/\r\n/g, "\n"),
        newQuery: newQuery.replace(/\r\n/g, "\n"),
      })
    ) {
      setBusyMode(null);
      return;
    }
    window.location.href = "/results";
  };

  const routeLabel = landingMode === "analyze" ? "Analysis mode" : "Compare mode";
  const charCount = landingMode === "compare" ? Math.max(oldQuery.length, newQuery.length) : newQuery.length;

  return (
    <div className="relative flex min-h-screen flex-col bg-background text-foreground">
      <AppHeader
        routeLabel={routeLabel}
        syncEnabled={syncEnabled}
        onToggleSync={handleToggleSync}
        isLight={isLight}
        onToggleTheme={toggleLightUI}
        soundOn={soundOn}
        onToggleSound={handleToggleSound}
      />

      <audio ref={switchAudioRef} src="/switch.mp3" preload="metadata" muted={!soundOn} />

      <main className="flex flex-1 flex-col px-5 pb-6 pt-8 md:px-7">
        {uploadStatus.status && (
          <Alert
            className={`mb-5 rounded-md border bg-card ${
              uploadStatus.status === "error" ? "border-destructive" : "border-border"
            }`}
          >
            <div className="flex items-center gap-3">
              {uploadStatus.status === "success" && <CheckCircle className="h-5 w-5 text-diff-add-fg" />}
              {uploadStatus.status === "error" && <AlertCircle className="h-5 w-5 text-destructive" />}
              {uploadStatus.status === "uploading" && <Brain className="h-5 w-5 animate-pulse text-accent-on-ground" />}
              <AlertDescription className="flex-1 text-foreground">{uploadStatus.message}</AlertDescription>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setUploadStatus({ type: null, status: null, message: "" })}
                className="h-8 w-8 p-0 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Alert>
        )}

        {analysisError && (
          <Alert className="mb-5 rounded-md border border-destructive bg-card">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-destructive" />
              <AlertDescription className="flex-1 text-foreground">
                <strong>Analysis error:</strong> {analysisError}
              </AlertDescription>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setAnalysisError(null)}
                className="h-8 w-8 p-0 text-muted-foreground hover:bg-surface-2 hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </Alert>
        )}

        {landingMode === "compare" ? (
          <>
            <div className="flex items-end justify-between gap-6 border-b border-border pb-4">
              <div>
                <h1 className="mb-1.5 font-heading text-3xl font-semibold tracking-[-0.01em] text-foreground">
                  Compare queries
                </h1>
                <p className="text-sm text-muted-foreground">
                  Paste both revisions, or attach matching .sql files — pairs are matched by filename.
                </p>
              </div>
              <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {charCount.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} chars
              </span>
            </div>

            <div className="mt-5 grid flex-1 grid-cols-1 gap-5 lg:grid-cols-2" style={{ minHeight: 0 }}>
              <div className={`flex h-[46vh] min-h-[340px] flex-col rounded-md border bg-card lg:h-full ${charCountBadOld ? "border-destructive" : "border-border"}`}>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
                    Original query
                  </span>
                  <span className="text-xs text-muted-foreground">v1</span>
                </div>
                <div className="min-h-0 flex-1 bg-code-bg p-4">
                  <Textarea
                    placeholder="Paste your original Oracle SQL query here..."
                    value={oldQuery}
                    onChange={(e) => setOldQuery(e.target.value)}
                    spellCheck={false}
                    className="h-full resize-none border-0 bg-transparent p-0 font-mono text-[13px] leading-[1.5] text-code-fg placeholder:text-muted-foreground focus-visible:ring-0"
                    onDragEnter={(e) => handleDragEnter(e, "old")}
                    onDragOver={handleDragOver}
                    onDragLeave={(e) => handleDragLeave(e, "old")}
                    onDrop={(e) => handleDrop(e, "old")}
                  />
                </div>
                <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => oldFileInputRef.current?.click()}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-[13px] text-foreground transition hover:bg-surface-2"
                  >
                    <Upload className="h-[15px] w-[15px]" /> Attach
                  </button>
                  <span className="inline-flex h-8 items-center gap-2 text-[13px] text-muted-foreground">
                    <FileText className="h-[15px] w-[15px]" /> {oldFiles[0]?.name ?? "SQL"}
                  </span>
                  {oldQuery && (
                    <button
                      type="button"
                      onClick={() => clearQuery("old")}
                      className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <input ref={oldFileInputRef} type="file" accept=".txt,.sql" multiple onChange={(e) => handleFileInputChange(e, "old")} className="hidden" />
                </div>
                {oldFiles.length > 1 && (
                  <p className="px-3 pb-2 text-xs text-muted-foreground">{oldFiles.length} files loaded</p>
                )}
                {charCountBadOld && (
                  <p className="px-3 pb-2 text-xs text-destructive">
                    {oldQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                  </p>
                )}
              </div>

              <div className={`flex h-[46vh] min-h-[340px] flex-col rounded-md border bg-card lg:h-full ${charCountBadNew ? "border-destructive" : "border-border"}`}>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
                    Updated query
                  </span>
                  <span className="text-xs text-muted-foreground">v2</span>
                </div>
                <div className="min-h-0 flex-1 bg-code-bg p-4">
                  <Textarea
                    placeholder="Paste your updated Oracle SQL query here..."
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    spellCheck={false}
                    className="h-full resize-none border-0 bg-transparent p-0 font-mono text-[13px] leading-[1.5] text-code-fg placeholder:text-muted-foreground focus-visible:ring-0"
                    onDragEnter={(e) => handleDragEnter(e, "new")}
                    onDragOver={handleDragOver}
                    onDragLeave={(e) => handleDragLeave(e, "new")}
                    onDrop={(e) => handleDrop(e, "new")}
                  />
                </div>
                <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => newFileInputRef.current?.click()}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-[13px] text-foreground transition hover:bg-surface-2"
                  >
                    <Upload className="h-[15px] w-[15px]" /> Attach
                  </button>
                  <span className="inline-flex h-8 items-center gap-2 text-[13px] text-muted-foreground">
                    <FileText className="h-[15px] w-[15px]" /> {newFiles[0]?.name ?? "SQL"}
                  </span>
                  {newQuery && (
                    <button
                      type="button"
                      onClick={() => clearQuery("new")}
                      className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                  <input ref={newFileInputRef} type="file" accept=".txt,.sql" multiple onChange={(e) => handleFileInputChange(e, "new")} className="hidden" />
                </div>
                {newFiles.length > 1 && (
                  <p className="px-3 pb-2 text-xs text-muted-foreground">{newFiles.length} files loaded</p>
                )}
                {charCountBadNew && (
                  <p className="px-3 pb-2 text-xs text-destructive">
                    {newQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                  </p>
                )}
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
              <span className="text-[13px] text-muted-foreground">Both panes required. Files over 5 MB are rejected.</span>
              <div className="flex items-center gap-2.5">
                {(Boolean(oldQuery) || Boolean(newQuery) || oldFiles.length > 0 || newFiles.length > 0) && (
                  <button
                    type="button"
                    onClick={resetAll}
                    className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm text-foreground transition hover:bg-surface-2"
                    title="Start a new comparison"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCompare}
                  disabled={
                    busyMode !== null ||
                    (oldFiles.length === 0 && newFiles.length === 0 && (!oldQuery.trim() || !newQuery.trim())) ||
                    charCountBadOld ||
                    charCountBadNew
                  }
                  className="inline-flex h-10 items-center gap-2.5 rounded-md bg-primary px-[22px] font-heading text-sm font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:opacity-45 disabled:pointer-events-none"
                >
                  {busyMode === "compare" ? "Comparing…" : "Compare"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-end justify-between gap-6 border-b border-border pb-4">
              <div>
                <h1 className="mb-1.5 font-heading text-3xl font-semibold tracking-[-0.01em] text-foreground">
                  Analyze a single query
                </h1>
                <p className="text-sm text-muted-foreground">
                  One query in, a full review out: metrics, hardcoded values and a written summary.
                </p>
              </div>
              <span className="whitespace-nowrap font-mono text-xs text-muted-foreground">
                {newFiles.length > 0 ? `${newFiles.length} file${newFiles.length > 1 ? "s" : ""} loaded` : `${charCount.toLocaleString()} / ${MAX_QUERY_CHARS.toLocaleString()} chars`}
              </span>
            </div>

            <div className="mt-5 grid flex-1 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_300px]" style={{ minHeight: 0 }}>
              <div className={`flex h-[50vh] min-h-[340px] flex-col rounded-md border bg-card lg:h-full ${charCountBadNew ? "border-destructive" : "border-border"}`}>
                <div className="flex items-center justify-between border-b border-border px-4 py-3">
                  <span className="font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
                    Upload query
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{newFiles[0]?.name ?? ""}</span>
                </div>
                <div className="min-h-0 flex-1 bg-code-bg p-4">
                  <Textarea
                    placeholder="Paste your Oracle SQL query here..."
                    value={newQuery}
                    onChange={(e) => setNewQuery(e.target.value)}
                    spellCheck={false}
                    className="h-full resize-none border-0 bg-transparent p-0 font-mono text-[13px] leading-[1.5] text-code-fg placeholder:text-muted-foreground focus-visible:ring-0"
                    onDragEnter={(e) => handleDragEnter(e, "new")}
                    onDragOver={handleDragOver}
                    onDragLeave={(e) => handleDragLeave(e, "new")}
                    onDrop={(e) => handleDrop(e, "new")}
                  />
                </div>
                <div className="flex items-center gap-2 border-t border-border px-3 py-2.5">
                  <button
                    type="button"
                    onClick={() => newFileInputRef.current?.click()}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-[13px] text-foreground transition hover:bg-surface-2"
                  >
                    <Upload className="h-[15px] w-[15px]" /> Attach
                  </button>
                  {newQuery && (
                    <button
                      type="button"
                      onClick={() => clearQuery("new")}
                      className="inline-flex h-8 items-center gap-2 rounded-md px-3 text-[13px] text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
                    >
                      <X className="h-[15px] w-[15px]" /> Clear
                    </button>
                  )}
                  <input ref={newFileInputRef} type="file" accept=".txt,.sql" multiple onChange={(e) => handleFileInputChange(e, "new")} className="hidden" />
                </div>
                {newFiles.length > 1 && (
                  <p className="px-3 pb-2 text-xs text-muted-foreground">{newFiles.length} files loaded</p>
                )}
                {charCountBadNew && (
                  <p className="px-3 pb-2 text-xs text-destructive">
                    {newQuery.length.toLocaleString()} / {MAX_QUERY_CHARS.toLocaleString()} characters — reduce size to analyze.
                  </p>
                )}
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-md border border-border bg-card p-[18px]">
                  <div className="mb-3.5 font-heading text-[13px] font-semibold uppercase tracking-[0.08em] text-foreground">
                    What you get
                  </div>
                  <div className="flex flex-col border-t border-border">
                    <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                      <Database className="h-[15px] w-[15px] text-muted-foreground" /> Query guide
                    </div>
                    <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                      <Zap className="h-[15px] w-[15px] text-muted-foreground" /> Bottlenecks
                    </div>
                    <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                      <Brain className="h-[15px] w-[15px] text-muted-foreground" /> Hardcoding scan
                    </div>
                    <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                      <FileText className="h-[15px] w-[15px] text-muted-foreground" /> Written summary
                    </div>
                  </div>
                </div>
                <div className="rounded-md border border-border bg-surface-2 p-[18px] text-[13px] leading-[1.6] text-muted-foreground">
                  Limits: .sql or .txt, under 5 MB, {MAX_QUERY_CHARS.toLocaleString()} characters per query. Multiple
                  files are queued and selectable on the results screen.
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between border-t border-border pt-4">
              <span className="text-[13px] text-muted-foreground">Analysis runs on the updated query only.</span>
              <div className="flex items-center gap-2.5">
                {(Boolean(newQuery) || newFiles.length > 0) && (
                  <button
                    type="button"
                    onClick={resetAll}
                    className="inline-flex h-10 items-center rounded-md border border-border px-4 text-sm text-foreground transition hover:bg-surface-2"
                    title="Start a new analysis"
                  >
                    Reset
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={busyMode !== null || (newFiles.length === 0 && !newQuery.trim()) || charCountBadNew}
                  className="inline-flex h-10 items-center gap-2.5 rounded-md bg-primary px-[22px] font-heading text-sm font-semibold text-primary-foreground transition hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:opacity-45 disabled:pointer-events-none"
                >
                  {busyMode === "analyze" ? "Analyzing…" : "Analyze"}
                </button>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
