import { importHtml } from "./richpaste";

export const FILE_IMPORT_ACCEPT = ".md,.markdown,.txt,.html,.htm";
export const MAX_IMPORT_BYTES = 2_000_000;

export type ImportedFile = { name: string; content: string; message: string };

/** Read locally; importing never uploads the original file or creates a document. */
export async function importFile(file: File): Promise<ImportedFile> {
  if (!/\.(md|markdown|txt|html?)$/i.test(file.name)) {
    throw new Error("Choose a Markdown (.md, .markdown), text (.txt), or HTML (.html, .htm) file");
  }
  if (file.size > MAX_IMPORT_BYTES) throw new Error("File is too large (limit 2 MB)");

  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reader.onabort = () => reject(new Error("Could not read the file. Please try again"));
    reader.readAsArrayBuffer(file);
  });
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error("File is not UTF-8 text. Save it with UTF-8 encoding and try again");
  }
  for (const char of content) {
    const code = char.charCodeAt(0);
    if (code < 9 || (code > 13 && code < 32)) throw new Error("File contains binary data. Choose a text document");
  }

  const notices: string[] = [];
  if (/\.html?$/i.test(file.name)) {
    const imported = importHtml(content);
    content = imported.markdown ?? "";
    notices.push("converted HTML to Markdown", ...imported.notices);
  }
  if (!content.trim()) throw new Error("File has no importable text");
  // Conversion can expand HTML, so also enforce the document API's character limit.
  if (content.length > 2_000_000) throw new Error("Imported text is too long (limit 2,000,000 characters)");
  return { name: file.name, content, message: `Imported “${file.name}”${notices.length ? `: ${notices.join("; ")}` : ""}. Save to keep it in Documents` };
}
