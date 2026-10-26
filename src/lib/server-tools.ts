// Server-side tools: webzoeken (Brave Search API) en het ophalen van pagina's.
// Wordt alleen door de API-route gebruikt, nooit in de browser.

export interface Source {
  title: string;
  url: string;
}

export interface ToolResult {
  text: string;
  sources: Source[];
}

export const TOOL_DEFS = [
  {
    name: "web_search",
    description:
      "Zoek op het web naar actuele informatie. Geef een korte, specifieke zoekopdracht. Retourneert titels, URL's en korte snippets.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "De zoekopdracht" } },
      required: ["query"],
    },
  },
  {
    name: "fetch_url",
    description:
      "Haal de leesbare tekst op van een webpagina (bijv. een URL uit de zoekresultaten). Gebruik dit om details te controleren.",
    parameters: {
      type: "object",
      properties: { url: { type: "string", description: "Volledige http(s) URL" } },
      required: ["url"],
    },
  },
];

export async function runTool(
  name: string,
  args: Record<string, unknown>,
  braveKey: string | undefined,
  sources: Source[],
): Promise<string> {
  try {
    if (name === "web_search") {
      if (!braveKey) return "Webzoeken is niet geconfigureerd (geen Brave API-key).";
      return await webSearch(String(args.query ?? ""), braveKey, sources);
    }
    if (name === "fetch_url") {
      return await fetchPage(String(args.url ?? ""), sources);
    }
    return `Onbekende tool: ${name}`;
  } catch (e) {
    return `Fout bij ${name}: ${(e as Error).message}`;
  }
}

async function webSearch(query: string, key: string, sources: Source[]): Promise<string> {
  const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=6`;
  const res = await fetch(url, {
    headers: { Accept: "application/json", "X-Subscription-Token": key },
  });
  if (!res.ok) return `Zoeken mislukt (${res.status}).`;
  const data = (await res.json()) as { web?: { results?: { title: string; url: string; description?: string }[] } };
  const results = data.web?.results ?? [];
  if (results.length === 0) return "Geen resultaten.";
  return results
    .map((r, i) => {
      sources.push({ title: r.title, url: r.url });
      return `[${i + 1}] ${r.title}\n${r.url}\n${stripTags(r.description ?? "")}`;
    })
    .join("\n\n");
}

async function fetchPage(url: string, sources: Source[]): Promise<string> {
  if (!/^https?:\/\//i.test(url)) return "Ongeldige URL.";
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; LLMHub/0.1)" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) return `Pagina niet bereikbaar (${res.status}).`;
  const html = await res.text();
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ?? url;
  sources.push({ title, url });
  const text = stripTags(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " "),
  );
  return text.slice(0, 20_000);
}

function stripTags(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}
