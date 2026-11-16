import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { applyTheme, isThemeMode, nextThemeMode, resolveTheme, THEME_KEY, themeInitScript, useThemeStore, useThemeSync } from "../../lib/theme";
import { fireSystemThemeChange, systemTheme } from "../setup";

describe("theme helpers", () => {
  it("cycles dark -> light -> system -> dark", () => {
    expect(nextThemeMode("dark")).toBe("light");
    expect(nextThemeMode("light")).toBe("system");
    expect(nextThemeMode("system")).toBe("dark");
  });

  it("resolves system against the OS preference", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("validates stored values", () => {
    expect(isThemeMode("light")).toBe(true);
    expect(isThemeMode("blue")).toBe(false);
    expect(isThemeMode(null)).toBe(false);
  });

  it("applyTheme sets data-theme and color-scheme on <html>", () => {
    applyTheme("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    systemTheme.dark = false;
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("light");
    systemTheme.dark = true;
    applyTheme("system");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("theme store", () => {
  it("persists the choice and applies it", () => {
    act(() => useThemeStore.getState().setMode("light"));
    expect(localStorage.getItem(THEME_KEY)).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(useThemeStore.getState().mode).toBe("light");
  });

  it("loads the saved choice, defaulting to dark for missing or invalid values", () => {
    localStorage.setItem(THEME_KEY, "system");
    systemTheme.dark = false;
    act(() => useThemeStore.getState().load());
    expect(useThemeStore.getState().mode).toBe("system");
    expect(document.documentElement.dataset.theme).toBe("light");

    localStorage.setItem(THEME_KEY, "garbage");
    act(() => useThemeStore.getState().load());
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("follows OS changes only while in system mode", () => {
    act(() => useThemeStore.getState().setMode("system"));
    renderHook(() => useThemeSync());
    systemTheme.dark = false;
    act(() => fireSystemThemeChange());
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => useThemeStore.getState().setMode("dark"));
    systemTheme.dark = false;
    act(() => fireSystemThemeChange());
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("themeInitScript", () => {
  const run = () => new Function(themeInitScript)();

  it("applies the stored theme before paint", () => {
    localStorage.setItem(THEME_KEY, "light");
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("resolves system and falls back to dark", () => {
    localStorage.setItem(THEME_KEY, "system");
    systemTheme.dark = false;
    run();
    expect(document.documentElement.dataset.theme).toBe("light");
    localStorage.clear();
    run();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
