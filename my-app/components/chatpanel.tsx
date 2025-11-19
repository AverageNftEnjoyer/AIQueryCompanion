"use client";

import React, { memo, useRef, useEffect } from "react";

type ChatMsg = { role: "user" | "assistant"; content: string };

type ChatPanelProps = {
  rawOld?: string;
  rawNew?: string;
  canonicalOld?: string;
  canonicalNew?: string;
  changeCount?: number;
  stats?: unknown;
  placeholder?: string;
  heightClass?: string;
  containerHeightClass?: string;
  queuedQuestion?: string;
  onQueuedConsumed?: () => void;
  externalMessages?: ChatMsg[];
  setExternalMessages?: React.Dispatch<React.SetStateAction<ChatMsg[]>>;
  externalLoading?: boolean;
  setExternalLoading?: React.Dispatch<React.SetStateAction<boolean>>;
};

function findLineMention(q: string): number | null {
  const m1 = q.match(/\blines?\s+(\d{1,7})(?:\s*[-–]\s*\d+)?\b/i);
  if (m1) {
    const n = Number(m1[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  const m2 = q.match(/(?:\b[lL]\s*|\#)(\d{1,7})\b/);
  if (m2) {
    const n = Number(m2[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
}

const ChatPanel = memo(function ChatPanel({
  rawOld,
  rawNew,
  canonicalOld,
  canonicalNew,
  changeCount = 0,
  stats = null,
  placeholder = "Ask me anything about the changes…",
  heightClass = "h-[34rem]",
  containerHeightClass,
  queuedQuestion,
  onQueuedConsumed,
  externalMessages,
  setExternalMessages,
  externalLoading,
  setExternalLoading
}: ChatPanelProps) {
  const compareMode = !!rawOld && !!rawNew;

  const visibleOld = compareMode ? (rawOld ?? "") : (rawOld ?? canonicalOld ?? "");
  const visibleNew = compareMode ? (rawNew ?? "") : (rawNew ?? canonicalNew ?? "");

  const oldTextRaw = (rawOld ?? "").toString();
  const newTextRaw = (rawNew ?? "").toString();

  const messages = externalMessages ?? [];
  const setMessages = setExternalMessages ?? (() => {});

  const loading = externalLoading ?? false;
  const setLoading = setExternalLoading ?? (() => {});

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const consumedQueuedRef = useRef<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  }, [messages.length, loading]);

  useEffect(() => {
    if (messages.length === 0) {
      setMessages([{ role: "assistant", content: "Hello! How can I assist you today?" }]);
    }
  }, []);

  useEffect(() => {
    const q = (queuedQuestion || "").trim();
    if (!q) return;
    if (consumedQueuedRef.current === q) return;
    consumedQueuedRef.current = q;
    void send(q);
    onQueuedConsumed?.();
  }, [queuedQuestion]);

  async function send(forced?: string) {
    const q = typeof forced === "string" ? forced.trim() : (inputRef.current?.value || "").trim();
    if (!q) return;
    if (!forced && inputRef.current) inputRef.current.value = "";

    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);

    const reqId = Math.random().toString(36).slice(2);
    pendingIdRef.current = reqId;

    try {
      const maybeLine = findLineMention(q);
      void maybeLine;

      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          oldQuery: oldTextRaw,
          newQuery: newTextRaw,
          visibleOld,
          visibleNew,
          indexing: "visible",
          mode: compareMode ? "compare" : "single",
          context: { stats, changeCount },
          history: [...messages, { role: "user", content: q }]
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content }))
        })
      });

      if (pendingIdRef.current !== reqId) return;

      const data = await res.json().catch(() => ({}));
      const answer = res.ok
        ? String(data?.answer ?? "").trim()
        : `⚠️ ${data?.error || `Chat error (${res.status})`}`;

      setMessages((m) => [...m, { role: "assistant", content: answer || "I didn’t get a reply." }]);
    } catch {
      if (pendingIdRef.current === reqId) {
        setMessages((m) => [...m, { role: "assistant", content: "⚠️ Network error while contacting the assistant." }]);
      }
    } finally {
      if (pendingIdRef.current === reqId) {
        setLoading(false);
        queueMicrotask(() => {
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
        });
      }
    }
  }

  return (
    <div className={`flex flex-col h-full ${containerHeightClass ?? heightClass}`}>
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto" aria-live="polite">
        <div className="space-y-2.5 p-0.5">
          {messages.map((m, i) => (
            <div
              key={i}
              className={[
                "rounded-2xl px-3.5 py-2.5 text-[13.5px] leading-relaxed shadow-sm transition",
                "max-w-[92%] sm:max-w-[85%] md:max-w-[78%]",
                m.role === "user"
                  ? "ml-auto bg-gray-100 text-gray-900 border border-gray-200"
                  : "mr-auto bg-white text-gray-900 border border-gray-200 animate-speech-pop"
              ].join(" ")}
            >
              {m.content}
            </div>
          ))}

          {loading && (
            <div className="mr-auto rounded-2xl px-3.5 py-2.5 bg-white border border-gray-200 text-[13.5px] text-gray-600 shadow-sm animate-speech-pop">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center gap-1 h-4">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className="w-2 h-2 rounded-full bg-gray-500"
                      style={{
                        animation: "dotFlash 1.2s infinite ease-in-out",
                        animationDelay: `${i * 0.2}s`
                      }}
                    />
                  ))}
                </div>
                <span className="text-gray-500">Thinking…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2 shrink-0 border-t border-gray-200 pt-2 bg-transparent">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            placeholder={placeholder}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (!loading) void send();
              }
            }}
            className="flex-1 h-10 rounded-xl border border-gray-300 bg-white px-3 text-[13.5px] text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-gray-200"
          />
        </div>
      </div>
    </div>
  );
});

export default ChatPanel;
