// app/layout.tsx
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
        {/* === THEME BOOTSTRAP: runs before first paint === */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var KEY = "qa:prefs:v1";
  var root = document.documentElement;
  try {
    var raw = localStorage.getItem(KEY);
    var isLight = false;
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && typeof parsed.isLight === "boolean") isLight = parsed.isLight;
      if (parsed && parsed.state && typeof parsed.state.isLight === "boolean") isLight = parsed.state.isLight;
    }
    if (isLight) { root.classList.add("qa-light"); root.classList.remove("qa-dark"); }
    else { root.classList.add("qa-dark"); root.classList.remove("qa-light"); }
  } catch(_) {
    root.classList.add("qa-dark"); root.classList.remove("qa-light");
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
