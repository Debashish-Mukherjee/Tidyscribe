export type ImportSource = "word" | "outlook" | "confluence" | "github" | "teams" | "gemini" | "copilot" | "chatgpt" | "claude" | "generic";

/** What a paste did to the content, in words the user can read in the status bar. */
export type ImportNotice = string;

export type ImportContext = {
  sources: ImportSource[];
  notices: ImportNotice[];
};

export type ImportResult = {
  markdown: string | null;
  sources: ImportSource[];
  notices: ImportNotice[];
};

export const SOURCE_LABELS: Record<ImportSource, string> = {
  word: "Word",
  outlook: "Outlook",
  confluence: "Confluence",
  github: "GitHub",
  teams: "Teams",
  gemini: "Gemini",
  copilot: "Copilot",
  chatgpt: "ChatGPT",
  claude: "Claude",
  generic: "the clipboard",
};

export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
