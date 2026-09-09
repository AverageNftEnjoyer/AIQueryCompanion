"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

export const PREFS_KEY = "qa:prefs:v1";

type Prefs = {
  isLight: boolean;
  soundOn: boolean;
  syncEnabled: boolean;
};

type BooleanUpdater = boolean | ((x: boolean) => boolean);

const DEFAULT: Prefs = {
  isLight: false,
  soundOn: true,
  syncEnabled: true,
};

function isPrefsPatch(value: unknown): value is Partial<Prefs> {
  return typeof value === "object" && value !== null;
}

function resolveUpdater(current: boolean, updater: BooleanUpdater): boolean {
  return typeof updater === "function" ? updater(current) : updater;
}

function logPrefsWarning(context: string, err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`[user-prefs] ${context}: ${message}`);
}

function load(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT;
    const parsed: unknown = JSON.parse(raw);
    if (!isPrefsPatch(parsed)) return DEFAULT;
    return { ...DEFAULT, ...parsed };
  } catch (err) {
    logPrefsWarning("failed to load preferences from localStorage", err);
    return DEFAULT;
  }
}

function save(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch (err) {
    logPrefsWarning("failed to save preferences to localStorage", err);
  }
}

export type UserPrefs = Prefs & {
  setIsLight: (v: BooleanUpdater) => void;
  setSoundOn: (v: BooleanUpdater) => void;
  setSyncEnabled: (v: BooleanUpdater) => void;
};

const UserPrefsContext = createContext<UserPrefs | null>(null);

// Single source of truth, owned once by <ThemeProvider> in the root layout —
// it never remounts on client-side navigation, so prefs are hydrated from
// localStorage exactly once per app load instead of once per page. Each page
// calling this independently used to re-run the pre-hydration -> hydration
// transition on every navigation, which briefly forced the `dark` class onto
// <html> before correcting itself a tick later (invisible in dark mode, a
// visible flash in light mode).
export function UserPrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  // Real state, not a ref: a ref mutation inside one effect is visible to a
  // sibling effect within the *same* commit (especially under React Strict
  // Mode's double-invoked effects in dev), which let a stale pre-hydration
  // value slip through and briefly force the wrong theme. State guarantees
  // every effect in a commit sees the same consistent snapshot.
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY && e.newValue) {
        try {
          const next: unknown = JSON.parse(e.newValue);
          if (!isPrefsPatch(next)) return;
          setPrefs((p) => ({ ...p, ...next }));
        } catch (err) {
          logPrefsWarning("failed to parse synced storage update", err);
        }
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    // Skip the very first (pre-hydration) commit — it still holds DEFAULT and
    // would otherwise clobber the real stored prefs before they're loaded below.
    if (!hydrated) return;
    save(prefs);
  }, [hydrated, prefs]);

  useEffect(() => {
    setPrefs(load());
    setHydrated(true);
  }, []);

  useEffect(() => {
    // Keeps <html>'s class in sync with the hydrated value, and with any
    // *subsequent* change (the user clicking the theme toggle, or a synced
    // update from another tab). Gated on `hydrated` so it never runs with the
    // pre-hydration DEFAULT value.
    if (!hydrated) return;
    document.documentElement.classList.toggle("dark", !prefs.isLight);
  }, [hydrated, prefs.isLight]);

  const setIsLight = useCallback((v: BooleanUpdater) => {
    setPrefs((p) => ({ ...p, isLight: resolveUpdater(p.isLight, v) }));
  }, []);

  const setSoundOn = useCallback((v: BooleanUpdater) => {
    setPrefs((p) => ({ ...p, soundOn: resolveUpdater(p.soundOn, v) }));
  }, []);

  const setSyncEnabled = useCallback((v: BooleanUpdater) => {
    setPrefs((p) => ({ ...p, syncEnabled: resolveUpdater(p.syncEnabled, v) }));
  }, []);

  const value: UserPrefs = { ...prefs, setIsLight, setSoundOn, setSyncEnabled };

  return <UserPrefsContext.Provider value={value}>{children}</UserPrefsContext.Provider>;
}

export function useUserPrefs(): UserPrefs {
  const ctx = useContext(UserPrefsContext);
  if (!ctx) {
    throw new Error("useUserPrefs must be used within <ThemeProvider>/<UserPrefsProvider>");
  }
  return ctx;
}
