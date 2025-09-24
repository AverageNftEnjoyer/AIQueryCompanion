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

export default function Page() {
  const { isLight, soundOn, syncEnabled, setIsLight, setSoundOn, setSyncEnabled } = useUserPrefs();
  const mode: "single" | "dual" = "dual";

  const switchAudioRef = useRef<HTMLAudioElement | null>(null);
  const botAudioRef = useRef<HTMLAudioElement | null>(null);
  const bgAudioRef = useRef<HTMLAudioElement | null>(null);

  // ---- Autoplay helper (handles browser autoplay policies)
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
      // Defer until first interaction
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

  // Keep effect: switch sound
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

  // Keep effect: bot sound
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
  const a = bgAudioRef.current;
  if (!a) return;
  a.loop = true;
  a.muted = !soundOn;
  if (!soundOn) {
    try {
      a.pause();
      a.currentTime = 0;
    } catch {}
  }
}, [soundOn]);

  useEffect(() => {
    const a = bgAudioRef.current;
    if (!a) return;
    tryAutoplay(a, 0.25);
    return () => clearResumeHandlers();
  }, []);

  useEffect(() => {
    return () => {
      if (bubbleTimerRef.current) {
        window.clearTimeout(bubbleTimerRef.current);
        bubbleTimerRef.current = null;
      }
      clearResumeHandlers();
    };
  }, []);

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
    ? "bg-slate-800 border-slate-700 hover:border-slate-500/80"
    : "bg-white/5 border-slate-500/20 hover:border-slate-400/40";

  const analysisCardClass = isLight
    ? "bg-slate-800 border-slate-700 hover:border-teal-400/60"
    : "bg-white/5 border-teal-500/20 hover:border-teal-400/40";

  const featureTextClass = isLight
    ? "text-slate-200 group-hover:text-slate-100"
    : "text-muted-foreground group-hover:text-slate-200";

  const descriptionTextClass = isLight ? "text-slate-300" : "text-muted-foreground";

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
      {isLight ? gridBgLight : gridBg}

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

      {/* Main */}
      <main className="relative z-10">
        {/* SFX elements */}
        <audio ref={switchAudioRef} src="/switch.mp3" preload="metadata" muted={!soundOn} />
        <audio ref={botAudioRef} src="/bot.mp3" preload="metadata" muted={!soundOn} />

        {/* NEW: Background music (auto-plays, loops, muted by Bell) */}
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
              {/* Query Compare */}
              <Card
                className={`group relative overflow-hidden transition-all duration-500 hover:shadow-2xl hover:shadow-white/5 cursor-pointer backdrop-blur-sm card-animate-1 animate-glow-pulse min-h-[480px] flex flex-col border ${compareCardClass}`}
              >
                {/* Full-card clickable overlay */}
                <Link
                  href="/landingpage?mode=compare"
                  onClick={playSwitch}
                  className="absolute inset-0 z-20"
                  aria-label="Enter Compare Mode"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-slate-600/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <CardHeader className="relative z-10 p-8 pb-4">
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 glow-slate ${
                      isLight ? "bg-slate-700" : "bg-gradient-to-br from-slate-600 to-slate-800"
                    }`}
                  >
                    <GitCompare className="w-8 h-8 text-white" />
                  </div>
                  <CardTitle className="text-2xl mb-3 transition-colors font-medium text-white">Query Compare</CardTitle>
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
                      className="w-full bg-gradient-to-r from-slate-600 to-slate-700 text-white hover:from-slate-500 hover:to-slate-600 transition-all font-medium glow-slate group-hover:scale-105"
                    >
                      Enter Compare Mode
                      <ArrowRight className="w-4 h-4 ml-2 group-hover:translate-x-2 transition-transform" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Query Analysis */}
              <Card
                className={`group relative overflow-hidden transition-all duration-500 hover:shadow-2xl hover:shadow-white/5 cursor-pointer backdrop-blur-sm card-animate-2 min-h-[480px] flex flex-col border ${analysisCardClass}`}
              >
                {/* Full-card clickable overlay */}
                <Link
                  href="/landingpage?mode=analyze"
                  onClick={playSwitch}
                  className="absolute inset-0 z-20"
                  aria-label="Enter Analysis Mode"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-teal-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                <CardHeader className="relative z-10 p-8 pb-4">
                  <div
                    className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-all duration-300 glow-teal ${
                      isLight ? "bg-teal-700" : "bg-gradient-to-br from-teal-600 to-teal-800"
                    }`}
                  >
                    <BarChart3 className="w-8 h-8 text-white" />
                  </div>
                  <CardTitle className="text-2xl mb-3 transition-colors font-medium text-white">Query Analysis</CardTitle>
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
                      className="w-full bg-gradient-to-r from-teal-600 to-teal-700 text-white hover:from-teal-500 hover:to-teal-600 transition-all font-medium glow-teal group-hover:scale-105"
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

        {/* Floating mascot + speech bubble (bottom-right) */}
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

              {/* Arrow */}
              <span
                className={`absolute -bottom-1.5 right-8 w-3 h-3 rotate-45 
        ${isLight ? "bg-white border-r border-b border-slate-200" : "bg-neutral-900/90 border-r border-b border-white/10"}`}
              />
            </div>
          )}
          {/* Mascot button */}
          <button type="button" onClick={handleMascotClick} aria-label="Play bot sound" className="block">
            <img
              src="/icon.png"
              width={256}
              height={256}
              alt="Query Companion"
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
              draggable={false}
            />
          </button>
        </div>
      </main>

      <style>{`
        @keyframes slide-up { 0%{opacity:0; transform:translateY(30px);} 100%{opacity:1; transform:translateY(0);} }
        @keyframes bounce-subtle { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-5px);} }
        @keyframes glow-pulse { 0%,100%{ box-shadow:0 0 20px rgba(0,255,255,.2);} 50%{ box-shadow:0 0 40px rgba(0,255,255,.4);} }
        .animate-glow-pulse { animation: glow-pulse 3s ease-in-out infinite; }
        .animate-bounce-subtle { animation: bounce-subtle 2s ease-in-out infinite; }
        .animate-slide-up { animation: slide-up .8s ease-out; }
        .glow-slate { box-shadow: 0 0 20px rgba(100,116,139,.3); }
        .glow-teal { box-shadow: 0 0 20px rgba(20,184,166,.3); }
        .card-animate-1 { animation: slide-up .8s ease-out .2s both; }
        .card-animate-2 { animation: slide-up .8s ease-out .4s both; }

        /* Floating icon subtle idle motion */
        @keyframes mascot-float {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-6px); }
        }
        .animate-mascot-float { animation: mascot-float 3s ease-in-out infinite; }

        /* Speech bubble pop animation */
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
            html { zoom: .85; } /* tweak to taste, e.g. .88 or .9 */
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
