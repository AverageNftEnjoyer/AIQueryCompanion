"use client";

import Link from "next/link";
import type { RefObject } from "react";
import { Link2, Sun, Moon, Bell, BellOff, MessageSquare } from "lucide-react";

interface AppHeaderProps {
  routeLabel: string;
  syncEnabled: boolean;
  onToggleSync: () => void;
  syncDisabled?: boolean;
  isLight: boolean;
  onToggleTheme: () => void;
  soundOn: boolean;
  onToggleSound: () => void;
  onAsk: () => void;
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
  onAsk,
  extra,
}: AppHeaderProps) {
  return (
    <header className="relative z-30 h-[60px] shrink-0 bg-card border-b border-border">
      <div className="mx-auto flex h-full w-full max-w-[1800px] items-center justify-between gap-4 px-4 md:px-6">
        <Link href="/" className="group flex min-w-0 items-center gap-4">
          <span className="whitespace-nowrap font-heading text-sm font-bold uppercase tracking-[0.14em] text-foreground transition-colors duration-150 group-hover:text-accent-on-ground">
            Query Companion
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
          <button
            type="button"
            onClick={onAsk}
            className="inline-flex h-8 items-center gap-2 rounded-md border border-border px-3 text-[13px] font-medium text-foreground transition hover:bg-surface-2"
          >
            <MessageSquare className="h-[15px] w-[15px]" />
            Ask
          </button>
        </div>
      </div>
    </header>
  );
}

interface AskPopoverProps {
  inputOpen: boolean;
  onCloseInput: () => void;
  inputVal: string;
  setInputVal: (v: string) => void;
  onSend: () => void;
  inputRef: RefObject<HTMLInputElement>;
  assistantVisible: boolean;
  assistantLoading: boolean;
  assistantText: string;
}

export function AskPopover({
  inputOpen,
  onCloseInput,
  inputVal,
  setInputVal,
  onSend,
  inputRef,
  assistantVisible,
  assistantLoading,
  assistantText,
}: AskPopoverProps) {
  if (!inputOpen && !assistantVisible) return null;

  return (
    <div className="fixed right-4 top-[68px] z-40 w-[min(92vw,380px)] md:right-6">
      {inputOpen && (
        <div className="rounded-md border border-border bg-card p-3 shadow-lg">
          <input
            ref={inputRef}
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSend();
              if (e.key === "Escape") onCloseInput();
            }}
            placeholder="Ask your question…"
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      )}
      {assistantVisible && (
        <div className="mt-2 rounded-md border border-border bg-card p-4 shadow-lg" aria-live="polite">
          {assistantLoading ? (
            <div className="flex h-5 items-center gap-1.5">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
            </div>
          ) : (
            <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">{assistantText}</p>
          )}
        </div>
      )}
    </div>
  );
}
