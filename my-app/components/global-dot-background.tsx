"use client";

import { useMemo } from "react";
import DotGrid from "@/components/dot-grid";
import { useUserPrefs } from "@/hooks/user-prefs";

export default function GlobalDotBackground() {
  const { isLight } = useUserPrefs();

  const palette = useMemo(
    () =>
      isLight
        ? {
            base: "#9eb0c8",
            active: "#5f769a",
            opacity: 0.5,
            veil:
              "radial-gradient(1100px 700px at 10% -10%, rgba(255,255,255,0.34), rgba(255,255,255,0.05) 45%, rgba(255,255,255,0.22) 100%)",
          }
        : {
            base: "#5b6f8b",
            active: "#8eabd8",
            opacity: 0.42,
            veil:
              "radial-gradient(1000px 680px at 18% -12%, rgba(12,20,33,0.30), rgba(12,20,33,0.08) 50%, rgba(12,20,33,0.35) 100%)",
          },
    [isLight]
  );

  return (
    <div className="pointer-events-none fixed inset-0 z-[1] overflow-hidden">
      <DotGrid
        className="opacity-100"
        dotSize={2.6}
        gap={22}
        baseColor={palette.base}
        activeColor={palette.active}
        proximity={130}
        speedTrigger={125}
        shockRadius={210}
        shockStrength={1.85}
        resistance={840}
        returnDuration={1.65}
        style={{ opacity: palette.opacity }}
      />
      <div className="absolute inset-0" style={{ background: palette.veil }} />
    </div>
  );
}
