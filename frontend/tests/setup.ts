import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

// jsdom lacks these browser APIs.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

const mediaListeners = new Set<() => void>();
export const systemTheme = { dark: true };
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    get matches() {
      return query.includes("dark") ? systemTheme.dark : !systemTheme.dark;
    },
    media: query,
    addEventListener: (_: string, listener: () => void) => mediaListeners.add(listener),
    removeEventListener: (_: string, listener: () => void) => mediaListeners.delete(listener),
  }),
});
export const fireSystemThemeChange = () => mediaListeners.forEach((listener) => listener());

Element.prototype.setPointerCapture = vi.fn();

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  window.innerWidth = 1440; // jsdom defaults to 1024, which the app treats as a narrow screen
  systemTheme.dark = true;
  delete document.documentElement.dataset.theme;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.stubGlobal("ResizeObserver", ResizeObserverStub);
  vi.restoreAllMocks();
});
