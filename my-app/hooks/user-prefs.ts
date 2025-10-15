"use client";

import { useCallback, useEffect, useState } from "react";

export const PREFS_KEY = "qa:prefs:v1";

type Prefs = {
  isLight: boolean;
  soundOn: boolean;
  syncEnabled: boolean;
};

const DEFAULT: Prefs = {
  isLight: false, 
  soundOn: true,
  syncEnabled: true,
};

function load(): Prefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return DEFAULT;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT, ...parsed };
  } catch {
    return DEFAULT;
  }
}

function save(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {}
}

export function useUserPrefs() {

  const [prefs, setPrefs] = useState<Prefs>(() => {
    if (typeof window === "undefined") return DEFAULT;

    const fromStorage = load();
    try {
      const hasStored = !!localStorage.getItem(PREFS_KEY);
      const root = document.documentElement;
      const hasLight = root.classList.contains("qa-light");
      const hasDark = root.classList.contains("qa-dark");

      if (!hasStored && (hasLight || hasDark)) {
        return {
          ...DEFAULT,
          isLight: hasLight,
        };
      }
    } catch {
    }
    return fromStorage;
  });

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === PREFS_KEY && e.newValue) {
        try {
          const next = JSON.parse(e.newValue);
          setPrefs((p) => ({ ...p, ...next }));
        } catch {}
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    save(prefs);
  }, [prefs]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (prefs.isLight) {
      root.classList.add("qa-light");
      root.classList.remove("qa-dark");
    } else {
      root.classList.add("qa-dark");
      root.classList.remove("qa-light");
    }
  }, [prefs.isLight]);

  const setIsLight = useCallback((v: boolean | ((x: boolean) => boolean)) => {
    setPrefs((p) => ({ ...p, isLight: typeof v === "function" ? (v as any)(p.isLight) : v }));
  }, []);

  const setSoundOn = useCallback((v: boolean | ((x: boolean) => boolean)) => {
    setPrefs((p) => ({ ...p, soundOn: typeof v === "function" ? (v as any)(p.soundOn) : v }));
  }, []);

  const setSyncEnabled = useCallback((v: boolean | ((x: boolean) => boolean)) => {
    setPrefs((p) => ({ ...p, syncEnabled: typeof v === "function" ? (v as any)(p.syncEnabled) : v }));
  }, []);

  return { ...prefs, setIsLight, setSoundOn, setSyncEnabled };
}
