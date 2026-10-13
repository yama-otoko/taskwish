"use client";

import { Github, Menu, Moon, Sun, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "./logo";

export function Header() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const isDocs = pathname.startsWith("/docs");

  return (
    <header className="site-header">
      <a href="/" className="home-link"><Logo /></a>
      <button className="menu-toggle" onClick={() => setOpen(!open)} aria-label="Toggle navigation" aria-expanded={open}>
        {open ? <X /> : <Menu />}
      </button>
      <nav className={open ? "main-nav open" : "main-nav"} aria-label="Main navigation">
        <a href="/docs" aria-current={isDocs ? "page" : undefined}>Docs</a>
        <a href="/#use-cases">Use Cases</a>
        <a href="https://github.com/yama-otoko/taskwish" target="_blank" rel="noreferrer"><Github size={17} /> GitHub</a>
        <ThemeSwitch />
        <a className="nav-cta" href="/#install">Install <span>↗</span></a>
      </nav>
    </header>
  );
}

function ThemeSwitch() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const syncTheme = () => setIsDark(document.documentElement.dataset.theme === "dark");
    const observer = new MutationObserver(syncTheme);

    syncTheme();
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  function toggleTheme() {
    const nextTheme = isDark ? "light" : "dark";
    document.documentElement.dataset.theme = nextTheme;
    try { localStorage.setItem("taskwish-theme", nextTheme); } catch {}
    setIsDark(!isDark);
  }

  return (
    <button
      className="theme-switch"
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={`Switch to ${isDark ? "light" : "dark"} mode`}
      onClick={toggleTheme}
    >
      <Sun size={13} aria-hidden="true" />
      <Moon size={13} aria-hidden="true" />
      <span className="theme-switch-thumb" />
    </button>
  );
}
