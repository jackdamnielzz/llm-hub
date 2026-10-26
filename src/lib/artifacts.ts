export type ArtifactKind = "html" | "svg" | "react" | "markdown" | "mermaid" | "code";

export interface Artifact {
  id: string; // messageId-index
  title: string;
  kind: ArtifactKind;
  lang: string;
  code: string;
}

const FENCE = /```([\w+-]*)\n([\s\S]*?)```/g;

function kindOf(lang: string): ArtifactKind {
  if (lang === "html") return "html";
  if (lang === "svg") return "svg";
  if (lang === "jsx" || lang === "tsx" || lang === "react") return "react";
  if (lang === "markdown" || lang === "md") return "markdown";
  if (lang === "mermaid") return "mermaid";
  return "code";
}

const ALWAYS_ARTIFACT = new Set(["html", "svg", "jsx", "tsx", "react", "markdown", "md", "mermaid"]);

/** Haalt codeblokken uit een antwoord die als artifact getoond kunnen worden. */
export function extractArtifacts(messageId: string, content: string): Artifact[] {
  const out: Artifact[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(content))) {
    const lang = m[1].toLowerCase();
    const code = m[2];
    if (code.trim().length < 20) continue;
    // Korte snippets blijven inline; alleen lange of speciale blokken worden een artifact
    if (!ALWAYS_ARTIFACT.has(lang) && code.split("\n").length < 15) continue;
    const kind = kindOf(lang);
    i++;
    out.push({ id: `${messageId}-${i}`, title: `${kind === "code" ? lang || "code" : kind} ${i}`, kind, lang, code });
  }
  return out;
}

const EXT: Record<ArtifactKind, string> = {
  html: "html",
  svg: "svg",
  react: "jsx",
  markdown: "md",
  mermaid: "mmd",
  code: "txt",
};

export function fileNameFor(a: Artifact): string {
  const ext = a.kind === "code" && a.lang ? a.lang : EXT[a.kind];
  return `${a.title.replace(/\s+/g, "-")}.${ext}`;
}

/** Bouwt het document dat in de sandbox-iframe wordt geladen. */
export function artifactSrcDoc(a: Artifact): string {
  if (a.kind === "html") return a.code;
  if (a.kind === "svg") return `<!doctype html><html><body style="margin:0;background:#fff">${a.code}</body></html>`;
  if (a.kind === "mermaid") {
    return `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;padding:16px;background:#fff;font-family:system-ui}</style></head>
<body><pre class="mermaid">${escapeHtml(a.code)}</pre>
<script type="module">
import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
mermaid.initialize({ startOnLoad: true });
</script></body></html>`;
  }
  if (a.kind === "react") {
    return `<!doctype html><html><head><meta charset="utf-8">
<script src="https://unpkg.com/react@18/umd/react.development.js" crossorigin></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js" crossorigin></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<style>body{margin:0;font-family:system-ui,sans-serif}</style></head>
<body><div id="root"></div>
<script type="text/babel" data-presets="react,typescript">
${a.code.replace(/^\s*export\s+default\s+/m, "const __App = ")}
const __C = typeof __App !== "undefined" ? __App : (typeof App !== "undefined" ? App : null);
if (__C) ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(__C));
</script></body></html>`;
  }
  return `<!doctype html><html><body><pre style="white-space:pre-wrap">${escapeHtml(a.code)}</pre></body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
