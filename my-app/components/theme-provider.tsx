"use client";

import { useUserPrefs } from "@/hooks/user-prefs";

// useUserPrefs() owns the single source of truth for the theme and toggles the
// `dark` class on <html> itself (see hooks/user-prefs.ts) — this component just
// needs to be mounted under the tree so that effect runs.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  useUserPrefs();
  return <>{children}</>;
}
