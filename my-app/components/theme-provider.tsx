"use client";

import { UserPrefsProvider } from "@/hooks/user-prefs";

// Mounted once in the root layout (app/layout.tsx) and never remounts across
// client-side navigation, so prefs hydrate from localStorage exactly once per
// app load and every page shares the same live isLight/soundOn/syncEnabled
// state via useUserPrefs().
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return <UserPrefsProvider>{children}</UserPrefsProvider>;
}
