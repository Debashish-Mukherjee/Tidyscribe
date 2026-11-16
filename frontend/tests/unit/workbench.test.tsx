import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import mermaid from "mermaid";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workbench } from "../../components/workbench";
import { readDraft } from "../../lib/drafts";
import { createFakeApi, type FakeApi } from "../fake-api";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}" viewBox="0 0 10 10"><title>diagram</title></svg>` })),
  },
}));

const SAMPLE = [
  "# Order Platform",
  "",
  "## Requirements",
  "",
  "| Requirement | Priority |",
  "|-------------|----------|",
  "| Capture | High |",
  "",
  "- [x] Define APIs",
  "- [ ] Build dashboard",
  "",
  "> [!WARNING]",
  "> Needs PCI compliance.",
  "",
  "```mermaid",
  "flowchart LR",
  "A --> B",
  "```",
  "",
  "+-----+",
  "| API |",
  "+-----+",
  "   |",
  "   v",
  "+-----+",
  "| DB  |",
  "+-----+",
].join("\n");

let fake: FakeApi;

beforeEach(() => {
  fake = createFakeApi();
  vi.stubGlobal("fetch", fake.fetch);
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

const editor = () => screen.getByPlaceholderText(/paste ai output/i) as HTMLTextAreaElement;
const previewHost = () => screen.getByTestId("preview-host");
// The preview lives in a shadow root, which document queries do not reach.
const preview = () => previewHost().shadowRoot?.querySelector(".md-preview") as HTMLElement;

async function paste(text: string) {
  const box = editor();
  await userEvent.clear(box);
  await userEvent.click(box);
  await userEvent.paste(text);
}

describe("Workbench preview", () => {
  it("renders the initial sample as structured markup, not plain text", async () => {
    render(<Workbench />);
    await waitFor(() => expect(preview()).not.toBeNull());
    expect(within(preview()).getByRole("heading", { level: 1, name: "Executive Summary" })).toBeInTheDocument();
    expect(preview().querySelectorAll("li").length).toBeGreaterThanOrEqual(7);
    expect(preview().querySelectorAll("[role=checkbox]")).toHaveLength(3);
    expect(preview().querySelector("blockquote")).toBeTruthy();
  });

  it("renders tables, callouts, task lists, mermaid and ASCII diagrams from pasted markdown", async () => {
    render(<Workbench />);
    await paste(SAMPLE);
    await waitFor(() => expect(within(preview()).getByRole("table")).toBeInTheDocument());
    expect(within(preview()).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["Requirement", "Priority"]);
    const boxes = preview().querySelectorAll<HTMLElement>("[role=checkbox]");
    expect([boxes[0].getAttribute("aria-checked"), boxes[1].getAttribute("aria-checked")]).toEqual(["true", "false"]);
    const callout = preview().querySelector("blockquote.callout-warning");
    expect(callout?.textContent).toContain("Warning");
    expect(callout?.textContent).not.toContain("[!WARNING]");
    await waitFor(() => expect(preview().querySelector(".mermaid svg")).toBeTruthy());
    expect(Array.from(preview().querySelectorAll("pre")).some((pre) => pre.textContent?.includes("| API |"))).toBe(true);
  });

  it("sanitises raw HTML in pasted content", async () => {
    render(<Workbench />);
    await paste('Hello <img src=x onerror="window.__pwned=1"><script>window.__pwned=2</script>');
    await waitFor(() => expect(preview().textContent).toContain("Hello"));
    expect(preview().querySelector("script")).toBeNull();
    expect(preview().innerHTML).not.toContain("onerror");
  });

  it("shows a placeholder for empty content", async () => {
    render(<Workbench />);
    await userEvent.clear(editor());
    await waitFor(() => expect(preview()).toHaveTextContent(/start pasting content/i));
  });

  it("expands PlantUML to Mermaid through the API for the preview", async () => {
    render(<Workbench />);
    await paste("```plantuml\nA -> B: hi\n```");
    await waitFor(() => expect(fake.calls).toContain("POST /api/expand-diagrams"));
    await waitFor(() => expect(preview().querySelector(".mermaid")).toBeTruthy(), { timeout: 3000 });
  });

  it("explains why a Mermaid diagram could not be rendered and still shows its source", async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("Parse error on line 11:\n...(advisory)']\n-----^"));
    render(<Workbench />);
    await paste("```mermaid\nflowchart LR\n  A --> B[bad (label)]\n```");
    const alert = await within(preview()).findByRole("alert");
    expect(alert).toHaveTextContent("Diagram could not be rendered: Parse error on line 11:");
    expect(alert).not.toHaveTextContent("-----^"); // only the first line of the message
    expect(preview().querySelector(".mermaid pre")).toHaveTextContent("A --> B[bad (label)]");
    expect(preview().querySelector(".mermaid svg")).toBeNull();
  });

  it("never interprets a diagram error or its source as HTML", async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error("<img src=x onerror=alert(1)>"));
    render(<Workbench />);
    await paste("```mermaid\nflowchart LR\n  A[<img src=x onerror=alert(2)>]\n```");
    await within(preview()).findByRole("alert");
    expect(preview().querySelector(".mermaid img")).toBeNull();
    expect(preview().querySelector(".mermaid pre")?.textContent).toContain("<img src=x onerror=alert(2)>");
  });
});

describe("Workbench editing", () => {
  it("undo/redo buttons and shortcuts walk the history", async () => {
    render(<Workbench />);
    const undo = screen.getByRole("button", { name: "Undo" });
    const redo = screen.getByRole("button", { name: "Redo" });
    expect(undo).toBeDisabled();
    expect(redo).toBeDisabled();

    await paste("# One");
    expect(undo).toBeEnabled();
    await userEvent.click(undo);
    expect(editor().value).toContain("Executive Summary");
    expect(redo).toBeEnabled();
    await userEvent.click(redo);
    expect(editor().value).toBe("# One");

    editor().focus();
    await userEvent.keyboard("{Control>}z{/Control}");
    expect(editor().value).toContain("Executive Summary");
    await userEvent.keyboard("{Control>}{Shift>}z{/Shift}{/Control}");
    expect(editor().value).toBe("# One");
  });

  it("autosaves the draft and restores it on the next load", async () => {
    const first = render(<Workbench />);
    await paste("# Remember me");
    await waitFor(() => expect(readDraft()).toBe("# Remember me"), { timeout: 2000 });
    first.unmount();

    render(<Workbench />);
    await waitFor(() => expect(editor().value).toBe("# Remember me"));
    expect(screen.getByText(/restored your last draft/i)).toBeInTheDocument();
  });

  it("captures pasted text into clipboard history", async () => {
    render(<Workbench />);
    await paste("something copied");
    await waitFor(() => expect(fake.db.clipboard.map((item) => item.content)).toContain("something copied"));
  });

  it("inserts a template from the sidebar as an undoable step", async () => {
    render(<Workbench />);
    await userEvent.click(screen.getByRole("button", { name: "Templates" }));
    await userEvent.click(await screen.findByRole("button", { name: "ADR" }));
    expect(editor().value).toContain("## Decision");
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(editor().value).not.toContain("## Decision");
  });
});

describe("Workbench theme", () => {
  it("cycles dark, light, system and persists the choice", async () => {
    render(<Workbench />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("dark"));
    const toggle = () => screen.getByRole("button", { name: /^theme:/i });
    expect(toggle()).toHaveAccessibleName(/theme: dark/i);

    await userEvent.click(toggle());
    expect(document.documentElement.dataset.theme).toBe("light");
    expect(localStorage.getItem("workbench.theme.v1")).toBe("light");
    expect(toggle()).toHaveAccessibleName(/theme: light/i);

    await userEvent.click(toggle());
    expect(localStorage.getItem("workbench.theme.v1")).toBe("system");
    await userEvent.click(toggle());
    expect(localStorage.getItem("workbench.theme.v1")).toBe("dark");
  });

  it("starts in the saved theme", async () => {
    localStorage.setItem("workbench.theme.v1", "light");
    render(<Workbench />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    expect(screen.getByRole("button", { name: /theme: light/i })).toBeInTheDocument();
  });
});

describe("Workbench layout", () => {
  it("resizes the sidebar from the keyboard and remembers it", async () => {
    render(<Workbench />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    expect(handle).toHaveAttribute("aria-valuenow", "256");
    handle.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(handle).toHaveAttribute("aria-valuenow", "288");
    await waitFor(() => expect(JSON.parse(localStorage.getItem("workbench.layout.v1")!).sidebar).toBe(288));
    await userEvent.dblClick(handle);
    expect(handle).toHaveAttribute("aria-valuenow", "256");
  });

  it("restores a saved layout", async () => {
    localStorage.setItem("workbench.layout.v1", JSON.stringify({ sidebar: 340, editor: 0.4 }));
    render(<Workbench />);
    await waitFor(() => expect(screen.getByRole("separator", { name: "Resize sidebar" })).toHaveAttribute("aria-valuenow", "340"));
  });
});

describe("Workbench diagram conversion", () => {
  const convert = async (label: RegExp | string) => {
    const select = screen.getByLabelText("Convert diagram");
    await userEvent.selectOptions(select, screen.getByRole("option", { name: label }));
  };

  it("replaces an ASCII diagram with a mermaid fence", async () => {
    render(<Workbench />);
    await paste("intro\n\n+-----+\n| A |\n+-----+\n  |\n+-----+\n| B |\n+-----+\n");
    editor().setSelectionRange(0, 0);
    await convert(/to mermaid/i);
    await waitFor(() => expect(editor().value).toContain("```mermaid\nconverted-mermaid\n```"));
    expect(editor().value).not.toContain("| A |");
    expect(editor().value.startsWith("intro")).toBe(true);
  });

  it("downloads SVG and Draw.io without touching the document", async () => {
    render(<Workbench />);
    await paste("+-----+\n| A |\n+-----+\n  |\n+-----+\n| B |\n+-----+");
    const before = editor().value;
    await convert(/to svg/i);
    await waitFor(() => expect(screen.getByText(/downloaded diagram\.svg/i)).toBeInTheDocument());
    await convert(/draw\.io/i);
    await waitFor(() => expect(screen.getByText(/downloaded diagram\.drawio/i)).toBeInTheDocument());
    expect(editor().value).toBe(before);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(2);
  });

  it("tells the user when there is nothing to convert or the API rejects it", async () => {
    render(<Workbench />);
    await paste("just prose");
    await convert(/to mermaid/i);
    expect(await screen.findByText(/no diagram at the cursor.*box diagram.*plantuml, terraform, kubernetes or draw\.io/i)).toBeInTheDocument();

    await paste("```plantuml\nsomething unsupported\n```");
    editor().setSelectionRange(0, 0);
    await convert(/to mermaid/i);
    expect(await screen.findByText(/diagram conversion failed: this diagram could not be converted/i)).toBeInTheDocument();
  });
});

describe("Workbench exports", () => {
  it("opening the HTML tab generates the export and shows it in a sandboxed frame", async () => {
    render(<Workbench />);
    await paste("# Exported title\n\ntext");
    await userEvent.click(screen.getByRole("tab", { name: "HTML" }));
    const frame = await screen.findByTitle("HTML export");
    expect(frame).toHaveAttribute("sandbox", "");
    expect(frame.getAttribute("srcdoc")).toContain("<h1>Exported</h1>");
    expect(fake.calls).toContain("POST /api/exports");
    expect(fake.calls).not.toContain("POST /api/documents");
    expect(screen.getByRole("link", { name: /download exported-title\.html/i })).toBeInTheDocument();
  });

  it("waits for the background worker, showing queued and generating states, then displays the result", async () => {
    fake.exportStates = ["queued", "processing"];
    render(<Workbench />);
    await paste("# Slow export");
    await userEvent.click(screen.getByRole("tab", { name: "HTML" }));
    expect(await screen.findByText(/html export queued/i)).toBeInTheDocument();
    expect(await within(screen.getByRole("status")).findByText(/generating html/i)).toBeInTheDocument();
    expect((await screen.findByTitle("HTML export", {}, { timeout: 4000 })).getAttribute("srcdoc")).toContain("<h1>Exported</h1>");
    expect(fake.calls.filter((call) => call.startsWith("GET /api/exports/job-1"))).toHaveLength(3); // two polls + the download
    expect(screen.getByRole("button", { name: /regenerate html/i })).toBeEnabled();
  });

  it("shows the worker's failure reason and does not try to download", async () => {
    fake.exportFailure = "The document could not be exported";
    render(<Workbench />);
    await paste("# Will fail");
    await userEvent.click(screen.getByRole("tab", { name: "PDF" }));
    expect(await screen.findByText(/export failed: the document could not be exported/i)).toBeInTheDocument();
    expect(fake.calls.some((call) => call.endsWith("/download"))).toBe(false);
    expect(screen.queryByTitle("PDF export")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /generate pdf/i })).toBeEnabled();
  });

  it("exporting never saves or creates a document", async () => {
    render(<Workbench />);
    await paste("# Same doc");
    await userEvent.click(screen.getByRole("tab", { name: "HTML" }));
    await screen.findByTitle("HTML export");
    await userEvent.click(screen.getByRole("tab", { name: "Preview" }));
    await paste("# Same doc\n\nchanged");
    await userEvent.click(screen.getByRole("tab", { name: "HTML" }));
    await waitFor(() => expect(fake.calls.filter((call) => call === "POST /api/exports")).toHaveLength(2));
    expect(fake.calls.some((call) => /^(POST|PUT) \/api\/documents/.test(call))).toBe(false);
    expect(fake.db.documents).toHaveLength(0);
  });

  it("flags stale exports after the content changes", async () => {
    render(<Workbench />);
    await paste("# Stale");
    await userEvent.click(screen.getByRole("tab", { name: "DOCX" }));
    await screen.findByRole("link", { name: /download stale\.docx/i });
    expect(screen.getByText(/word documents cannot be previewed/i)).toBeInTheDocument();
    await userEvent.type(editor(), " more");
    expect(await screen.findByText(/content changed since this was generated/i)).toBeInTheDocument();
  });

  it("reports export failures in the status bar", async () => {
    render(<Workbench />);
    await paste("# Fails");
    fake.fetch.mockImplementationOnce(async () => ({ ok: false, status: 500, statusText: "x", json: async () => ({ detail: "boom" }) }));
    await userEvent.click(screen.getByRole("tab", { name: "PDF" }));
    expect(await screen.findByText(/export failed: boom/i)).toBeInTheDocument();
  });

  it("does not export empty content", async () => {
    render(<Workbench />);
    await userEvent.clear(editor());
    await userEvent.click(screen.getByRole("button", { name: "Export" }));
    await userEvent.click(screen.getByRole("menuitem", { name: /word/i }));
    expect(await screen.findByText(/add content before exporting/i)).toBeInTheDocument();
    expect(fake.calls.some((call) => call.includes("/api/exports"))).toBe(false);
  });
});

describe("Workbench header", () => {
  const openExportMenu = () => userEvent.click(screen.getByRole("button", { name: "Export" }));

  it("Export offers every format and closes on Escape or an outside click", async () => {
    render(<Workbench />);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await openExportMenu();
    expect(screen.getAllByRole("menuitem").map((item) => item.textContent)).toEqual(["Word (.docx)", "PDF", "HTML", "Markdown (.md)"]);
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await openExportMenu();
    await userEvent.click(editor());
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("exports the chosen format and downloads it", async () => {
    render(<Workbench />);
    await paste("# Menu export\n\ntext");
    await openExportMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: "PDF" }));
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled());
    expect(fake.calls).toEqual(expect.arrayContaining(["POST /api/exports"]));
    expect(await screen.findByText(/pdf export ready: menu-export\.pdf/i)).toBeInTheDocument();
  });

  it("downloads Markdown directly without contacting the export service", async () => {
    render(<Workbench />);
    await paste("# Plain md\n\ntext");
    await openExportMenu();
    await userEvent.click(screen.getByRole("menuitem", { name: /markdown/i }));
    expect(await screen.findByText("Downloaded plain-md.md")).toBeInTheDocument();
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
    expect(fake.calls.some((call) => call.includes("/api/exports"))).toBe(false);
  });

  it("shows the document title and tracks saved state", async () => {
    render(<Workbench />);
    await paste("# Tracked doc\n\nbody");
    const state = screen.getByTestId("save-state");
    expect(state).toHaveTextContent("Not saved");

    await userEvent.click(screen.getByRole("button", { name: "Save as new document" }));
    await waitFor(() => expect(state).toHaveTextContent("Saved"));
    expect(screen.getAllByText("Tracked doc").length).toBeGreaterThan(0);
    expect(fake.db.documents.map((d) => d.title)).toEqual(["Tracked doc"]);

    await userEvent.type(editor(), " more");
    expect(state).toHaveTextContent("Unsaved changes");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(state).toHaveTextContent("Saved"));
    expect(fake.db.documents).toHaveLength(1);
  });

  it("saved documents appear in the Documents list straight away", async () => {
    render(<Workbench />);
    await paste("# Listed doc");
    await userEvent.click(screen.getByRole("button", { name: "Save as new document" }));
    expect(await within(screen.getByRole("complementary")).findByText("Listed doc")).toBeInTheDocument();
  });

  it("will not save empty content and reports save failures", async () => {
    render(<Workbench />);
    await userEvent.clear(editor());
    expect(screen.getByRole("button", { name: "Save as new document" })).toBeDisabled();

    await paste("# Fails to save");
    fake.fetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server", json: async () => ({ detail: "db down" }) });
    await userEvent.click(screen.getByRole("button", { name: "Save as new document" }));
    expect(await screen.findByText(/save failed: db down/i)).toBeInTheDocument();
    expect(screen.getByTestId("save-state")).toHaveTextContent("Not saved");
  });

  it("Copy Markdown puts the source on the clipboard", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<Workbench />);
    await paste("# Copy me");
    await userEvent.click(screen.getByRole("button", { name: "Copy Markdown" }));
    expect(writeText).toHaveBeenCalledWith("# Copy me");
    expect(await screen.findByText("Copied Markdown to clipboard")).toBeInTheDocument();
  });

  it("the side panel collapses to the icon rail and reopens from any section icon", async () => {
    render(<Workbench />);
    const side = screen.getByRole("complementary");
    expect(within(side).getByLabelText("Search documents")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Collapse side panel" }));
    expect(within(side).queryByLabelText("Search documents")).not.toBeInTheDocument();
    expect(screen.queryByRole("separator", { name: "Resize sidebar" })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem("workbench.layout.v1") as string).panel).toBe(false);

    await userEvent.click(screen.getByRole("button", { name: "Templates" }));
    expect(screen.getByRole("separator", { name: "Resize sidebar" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Templates" })).toHaveAttribute("aria-current", "page");
  });

  it("restores a collapsed side panel", async () => {
    localStorage.setItem("workbench.layout.v1", JSON.stringify({ sidebar: 300, editor: 0.5, panel: false }));
    render(<Workbench />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Collapse side panel" })).not.toBeInTheDocument());
  });

  it("starts with the side panel collapsed on a narrow screen, unless a layout was saved", async () => {
    window.innerWidth = 900;
    const first = render(<Workbench />);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Collapse side panel" })).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: "Documents" }));
    expect(screen.getByRole("button", { name: "Collapse side panel" })).toBeInTheDocument();
    first.unmount();

    localStorage.setItem("workbench.layout.v1", JSON.stringify({ sidebar: 256, editor: 0.5, panel: true }));
    render(<Workbench />);
    expect(await screen.findByRole("button", { name: "Collapse side panel" })).toBeInTheDocument();
  });

  it("shows messages and a live word count in the bottom status bar", async () => {
    render(<Workbench />);
    await paste("one two three");
    expect(screen.getByText("3 words")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

describe("Workbench settings", () => {
  const writingStyle = () => screen.getByLabelText("Writing style") as HTMLSelectElement;

  it("applies saved server preferences, even over a different local theme", async () => {
    localStorage.setItem("workbench.theme.v1", "dark");
    fake.settings["ui.theme"] = "light";
    fake.settings["editor.default_tone"] = "HLD";
    render(<Workbench />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light"));
    await waitFor(() => expect(writingStyle().value).toBe("HLD"));
    expect(localStorage.getItem("workbench.theme.v1")).toBe("light");
  });

  it("ignores unknown or tampered stored values", async () => {
    fake.settings["ui.theme"] = "neon";
    fake.settings["editor.default_tone"] = "Poetry";
    render(<Workbench />);
    await waitFor(() => expect(fake.calls).toContain("GET /api/settings"));
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(writingStyle().value).toBe("Solution Design");
  });

  it("saves theme changes from the header button to the server", async () => {
    render(<Workbench />);
    await userEvent.click(screen.getByRole("button", { name: /^theme:/i }));
    await waitFor(() => expect(fake.settings["ui.theme"]).toBe("light"));
  });

  it("the Settings panel changes theme and writing style and saves both", async () => {
    render(<Workbench />);
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText("Dark")).toBeChecked();

    await userEvent.click(screen.getByLabelText("Light"));
    expect(document.documentElement.dataset.theme).toBe("light");
    await waitFor(() => expect(fake.settings["ui.theme"]).toBe("light"));
    expect(screen.getByLabelText("Light")).toBeChecked();

    await userEvent.selectOptions(screen.getByLabelText("Default writing style"), "Runbook");
    await waitFor(() => expect(fake.settings["editor.default_tone"]).toBe("Runbook"));
    expect(writingStyle().value).toBe("Runbook");
  });

  it("the toolbar writing style is saved and used by Clean AI Text", async () => {
    render(<Workbench />);
    await userEvent.selectOptions(writingStyle(), "ADR");
    await waitFor(() => expect(fake.settings["editor.default_tone"]).toBe("ADR"));
    await paste("Certainly! text");
    await userEvent.click(screen.getByRole("button", { name: /clean ai text/i }));
    const transformCall = fake.fetch.mock.calls.find(([url]) => String(url).endsWith("/api/transform"));
    expect(JSON.parse(transformCall![1].body).tone).toBe("ADR");
  });

  it("Reset pane sizes restores the default layout", async () => {
    render(<Workbench />);
    const handle = screen.getByRole("separator", { name: "Resize sidebar" });
    handle.focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}");
    expect(handle).toHaveAttribute("aria-valuenow", "288");
    await userEvent.click(screen.getByRole("button", { name: "Settings" }));
    await userEvent.click(screen.getByRole("button", { name: /reset pane sizes/i }));
    expect(handle).toHaveAttribute("aria-valuenow", "256");
    expect(screen.getByText(/pane sizes reset/i)).toBeInTheDocument();
  });

  it("keeps working when the settings service is down, and says when a save fails", async () => {
    localStorage.setItem("workbench.theme.v1", "light");
    const original = fake.fetch.getMockImplementation() as (url: string, init?: RequestInit) => unknown;
    fake.fetch.mockImplementation(async (url: string, init?: RequestInit) =>
      String(url).includes("/api/settings")
        ? { ok: false, status: 500, statusText: "x", json: async () => ({ detail: "down" }) }
        : original(url, init),
    );
    render(<Workbench />);
    await waitFor(() => expect(document.documentElement.dataset.theme).toBe("light")); // local choice survives
    await userEvent.click(screen.getByRole("button", { name: /^theme:/i }));
    expect(await screen.findByText(/could not save the setting on the server/i)).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("Workbench rich paste", () => {
  const pasteRich = (html: string, plain = "plain fallback") => {
    const data: Record<string, string> = { text: plain, "text/plain": plain, "text/html": html };
    // fireEvent returns false when the handler called preventDefault().
    return fireEvent.paste(editor(), { clipboardData: { getData: (type: string) => data[type] ?? "" } });
  };

  const RICH = "<h2>Plan</h2><ul><li>First <strong>item</strong></li><li>Second</li></ul>";

  it("converts bullets, headings and bold into Markdown instead of flattening them", async () => {
    render(<Workbench />);
    await userEvent.clear(editor());
    const proceeded = pasteRich(RICH);
    expect(proceeded).toBe(false); // default paste suppressed: we insert the Markdown ourselves
    await waitFor(() => expect(editor().value).toBe("## Plan\n\n- First **item**\n- Second"));
    expect(screen.getByText(/pasted formatted text as markdown/i)).toBeInTheDocument();
    await waitFor(() => expect(within(preview()).getAllByRole("listitem")).toHaveLength(2));
  });

  it("inserts at the cursor, replaces a selection, and leaves the caret after the pasted text", async () => {
    render(<Workbench />);
    await paste("Start MIDDLE end");
    editor().setSelectionRange(6, 12); // select MIDDLE
    pasteRich("<ul><li>x</li></ul>");
    await waitFor(() => expect(editor().value).toBe("Start - x end"));
    expect(editor().selectionStart).toBe("Start - x".length);
    expect(editor().selectionEnd).toBe("Start - x".length);
  });

  it("is a single undoable step", async () => {
    render(<Workbench />);
    await paste("before");
    pasteRich("<ul><li>a</li><li>b</li></ul>");
    await waitFor(() => expect(editor().value).toContain("- a"));
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(editor().value).toBe("before");
  });

  it("saves the converted Markdown (not the flattened text) to clipboard history", async () => {
    render(<Workbench />);
    pasteRich(RICH, "Plan First item Second");
    await waitFor(() => expect(fake.db.clipboard.map((item) => item.content)).toContain("## Plan\n\n- First **item**\n- Second"));
  });

  it("leaves plain text and editor-style HTML to the normal paste", async () => {
    render(<Workbench />);
    await userEvent.clear(editor());
    expect(pasteRich('<div style="font-family:monospace"><span>def f():</span><span>    return 1</span></div>', "def f():\n    return 1")).toBe(true);
    expect(pasteRich("", "just text")).toBe(true);
    await waitFor(() => expect(fake.db.clipboard.map((item) => item.content)).toEqual(expect.arrayContaining(["def f():\n    return 1", "just text"])));
    expect(editor().value).toBe(""); // jsdom performs no default paste; nothing was inserted by us
  });
});

describe("Workbench AI actions", () => {
  it("Clean AI Text shows a report and changes nothing until the user applies it", async () => {
    render(<Workbench />);
    await paste("Certainly! text");
    await userEvent.click(screen.getByRole("button", { name: /clean ai text/i }));

    const dialog = await screen.findByRole("dialog", { name: /review cleanup/i });
    expect(within(dialog).getByTestId("clean-summary")).toHaveTextContent("Removed: 1 phrase.");
    expect(within(dialog).getByTestId("change-preamble")).toHaveTextContent("Certainly!");
    expect(within(dialog).getByRole("group", { name: /preview of changes/i })).toHaveTextContent("Certainly! text");
    expect(editor().value).toBe("Certainly! text");

    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(editor().value).toBe("Certainly! text");

    await userEvent.click(screen.getByRole("button", { name: /clean ai text/i }));
    await userEvent.click(await screen.findByRole("button", { name: "Apply Changes" }));
    await waitFor(() => expect(editor().value).toContain("# Cleaned"));
    expect(editor().value).not.toContain("Certainly!");
    expect(screen.getByText(/text cleaned: removed 1 phrase/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(editor().value).toBe("Certainly! text");
  });

  it("says so when there is nothing to clean instead of opening a dialog", async () => {
    render(<Workbench />);
    await paste("# Already clean");
    fake.fetch.mockImplementationOnce(async () => ({ ok: true, status: 200, statusText: "OK", json: async () => ({ cleaned_text: "# Already clean", summary: "", changes: [], removed: 0, changed: false }) }));
    await userEvent.click(screen.getByRole("button", { name: /clean ai text/i }));
    expect(await screen.findByText(/nothing to clean/i)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses to apply a cleanup when the text changed during the review", async () => {
    render(<Workbench />);
    await paste("Certainly! text");
    await userEvent.click(screen.getByRole("button", { name: /clean ai text/i }));
    await screen.findByRole("dialog", { name: /review cleanup/i });
    fireEvent.change(editor(), { target: { value: "Certainly! text and more" } });
    await userEvent.click(screen.getByRole("button", { name: "Apply Changes" }));
    expect(editor().value).toBe("Certainly! text and more");
    expect(screen.getByText(/changed while you were reviewing/i)).toBeInTheDocument();
  });

  it("Smart Paste replaces the editor content via the API", async () => {
    render(<Workbench />);
    await paste("  padded  ");
    await userEvent.click(screen.getByRole("button", { name: /smart paste/i }));
    await waitFor(() => expect(editor().value).toBe("padded"));
    expect(screen.getByText(/detected: markdown/i)).toBeInTheDocument();
  });
});
