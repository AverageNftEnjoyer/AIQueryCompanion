// components/ChatPanel.tsx
"use client";

import React, { memo, useRef, useState, useEffect } from "react";

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
};

function extractLineContext(sql: string, lineNum: number, window = 6) {
  const lines = (sql || "").split("\n");
  const idx = Math.max(0, Math.min(lines.length - 1, lineNum - 1));
  const start = Math.max(0, idx - window);
  const end = Math.min(lines.length - 1, idx + window);
  const snippet = lines
    .slice(start, end + 1)
    .map((t, i) => {
      const ln = start + i + 1;
      return `${ln.toString().padStart(5, " ")} | ${t}`;
    })
    .join("\n");
  return {
    exists: !!lines[idx],
    exact: lines[idx] ?? "",
    snippet,
    totalLines: lines.length,
  };
}

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
}: ChatPanelProps) {
  const compareMode = !!rawOld && !!rawNew;

  // ✅ Use RAW in compare mode so numbering matches analyze mode exactly
  const visibleOld = compareMode ? (rawOld ?? "") : (rawOld ?? canonicalOld ?? "");
  const visibleNew = compareMode ? (rawNew ?? "") : (rawNew ?? canonicalNew ?? "");

  const oldTextRaw = (rawOld ?? "").toString();
  const newTextRaw = (rawNew ?? "").toString();

  const [messages, setMessages] = useState<ChatMsg[]>([
    { role: "assistant", content: "Hello! I'm your Query Companion, are you ready to explore the changes together?" },
  ]);
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const scrollToBottom = () => {
    queueMicrotask(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  };
  useEffect(scrollToBottom, [messages.length, loading]);

  async function send() {
    const q = (inputRef.current?.value || "").trim();
    if (!q) return;
    if (inputRef.current) inputRef.current.value = "";

    setMessages((m) => [...m, { role: "user", content: q }]);
    setLoading(true);

    try {
      const maybeLine = findLineMention(q);
      const focusFrom = visibleNew || visibleOld || "";
      const lineContext = maybeLine ? extractLineContext(focusFrom, maybeLine, 6) : null;

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
          context: {
            stats,
            changeCount,
            ...(maybeLine && lineContext
              ? {
                  focusLine: maybeLine,
                  focusLineExists: lineContext.exists,
                  focusLineExact: lineContext.exact,
                  focusSnippet: lineContext.snippet,
                  focusTotalLines: lineContext.totalLines,
                }
              : null),
          },
          // ✅ send recent history so route can resolve “old/new” follow-ups
          history: [...messages, { role: "user", content: q }]
            .slice(-8)
            .map((m) => ({ role: m.role, content: m.content })),
        }),
      });

      const data = await res.json().catch(() => ({} as any));
      const answer = res.ok
        ? String((data as any)?.answer ?? "").trim()
        : `⚠️ ${(data as any)?.error || `Chat error (${res.status})`}`;

      setMessages((m) => [...m, { role: "assistant", content: answer || "I didn’t get a reply." }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "⚠️ Network error while contacting the assistant." }]);
    } finally {
      setLoading(false);
      scrollToBottom();
    }
  }

  return (
    <div className={`p-5 ${containerHeightClass ?? heightClass} flex flex-col`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-slate-900 font-semibold">Query Companion</h3>
        <span className="text-xs text-gray-500">{loading ? "" : ""}</span>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 min-h-0 bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-y-auto scroll-overlay"
        aria-live="polite"
      >
        <div className="space-y-3">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm leading-relaxed ${
                m.role === "user"
                  ? "ml-auto bg-emerald-100 text-emerald-900"
                  : "mr-auto bg-white text-gray-900 border border-gray-200"
              }`}
            >
              {m.content}
            </div>
          ))}
          {loading && (
            <div className="mr-auto max-w-[70%] rounded-xl px-3 py-2 bg-white border border-gray-200 text-sm text-gray-600">
              <span className="inline-flex items-center gap-2">
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" aria-hidden="true">
                  <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                </svg>
                Thinking…
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          className="flex-1 h-10 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300"
        />
      </div>
    </div>
  );
});

export default ChatPanel;
