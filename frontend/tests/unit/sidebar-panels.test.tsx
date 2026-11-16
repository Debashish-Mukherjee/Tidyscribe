import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { SidebarPanel, type SidebarPanelProps } from "../../components/sidebar-panels";
import { createFakeApi } from "../fake-api";

const confirmDelete = () => userEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete" }));

const renderPanel = (section: string, overrides: Partial<SidebarPanelProps> = {}, seed = {}) => {
  const fake = createFakeApi(seed);
  vi.stubGlobal("fetch", fake.fetch);
  const props: SidebarPanelProps = {
    section,
    content: "# Draft\n\nbody",
    getSelection: () => "",
    insert: vi.fn(),
    currentDocId: null,
    onOpenDocument: vi.fn(),
    onDocumentDeleted: vi.fn(),
    notify: vi.fn(),
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <SidebarPanel {...props} />
    </QueryClientProvider>,
  );
  return { fake, props };
};

describe("Templates panel", () => {
  it("lists templates and inserts one into the editor", async () => {
    const { props } = renderPanel("Templates");
    await userEvent.click(await screen.findByRole("button", { name: "ADR" }));
    expect(props.insert).toHaveBeenCalledWith("# ADR\n\n## Decision\n", "template ADR");
  });

  it("saves the editor as a new template and refreshes the list", async () => {
    const { fake, props } = renderPanel("Templates");
    await screen.findByText("ADR");
    await userEvent.type(screen.getByLabelText("Template name"), "My RFC");
    await userEvent.click(screen.getByRole("button", { name: /save template/i }));
    expect(await screen.findByText("My RFC")).toBeInTheDocument();
    expect(fake.db.templates.at(-1)).toMatchObject({ name: "My RFC", category: "custom", body: "# Draft\n\nbody" });
    expect(props.notify).toHaveBeenCalledWith("Saved template My RFC");
  });

  it("disables saving without a name and deletes templates", async () => {
    const { fake } = renderPanel("Templates");
    await screen.findByText("ADR");
    expect(screen.getByRole("button", { name: /save template/i })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Delete ADR" }));
    await confirmDelete();
    await waitFor(() => expect(fake.db.templates).toHaveLength(0));
    expect(await screen.findByText("No templates.")).toBeInTheDocument();
  });
});

describe("Delete confirmation", () => {
  it("keeps the item when the dialog is cancelled, and Escape cancels too", async () => {
    const { fake } = renderPanel("Templates");
    await screen.findByText("ADR");
    await userEvent.click(screen.getByRole("button", { name: "Delete ADR" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("ADR");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fake.db.templates).toHaveLength(1);

    await userEvent.click(screen.getByRole("button", { name: "Delete ADR" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(fake.db.templates).toHaveLength(1);
  });
});

describe("Load errors", () => {
  it("shows a readable error with Retry instead of an empty list when the API is unreachable", async () => {
    const { fake } = renderPanel("Documents");
    fake.fetch.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    await userEvent.type(screen.getByRole("textbox", { name: "Search documents" }), "x");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Could not load documents: Cannot reach the server");
    expect(alert).not.toHaveTextContent("Failed to fetch");
    expect(within(alert).getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("Snippets panel", () => {
  it("shows category and tags, inserts, and filters by search", async () => {
    const { fake, props } = renderPanel("Snippets");
    expect(await screen.findByText("SQL #db")).toBeInTheDocument();
    await userEvent.click(screen.getByText("K8s deploy"));
    expect(props.insert).toHaveBeenCalledWith("kind: Deployment", "snippet K8s deploy");

    await userEvent.type(screen.getByLabelText(/search snippets/i), "index");
    await waitFor(() => expect(screen.queryByText("K8s deploy")).not.toBeInTheDocument());
    expect(screen.getByText("SQL index")).toBeInTheDocument();
    expect(fake.calls.some((call) => call.includes("q=index"))).toBe(true);
  });

  it("toggles favourite and archives (hiding archived items by default)", async () => {
    const { fake } = renderPanel("Snippets");
    await screen.findByText("SQL index");
    await userEvent.click(screen.getAllByRole("button", { name: "Favourite" })[0]);
    await waitFor(() => expect(fake.db.snippets[0].favorite).toBe(true));

    await userEvent.click(screen.getAllByRole("button", { name: "Archive" })[0]);
    await waitFor(() => expect(screen.queryByText("SQL index")).not.toBeInTheDocument());
    await userEvent.click(screen.getByLabelText("Show archived"));
    expect(await screen.findByText("SQL index")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Unarchive" })).toBeInTheDocument();
  });

  it("deletes a snippet", async () => {
    const { fake } = renderPanel("Snippets");
    await userEvent.click(await screen.findByRole("button", { name: "Delete SQL index" }));
    await confirmDelete();
    await waitFor(() => expect(fake.db.snippets.map((s) => s.title)).toEqual(["K8s deploy"]));
  });

  it("saves the editor selection (not the whole document) with parsed tags", async () => {
    const { fake } = renderPanel("Snippets", { getSelection: () => "select 1;" });
    await screen.findByText("SQL index");
    await userEvent.type(screen.getByLabelText("Snippet title"), "Probe");
    await userEvent.selectOptions(screen.getByLabelText("Snippet category"), "SQL");
    await userEvent.type(screen.getByLabelText("Snippet tags"), "db, perf ,");
    await userEvent.click(screen.getByRole("button", { name: /save snippet/i }));
    await waitFor(() => expect(fake.db.snippets.at(-1)).toMatchObject({ title: "Probe", category: "SQL", tags: ["db", "perf"], body: "select 1;" }));
  });

  it("surfaces API errors through notify", async () => {
    const { fake, props } = renderPanel("Snippets");
    await screen.findByText("SQL index");
    fake.fetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: "Server", json: async () => ({ detail: "db down" }) });
    await userEvent.click(screen.getAllByRole("button", { name: "Favourite" })[0]);
    await waitFor(() => expect(props.notify).toHaveBeenCalledWith("Update failed: db down"));
  });
});

describe("Clipboard panel", () => {
  it("lists items, inserts on click, pins and deletes with undo", async () => {
    const { fake, props } = renderPanel("Clipboard History");
    await userEvent.click(await screen.findByText("first clip"));
    expect(props.insert).toHaveBeenCalledWith("first clip", "clipboard item");

    await userEvent.click(screen.getByRole("button", { name: "Pin" }));
    await waitFor(() => expect(fake.db.clipboard[0].pinned).toBe(true));
    expect(await screen.findByRole("button", { name: "Unpin" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("button", { name: /undo delete/i })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /undo delete/i }));
    await waitFor(() => expect(fake.calls).toContain("POST /api/clipboard/c1/restore"));
  });

  it("shows an empty-state hint", async () => {
    renderPanel("Clipboard History", {}, { clipboard: [] });
    expect(await screen.findByText(/captured here automatically/i)).toBeInTheDocument();
  });
});

describe("Documents panel", () => {
  const docs = [
    { id: "d1", title: "Order Platform", content: "# Order Platform", updated_at: null },
    { id: "d2", title: "Runbook", content: "# Runbook", updated_at: null },
  ];

  it("lists, searches, opens and highlights the current document", async () => {
    const { props } = renderPanel("Documents", { currentDocId: "d2" }, { documents: docs });
    await userEvent.click(await screen.findByText("Order Platform"));
    expect(props.onOpenDocument).toHaveBeenCalledWith(expect.objectContaining({ id: "d1" }));

    await userEvent.type(screen.getByLabelText("Search documents"), "run");
    await waitFor(() => expect(screen.queryByText("Order Platform")).not.toBeInTheDocument());
    expect(screen.getByText("Runbook").closest("div")).toHaveClass("ring-1");
  });

  it("deletes a document and shows how recently each one changed", async () => {
    const recent = new Date(Date.now() - 5 * 60_000).toISOString();
    const { fake, props } = renderPanel("Documents", {}, { documents: [docs[0], { ...docs[1], updated_at: recent }] });
    expect(await screen.findByText("5 min ago")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Delete Runbook" }));
    await confirmDelete();
    await waitFor(() => expect(props.onDocumentDeleted).toHaveBeenCalledWith("d2"));
    expect(fake.db.documents.map((d) => d.id)).toEqual(["d1"]);
  });

  it("no longer carries a Save button (saving lives in the header) and points users to it", async () => {
    renderPanel("Documents", {}, { documents: [] });
    expect(await screen.findByText(/use save in the header/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /save/i })).not.toBeInTheDocument();
  });
});

describe("Settings panel", () => {
  const preferences = () => ({
    theme: "light" as const,
    onThemeChange: vi.fn(),
    tone: "ADR" as const,
    onToneChange: vi.fn(),
    onResetLayout: vi.fn(),
  });

  it("shows the current values and reports changes", async () => {
    const controls = preferences();
    renderPanel("Settings", { preferences: controls });
    expect(screen.getByLabelText("Light")).toBeChecked();
    expect(screen.getByLabelText("Default writing style")).toHaveValue("ADR");

    await userEvent.click(screen.getByLabelText("System"));
    expect(controls.onThemeChange).toHaveBeenCalledWith("system");
    await userEvent.selectOptions(screen.getByLabelText("Default writing style"), "RFC");
    expect(controls.onToneChange).toHaveBeenCalledWith("RFC");
    await userEvent.click(screen.getByRole("button", { name: /reset pane sizes/i }));
    expect(controls.onResetLayout).toHaveBeenCalledOnce();
    expect(screen.getByText(/follow you to other browsers/i)).toBeInTheDocument();
  });

  it("degrades gracefully when no controls are provided", () => {
    renderPanel("Settings");
    expect(screen.getByText("Settings are not available.")).toBeInTheDocument();
  });
});

it("loads documents beyond the first page", async () => {
  const documents = Array.from({ length: 51 }, (_, index) => ({ id: `p-${index}`, title: `Page document ${index}`, content: "text" }));
  renderPanel("Documents", {}, { documents });
  await screen.findByRole("button", { name: "Page document 0" });
  expect(screen.queryByRole("button", { name: "Page document 50" })).toBeNull();
  await userEvent.click(screen.getByRole("button", { name: "Load more documents" }));
  expect(await screen.findByRole("button", { name: "Page document 50" })).toBeInTheDocument();
});
