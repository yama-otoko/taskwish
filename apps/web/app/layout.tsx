import type { Metadata } from "next";
import Script from "next/script";
import type { ReactNode } from "react";
import { Footer } from "../src/footer";
import { Header } from "../src/header";
import "./globals.css";

const title = "TaskWish — The framework for building autonomous companies";
const description = "Build autonomous companies from typed actors, tools, state, and AI workflows in TypeScript.";
const themeScript = `
  (() => {
    const key = "taskwish-theme";
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");

    const applyTheme = () => {
      let saved;
      try { saved = localStorage.getItem(key); } catch {}
      root.dataset.theme = saved === "light" || saved === "dark"
        ? saved
        : media.matches ? "dark" : "light";
    };

    applyTheme();
    media.addEventListener("change", applyTheme);
    window.addEventListener("storage", (event) => {
      if (event.key === key) applyTheme();
    });
  })();
`;

export const metadata: Metadata = {
  metadataBase: new URL("https://taskwish.ai"),
  title: {
    default: title,
    template: "%s · TaskWish",
  },
  description,
  openGraph: {
    title,
    description,
    url: "https://taskwish.ai",
    siteName: "TaskWish",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "TaskWish — The framework for building autonomous companies",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [
      {
        url: "/og-image.png",
        alt: "TaskWish — The framework for building autonomous companies",
      },
    ],
  },
  icons: { icon: "/favicon.svg" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Script id="theme-init" strategy="beforeInteractive">{themeScript}</Script>
        <Header />{children}<Footer />
      </body>
    </html>
  );
}
