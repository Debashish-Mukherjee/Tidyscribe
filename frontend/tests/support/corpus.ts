// Content a user realistically copies out of AI chats and office tools.

export const FENCE = "```";

export function bigTable(rows: number, cols: number): string {
  const head = `| ${Array.from({ length: cols }, (_, c) => `Col ${c + 1}`).join(" | ")} |`;
  const rule = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`;
  const body = Array.from({ length: rows }, (_, r) => `| ${Array.from({ length: cols }, (_, c) => `r${r + 1}c${c + 1}`).join(" | ")} |`);
  return [head, rule, ...body].join("\n");
}

export function bigDocument(lines: number): string {
  const out: string[] = ["# Large document", ""];
  for (let i = 0; i < lines; i += 1) {
    if (i % 50 === 0) out.push("", `## Section ${i / 50 + 1}`, "");
    else if (i % 10 === 0) out.push(`- bullet ${i} with **bold** and \`code\``);
    else out.push(`Line ${i}: The quick brown fox jumps over the lazy dog.`);
  }
  return out.join("\n");
}

export function flowchart(nodes: number): string {
  const lines = ["flowchart TD"];
  for (let i = 0; i < nodes; i += 1) lines.push(`  N${i}[Step ${i}] --> N${i + 1}[Step ${i + 1}]`);
  return `${FENCE}mermaid\n${lines.join("\n")}\n${FENCE}`;
}

export const MERMAID_VALID: Record<string, string> = {
  flowchart: "flowchart LR\n  A[Client] --> B{Gateway}\n  B -->|ok| C[(DB)]\n  B -->|fail| D((Alert))",
  sequence: "sequenceDiagram\n  participant U as User\n  participant A as API\n  U->>A: POST /orders\n  A-->>U: 202 Accepted",
  class: "classDiagram\n  class Order {\n    +String id\n    +submit()\n  }\n  Order --> Customer",
  state: "stateDiagram-v2\n  [*] --> Draft\n  Draft --> Review\n  Review --> [*]",
  er: "erDiagram\n  CUSTOMER ||--o{ ORDER : places\n  ORDER ||--|{ LINE : contains",
  gantt: "gantt\n  title Plan\n  dateFormat YYYY-MM-DD\n  section A\n  Task :a1, 2026-01-01, 10d",
  pie: 'pie title Share\n  "A" : 40\n  "B" : 60',
  mindmap: "mindmap\n  root((Platform))\n    API\n    Workers",
  journey: "journey\n  title Day\n  section Work\n    Code: 5: Me",
  timeline: "timeline\n  title History\n  2025 : Start\n  2026 : Launch",
};

export const MERMAID_INVALID: Record<string, string> = {
  unknownType: "foobar\n  A --> B",
  unclosedBracket: "flowchart TD\n  A[Start --> B",
  danglingArrow: "flowchart TD\n  A -->",
  badSequence: "sequenceDiagram\n  A->>",
  parensInLabel: "flowchart TD\n  A[Call foo(bar) | baz] --> B{x > 1 ?}",
  htmlInLabel: 'flowchart TD\n  A["<img src=x onerror=alert(1)>"] --> B',
};

export const AI_PREAMBLE_DOC = [
  "Sure! Here's a comprehensive design document for you:",
  "",
  "# Order Service",
  "",
  "Let me know if you'd like me to expand any section!",
].join("\n");

export const NESTED_FENCE_DOC = [
  "# Docs",
  "",
  "````markdown",
  "# Inner",
  "```python",
  "print('hi')",
  "```",
  "````",
  "",
  "After the nested block.",
].join("\n");

export const MIXED_HTML_DOC = [
  "# Mixed",
  "",
  "<details><summary>More</summary>",
  "",
  "Hidden **markdown** inside details.",
  "",
  "</details>",
  "",
  "Press <kbd>Ctrl</kbd>+<kbd>C</kbd> then H<sub>2</sub>O and x<sup>2</sup>.<br>Second line.",
  "",
  '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>',
  "",
  '<div align="center"><img src="https://invalid.example/none.png" alt="broken image"></div>',
].join("\n");

export const GITHUB_FLAVOURED_DOC = [
  "# GFM",
  "",
  "Footnote reference[^1] and ~~strike~~ and https://example.com autolink.",
  "",
  "[^1]: The footnote text.",
  "",
  "> [!NOTE]",
  "> A GitHub style note.",
  "",
  "> [!WARNING]",
  "> A warning.",
  "",
  "1. one",
  "1. two",
  "1. three",
  "",
  "3. starts at three",
  "4. four",
  "",
  "- [x] done",
  "- [ ] todo",
  "",
  "Term\n: Definition",
  "",
  "Setext Heading\n==============",
  "",
  ":rocket: emoji shortcode",
].join("\n");

export const MATH_DOC = [
  "# Math",
  "",
  "Inline $E = mc^2$ and block:",
  "",
  "$$",
  "\\int_0^1 x^2 dx = \\frac{1}{3}",
  "$$",
  "",
  "ChatGPT style \\( a^2 + b^2 = c^2 \\) and \\[ x = \\frac{-b}{2a} \\].",
].join("\n");

export const UNICODE_DOC = [
  "# 概要 – Résumé – ملخص – תקציר 🚀",
  "",
  "日本語のテキスト、中文文本、한국어. Emoji: 😀👩‍👩‍👧‍👦🏳️‍🌈. Combining: e\u0301 a\u0308.",
  "",
  "مرحبا بالعالم — النص من اليمين إلى اليسار",
  "",
  "שלום עולם — טקסט מימין לשמאל",
  "",
  "| 名前 | 説明 |",
  "| --- | --- |",
  "| テスト | 日本語 |",
  "",
  `${FENCE}python`,
  "print('こんにちは 🌍')",
  FENCE,
].join("\n");

export const HOSTILE_HTML_DOC = [
  "# Hostile",
  "",
  "[click me](javascript:window.__pwned=1)",
  "",
  "[data link](data:text/html,<script>window.__pwned=2</script>)",
  "",
  '<a href="javascript:window.__pwned=3">raw anchor</a>',
  "",
  '<svg onload="window.__pwned=4"><circle r="5"/></svg>',
  "",
  '<iframe src="javascript:window.__pwned=5"></iframe>',
  "",
  '<style>body{display:none !important}</style>',
  "",
  '<form action="https://evil.example"><input name=x><button>Go</button></form>',
  "",
  '<meta http-equiv="refresh" content="0;url=https://evil.example">',
  "",
  '![x](x " onerror="window.__pwned=6)',
].join("\n");

export const MALFORMED_DOC = [
  "# Broken",
  "",
  `${FENCE}python`,
  "def never_closed():",
  "    pass",
  "",
  "| a | b |",
  "| --- |",
  "| 1 | 2 | 3 | 4 |",
  "",
  "**bold never closed",
  "",
  "[link](unterminated",
  "",
  "<div><span>unclosed",
  "",
  "####### seven hashes",
  "",
  "- item\n    - deep\n        - deeper\n            - deepest\n                - way deeper",
].join("\n");

export function deeplyNestedList(depth: number): string {
  return Array.from({ length: depth }, (_, i) => `${"  ".repeat(i)}- level ${i + 1}`).join("\n");
}

export function deeplyNestedQuote(depth: number): string {
  return `${">".repeat(depth)} quoted at depth ${depth}`;
}

export const SAFE_LINK_ISSUES = ["javascript:", "onerror", "onload"];

// ---------- Clipboard HTML from real-world sources (structure copied from observed payloads) ----------

export interface PasteSample {
  name: string;
  html: string;
  text: string;
  mustContain: Array<string | RegExp>;
  mustNotContain: Array<string | RegExp>;
}

const word = (body: string) =>
  `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"><head><meta charset="utf-8"><!--[if gte mso 9]><xml><o:DocumentProperties></o:DocumentProperties></xml><![endif]--><style><!-- p.MsoNormal{margin:0in;font-size:11pt} --></style></head><body lang=EN-US><!--StartFragment-->${body}<!--EndFragment--></body></html>`;

export const PASTE_SAMPLES: PasteSample[] = [
  {
    name: "Word: headings, bold, fake lists, table",
    html: word(
      `<h1 style='mso-style-name:"Heading 1"'><span style='font-size:16.0pt'>Project Plan</span></h1>` +
        `<p class=MsoNormal>Intro with <b>bold</b>, <i>italic</i> and <a href="https://example.com/a">a link</a>.<o:p></o:p></p>` +
        `<p class=MsoListParagraph style='text-indent:-.25in;mso-list:l0 level1 lfo1'><![if !supportLists]><span style='font-family:Symbol;mso-list:Ignore'>·<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></span><![endif]>First bullet<o:p></o:p></p>` +
        `<p class=MsoListParagraph style='text-indent:-.25in;mso-list:l0 level2 lfo1'><![if !supportLists]><span style='font-family:"Courier New";mso-list:Ignore'>o<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;</span></span><![endif]>Nested bullet<o:p></o:p></p>` +
        `<p class=MsoListParagraph style='text-indent:-.25in;mso-list:l1 level1 lfo2'><![if !supportLists]><span style='mso-list:Ignore'>1.<span style='font:7.0pt "Times New Roman"'>&nbsp;&nbsp;</span></span><![endif]>Numbered item<o:p></o:p></p>` +
        `<table class=MsoTableGrid border=1 cellspacing=0><tr><td><p class=MsoNormal>Name<o:p></o:p></p></td><td><p class=MsoNormal>Role<o:p></o:p></p></td></tr><tr><td><p class=MsoNormal>Ada<o:p></o:p></p></td><td><p class=MsoNormal>Engineer<o:p></o:p></p></td></tr></table>`,
    ),
    text: "Project Plan\nIntro with bold, italic and a link.\n·       First bullet\no   Nested bullet\n1.  Numbered item\nName\tRole\nAda\tEngineer",
    mustContain: ["# Project Plan", "**bold**", "[a link](https://example.com/a)", "- First bullet", "  - Nested bullet", "1. Numbered item", "| Name | Role |", "| Ada | Engineer |"],
    mustNotContain: ["mso-", "<o:p>", "·", "Courier New", "StartFragment"],
  },
  {
    name: "Outlook: WordSection, safelinks, reply header, signature",
    html: word(
      `<div class=WordSection1><p class=MsoNormal>Hi team,<o:p></o:p></p><p class=MsoNormal>See <a href="https://nam06.safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fdoc&amp;data=05%7C01">https://example.com/doc</a><o:p></o:p></p>` +
        `<p class=MsoNormal><b>Action items:</b><o:p></o:p></p><ul><li class=MsoListParagraph>Ship the thing<o:p></o:p></li><li class=MsoListParagraph>Write the docs<o:p></o:p></li></ul>` +
        `<div style='border:none;border-top:solid #E1E1E1 1.0pt;padding:3.0pt 0in 0in 0in'><p class=MsoNormal><b>From:</b> Ada &lt;ada@example.com&gt;<br><b>Sent:</b> Monday, 2 November 2026 9:00 AM<br><b>To:</b> Bob<br><b>Subject:</b> Plan<o:p></o:p></p></div></div>`,
    ),
    text: "Hi team,\nSee https://example.com/doc\nAction items:\nShip the thing\nWrite the docs\nFrom: Ada <ada@example.com>\nSent: Monday, 2 November 2026 9:00 AM",
    mustContain: ["Hi team,", "**Action items:**", "- Ship the thing", "- Write the docs", "https://example.com/doc"],
    mustNotContain: ["WordSection", "<o:p>", "mso-", "safelinks.protection.outlook.com"],
  },
  {
    name: "Confluence: code macro, info panel, table, task list",
    html:
      `<meta charset="utf-8"><h2 id="Design-Overview">Design Overview</h2>` +
      `<div class="code panel pdl" style="border-width: 1px;"><div class="codeContent panelContent pdl"><pre class="syntaxhighlighter-pre" data-syntaxhighlighter-params="brush: java; gutter: false" data-theme="Confluence">public class Order {\n    int id;\n}</pre></div></div>` +
      `<div class="confluence-information-macro confluence-information-macro-note"><span class="aui-icon aui-icon-small aui-iconfont-warning confluence-information-macro-icon"></span><div class="confluence-information-macro-body"><p>Remember to migrate the schema.</p></div></div>` +
      `<div class="table-wrap"><table class="confluenceTable"><tbody><tr><th class="confluenceTh">Service</th><th class="confluenceTh">Owner</th></tr><tr><td class="confluenceTd">Billing</td><td class="confluenceTd">Ada</td></tr></tbody></table></div>` +
      `<ul class="inline-task-list"><li data-inline-task-id="1"><span class="placeholder-inline-tasks">Review</span></li><li class="checked" data-inline-task-id="2"><span class="placeholder-inline-tasks">Approve</span></li></ul>`,
    text: "Design Overview\npublic class Order {\n    int id;\n}\nRemember to migrate the schema.\nService\tOwner\nBilling\tAda\nReview\nApprove",
    mustContain: ["## Design Overview", "public class Order {", "    int id;", "| Service | Owner |", "| Billing | Ada |", "Remember to migrate the schema."],
    mustNotContain: ["confluence", "aui-icon", "syntaxhighlighter"],
  },
  {
    name: "GitHub: rendered README with anchors, highlighted code, task list",
    html:
      `<meta charset="utf-8"><div class="markdown-heading"><h2 class="heading-element">Install</h2><a id="user-content-install" class="anchor" aria-label="Permalink: Install" href="#install"><svg class="octicon octicon-link" viewBox="0 0 16 16" width="16" height="16"><path d="M7.775 3.275z"></path></svg></a></div>` +
      `<div class="highlight highlight-source-shell notranslate position-relative overflow-auto"><pre>npm <span class="pl-c1">install</span> foo</pre><div class="zeroclipboard-container"><clipboard-copy aria-label="Copy" class="ClipboardButton"><svg class="octicon"></svg></clipboard-copy></div></div>` +
      `<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" disabled> Write tests</li><li class="task-list-item"><input type="checkbox" class="task-list-item-checkbox" checked disabled> Ship</li></ul>` +
      `<p>Thanks <g-emoji class="g-emoji" alias="tada" fallback-src="https://github.githubassets.com/images/icons/emoji/unicode/1f389.png">🎉</g-emoji> to <a class="user-mention notranslate" href="https://github.com/octocat">@octocat</a>.</p>`,
    text: "Install\nnpm install foo\nWrite tests\nShip\nThanks 🎉 to @octocat.",
    mustContain: ["## Install", "npm install foo", "- [ ] Write tests", "- [x] Ship", "🎉", "[@octocat](https://github.com/octocat)"],
    mustNotContain: ["octicon", "Permalink", "M7.775", "zeroclipboard"],
  },
  {
    name: "Teams: reply quote, mention, emoji image, code block",
    html:
      `<div><blockquote itemscope="" itemtype="http://schema.skype.com/Reply" itemid="1"><strong itemprop="mri">Ada</strong><span itemprop="time">10:01</span><p itemprop="preview">Can you check the build?</p></blockquote>` +
      `<p>Sure <span itemscope="" itemtype="http://schema.skype.com/Mention" itemid="0">Ada</span>, on it <img alt="😀" src="https://statics.teams.cdn.office.net/evergreen-assets/personal-expressions/v2/assets/emoticons/smile/default/20_f.png" itemtype="http://schema.skype.com/Emoji" width="20" height="20"></p>` +
      `<pre>kubectl get pods -n prod</pre><ul><li>first</li><li>second</li></ul></div>`,
    text: "Ada 10:01 Can you check the build?\nSure Ada, on it 😀\nkubectl get pods -n prod\nfirst\nsecond",
    mustContain: ["Can you check the build?", "kubectl get pods -n prod", "- first", "- second", "😀"],
    mustNotContain: ["schema.skype.com", "statics.teams.cdn", "itemprop"],
  },
  {
    name: "ChatGPT: code block with header and Copy button",
    html:
      `<meta charset="utf-8"><h3 data-start="0" data-end="10">Plan</h3><pre class="overflow-visible!"><div class="contain-inline-size rounded-2xl relative bg-token-sidebar-surface-primary"><div class="flex items-center text-token-text-secondary px-4 py-2 text-xs font-sans justify-between h-9">python<span><button class="flex gap-1 items-center">Copy code</button></span></div><div class="overflow-y-auto p-4" dir="ltr"><code class="whitespace-pre! language-python"><span class="hljs-keyword">def</span> <span class="hljs-title">run</span>():\n    <span class="hljs-keyword">return</span> <span class="hljs-number">1</span></code></div></div></pre>` +
      `<p data-start="20">Then <strong>verify</strong>.</p>`,
    text: "Plan\npython\nCopy code\ndef run():\n    return 1\nThen verify.",
    mustContain: ["### Plan", "```python", "def run():", "    return 1", "**verify**"],
    mustNotContain: ["Copy code", "hljs", "contain-inline-size"],
  },
  {
    name: "ChatGPT: mermaid code block",
    html:
      `<pre class="overflow-visible!"><div class="contain-inline-size"><div class="flex items-center">mermaid<button>Copy code</button></div><div class="overflow-y-auto p-4"><code class="whitespace-pre! language-mermaid">flowchart TD\n  A[Start] --&gt; B[End]</code></div></div></pre>`,
    text: "mermaid\nCopy code\nflowchart TD\n  A[Start] --> B[End]",
    mustContain: ["```mermaid", "flowchart TD", "A[Start] --> B[End]"],
    mustNotContain: ["Copy code"],
  },
  {
    name: "Claude: table, ordered list and code block",
    html:
      `<div class="font-claude-response"><ol class="[&:not(:last-child)]:!pb-1.5 list-decimal"><li class="whitespace-normal break-words"><strong>Plan</strong>: scope</li><li class="whitespace-normal break-words">Build</li></ol>` +
      `<div class="overflow-x-auto w-full px-2 mb-6"><table class="bg-bg-100 min-w-full border-separate border-spacing-0 text-sm leading-[1.88888] whitespace-normal"><thead class="text-left"><tr><th class="text-text-000 font-bold">Tool</th><th>Use</th></tr></thead><tbody><tr><td>Redis</td><td>Cache</td></tr></tbody></table></div>` +
      `<pre class="code-block__code !my-0 !rounded-lg !text-sm !leading-relaxed"><code class="language-bash"><span class="token function">docker</span> compose up -d</code></pre></div>`,
    text: "Plan: scope\nBuild\nTool\tUse\nRedis\tCache\ndocker compose up -d",
    mustContain: ["1. **Plan**: scope", "2. Build", "| Tool | Use |", "| Redis | Cache |", "```bash", "docker compose up -d"],
    mustNotContain: ["font-claude", "bg-bg-100", "token function"],
  },
  {
    name: "Gemini: code-block custom elements and source footnotes",
    html:
      `<p data-path-to-node="1">Use the following<sup class="superscript" data-turn-source-index="1"><button>1</button></sup>:</p>` +
      `<code-block><div class="code-block ng-star-inserted"><div class="code-block-decoration header-formatted"><span>Python</span><div class="buttons"><button mat-icon-button aria-label="Copy code">Copy code</button></div></div><div class="formatted-code-block-internal-container"><div class="animated-opacity"><pre class="ng-star-inserted"><code role="text" data-test-id="code-content">print("hello")\nprint("world")</code></pre></div></div></div></code-block>` +
      `<table-block><div class="table-block-component"><table><thead><tr><th><span>Key</span></th><th><span>Value</span></th></tr></thead><tbody><tr><td><span>a</span></td><td><span>1</span></td></tr></tbody></table></div></table-block>`,
    text: "Use the following1:\nPython\nCopy code\nprint(\"hello\")\nprint(\"world\")\nKey\tValue\na\t1",
    mustContain: ['print("hello")', 'print("world")', "| Key | Value |", "| a | 1 |"],
    mustNotContain: ["Copy code", "Python\n", "ng-star-inserted", "table-block"],
  },
  {
    name: "Copilot: ac-textBlock with code and list",
    html:
      `<div class="ac-textBlock" style="font-size:14px"><p>Here is the <strong>fix</strong>:</p><ul><li>Update <code>config.py</code></li><li>Restart the service</li></ul>` +
      `<div class="ac-codeBlock"><div class="header"><span>json</span><button>Copy</button></div><pre><code class="language-json">{ "retries": 3 }</code></pre></div></div>`,
    text: 'Here is the fix:\nUpdate config.py\nRestart the service\njson\nCopy\n{ "retries": 3 }',
    mustContain: ["**fix**", "- Update `config.py`", "- Restart the service", "```json", '{ "retries": 3 }'],
    mustNotContain: ["ac-textBlock", "\nCopy\n"],
  },
  {
    name: "Web page: article with nested table, image and <br>",
    html:
      `<article><h1>Release notes</h1><p>Line one<br>Line two<br>Line three</p><table><tr><td>Version</td><td>Date</td></tr><tr><td>1.0</td><td>2026-01-01</td></tr></table>` +
      `<p><img src="https://example.com/diagram.png" alt="Architecture"></p><hr><blockquote><p>Quoted <em>text</em></p></blockquote></article>`,
    text: "Release notes\nLine one\nLine two\nLine three\nVersion Date\n1.0 2026-01-01\nQuoted text",
    mustContain: ["# Release notes", "| Version | Date |", "![Architecture](https://example.com/diagram.png)", "---", "> Quoted *text*"],
    mustNotContain: ["<br>", "<table"],
  },
];

// Plain-text paste (no HTML flavour) as copied from the chat UIs' "Copy" buttons.
export const PLAIN_TEXT_AI_COPIES = {
  chatGptWithHeaders:
    "ChatGPT said:\nHere is the plan:\n\n## Steps\n\n1. First\n2. Second\n\npython\nCopy code\nprint('x')\n",
  claudeArtifact: "Claude responded: Here's the doc\n\n# Title\n\nBody\n",
  tabSeparatedExcel: "Name\tRole\nAda\tEngineer\nBob\tDesigner\n",
  csvPaste: "Name,Role\nAda,Engineer\nBob,Designer\n",
  jsonPaste: '{"name":"x","items":[1,2,3],"nested":{"a":null}}',
  yamlPaste: "services:\n  web:\n    image: nginx\n    ports:\n      - \"80:80\"\n",
  sqlPaste: "SELECT a, b\nFROM t\nWHERE a > 1\nORDER BY b;\n",
  xmlPaste: '<?xml version="1.0"?>\n<root><item id="1">x</item></root>\n',
  svgPaste: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>',
  asciiDiagram: "+-------+     +-------+\n|  API  | --> |  DB   |\n+-------+     +-------+\n",
};
