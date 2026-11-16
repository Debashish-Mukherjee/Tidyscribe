import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { renderPreview } from "../../lib/preview";
const root = path.resolve(__dirname, "../../../test-fixtures/exports");
const manifest = JSON.parse(readFileSync(path.join(root, "manifest.json"), "utf8")) as Record<string, { text: string[]; html: string[] }>;
describe("shared export corpus", () => {
  for (const [name, expected] of Object.entries(manifest)) {
    it(`renders ${name} with the agreed semantics`, () => {
      const preview = renderPreview(readFileSync(path.join(root, name), "utf8"));
      expect(preview.ok).toBe(true);
      if (!preview.ok) throw new Error(preview.error);
      for (const text of [...expected.text, ...expected.html]) expect(preview.html).toContain(text);
    });
  }
});
