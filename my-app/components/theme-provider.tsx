"use client";

import { useEffect, useRef } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";
import { useUserPrefs } from "@/hooks/user-prefs";

/**
 * Bridges next-themes <-> your persisted prefs:
 * - next-themes writes/reads the theme to localStorage (key: "theme")
 * - we keep prefs.isLight in sync both ways, but avoid infinite loops
 */
export function ThemeProvider({
  children,
  ...props
}: Omit<ThemeProviderProps, "attribute">) {
  const { isLight, setIsLight } = useUserPrefs();

  // On first mount, ensure <html class> reflects our persisted isLight value,
  // and tell next-themes to start from that default.
  // next-themes will persist under localStorage("theme") automatically.
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return;
    mounted.current = true;

    const root = document.documentElement;
    root.classList.toggle("light", isLight);
    root.classList.toggle("dark", !isLight);
  }, [isLight]);

  return (
    <NextThemesProvider
      // Critical: use class strategy to avoid inline style flicker
      attribute="class"
      // We don’t want system changes to flip the app unexpectedly
      enableSystem={false}
      // Start from our persisted choice (prevents flash). If you want to
      // SSR-initialize this, you can also set an inline script in layout,
      // but this is usually fine for client apps.
      defaultTheme={isLight ? "light" : "dark"}
      // Smoothens UX on toggle (no CSS transitions flash)
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
