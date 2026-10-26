import { NextRequest } from "next/server";
import { runTool, TOOL_DEFS, type Source } from "@/lib/server-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
  /** Als aanwezig (met Brave-key) krijgt het model de web-tools. */
  braveKey?: string;
}

const MAX_TOOL_ROUNDS = 5;

function parseDataUrl(u: string) {
  const m = /^data:(.+?);base64,(.*)$/.exec(u);
  return m ? { mediaType: m[1], data: m[2] } : null;
}

// ---------- Anthropic ----------

function anthropicMessages(turns: Turn[]) {
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

// ---------- OpenAI-compatible ----------

function openaiMessages(system: string | undefined, turns: Turn[]) {
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

// ---------- Tool-loop (niet-streamend) ----------

async function completeWithTools(body: Body, signal: AbortSignal): Promise<{ text: string; sources: Source[] }> {
  const sources: Source[] = [];
  const isAnthropic = body.kind === "anthropic";

  // Gesprek in het formaat van de provider
  const anthropicConv: unknown[] = isAnthropic ? anthropicMessages(body.messages) : [];
  const openaiConv: unknown[] = isAnthropic ? [] : openaiMessages(body.system, body.messages);

  const anthropicTools = TOOL_DEFS.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  const openaiTools = TOOL_DEFS.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

  for (let round = 0; round < MAX_TOOL_ROUNDS + 1; round++) {
    const allowTools = round < MAX_TOOL_ROUNDS;

    if (isAnthropic) {
      const res = await fetch(endpoint(body), {
        method: "POST",
        headers: headers(body),
        signal,
        body: JSON.stringify({
          model: body.model,
          max_tokens: 4096,
          system: body.system || undefined,
          messages: anthropicConv,
          ...(allowTools ? { tools: anthropicTools } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      const data = (await res.json()) as {
        content: { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }[];
        stop_reason: string;
      };
      const toolUses = data.content.filter((c) => c.type === "tool_use");
      if (data.stop_reason !== "tool_use" || toolUses.length === 0) {
        return { text: data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join(""), sources };
      }
      anthropicConv.push({ role: "assistant", content: data.content });
      const results = [];
      for (const tu of toolUses) {
        const out = await runTool(tu.name!, tu.input ?? {}, body.braveKey, sources);
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      anthropicConv.push({ role: "user", content: results });
    } else {
      const res = await fetch(endpoint(body), {
        method: "POST",
        headers: headers(body),
        signal,
        body: JSON.stringify({
          model: body.model,
          messages: openaiConv,
          ...(allowTools ? { tools: openaiTools } : {}),
        }),
      });
      if (!res.ok) throw new Error((await res.text()) || res.statusText);
      const data = (await res.json()) as {
        choices: {
          message: {
            content: string | null;
            tool_calls?: { id: string; function: { name: string; arguments: string } }[];
          };
        }[];
      };
      const msg = data.choices[0].message;
      if (!msg.tool_calls?.length) return { text: msg.content ?? "", sources };
      openaiConv.push({ role: "assistant", content: msg.content ?? null, tool_calls: msg.tool_calls });
      for (const tc of msg.tool_calls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          /* ongeldige JSON: de tool krijgt lege argumenten */
        }
        const out = await runTool(tc.function.name, args, body.braveKey, sources);
        openaiConv.push({ role: "tool", tool_call_id: tc.id, content: out });
      }
    }
  }
  return { text: "Er is een limiet bereikt voor het aantal zoekstappen.", sources };
}

// ---------- Streamen zonder tools ----------

function extractDelta(kind: Body["kind"], obj: any): string {
  if (kind === "anthropic") {
    return obj.type === "content_block_delta" && obj.delta?.type === "text_delta" ? obj.delta.text ?? "" : "";
  }
  return obj.choices?.[0]?.delta?.content ?? "";
}

function streamPlain(body: Body, signal: AbortSignal): Response {
  const payload =
    body.kind === "anthropic"
      ? {
          model: body.model,
          max_tokens: 4096,
          stream: true,
          system: body.system || undefined,
          messages: anthropicMessages(body.messages),
        }
      : { model: body.model, stream: true, messages: openaiMessages(body.system, body.messages) };

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const push = (t: string) => {
        try {
          controller.enqueue(encoder.encode(t));
        } catch {
          /* client is weg */
        }
      };
      try {
        const upstream = await fetch(endpoint(body), {
          method: "POST",
          headers: headers(body),
          body: JSON.stringify(payload),
          signal,
        });
        if (!upstream.ok || !upstream.body) {
          push(`\n\n[Fout ${upstream.status}: ${(await upstream.text()).slice(0, 500)}]`);
          return;
        }
        const reader = upstream.body.getReader();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx: number;
          while ((idx = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data || data === "[DONE]") continue;
            const obj = JSON.parse(data);
            if (obj.type === "error") throw new Error(obj.error?.message ?? "Upstream fout");
            const text = extractDelta(body.kind, obj);
            if (text) push(text);
          }
        }
      } catch (e) {
        push(`\n\n[Fout: ${(e as Error).message}]`);
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
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}

// ---------- Handler ----------

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  if (!/^https?:\/\//.test(body.baseUrl)) {
    return Response.json({ error: "Ongeldige base URL" }, { status: 400 });
  }

  if (body.braveKey) {
    try {
      const result = await completeWithTools(body, req.signal);
      return Response.json(result);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  }

  return streamPlain(body, req.signal);
}
