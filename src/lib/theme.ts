"use client";
import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { THEME_KEY } from "./theme-script";

export type ThemePreference = "system" | "light" | "dark";
export type Theme = "light" | "dark";
/** The theme the saved preference resolves to right now. */
export function resolvedTheme(): Theme {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return systemTheme();
}

/**
 * In development React's Strict Mode remount resets <html> to its JSX attributes,
 * wiping what the head script set; re-apply before paint. A no-op in production.
 */
export function useReapplyTheme() {
  useLayoutEffect(() => {
    const theme = resolvedTheme();
    if (document.documentElement.dataset.theme !== theme) document.documentElement.dataset.theme = theme;
  }, []);
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function apply(theme: Theme, animate: boolean) {
  const root = document.documentElement;
  if (root.dataset.theme === theme) return;
  if (animate) {
    root.classList.add("theme-transition");
    window.setTimeout(() => root.classList.remove("theme-transition"), 250);
  }
  root.dataset.theme = theme;
}

/** The saved preference plus the theme actually shown; follows the OS when "system". */
export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>("system");
  const [theme, setTheme] = useState<Theme>("dark");
  useEffect(() => {
    let saved: ThemePreference = "system";
    try {
      const value = localStorage.getItem(THEME_KEY);
      if (value === "light" || value === "dark") saved = value;
    } catch {}
    queueMicrotask(() => {
      setPreference(saved);
      setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
    });
  }, []);
  // Stay in sync with other switchers (and the OS) by watching the attribute itself.
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() => setTheme(root.dataset.theme === "light" ? "light" : "dark"));
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const follow = () => {
      const next = systemTheme();
      apply(next, true);
      setTheme(next);
    };
    media.addEventListener("change", follow);
    return () => media.removeEventListener("change", follow);
  }, [preference]);
  const choose = useCallback((next: ThemePreference) => {
    try {
      if (next === "system") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {}
    const shown = next === "system" ? systemTheme() : next;
    apply(shown, true);
    setPreference(next);
    setTheme(shown);
  }, []);
  return { preference, theme, choose };
}
