import { afterEach, describe, expect, it } from "vitest";
import { resolveApiBase, runtimeConfigScript } from "../../lib/config";

afterEach(() => {
  delete window.__APP_CONFIG__;
});

describe("runtime config", () => {
  it("prefers the injected API URL and trims trailing slashes", () => {
    window.__APP_CONFIG__ = { apiUrl: "https://api.example.com/" };
    expect(resolveApiBase()).toBe("https://api.example.com");
  });

  it("falls back to the build-time default when nothing is injected", () => {
    window.__APP_CONFIG__ = { apiUrl: "" };
    expect(resolveApiBase()).toMatch(/^http/);
  });

  it("escapes markup so the value cannot end the script tag", () => {
    const script = runtimeConfigScript("</script><script>alert(1)</script>");
    expect(script).not.toContain("</script>");
    expect(script.startsWith("window.__APP_CONFIG__=")).toBe(true);
  });
});
