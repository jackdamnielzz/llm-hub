import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Haalt de volledige modellijst op bij een provider (OpenAI-compatibel of Anthropic).
export async function POST(req: NextRequest) {
  const { kind, baseUrl, apiKey } = (await req.json()) as {
    kind: "anthropic" | "openai-compatible";
    baseUrl: string;
    apiKey?: string;
  };
  if (!/^https?:\/\//.test(baseUrl)) {
    return Response.json({ error: "Ongeldige base URL" }, { status: 400 });
  }
  const base = baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (kind === "anthropic") {
    headers["x-api-key"] = apiKey ?? "";
    headers["anthropic-version"] = "2023-06-01";
  } else if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }
  const url = kind === "anthropic" ? `${base}/v1/models?limit=1000` : `${base}/models`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      const detail = (await res.text()).slice(0, 300);
      return Response.json({ error: `Provider gaf ${res.status}: ${detail}` }, { status: 502 });
    }
    const data = (await res.json()) as { data?: { id: string }[] };
    const ids = (data.data ?? []).map((m) => m.id).sort();
    return Response.json({ ids });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 502 });
  }
}
