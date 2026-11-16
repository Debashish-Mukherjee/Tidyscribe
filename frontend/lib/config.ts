const DEFAULT_API_URL = "http://localhost:8000";

declare global {
  interface Window {
    __APP_CONFIG__?: { apiUrl?: string };
  }
}

/** Resolved at page load: the container's API_URL (injected by the layout), else the build-time value. */
export function resolveApiBase(): string {
  const runtime = typeof window !== "undefined" ? window.__APP_CONFIG__?.apiUrl : undefined;
  return (runtime || process.env.NEXT_PUBLIC_API_URL || DEFAULT_API_URL).replace(/\/+$/, "");
}

/** Inline script that exposes server-side env to the browser; `<` is escaped so the value cannot close the tag. */
export function runtimeConfigScript(apiUrl: string | undefined): string {
  const json = JSON.stringify({ apiUrl: apiUrl || "" }).replace(/</g, "\\u003c");
  return `window.__APP_CONFIG__=${json};`;
}
