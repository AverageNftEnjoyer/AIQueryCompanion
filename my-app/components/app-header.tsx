"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Link2, Sun, Moon, Bell, BellOff, MessageSquare, X } from "lucide-react";
import { useUserPrefs } from "@/hooks/user-prefs";
import { requestChatbotAnswer, type ChatMessage } from "@/lib/client/chatbot";

interface AppHeaderProps {
  routeLabel: string;
  syncEnabled: boolean;
  onToggleSync: () => void;
  syncDisabled?: boolean;
  isLight: boolean;
  onToggleTheme: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  extra?: React.ReactNode;
}

export function AppHeader({
  routeLabel,
  syncEnabled,
  onToggleSync,
  syncDisabled,
  isLight,
  onToggleTheme,
  soundOn,
  onToggleSound,
  extra,
}: AppHeaderProps) {
  return (
    <header className="relative z-30 h-[60px] shrink-0 bg-card border-b border-border">
      <div className="mx-auto flex h-full w-full max-w-[1800px] items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="group flex min-w-0 items-center gap-4">
          <span className="whitespace-nowrap font-heading text-sm font-bold uppercase tracking-[0.14em] text-foreground transition-colors duration-150 group-hover:text-accent-on-ground">
            QueryLens
          </span>
          <span className="h-3.5 w-px shrink-0 bg-border" />
          <span className="truncate text-[13px] uppercase tracking-[0.06em] text-muted-foreground">
            {routeLabel}
          </span>
        </Link>

        <div className="flex shrink-0 items-center gap-1">
          {extra}
          <button
            type="button"
            onClick={onToggleSync}
            disabled={syncDisabled}
            title="Toggle synced scrolling"
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-40"
          >
            <Link2 className={`h-[17px] w-[17px] ${syncEnabled ? "text-foreground" : ""}`} />
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            title={isLight ? "Switch to dark background" : "Switch to light background"}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-2"
          >
            {isLight ? <Sun className="h-[17px] w-[17px]" /> : <Moon className="h-[17px] w-[17px]" />}
          </button>
          <button
            type="button"
            onClick={onToggleSound}
            title={soundOn ? "Mute sounds" : "Enable sounds"}
            className="mr-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-2"
          >
            {soundOn ? <Bell className="h-[17px] w-[17px]" /> : <BellOff className="h-[17px] w-[17px]" />}
          </button>
          <AskWidget />
        </div>
      </div>
    </header>
  );
}

const MAX_TURNS = 8;

/** Self-contained header assistant: trigger button + a small multi-turn chat panel. */
function AskWidget() {
  const { soundOn } = useUserPrefs();
  const botAudioRef = useRef<HTMLAudioElement | null>(null);

  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputVal, setInputVal] = useState("");
  const [loading, setLoading] = useState(false);

  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const requestCounterRef = useRef(0);
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

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

  const sendQuestion = async () => {
    const q = inputVal.trim();
    if (!q || loading) return;

    setInputVal("");
    const history = messages.slice(-MAX_TURNS * 2);
    const nextMessages = [...messages, { role: "user" as const, content: q }];
    setMessages(nextMessages);
    setLoading(true);

    const requestId = requestCounterRef.current + 1;
    requestCounterRef.current = requestId;

    try {
      const result = await requestChatbotAnswer(q, history);
      if (requestCounterRef.current !== requestId) return;

      const answer = result.ok ? result.answer || "I didn't get a reply." : `Warning: ${result.error}`;
      const assistantMsg: ChatMessage = { role: "assistant", content: answer };
      setMessages((prev) => [...prev, assistantMsg].slice(-MAX_TURNS * 2));
      if (result.ok) playBot();
    } finally {
      if (requestCounterRef.current === requestId) setLoading(false);
    }
  };

  return (
    <div className="relative" ref={panelRef}>
      <audio ref={botAudioRef} src="/bot.mp3" preload="metadata" muted={!soundOn} />
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-[13px] font-medium text-foreground transition hover:bg-surface-2"
      >
        <MessageSquare className="h-[15px] w-[15px]" />
        Ask
      </button>

      {open && (
        <div className="fixed right-4 top-[68px] z-40 flex h-[440px] w-[min(92vw,380px)] flex-col rounded-md border border-border bg-card shadow-lg md:right-6">
          <div className="flex shrink-0 items-center justify-between border-b border-border px-3.5 py-2.5">
            <span className="font-heading text-[13px] font-semibold uppercase tracking-[0.06em] text-foreground">
              Ask QueryLens
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition hover:bg-surface-2 hover:text-foreground"
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div ref={listRef} className="scroll-overlay min-h-0 flex-1 overflow-y-auto p-3">
            {messages.length === 0 && !loading ? (
              <p className="p-1 text-sm leading-relaxed text-muted-foreground">
                Ask a question about SQL, this workspace, or anything you're reviewing. Follow-ups keep the last{" "}
                {MAX_TURNS} exchanges of context.
              </p>
            ) : (
              <div className="space-y-2">
                {messages.map((m, i) => (
                  <div
                    key={i}
                    className={[
                      "max-w-[88%] rounded-md px-3 py-2 text-[13px] leading-relaxed",
                      m.role === "user" ? "ml-auto bg-primary text-primary-foreground" : "mr-auto bg-surface-2 text-foreground",
                    ].join(" ")}
                  >
                    {m.content}
                  </div>
                ))}
                {loading && (
                  <div className="mr-auto flex h-8 max-w-[88%] items-center gap-1.5 rounded-md bg-surface-2 px-3">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-border p-2.5">
            <input
              ref={inputRef}
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") sendQuestion();
              }}
              disabled={loading}
              placeholder="Ask a follow-up…"
              className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground transition-colors duration-150 focus:!border-[var(--primary)] disabled:opacity-60"
            />
          </div>
        </div>
      )}
    </div>
  );
}
