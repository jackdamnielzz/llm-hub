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

const LABEL: Record<ArtifactKind, string> = {
  html: "Webpagina",
  svg: "Afbeelding",
  react: "App",
  markdown: "Document",
  mermaid: "Diagram",
  code: "Code",
};

function isArtifactBlock(lang: string, code: string): boolean {
  if (code.trim().length < 20) return false;
  return ALWAYS_ARTIFACT.has(lang) || code.split("\n").length >= 15;
}

/** Een leesbare titel uit de inhoud, anders leeg. */
function deriveTitle(kind: ArtifactKind, code: string): string {
  const clean = (t: string) => t.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 60);
  if (kind === "html") {
    const t = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(code)?.[1] ?? /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(code)?.[1];
    return t ? clean(t) : "";
  }
  if (kind === "markdown") {
    const h = /^#\s+(.+)$/m.exec(code)?.[1];
    return h ? clean(h) : "";
  }
  return "";
}

/** Haalt de artifact-blokken uit een tekst, zodat alleen de knop getoond wordt. */
export function stripArtifactBlocks(content: string): string {
  return content.replace(/```([\w+-]*)\n([\s\S]*?)```/g, (full, lang: string, code: string) =>
    isArtifactBlock(lang.toLowerCase(), code) ? "" : full,
  );
}

/** Haalt codeblokken uit een antwoord die als artifact getoond kunnen worden. */
export function extractArtifacts(messageId: string, content: string): Artifact[] {
  const out: Artifact[] = [];
  let m: RegExpExecArray | null;
  let i = 0;
  FENCE.lastIndex = 0;
  while ((m = FENCE.exec(content))) {
    const lang = m[1].toLowerCase();
    const code = m[2];
    // Korte snippets blijven inline; alleen lange of speciale blokken worden een artifact
    if (!isArtifactBlock(lang, code)) continue;
    const kind = kindOf(lang);
    i++;
    const title = deriveTitle(kind, code) || (kind === "code" ? `${lang || "Code"} ${i}` : `${LABEL[kind]} ${i}`);
    out.push({ id: `${messageId}-${i}`, title, kind, lang, code });
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


/** Script in de sandbox: geeft de app `llm.ask(...)` om het gekozen model aan te roepen. */
export const LLM_BRIDGE = `<script>
(function(){
  var pending = {}, n = 0;
  window.addEventListener('message', function(e){
    var d = e.data; if (!d || d.type !== 'llm-res' || !pending[d.id]) return;
    var p = pending[d.id];
    if (d.chunk) { p.text += d.chunk; if (p.onChunk) p.onChunk(d.chunk); }
    if (d.error) { delete pending[d.id]; p.reject(new Error(d.error)); }
    if (d.done) { delete pending[d.id]; p.resolve(p.text); }
  });
  window.llm = {
    ask: function(prompt, opts) {
      opts = opts || {};
      var messages = typeof prompt === 'string' ? [{ role: 'user', content: prompt }] : prompt;
      var id = ++n;
      return new Promise(function(resolve, reject) {
        pending[id] = { text: '', onChunk: opts.onChunk, resolve: resolve, reject: reject };
        parent.postMessage({ type: 'llm-ask', id: id, messages: messages, system: opts.system }, '*');
      });
    }
  };
})();
</script>`;

/** Bouwt het document dat in de sandbox-iframe wordt geladen. */
export function artifactSrcDoc(a: Artifact): string {
  if (a.kind === "html") {
    // Bridge in de <head> zetten, zodat de doctype en quirks-mode niet veranderen
    if (/<head[^>]*>/i.test(a.code)) return a.code.replace(/<head[^>]*>/i, (m) => m + LLM_BRIDGE);
    return LLM_BRIDGE + a.code;
  }
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
    return `<!doctype html><html><head><meta charset="utf-8">${LLM_BRIDGE}
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
