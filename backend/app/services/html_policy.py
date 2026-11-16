"""The one policy for raw HTML in Markdown: a safe, document-semantic subset is preserved everywhere.

The browser preview (frontend/lib/sanitize.ts) and every export writer accept exactly these elements and attributes.
Anything else is removed (its text is kept), so Preview, HTML, DOCX and PDF cannot disagree about what a pasted
fragment means. tests/unit/policy.test.ts keeps the two lists identical.
"""

BLOCK_TAGS = (
    "p", "br", "hr", "div", "span", "blockquote", "pre", "code",
    "h1", "h2", "h3", "h4", "h5", "h6",
    "ul", "ol", "li", "dl", "dt", "dd",
    "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    "details", "summary", "section",
)

INLINE_TAGS = (
    "a", "abbr", "b", "cite", "del", "em", "i", "img", "ins", "kbd", "mark", "q", "s", "samp", "small",
    "strong", "sub", "sup", "u", "var",
)

MATHML_TAGS = (
    "math", "semantics", "annotation", "mrow", "mi", "mn", "mo", "ms", "mtext", "mspace", "msqrt", "mroot",
    "mfrac", "msup", "msub", "msubsup", "munder", "mover", "munderover", "mtable", "mtr", "mtd", "mstyle",
    "mpadded", "mphantom", "menclose",
)

ALLOWED_TAGS = BLOCK_TAGS + INLINE_TAGS + MATHML_TAGS

ALLOWED_ATTRIBUTES = (
    "href", "title", "alt", "src", "colspan", "rowspan", "align", "start", "open", "dir", "lang", "class", "id",
    "role", "data-callout", "data-tex", "aria-checked", "aria-disabled", "aria-label",
    "encoding", "display", "xmlns", "mathvariant", "columnalign", "rowspacing", "columnspacing", "stretchy",
    "fence", "separator", "scriptlevel", "displaystyle", "linethickness", "notation", "lspace", "rspace", "width", "height",
)

# Elements whose whole content is dropped, not unwrapped.
DROPPED_WITH_CONTENT = ("script", "style", "head", "title", "meta", "link", "base", "template", "noscript", "iframe", "object", "embed", "form", "select", "textarea", "button", "svg")

SAFE_LINK_SCHEMES = ("http:", "https:", "mailto:", "tel:")
