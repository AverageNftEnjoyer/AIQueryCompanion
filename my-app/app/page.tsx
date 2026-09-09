"use client";

import Link from "next/link";
import { useState, useCallback, useRef, useEffect } from "react";
import { ArrowRight, Zap, BarChart3, GitCompare, Brain, Database } from "lucide-react";
import { useUserPrefs } from "@/hooks/user-prefs";
import { requestChatbotAnswer } from "@/lib/client/chatbot";
import { AppHeader, AskPopover } from "@/components/app-header";

export default function Page() {
  const { isLight, soundOn, syncEnabled, setIsLight, setSoundOn, setSyncEnabled } = useUserPrefs();

  const switchAudioRef = useRef<HTMLAudioElement | null>(null);
  const botAudioRef = useRef<HTMLAudioElement | null>(null);

  const [assistantVisible, setAssistantVisible] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantText, setAssistantText] = useState<string>("");

  const [inputOpen, setInputOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestCounterRef = useRef(0);

  useEffect(() => {
    if (inputOpen) setTimeout(() => inputRef.current?.focus(), 0);
  }, [inputOpen]);

  const playSwitch = () => {
    if (!soundOn) return;
    const el = switchAudioRef.current;
    if (!el) return;
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = 0.5;
      el.play()?.catch(() => {});
    } catch {}
  };

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

  const toggleLightUI = useCallback(() => {
    setIsLight((v) => !v);
    playSwitch();
  }, [setIsLight]);

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

  const handleAskClick = () => {
    setInputOpen((v) => !v);
    setAssistantVisible(false);
  };

  const sendQuestion = async () => {
    const q = inputVal.trim();
    if (!q) return;

    setInputOpen(false);
    setAssistantVisible(true);
    setAssistantLoading(true);
    setAssistantText("");
    setInputVal("");

    const requestId = requestCounterRef.current + 1;
    requestCounterRef.current = requestId;

    try {
      const result = await requestChatbotAnswer(q);
      if (requestCounterRef.current !== requestId) return;

      if (result.ok) {
        setAssistantText(result.answer || "I didn't get a reply.");
        playBot();
      } else {
        setAssistantText(`Warning: ${result.error}`);
      }
    } finally {
      if (requestCounterRef.current === requestId) {
        setAssistantLoading(false);
      }
    }
  };

  return (
    <div className="relative min-h-screen bg-background text-foreground">
      <AppHeader
        routeLabel="Home"
        syncEnabled={syncEnabled}
        onToggleSync={handleToggleSync}
        isLight={isLight}
        onToggleTheme={toggleLightUI}
        soundOn={soundOn}
        onToggleSound={handleToggleSound}
        onAsk={handleAskClick}
      />

      <AskPopover
        inputOpen={inputOpen}
        onCloseInput={() => setInputOpen(false)}
        inputVal={inputVal}
        setInputVal={setInputVal}
        onSend={sendQuestion}
        inputRef={inputRef}
        assistantVisible={assistantVisible}
        assistantLoading={assistantLoading}
        assistantText={assistantText}
      />

      <audio ref={switchAudioRef} src="/switch.mp3" preload="metadata" muted={!soundOn} />
      <audio ref={botAudioRef} src="/bot.mp3" preload="metadata" muted={!soundOn} />

      <main className="px-7 pb-7 pt-14">
        <div className="mx-auto max-w-[920px]">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-accent-on-ground">
            SQL review workspace
          </div>
          <h1 className="mt-3.5 font-heading text-[44px] font-semibold leading-[1.05] tracking-[-0.01em] text-foreground">
            Choose your analysis mode
          </h1>
          <p className="mt-3 max-w-[620px] text-base leading-[1.55] text-muted-foreground">
            Compare two revisions of a query, or examine a single query on its own. Both modes accept pasted SQL or
            uploaded .sql files.
          </p>
        </div>

        <div className="mx-auto mt-11 grid max-w-[920px] grid-cols-1 gap-6 md:grid-cols-2">
          <Link
            href="/landingpage?mode=compare"
            onClick={playSwitch}
            className="group flex min-h-[340px] flex-col rounded-md border border-border bg-card p-7 transition-colors duration-200 hover:border-[var(--primary)] hover:shadow-[0_0_0_1px_var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface-2 text-accent-on-ground transition-colors duration-200 group-hover:border-[var(--primary)]/40 group-hover:bg-[var(--primary)]/10">
                <GitCompare className="h-[22px] w-[22px]" />
              </span>
              <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Two files</span>
            </div>
            <h2 className="mt-[22px] mb-2 font-heading text-2xl font-semibold tracking-[-0.01em] text-foreground transition-colors duration-200 group-hover:text-[var(--primary)]">
              Query Compare
            </h2>
            <p className="mb-5 text-sm leading-[1.6] text-muted-foreground">
              Side-by-side diff with change grouping, syntax and performance verdicts, and jump-to-change navigation.
            </p>
            <div className="mb-6 flex flex-col border-t border-border">
              <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                <Zap className="h-[15px] w-[15px] text-muted-foreground" />
                Syntax &amp; performance scans
              </div>
              <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                <BarChart3 className="h-[15px] w-[15px] text-muted-foreground" />
                Change-highlighted analysis
              </div>
              <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                <Brain className="h-[15px] w-[15px] text-muted-foreground" />
                AI optimization suggestions
              </div>
            </div>
            <div className="mt-auto flex items-center">
              <span className="inline-flex h-10 items-center gap-2.5 rounded-md bg-primary px-[18px] font-heading text-sm font-semibold text-primary-foreground transition-colors duration-200 group-hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]">
                Enter compare mode
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </span>
            </div>
          </Link>

          <Link
            href="/landingpage?mode=analyze"
            onClick={playSwitch}
            className="group flex min-h-[340px] flex-col rounded-md border border-border bg-card p-7 transition-colors duration-200 hover:border-[var(--primary)] hover:shadow-[0_0_0_1px_var(--primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <div className="flex items-center justify-between">
              <span className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-surface-2 text-accent-on-ground transition-colors duration-200 group-hover:border-[var(--primary)]/40 group-hover:bg-[var(--primary)]/10">
                <BarChart3 className="h-[22px] w-[22px]" />
              </span>
              <span className="text-xs uppercase tracking-[0.1em] text-muted-foreground">One file</span>
            </div>
            <h2 className="mt-[22px] mb-2 font-heading text-2xl font-semibold tracking-[-0.01em] text-foreground transition-colors duration-200 group-hover:text-[var(--primary)]">
              Query Analysis
            </h2>
            <p className="mb-5 text-sm leading-[1.6] text-muted-foreground">
              Deep examination of a single query: metrics, bottleneck detection, hardcoding scan and a
              plain-language summary.
            </p>
            <div className="mb-6 flex flex-col border-t border-border">
              <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                <Database className="h-[15px] w-[15px] text-muted-foreground" />
                Comprehensive query guides
              </div>
              <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                <Zap className="h-[15px] w-[15px] text-muted-foreground" />
                Bottleneck identification
              </div>
              <div className="flex items-center gap-2.5 border-b border-border py-2.5 text-[13px] text-foreground">
                <Brain className="h-[15px] w-[15px] text-muted-foreground" />
                Hardcoding scanner
              </div>
            </div>
            <div className="mt-auto flex items-center">
              <span className="inline-flex h-10 items-center gap-2.5 rounded-md border border-foreground px-[18px] font-heading text-sm font-semibold text-foreground transition-colors duration-200 group-hover:bg-surface-2">
                Enter analysis mode
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
              </span>
            </div>
          </Link>
        </div>
      </main>
    </div>
  );
}
