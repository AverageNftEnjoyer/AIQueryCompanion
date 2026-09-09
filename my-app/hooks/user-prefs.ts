"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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

export function useUserPrefs() {
  // Always start from DEFAULT on both server and the first client render so the
  // two markups match; the real, possibly-personalized value is hydrated right
  // after mount below. Reading localStorage inside the useState initializer
  // would make the client's first render disagree with the server's and trigger
  // a React hydration mismatch.
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT);
  const hydratedRef = useRef(false);

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
    if (!hydratedRef.current) return;
    save(prefs);
  }, [prefs]);

  // Runs after the save-guard effect above (declaration order), so on the
  // initial commit the guard still sees hydratedRef.current === false.
  useEffect(() => {
    setPrefs(load());
    hydratedRef.current = true;
  }, []);

  useEffect(() => {
    // Skip the pre-hydration commit too: app/layout.tsx's inline script already
    // set the correct class synchronously before hydration, from the same
    // localStorage key. Re-applying DEFAULT here first would flash the wrong
    // theme for a frame before the load-on-mount effect corrects it.
    if (!hydratedRef.current) return;
    document.documentElement.classList.toggle("dark", !prefs.isLight);
  }, [prefs.isLight]);

  const setIsLight = useCallback((v: BooleanUpdater) => {
    setPrefs((p) => ({ ...p, isLight: resolveUpdater(p.isLight, v) }));
  }, []);

  const setSoundOn = useCallback((v: BooleanUpdater) => {
    setPrefs((p) => ({ ...p, soundOn: resolveUpdater(p.soundOn, v) }));
  }, []);

  const setSyncEnabled = useCallback((v: BooleanUpdater) => {
    setPrefs((p) => ({ ...p, syncEnabled: resolveUpdater(p.syncEnabled, v) }));
  }, []);

  return { ...prefs, setIsLight, setSoundOn, setSyncEnabled };
}
