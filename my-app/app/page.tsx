"use client";

import Link from "next/link";
import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import {
  Home,
  Bell,
  BellOff,
  Link2,
  Sun,
  Moon,
  ArrowRight,
  Zap,
  BarChart3,
  GitCompare,
  Brain,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useUserPrefs } from "@/hooks/user-prefs";
import Image from "next/image";
import Waves from "@/components/waves";

export default function Page() {
  const { isLight, soundOn, syncEnabled, setIsLight, setSoundOn, setSyncEnabled } = useUserPrefs();
  const mode: "single" | "dual" = "dual";

  const switchAudioRef = useRef<HTMLAudioElement | null>(null);
  const botAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);

  const resumeHandlerRef = useRef<(() => void) | null>(null);
  const clearResumeHandlers = () => {
    if (resumeHandlerRef.current) {
      window.removeEventListener("pointerdown", resumeHandlerRef.current);
      window.removeEventListener("keydown", resumeHandlerRef.current);
      resumeHandlerRef.current = null;
    }
  };
  const tryAutoplay = async (el: HTMLAudioElement, volume = 0.25) => {
    try {
      el.pause();
      el.currentTime = 0;
      el.volume = volume;
      await el.play();
    } catch {
      const resume = () => {
        el
          .play()
          .catch(() => {})
          .finally(() => clearResumeHandlers());
      };
      resumeHandlerRef.current = resume;
      window.addEventListener("pointerdown", resume, { once: true });
      window.addEventListener("keydown", resume, { once: true });
    }
  };

  const lines = useMemo(
    () => [
      "Welcome! Pick a mode to begin.",
      "Compare Mode: for results at a glance.",
      "Analysis Mode: for deep insights.",
      "Compare mode has many features.",
      "Click a card to get started.",
      "Tip: Theme toggle lives in the top right.",
      "Mute or unmute sounds with the bell up top.",
      "Not sure where to start? Compare is a great first step.",
      "After you pick a mode, I highlight what matters.",
      "Compare shows additions, modifications, and deletions.",
      "Analysis explains performance risks and best practices.",
      "Ready for a summary later? I can write one for you.",
      "Large queries? Analysis can flag bottlenecks.",
      "Ready to dive in?",
    ],
    []
  );
  const [bubbleText, setBubbleText] = useState<string>("");
  const [showBubble, setShowBubble] = useState<boolean>(false);
  const [bubbleKey, setBubbleKey] = useState<number>(0);
  const bubbleTimerRef = useRef<number | null>(null);
  const bubbleDims = useMemo(() => {
    const len = (bubbleText || "").length;

    if (len <= 24) {
      return { minW: 140, maxW: 260 };
    } else if (len <= 70) {
      return { minW: 180, maxW: 480 };
    }
    return { minW: 220, maxW: 720 };
  }, [bubbleText]);

  useEffect(() => {
    const a = switchAudioRef.current;
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

  const headerBgClass = useMemo(
    () =>
      isLight
        ? "bg-slate-50/95 border-slate-200 text-slate-900 shadow-[0_1px_0_rgba(0,0,0,0.04)]"
        : "bg-black/30 border-white/10 text-white",
    [isLight]
  );

  const pageBgClass = isLight ? "bg-slate-100 text-slate-900" : "bg-neutral-950 text-white";

  const compareCardClass = isLight
    ? "bg-white border-violet-200 hover:border-violet-300"
    : "bg-gradient-to-b from-violet-950/40 to-indigo-900/20 border-violet-700/40 hover:border-violet-400/50";

  const analysisCardClass = isLight
    ? "bg-white border-fuchsia-200 hover:border-fuchsia-300"
    : "bg-gradient-to-b from-fuchsia-950/40 to-sky-900/20 border-fuchsia-700/40 hover:border-fuchsia-400/50";

  const featureTextClass = isLight
    ? "text-slate-700 group-hover:text-slate-900"
    : "text-slate-300 group-hover:text-white";

  const descriptionTextClass = isLight ? "text-slate-600" : "text-slate-300";

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

  return (
    <div className={`min-h-screen relative ${pageBgClass}`}>
      {/* Waves background in purple/black scheme */}
      <Waves
        className="pointer-events-none"
        lineColor={isLight ? "rgba(124, 58, 237, 0.22)" : "rgba(168, 85, 247, 0.32)"}   /* violet-600/700 */
        backgroundColor="transparent"
        waveSpeedX={0.0125}
        waveSpeedY={0.006}
        waveAmpX={36}
        waveAmpY={18}
        xGap={12}
        yGap={28}
        friction={0.93}
        tension={0.006}
        maxCursorMove={110}
        style={{
          opacity: isLight ? 0.65 : 0.85,
          filter: isLight ? "saturate(0.9)" : "saturate(1.05)",
        }}
      />

      <header className={`relative z-10 border ${headerBgClass} backdrop-blur`}>
        <div className="mx-auto w-full max-w-[1800px] px-3 md:px-4 lg:px-6 py-4">
          <div className="grid grid-cols-3 items-center gap-3">
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

            <div className="flex items-center justify-center">
              <span className={`${isLight ? "text-gray-700" : "text-white"} inline-flex items-center gap-2`}>
                <span className="font-heading font-semibold text-lg">AI-Powered Query Companion</span>
              </span>
            </div>

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
        <audio ref={switchAudioRef} src="/switch.mp3" preload="metadata" muted={!soundOn} />
        <audio ref={botAudioRef} src="/bot.mp3" preload="metadata" muted={!soundOn} />
        <audio ref={bgAudioRef} src="/background.mp3" preload="auto" muted={!soundOn} loop />

        <section className="container mx-auto px-4 py-12">
          <div className="max-w-6xl mx-auto">
            <h2
              className={`text-4xl md:text-5xl font-light text-center mb-16 animate-bounce-subtle ${
                isLight ? "text-slate-900" : "text-white"
              }`}
            >
              Choose Your Analysis Mode
            </h2>

            <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
              <Card
                className={`group relative overflow-hidden transition-all duration-500 hover:shadow-2xl hover:shadow-fuchsia-400/10 cursor-pointer backdrop-blur-sm card-animate-1 animate-glow-pulse min-h-[480px] flex flex-col border ${compareCardClass}`}
              >
                <Link
                  href="/landingpage?mode=compare"
                  onClick={playSwitch}
                  className="absolute inset-0 z-20"
                  aria-label="Enter Compare Mode"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-fuchsia-500/10 to-sky-400/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <CardHeader className="relative z-10 p-8 pb-4">
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 glow-violet ${
                      isLight ? "bg-violet-50 border border-violet-200" : "bg-gradient-to-br from-violet-600 to-indigo-700"
                    }`}
                  >
                    <GitCompare className={`w-8 h-8 ${isLight ? "text-violet-700" : "text-white"}`} />
                  </div>
                  <CardTitle
                    className={`text-2xl mb-3 transition-colors font-medium ${
                      isLight ? "text-slate-900" : "text-white"
                    }`}
                  >
                    Query Compare
                  </CardTitle>
                  <CardDescription className={`text-base leading-relaxed font-light ${descriptionTextClass}`}>
                    Advanced side-by-side query analysis with AI-powered performance insights, optimization
                    recommendations and interactive support.
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10 p-8 pt-0 flex flex-col grow">
                  <div className="space-y-4 mb-8 grow">
                    <div className={`flex items-center gap-3 text-sm transition-colors ${featureTextClass}`}>
                      <Zap className="w-4 h-4" />
                      Real-time performance comparison
                    </div>
                    <div className={`flex items-center gap-3 text-sm transition-colors ${featureTextClass}`}>
                      <BarChart3 className="w-4 h-4" />
                      Visual execution plan analysis
                    </div>
                    <div className={`flex items-center gap-3 text-sm transition-colors ${featureTextClass}`}>
                      <Brain className="w-4 h-4" />
                      AI optimization suggestions
                    </div>
                  </div>
                  <div className="mt-auto">
                    <Button
                      type="button"
                      className="w-full bg-gradient-to-r from-violet-600 via-fuchsia-600 to-indigo-600 text-white hover:brightness-110 transition-all font-medium glow-violet group-hover:scale-105"
                    >
                      Enter Compare Mode
                      <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-2 transition-transform" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={`group relative overflow-hidden transition-all duration-500 hover:shadow-2xl hover:shadow-fuchsia-400/10 cursor-pointer backdrop-blur-sm card-animate-2 min-h-[480px] flex flex-col border ${analysisCardClass}`}
              >
                <Link
                  href="/landingpage?mode=analyze"
                  onClick={playSwitch}
                  className="absolute inset-0 z-20"
                  aria-label="Enter Analysis Mode"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-fuchsia-500/10 via-violet-500/10 to-sky-400/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <CardHeader className="relative z-10 p-8 pb-4">
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 glow-neon ${
                      isLight ? "bg-fuchsia-50 border border-fuchsia-200" : "bg-gradient-to-br from-fuchsia-600 to-sky-600"
                    }`}
                  >
                    <BarChart3 className={`w-8 h-8 ${isLight ? "text-fuchsia-700" : "text-white"}`} />
                  </div>
                  <CardTitle
                    className={`text-2xl mb-3 transition-colors font-medium ${
                      isLight ? "text-slate-900" : "text-white"
                    }`}
                  >
                    Query Analysis
                  </CardTitle>
                  <CardDescription className={`text-base leading-relaxed font-light ${descriptionTextClass}`}>
                    Deep-dive query examination with comprehensive metrics, bottleneck detection, and intelligent
                    recommendations.
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10 p-8 pt-0 flex flex-col grow">
                  <div className="space-y-4 mb-8 grow">
                    <div className={`flex items-center gap-3 text-sm transition-colors ${featureTextClass}`}>
                      <Database className="w-4 h-4" />
                      Comprehensive query profiling
                    </div>
                    <div className={`flex items-center gap-3 text-sm transition-colors ${featureTextClass}`}>
                      <Zap className="w-4 h-4" />
                      Bottleneck identification
                    </div>
                    <div className={`flex items-center gap-3 text-sm transition-colors ${featureTextClass}`}>
                      <Brain className="w-4 h-4" />
                      Smart optimization paths
                    </div>
                  </div>
                  <div className="mt-auto">
                    <Button
                      type="button"
                      className="w-full bg-gradient-to-r from-fuchsia-600 via-violet-600 to-sky-600 text-white hover:brightness-110 transition-all font-medium glow-neon group-hover:scale-105"
                    >
                      Enter Analysis Mode
                      <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-2 transition-transform" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

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
      </main>

      <style>{`
        @keyframes slide-up { 0%{opacity:0; transform:translateY(30px);} 100%{opacity:1; transform:translateY(0);} }
        @keyframes bounce-subtle { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-5px);} }
        @keyframes glow-pulse { 0%,100%{ box-shadow:0 0 24px rgba(236,72,153,.28);} 50%{ box-shadow:0 0 48px rgba(99,102,241,.38);} }
        .animate-glow-pulse { animation: glow-pulse 3s ease-in-out infinite; }
        .animate-bounce-subtle { animation: bounce-subtle 2s ease-in-out infinite; }
        .animate-slide-up { animation: slide-up .8s ease-out; }

        .glow-violet { box-shadow: 0 0 22px rgba(139,92,246,.45), 0 0 12px rgba(56,189,248,.25); }
        .glow-neon { box-shadow: 0 0 22px rgba(236,72,153,.45), 0 0 12px rgba(56,189,248,.25); }

        .card-animate-1 { animation: slide-up .8s ease-out .2s both; }
        .card-animate-2 { animation: slide-up .8s ease-out .4s both; }

        @keyframes mascot-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        .animate-mascot-float { animation: mascot-float 3s ease-in-out infinite; }

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
    </div>
  );
}
