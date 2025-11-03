"use client";

import { useEffect, useRef } from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ThemeProviderProps } from "next-themes";
import { useUserPrefs } from "@/hooks/user-prefs";


export function ThemeProvider({
  children,
  ...props
}: Omit<ThemeProviderProps, "attribute">) {
  const { isLight, setIsLight } = useUserPrefs();
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
      attribute="class"
      enableSystem={false}
      defaultTheme={isLight ? "light" : "dark"}
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
