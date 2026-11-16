"use client";

import { useEffect } from "react";
import { create } from "zustand";

export type ThemeMode = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export const THEME_KEY = "workbench.theme.v1";
const MODES: ThemeMode[] = ["dark", "light", "system"];

export const isThemeMode = (value: unknown): value is ThemeMode => MODES.includes(value as ThemeMode);

export const nextThemeMode = (mode: ThemeMode): ThemeMode => MODES[(MODES.indexOf(mode) + 1) % MODES.length];

export const resolveTheme = (mode: ThemeMode, systemPrefersDark: boolean): ResolvedTheme =>
  mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode;

const prefersDark = () => typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

export function applyTheme(mode: ThemeMode) {
  const resolved = resolveTheme(mode, prefersDark());
  document.documentElement.dataset.theme = resolved;
  document.documentElement.style.colorScheme = resolved;
}

type ThemeState = { mode: ThemeMode; setMode: (mode: ThemeMode) => void; load: () => void };

export const useThemeStore = create<ThemeState>((set) => ({
  mode: "dark",
  setMode: (mode) => {
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies for this session.
    }
    applyTheme(mode);
    set({ mode });
  },
  load: () => {
    let stored: unknown = null;
    try {
      stored = localStorage.getItem(THEME_KEY);
    } catch {
      // ignore
    }
    const mode = isThemeMode(stored) ? stored : "dark";
    applyTheme(mode);
    set({ mode });
  },
}));

/** Loads the saved theme once and keeps "system" in sync with the OS setting. */
export function useThemeSync() {
  const mode = useThemeStore((state) => state.mode);
  const load = useThemeStore((state) => state.load);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (mode !== "system") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [mode]);
}

/** Inline script that sets data-theme before first paint so there is no flash of the wrong theme. */
export const themeInitScript = `try{var m=localStorage.getItem("${THEME_KEY}");var d=m==="light"?false:m==="system"?matchMedia("(prefers-color-scheme: dark)").matches:true;var t=d?"dark":"light";document.documentElement.dataset.theme=t;document.documentElement.style.colorScheme=t}catch(e){}`;
