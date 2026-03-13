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
import { requestChatbotAnswer } from "@/lib/client/chatbot";
import Image from "next/image";

export default function Page() {
  const { isLight, soundOn, syncEnabled, setIsLight, setSoundOn, setSyncEnabled } = useUserPrefs();

  const switchAudioRef = useRef<HTMLAudioElement | null>(null);
  const botAudioRef = useRef<HTMLAudioElement | null>(null);

  // Assistant output bubble
  const [assistantVisible, setAssistantVisible] = useState(false);
  const [assistantLoading, setAssistantLoading] = useState(false);
  const [assistantText, setAssistantText] = useState<string>("");

  // Input bubble
  const [inputOpen, setInputOpen] = useState(false);
  const [inputVal, setInputVal] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const requestCounterRef = useRef(0);

  useEffect(() => {
    if (inputOpen) setTimeout(() => inputRef.current?.focus(), 0);
  }, [inputOpen]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("qc:assistantVisible");
      if (saved) setAssistantVisible(saved === "1");
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("qc:assistantVisible", assistantVisible ? "1" : "0");
    } catch {}
  }, [assistantVisible]);

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

  // Only play this when a response is returned (not on mascot click)
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
        ? "bg-white/95 border-slate-200 text-slate-900 shadow-[0_1px_0_rgba(15,23,42,0.06)]"
        : "bg-slate-950/95 border-slate-800 text-slate-100 shadow-[0_1px_0_rgba(148,163,184,0.08)]",
    [isLight]
  );
  const pageBgClass = isLight ? "bg-transparent text-slate-900" : "bg-transparent text-slate-100";
  const panelCardClass = isLight
    ? "bg-white border-slate-200 shadow-lg"
    : "bg-white/5 border-white/10 backdrop-blur-sm hover:border-white/20 transition";
  const featureTextClass = isLight ? "text-slate-700" : "text-white/80";
  const descriptionTextClass = isLight ? "text-slate-600" : "text-white/70";
  const primaryBtnClass =
    "w-full px-6 md:px-8 py-3 font-heading font-medium text-base rounded-md text-white border border-white/10 shadow-md transition-all";
  const primaryAnalyze = "bg-gradient-to-r from-teal-600 to-teal-700 hover:from-teal-500 hover:to-teal-600";
  const primaryCompare = "bg-gradient-to-r from-slate-700 to-slate-600 hover:from-slate-600 hover:to-slate-500";

  const bubbleBgClass = isLight ? "bg-white" : "bg-neutral-900/95";
  const bubbleTextClass = isLight ? "text-slate-900" : "text-white";
  const bubbleBorderClass = isLight ? "border-slate-200" : "border-white/15";

  // Toggle input bubble; hide previous answer while typing
  const handleMascotClick = () => {
    setInputOpen((v) => !v);
    setAssistantVisible(false);
  };

  // Heuristic width based on response complexity; prioritize height, cap at 560px
  const responseWidth = useMemo(() => {
    const len = assistantText.length || 0;
    const base = 300; // keep compact; grows slightly
    const growth = Math.min(200, Math.max(0, Math.floor((len - 80) / 6)));
    const w = base + growth;
    return Math.min(560, Math.max(280, w));
  }, [assistantText]);

  // Send question, show loading, then render answer; play audio only on response
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
        setAssistantText(`⚠️ ${result.error}`);
      }
    } finally {
      if (requestCounterRef.current === requestId) {
        setAssistantLoading(false);
      }
    }
  };

  return (
    <div className={`min-h-screen relative ${pageBgClass}`}>
      <header className={`relative z-10 border ${headerBgClass} backdrop-blur`}>
        <div className="mx-auto w-full max-w-[1800px] px-3 md:px-4 lg:px-6 py-4">
          <div className="grid grid-cols-3 items-center gap-3">
            <div className="flex">
              <Link
                href="/"
                onClick={() => playSwitch()}
                className={`inline-flex items-center justify-center w-10 h-10 rounded-lg transition border ${
                  isLight ? "bg-black/5 hover:bg-black/10 border-black/10 text-gray-700" : "bg-white/5 hover:bg-white/10 border-white/10 text-white"
                }`}
              >
                <Home className="w-5 h-5" />
              </Link>
            </div>

            <div className="flex items-center justify-center">
              <span className={`${isLight ? "text-gray-700" : "text-white"} inline-flex items-center gap-2`}>
                <span className="font-heading font-semibold text-lg">Query Analyzer Suite</span>
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
                {isLight ? <Sun className="h-5  text-gray-700" /> : <Moon className="h-5 w-5 text-white" />}
              </button>

              <button
                type="button"
                onClick={handleToggleSound}
                aria-pressed={soundOn}
                title={soundOn ? "Mute sounds" : "Enable sounds"}
                className={`inline-flex items-center justify-center w-8 h-8 rounded-lg transition border border-transparent ${isLight ? "hover:bg-black/10" : "hover:bg-white/10"} focus:outline-none focus-visible:ring-0`}
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

        <section className="container mx-auto px-4 py-10 md:py-14">
          <div className="max-w-6xl mx-auto">
            <h2 className={`text-3xl md:text-4xl font-light text-center mb-8 md:mb-10 ${isLight ? "text-slate-900" : "text-white"}`}>
              Choose Your Analysis Mode
            </h2>
            <div className="grid md:grid-cols-2 gap-6 max-w-5xl mx-auto">
              <Card className={`group relative overflow-hidden cursor-pointer min-h-[460px] flex flex-col border ${panelCardClass}`}>
                <Link href="/landingpage?mode=compare" onClick={playSwitch} className="absolute inset-0 z-20" aria-label="Enter Compare Mode" />
                <CardHeader className="relative z-10 p-8 pb-4">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 border ${isLight ? "bg-slate-100 border-slate-200" : "bg-white/10 border-white/20"}`}>
                    <GitCompare className={`w-8 h-8 ${isLight ? "text-slate-700" : "text-white"}`} />
                  </div>
                  <CardTitle className={`text-2xl mb-3 font-semibold ${isLight ? "text-slate-900" : "text-slate-100"}`}>Query Compare</CardTitle>
                  <CardDescription className={`text-base leading-relaxed ${descriptionTextClass}`}>
                    Side-by-side query diff with execution-focused insights for safe optimization decisions.
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10 p-8 pt-0 flex flex-col grow">
                  <div className="space-y-4 mb-8 grow">
                    <div className={`flex items-center gap-3 text-sm ${featureTextClass}`}><Zap className="w-4 h-4" />Syntax and performance scans</div>
                    <div className={`flex items-center gap-3 text-sm ${featureTextClass}`}><BarChart3 className="w-4 h-4" />Change-focused impact analysis</div>
                    <div className={`flex items-center gap-3 text-sm ${featureTextClass}`}><Brain className="w-4 h-4" />Actionable optimization guidance</div>
                  </div>
                  <div className="mt-auto">
                    <Button type="button" className={`${primaryBtnClass} ${primaryCompare}`}>
                      Enter Compare Mode
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card className={`group relative overflow-hidden cursor-pointer min-h-[460px] flex flex-col border ${panelCardClass}`}>
                <Link href="/landingpage?mode=analyze" onClick={playSwitch} className="absolute inset-0 z-20" aria-label="Enter Analysis Mode" />
                <CardHeader className="relative z-10 p-8 pb-4">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 border ${isLight ? "bg-slate-100 border-slate-200" : "bg-white/10 border-white/20"}`}>
                    <BarChart3 className={`w-8 h-8 ${isLight ? "text-slate-700" : "text-white"}`} />
                  </div>
                  <CardTitle className={`text-2xl mb-3 font-semibold ${isLight ? "text-slate-900" : "text-slate-100"}`}>Query Analysis</CardTitle>
                  <CardDescription className={`text-base leading-relaxed ${descriptionTextClass}`}>
                    Deep query diagnostics with bottleneck detection and implementation-ready recommendations.
                  </CardDescription>
                </CardHeader>
                <CardContent className="relative z-10 p-8 pt-0 flex flex-col grow">
                  <div className="space-y-4 mb-8 grow">
                    <div className={`flex items-center gap-3 text-sm ${featureTextClass}`}><Database className="w-4 h-4" />Comprehensive query breakdowns</div>
                    <div className={`flex items-center gap-3 text-sm ${featureTextClass}`}><Zap className="w-4 h-4" />Bottleneck identification</div>
                    <div className={`flex items-center gap-3 text-sm ${featureTextClass}`}><Brain className="w-4 h-4" />Hardcode and anti-pattern detection</div>
                  </div>
                  <div className="mt-auto">
                    <Button type="button" className={`${primaryBtnClass} ${primaryAnalyze}`}>
                      Enter Analysis Mode
                      <ArrowRight className="w-4 h-4 ml-2" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </section>

        {/* Mascot + unified bubble anchor */}
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
          {/* Bubble anchor: one position for all states */}
          <div className="bubble-anchor">
            {/* INPUT bubble (width reduced by ~1/3) */}
            {inputOpen && (
              <div
                className={`relative inline-block rounded-2xl border ${bubbleBorderClass} ${bubbleBgClass} px-4 py-4 shadow-[0_16px_50px_rgba(0,0,0,0.28)] animate-chat-in`}
                style={{
                  filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.35))",
                  width: "min(85vw, 340px)",
                }}
              >
                <span className={`absolute -bottom-1.5 right-12 w-3 h-3 rotate-45 border-r border-b ${bubbleBgClass} ${bubbleBorderClass}`} />
                <input
                  ref={inputRef}
                  value={inputVal}
                  onChange={(e) => setInputVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") sendQuestion();
                    if (e.key === "Escape") setInputOpen(false);
                  }}
                  placeholder="Ask your question…"
                  className={`w-full h-16 rounded-md border px-4 text-base outline-none
                    ${isLight ? "bg-white text-slate-900 border-slate-300 focus:ring-2 focus:ring-slate-300"
                              : "bg-neutral-800 text-white border-white/15 focus:ring-2 focus:ring-white/20"}`}
                />
              </div>
            )}

            {/* ANSWER / LOADING bubble */}
            {assistantVisible && (
              <div
                className={`relative inline-block rounded-2xl border ${bubbleBorderClass} ${bubbleBgClass} px-4 py-3 shadow-[0_16px_50px_rgba(0,0,0,0.28)] animate-chat-in`}
                style={{
                  filter: "drop-shadow(0 2px 8px rgba(0,0,0,0.35))",
                  maxWidth: "560px",
                  width: assistantLoading ? "120px" : `min(85vw, ${responseWidth}px)`, 
                }}
                aria-live="polite"
              >
                <span className={`absolute -bottom-1.5 right-12 w-3 h-3 rotate-45 border-r border-b ${bubbleBgClass} ${bubbleBorderClass}`} />

                {assistantLoading ? (
                  <div className={`loader-bubble ${isLight ? "text-slate-600" : "text-slate-300"}`}>
                    <div className="dots" aria-hidden>
                      <span />
                      <span />
                      <span />
                    </div>
                    <span className="sr-only">Assistant is typing</span>
                  </div>
                ) : (
                  <span
                    className={`block text-sm md:text-[0.95rem] leading-normal break-words whitespace-normal [text-wrap:pretty] ${bubbleTextClass}`}
                    style={{
                      hyphens: "auto",
                      wordBreak: "break-word",
                    }}
                  >
                    {assistantText}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Mascot button */}
          <button type="button" onClick={handleMascotClick} aria-label="Ask the assistant" className="block">
            <Image
              src="/icon.png"
              alt="Query Companion"
              width={256}
              height={256}
              priority
              draggable={false}
              className="block w-52 h-52 md:w-56 md:h-56 rounded-2xl"
              style={{ filter: "drop-shadow(0 0 4px rgba(0,0,0,0.35))", outline: "none" }}
              sizes="(min-width: 768px) 16rem, 14rem"
            />
          </button>
        </div>
      </main>

      <style>{`
        @keyframes chat-in { 0% { opacity: 0; transform: translateY(8px) scale(.98); } 100% { opacity: 1; transform: translateY(0) scale(1); } }
        .animate-chat-in { animation: chat-in .22s cubic-bezier(.2,.8,.2,1) both; }

        /* Unified anchor above mascot; shifted right across all sizes */
        .bubble-anchor{
          position: absolute;
          bottom: calc(100% - 30px);
          right: 92px;  
          left: auto;
          transform: none;
          width: fit-content;
          max-width: min(90vw, 560px);
          z-index: 1;
        }

        @media (min-width: 1536px){
          .bubble-anchor{ right: 95px; } 
        }
        @media (min-width: 1024px) and (max-width: 1535px){
          .bubble-anchor{ right: 90px; } 
        }
        @media (max-width: 1023px){
          .bubble-anchor{ right: 80px; } 
        }
        @media (max-width: 640px){
          .bubble-anchor{
            right: 70px;  
            bottom: calc(100% - 12px);
            max-width: min(92vw, 560px);
          }
        }

        @keyframes dotFlash {
          0%, 100% { opacity: 0.4; transform: scale(0.9) translateY(0); }
          25% { opacity: 1; transform: scale(1.15) translateY(-1px); }
          50% { opacity: 0.8; transform: scale(1) translateY(1px); }
          75% { opacity: 0.6; transform: scale(1.05) translateY(-0.5px); }
        }

        /* Tiny, consistent loading animation */
        .loader-bubble {
          display: flex;
          align-items: center;
          justify-content: center;
          height: 36px;
        }
        .dots {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        .dots span {
          width: 6px;
          height: 6px;
          border-radius: 9999px;
          background: currentColor;
          animation: dotFlash 1.2s infinite ease-in-out;
        }
        .dots span:nth-child(2) { animation-delay: .2s; }
        .dots span:nth-child(3) { animation-delay: .4s; }
      `}</style>
    </div>
  );
}
