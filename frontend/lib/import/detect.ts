import type { ImportSource } from "./types";

/**
 * Which tool a clipboard came from, judged by markers that tool puts in its HTML. Several can apply at once
 * (Outlook mail is Word HTML), and every adapter only acts on markup that is unmistakably its own.
 */
export function detectSources(html: string): ImportSource[] {
  const found: ImportSource[] = [];
  const has = (pattern: RegExp) => pattern.test(html);

  const word = has(/urn:schemas-microsoft-com:office:word|xmlns:w=|class="?Mso[A-Z]|mso-[a-z-]+:|<o:p>|name="?Generator"? content="?Microsoft Word/i);
  const outlook = has(/safelinks\.protection\.outlook\.com|urldefense\.(?:proofpoint\.)?com|id="?divRplyFwdMsg|OutlookMessageHeader|class="?(?:x_)?MsoNormal[^>]*>\s*<b>From:/i);
  if (word) found.push("word");
  if (outlook) found.push("outlook");

  if (has(/confluence-|confluenceT[dh]|ak-renderer|data-macro-name=|syntaxhighlighter|inline-task-list|data-prosemirror-node-name="?(?:panel|taskItem|extension)|data-panel-type=/i)) found.push("confluence");
  if (has(/class="[^"]*(?:markdown-body|markdown-heading|octicon|user-mention)|<g-emoji|<clipboard-copy|user-content-|data-footnote-ref/i)) found.push("github");
  if (has(/schema\.skype\.com|statics\.teams\.cdn|itemtype="?https?:\/\/schema\.skype/i)) found.push("teams");
  if (has(/<code-block|data-path-to-node|<table-block|<response-element|<message-content|formatted-code-block|data-turn-source-index|model-response/i)) found.push("gemini");
  if (has(/ac-textBlock|ac-codeBlock|ac-container|class="[^"]*\bcib-|data-content="?ai-message/i)) found.push("copilot");
  if (has(/data-message-author-role|data-start="|data-end="|contain-inline-size|overflow-visible!|whitespace-pre!|class="[^"]*\bmarkdown prose/i)) found.push("chatgpt");
  if (has(/font-claude|code-block__code|standard-markdown|class="[^"]*\bbg-bg-\d|claude\.ai/i)) found.push("claude");

  return found.length > 0 ? found : ["generic"];
}
