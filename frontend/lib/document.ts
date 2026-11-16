export const titleFromMarkdown = (markdown: string) => {
  const heading = markdown.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return (heading || "Tidyscribe draft").slice(0, 200);
};
export const slugify = (value: string) => value.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 80) || "document";
export const triggerDownload = (url: string, filename: string) => {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
};
