"use client";

import * as React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useUserPrefs } from "@/hooks/user-prefs";

type Props = {
  onClickSound?: () => void;
  className?: string;
};

export function ThemeToggle({ onClickSound, className }: Props) {
  const { setTheme, resolvedTheme, theme } = useTheme();
  const { isLight, setIsLight } = useUserPrefs();
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  const isDark = (resolvedTheme ?? theme) === "dark";

  React.useEffect(() => {
    const currentlyLight = !isDark;
    if (currentlyLight !== isLight) {
      setIsLight(currentlyLight);
    }
  }, [isDark, isLight, setIsLight]);

  const handleClick = () => {
    const nextIsLight = isDark; 
    const nextTheme = nextIsLight ? "light" : "dark";
    if (resolvedTheme !== nextTheme) setTheme(nextTheme);
    if (isLight !== nextIsLight) setIsLight(nextIsLight);
    onClickSound?.();
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={!isDark}
      title={isDark ? "Switch to light" : "Switch to dark"}
      className={[
        "inline-flex items-center justify-center w-8 h-8 rounded-lg",
        "transition border border-transparent",
        "hover:bg-white/10",
        "focus:outline-none focus-visible:ring-0",
        className || "",
      ].join(" ")}
    >
      {/* Light mode icon */}
      <Sun className={`h-5 w-5 transition ${isDark ? "hidden" : "text-white"}`} />
      {/* Dark mode icon */}
      <Moon className={`h-5 w-5 transition ${isDark ? "text-white" : "hidden"}`} />
      <span className="sr-only">Toggle theme</span>
    </button>
  );
}
