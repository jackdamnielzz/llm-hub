export interface Artifact {
  id: string; // messageId-index
  title: string;
  kind: "html" | "svg" | "react" | "code";
  lang: string;
  code: string;
}

const FENCE = /```([\w+-]*)\n([\s\S]*?)```/g;
const RUNNABLE = new Set(["html", "svg", "jsx", "tsx", "react"]);

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
    const kind: Artifact["kind"] = lang === "html" ? "html" : lang === "svg" ? "svg" : lang === "jsx" || lang === "tsx" || lang === "react" ? "react" : "code";
    if (!RUNNABLE.has(lang) && code.split("\n").length < 15) continue; // korte snippets blijven inline
    out.push({
      id: `${messageId}-${i++}`,
      title: `${kind === "code" ? lang || "code" : kind} ${i}`,
      kind,
      lang,
      code,
    });
  }
  return out;
}

/** Bouwt het document dat in de sandbox-iframe wordt geladen. */
export function artifactSrcDoc(a: Artifact): string {
  if (a.kind === "html") return a.code;
  if (a.kind === "svg") return `<!doctype html><html><body style="margin:0;background:#fff">${a.code}</body></html>`;
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
