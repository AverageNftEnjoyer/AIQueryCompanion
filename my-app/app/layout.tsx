import React from "react";
import type { Metadata } from "next";
import { Space_Grotesk, DM_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-dm-sans",
});

export const metadata: Metadata = {
  title: "AI-Powered Query Companion",
  description:
    "Full-stack tool for comparing Oracle SQL queries with AI-powered analysis and explanations",
  generator: "v0.app",
  icons: {
    icon: [
      { url: "/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/favicon-64.png", sizes: "64x64", type: "image/png" },
      { url: "/favicon.ico", sizes: "any" },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${spaceGrotesk.variable} ${dmSans.variable} antialiased`}
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta id="theme-color" name="theme-color" content="#0a0a0a" />

        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var KEY = "qa:prefs:v1";
  var root = document.documentElement;
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  function setTheme(isLight){
    if (isLight) {
      root.classList.add("qa-light"); root.classList.remove("qa-dark");
      if (themeMeta) themeMeta.setAttribute("content", "#f1f5f9"); // light address bar
    } else {
      root.classList.add("qa-dark"); root.classList.remove("qa-light");
      if (themeMeta) themeMeta.setAttribute("content", "#0a0a0a"); // dark address bar
    }
  }
  try {
    var raw = localStorage.getItem(KEY);
    var isLight = false;
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.isLight === "boolean") isLight = parsed.isLight;
      if (parsed && parsed.state && typeof parsed.state.isLight === "boolean") isLight = parsed.state.isLight;
    }
    setTheme(isLight);
  } catch(_) {
    setTheme(false);
  }
})();`,
          }}
        />

        <style
          dangerouslySetInnerHTML={{
            __html: `
:root.qa-light, .qa-light body { background-color: #f1f5f9; color-scheme: light; }
:root.qa-dark,  .qa-dark body  { background-color: #0a0a0a; color-scheme: dark; }
html, body { min-height: 100%; }

/* Respect users who prefer reduced motion (kills large animations) */
@media (prefers-reduced-motion: reduce) {
  .animate-bounce-subtle,
  .animate-glow-pulse,
  .animate-mascot-float {
    animation: none !important;
  }
}
`,
          }}
        />
      </head>
      <body className="font-body min-h-dvh bg-[color:var(--background)]">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
