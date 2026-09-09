import React from "react";
import type { Metadata } from "next";
import { Source_Serif_4, Public_Sans, JetBrains_Mono } from "next/font/google";
import { ThemeProvider } from "@/components/theme-provider";
import GlobalDotBackground from "@/components/global-dot-background";
import "./globals.css";

const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-source-serif",
  weight: ["400", "600", "700"],
});

const publicSans = Public_Sans({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-public-sans",
  weight: ["400", "500", "600"],
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: {
    default: "QueryLens",
    template: "%s | QueryLens",
  },
  description:
    "Enterprise SQL comparison and AI-assisted analysis platform for engineering teams.",
  applicationName: "QueryLens",
  creator: "QueryLens Team",
  keywords: [
    "SQL analysis",
    "query comparison",
    "change intelligence",
    "developer tooling",
    "Oracle SQL",
  ],
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
      className={`${sourceSerif.variable} ${publicSans.variable} ${jetbrainsMono.variable} antialiased`}
    >
      <head>
        <meta name="color-scheme" content="light dark" />
        <meta id="theme-color" name="theme-color" content="#16151a" />

        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){
  var KEY = "qa:prefs:v1";
  var root = document.documentElement;
  var themeMeta = document.querySelector('meta[name="theme-color"]');
  function setTheme(isLight){
    root.classList.toggle("dark", !isLight);
    if (themeMeta) themeMeta.setAttribute("content", isLight ? "#f7f6f3" : "#16151a");
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

      </head>
      <body className="relative font-body min-h-dvh bg-[color:var(--background)] overflow-x-hidden">
        <ThemeProvider>
          <GlobalDotBackground />
          <div className="relative z-[2]">{children}</div>
        </ThemeProvider>
      </body>
    </html>
  );
}
