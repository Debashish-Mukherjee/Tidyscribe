import DOMPurify from "dompurify";

/** HTML that has been through `sanitizeHtml`; the only type the preview sink accepts. */
export type SafeHtml = string & { readonly __safeHtml: true };

export const EMPTY_HTML = "" as SafeHtml;

/**
 * The single raw-HTML policy: a safe, document-semantic subset is preserved in Preview and in every export.
 * backend/app/services/html_policy.py holds the same lists (tests/unit/policy.test.ts keeps them identical).
 */
export const BLOCK_TAGS = [
  "p", "br", "hr", "div", "span", "blockquote", "pre", "code",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "dl", "dt", "dd",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "details", "summary", "section",
];

export const INLINE_TAGS = [
  "a", "abbr", "b", "cite", "del", "em", "i", "img", "ins", "kbd", "mark", "q", "s", "samp", "small",
  "strong", "sub", "sup", "u", "var",
];

export const MATHML_TAGS = [
  "math", "semantics", "annotation", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msqrt", "mroot",
  "mfrac", "msup", "msub", "msubsup", "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mstyle",
  "mpadded", "mphantom", "menclose",
];

export const ALLOWED_TAGS = [...BLOCK_TAGS, ...INLINE_TAGS, ...MATHML_TAGS];

export const ALLOWED_ATTRIBUTES = [
  "href", "title", "alt", "src", "colspan", "rowspan", "align", "start", "open", "dir", "lang", "class", "id",
  "role", "data-callout", "data-tex", "aria-checked", "aria-disabled", "aria-label",
  "encoding", "display", "xmlns", "mathvariant", "columnalign", "rowspacing", "columnspacing", "stretchy",
  "fence", "separator", "scriptlevel", "displaystyle", "linethickness", "notation", "lspace", "rspace", "width", "height",
];

// Elements that restyle, redirect, submit or embed. Stored or pasted content has no business using them.
export const FORBIDDEN_TAGS = [
  "style",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "option",
  "optgroup",
  "datalist",
  "fieldset",
  "output",
  "dialog",
  "iframe",
  "frame",
  "frameset",
  "object",
  "embed",
  "applet",
  "script",
  "noscript",
  "template",
  "slot",
];

// Inline style can still cover the page (position: fixed) even without a <style> element.
export const FORBIDDEN_ATTRIBUTES = ["style", "action", "formaction", "autofocus", "ping"];

export type SanitizeResult = { html: SafeHtml; blocked: string[] };

/** Fails closed: without a DOM nothing can be sanitised, so nothing is returned. */
export function sanitizeHtml(dirty: string, options: { extraAttributes?: string[] } = {}): SanitizeResult {
  if (!DOMPurify.isSupported) return { html: EMPTY_HTML, blocked: [] };

  // FORCE_BODY keeps a leading <style> in the body, where it is removed and reported instead of silently parsed into <head>.
  const html = DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR: [...ALLOWED_ATTRIBUTES, ...(options.extraAttributes ?? [])],
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: FORBIDDEN_TAGS,
    FORBID_ATTR: FORBIDDEN_ATTRIBUTES,
    FORCE_BODY: true,
  });

  const blocked = new Set<string>();
  for (const entry of DOMPurify.removed) {
    if ("element" in entry) {
      const name = entry.element.nodeName.toLowerCase();
      // "remove" and "body" are wrappers FORCE_BODY itself inserts.
      if (!name.startsWith("#") && name !== "remove" && name !== "body") blocked.add(`<${name}>`);
    } else if (entry.attribute) {
      blocked.add(entry.attribute.name.toLowerCase());
    }
  }
  return { html: html as SafeHtml, blocked: [...blocked] };
}
