import { NextRequest } from "next/server";
import { runTool, TOOL_DEFS, type Source } from "@/lib/server-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // Vercel: webzoeken met meerdere stappen duurt langer dan 10 s

interface Turn {
  role: "user" | "assistant";
  text: string;
  images?: string[];
}

interface Body {
  kind: "anthropic" | "openai-compatible";
  baseUrl: string;
  apiKey?: string;
  model: string;
  system?: string;
  messages: Turn[];
  /** Als aanwezig krijgt het model de web-tools. */
  braveKey?: string;
}

type Event =
  | { t: "text"; v: string }
  | { t: "status"; v: string }
  | { t: "source"; v: Source }
  | { t: "error"; v: string };

interface Call {
  id: string;
  name: string;
  args: Record<string, unknown>;
  raw: string;
}

const MAX_TOOL_ROUNDS = 5;
const enc = new TextEncoder();

function parseDataUrl(u: string) {
  const m = /^data:(.+?);base64,(.*)$/.exec(u);
  return m ? { mediaType: m[1], data: m[2] } : null;
}

function anthropicMessages(turns: Turn[]): unknown[] {
  return turns.map((t) => ({
    role: t.role,
    content: t.images?.length
      ? [
          ...t.images.flatMap((u) => {
            const p = parseDataUrl(u);
            return p ? [{ type: "image", source: { type: "base64", media_type: p.mediaType, data: p.data } }] : [];
          }),
          { type: "text", text: t.text || " " },
        ]
      : t.text || " ",
  }));
}

function openaiMessages(system: string | undefined, turns: Turn[]): unknown[] {
  const msgs: unknown[] = [];
  if (system) msgs.push({ role: "system", content: system });
  for (const t of turns) {
    msgs.push({
      role: t.role,
      content: t.images?.length
        ? [...t.images.map((u) => ({ type: "image_url", image_url: { url: u } })), { type: "text", text: t.text }]
        : t.text,
    });
  }
  return msgs;
}

function endpoint(body: Body) {
  const base = body.baseUrl.replace(/\/+$/, "");
  return body.kind === "anthropic" ? `${base}/v1/messages` : `${base}/chat/completions`;
}

function headers(body: Body): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (body.kind === "anthropic") {
    h["x-api-key"] = body.apiKey ?? "";
    h["anthropic-version"] = "2023-06-01";
  } else if (body.apiKey) {
    h["Authorization"] = `Bearer ${body.apiKey}`;
  }
  return h;
}

async function callUpstream(body: Body, payload: unknown, signal: AbortSignal): Promise<Response> {
  const res = await fetch(endpoint(body), {
    method: "POST",
    headers: headers(body),
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) throw new Error(`Provider gaf ${res.status}: ${(await res.text()).slice(0, 500)}`);
  return res;
}

/** Leest de SSE-stream van een provider en geeft elk JSON-event door. */
async function* sseEvents(res: Response): AsyncGenerator<any> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const d = line.slice(5).trim();
      if (!d || d === "[DONE]") continue;
      yield JSON.parse(d);
    }
  }
}

// ---------- Eén ronde bij Anthropic (streamt tekst meteen door) ----------

async function anthropicRound(body: Body, conv: unknown[], allowTools: boolean, signal: AbortSignal, emit: (e: Event) => void) {
  const res = await callUpstream(
    body,
    {
      model: body.model,
      max_tokens: 4096,
      stream: true,
      system: body.system || undefined,
      messages: conv,
      ...(allowTools
        ? { tools: TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters })) }
        : {}),
    },
    signal,
  );

  const blocks: any[] = [];
  for await (const ev of sseEvents(res)) {
    if (ev.type === "error") throw new Error(ev.error?.message ?? "Upstream fout");
    if (ev.type === "content_block_start") {
      const b = ev.content_block;
      blocks[ev.index] =
        b.type === "tool_use"
          ? { type: "tool_use", id: b.id, name: b.name, _json: "" }
          : { type: "text", text: "" };
    } else if (ev.type === "content_block_delta") {
      const b = blocks[ev.index];
      if (!b) continue;
      if (ev.delta?.type === "text_delta") {
        b.text += ev.delta.text;
        emit({ t: "text", v: ev.delta.text });
      } else if (ev.delta?.type === "input_json_delta") {
        b._json += ev.delta.partial_json ?? "";
      }
    }
  }

  const clean = blocks.filter(Boolean).map((b) => {
    if (b.type === "tool_use") {
      let input: Record<string, unknown> = {};
      try {
        input = JSON.parse(b._json || "{}");
      } catch {
        /* ongeldige JSON: lege argumenten */
      }
      return { type: "tool_use", id: b.id, name: b.name, input };
    }
    return { type: "text", text: b.text };
  });
  const calls: Call[] = clean
    .filter((b) => b.type === "tool_use")
    .map((b) => ({ id: b.id as string, name: b.name as string, args: b.input as Record<string, unknown>, raw: JSON.stringify(b.input) }));
  return { blocks: clean.filter((b) => b.type !== "text" || b.text), calls };
}

// ---------- Eén ronde bij OpenAI-compatibel ----------

async function openaiRound(body: Body, conv: unknown[], allowTools: boolean, signal: AbortSignal, emit: (e: Event) => void) {
  const res = await callUpstream(
    body,
    {
      model: body.model,
      stream: true,
      messages: conv,
      ...(allowTools
        ? {
            tools: TOOL_DEFS.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    },
    signal,
  );

  let text = "";
  const tc: Record<number, { id: string; name: string; raw: string }> = {};
  for await (const ev of sseEvents(res)) {
    if (ev.error) throw new Error(ev.error.message ?? "Upstream fout");
    const d = ev.choices?.[0]?.delta;
    if (!d) continue;
    if (d.content) {
      text += d.content;
      emit({ t: "text", v: d.content });
    }
    for (const c of d.tool_calls ?? []) {
      const slot = (tc[c.index] ??= { id: "", name: "", raw: "" });
      if (c.id) slot.id = c.id;
      if (c.function?.name) slot.name += c.function.name;
      if (c.function?.arguments) slot.raw += c.function.arguments;
    }
  }

  const calls: Call[] = Object.entries(tc)
    .filter(([, c]) => c.name)
    .map(([idx, c]) => {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(c.raw || "{}");
      } catch {
        /* ongeldige JSON: lege argumenten */
      }
      return { id: c.id || `call_${idx}`, name: c.name, args, raw: c.raw || "{}" };
    });
  return { text, calls };
}

// ---------- Hoofdloop ----------

function statusFor(name: string, args: Record<string, unknown>): string {
  if (name === "web_search") return `🔎 Zoekt: ${String(args.query ?? "")}`;
  if (name === "fetch_url") return `📄 Leest: ${String(args.url ?? "")}`;
  return `🔧 ${name}`;
}

async function run(body: Body, emit: (e: Event) => void, signal: AbortSignal) {
  const isA = body.kind === "anthropic";
  const conv: unknown[] = isA ? anthropicMessages(body.messages) : openaiMessages(body.system, body.messages);
  const sources: Source[] = [];

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    const allowTools = !!body.braveKey && round < MAX_TOOL_ROUNDS;
    const result = isA
      ? await anthropicRound(body, conv, allowTools, signal, emit)
      : await openaiRound(body, conv, allowTools, signal, emit);

    if (result.calls.length === 0) return; // tekst is al doorgestreamd

    // Sla het assistent-bericht met de tool-aanvragen op, zodat het model context houdt
    const outputs: string[] = [];
    for (const c of result.calls) {
      emit({ t: "status", v: statusFor(c.name, c.args) });
      const before = sources.length;
      outputs.push(await runTool(c.name, c.args, body.braveKey, sources));
      for (const s of sources.slice(before)) emit({ t: "source", v: s });
    }

    if (isA) {
      const r = result as Awaited<ReturnType<typeof anthropicRound>>;
      conv.push({ role: "assistant", content: r.blocks });
      conv.push({
        role: "user",
        content: result.calls.map((c, i) => ({ type: "tool_result", tool_use_id: c.id, content: outputs[i] })),
      });
    } else {
      const r = result as Awaited<ReturnType<typeof openaiRound>>;
      conv.push({
        role: "assistant",
        content: r.text || null,
        tool_calls: result.calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.raw } })),
      });
      result.calls.forEach((c, i) => conv.push({ role: "tool", tool_call_id: c.id, content: outputs[i] }));
    }
  }
  emit({ t: "text", v: "\n\n[Limiet van zoekstappen bereikt]" });
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  if (!/^https?:\/\//.test(body.baseUrl)) {
    return Response.json({ error: "Ongeldige base URL" }, { status: 400 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: Event) => {
        try {
          controller.enqueue(enc.encode(JSON.stringify(e) + "\n"));
        } catch {
          /* client is weg */
        }
      };
      try {
        await run(body, emit, req.signal);
      } catch (e) {
        emit({ t: "error", v: (e as Error).message });
      } finally {
        try {
          controller.close();
        } catch {
          /* al gesloten */
        }
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
