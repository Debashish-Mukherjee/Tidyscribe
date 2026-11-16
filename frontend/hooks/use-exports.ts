"use client";

import { useEffect, useRef, useState } from "react";
import { api, errorMessage, waitForExport } from "../lib/api";
import { extractMermaidSources, hasPlantUml, renderDiagramPngs, type DiagramImage } from "../lib/diagrams";
import { titleFromMarkdown, slugify, triggerDownload } from "../lib/document";
import { renderPreview } from "../lib/preview";

export type ExportFormat = "html" | "docx" | "pdf";
type ExportResult = { content: string; blobUrl: string; filename: string; html?: string };

export function useExports(content: string, setStatusMessage: (message: string) => void) {
  const [exportResults, setExportResults] = useState<Partial<Record<ExportFormat, ExportResult>>>({});
  const [exporting, setExporting] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const running = useRef(false);
  const results = useRef(exportResults);
  useEffect(() => () => {
    for (const result of Object.values(results.current)) URL.revokeObjectURL(result.blobUrl);
  }, []);

  const runExport = async (format: ExportFormat, download = false) => {
    if (!content.trim()) {
      setStatusMessage("Add content before exporting");
      return;
    }

    if (running.current) return;
    running.current = true;
    setExporting(true);
    try {
      setStatusMessage(`Creating ${format.toUpperCase()} export…`);
      const title = titleFromMarkdown(content);

      let diagrams: DiagramImage[] = [];
      let failedDiagrams = 0;
      // The backend expands PlantUML the same way, so Mermaid sources match the rendered images.
      const expandedMarkdown = hasPlantUml(content) ? (await api.expandDiagrams(content)).markdown : content;
      if (extractMermaidSources(expandedMarkdown).length > 0) {
        setStatusMessage("Rendering diagrams…");
        ({ images: diagrams, failed: failedDiagrams } = await renderDiagramPngs(expandedMarkdown));
      }

      // Exports are built from the editor text and never save or create a document. The Preview's own HTML goes along so
      // every format follows what the user saw, not a second rendering of the Markdown.
      const rendered = renderPreview(expandedMarkdown);
      const queued = await api.exports.create({ title, content, html: rendered.ok ? rendered.html : undefined, format, diagrams });
      setJobId(queued.job_id);
      const job = await waitForExport(queued, {
        onStatus: (status) => setStatusMessage((status === "processing" || status === "starting") ? `Generating ${format.toUpperCase()}…` : `${format.toUpperCase()} export queued…`),
      });

      const file = await fetch(job.file_url as string);
      if (!file.ok) throw new Error(`download failed (${file.status})`);
      const blob = await file.blob();
      const filename = `${slugify(title)}.${format}`;

      const previous = results.current[format];
      if (previous) URL.revokeObjectURL(previous.blobUrl);
      const blobUrl = URL.createObjectURL(blob);
      const html = format === "html" ? await blob.text() : undefined;
      results.current = { ...results.current, [format]: { content, blobUrl, filename, html } };
      setExportResults(results.current);

      const note = failedDiagrams > 0 ? ` (${failedDiagrams} diagram(s) could not be rendered and were included as source)` : "";
      setStatusMessage(`${format.toUpperCase()} export ready: ${filename}${note}`);
      if (download) triggerDownload(blobUrl, filename);
    } catch (error) {
      setStatusMessage(`Export failed: ${errorMessage(error)}`);
    } finally {
      running.current = false;
      setJobId(null);
      setExporting(false);
    }
  };


  const cancelExport = async () => {
    if (!jobId) return;
    try {
      await api.exports.cancel(jobId);
      setStatusMessage("Cancellation requested…");
    } catch (error) {
      setStatusMessage(`Could not cancel export: ${errorMessage(error)}`);
    }
  };
  return { exportResults, exporting, runExport, cancelExport, canCancel: jobId !== null };
}
