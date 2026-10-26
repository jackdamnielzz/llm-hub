"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Attachment, ChatMessage, Conversation, Project, ProviderConfig, ToolSettings } from "@/lib/types";
import {
  loadConversations,
  loadProjects,
  loadProviders,
  loadTools,
  saveConversations,
  saveProjects,
  saveProviders,
  saveTools,
} from "@/lib/storage";
import { decryptSecret } from "@/lib/crypto";
import { readFile } from "@/lib/files";
import { uid } from "@/lib/id";
import { extractArtifacts, artifactSrcDoc, type Artifact } from "@/lib/artifacts";
import SettingsDialog from "./SettingsDialog";
import ProjectDialog from "./ProjectDialog";

interface Turn {
  role: "user" | "assistant";
  text: string;
  images?: string[];
}

const ARTIFACT_INSTRUCTIONS = `Wanneer je een interactieve pagina, grafiek, diagram of een stuk code van meer dan enkele regels maakt, zet het in één codeblok met taal "html", "svg", "jsx" of de juiste programmeertaal. Gebruik voor React één component (export default) met Tailwind-vrije, inline styles.`;

const WEB_INSTRUCTIONS = `Je hebt toegang tot webzoeken (tool web_search) en het ophalen van pagina's (tool fetch_url). Gebruik ze wanneer de vraag actuele informatie vereist of wanneer je iets moet controleren. Noem de bronnen die je gebruikt.`;

function parseKey(key: string): { providerId: string; model: string } | null {
  const i = key.indexOf("|");
  if (i < 0) return null;
  return { providerId: key.slice(0, i), model: key.slice(i + 1) };
}

function buildSystem(project: Project | undefined, webActive: boolean): string {
  const parts: string[] = [];
  if (project?.instructions.trim()) parts.push(project.instructions.trim());
  for (const f of project?.files ?? []) {
    if (f.text) parts.push(`--- Projectbestand: ${f.name} ---\n${f.text}`);
  }
  if (webActive) parts.push(WEB_INSTRUCTIONS);
  parts.push(ARTIFACT_INSTRUCTIONS);
  return parts.join("\n\n");
}

function toTurns(msgs: ChatMessage[]): Turn[] {
  return msgs.map((m) => {
    let text = m.content;
    const images: string[] = [];
    for (const a of m.attachments ?? []) {
      if (a.dataUrl) images.push(a.dataUrl);
      if (a.text) text += `\n\n--- Bestand: ${a.name} ---\n${a.text}`;
    }
    return { role: m.role, text: text || " ", images: images.length ? images : undefined };
  });
}

const titleFrom = (text: string, fallback: string) => (text || fallback).slice(0, 40) || "Nieuwe chat";

export default function App() {
  const [loaded, setLoaded] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [tools, setTools] = useState<ToolSettings>({ webSearchEnabled: false });
  const [convs, setConvs] = useState<Conversation[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [modelKey, setModelKey] = useState("");
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<Attachment[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | "new" | null>(null);
  const [openArtifact, setOpenArtifact] = useState<Artifact | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProviders(loadProviders());
    setTools(loadTools());
    setConvs(loadConversations());
    setProjects(loadProjects());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (loaded) saveConversations(convs);
  }, [convs, loaded]);
  useEffect(() => {
    if (loaded) saveProjects(projects);
  }, [projects, loaded]);

  const active = useMemo(() => convs.find((c) => c.id === activeId) ?? null, [convs, activeId]);
  const project = useMemo(() => projects.find((p) => p.id === active?.projectId), [projects, active]);

  const modelOptions = useMemo(
    () =>
      providers
        .filter((p) => p.enabled)
        .flatMap((p) => p.models.map((m) => ({ key: `${p.id}|${m}`, label: `${p.name} · ${m}` }))),
    [providers],
  );

  const currentKey = active
    ? `${active.providerId}|${active.model}`
    : modelKey || modelOptions[0]?.key || "";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [active?.messages.length, active?.messages.at(-1)?.content]);

  function newChat(projectId?: string) {
    const sel = parseKey(currentKey);
    if (!sel) {
      setShowSettings(true);
      return;
    }
    const c: Conversation = {
      id: uid(),
      title: "Nieuwe chat",
      projectId,
      providerId: sel.providerId,
      model: sel.model,
      messages: [],
      updatedAt: Date.now(),
    };
    setConvs((p) => [c, ...p]);
    setActiveId(c.id);
    setInput("");
    setPending([]);
    setError(null);
    setOpenArtifact(null);
  }

  function changeModel(key: string) {
    setModelKey(key);
    const sel = parseKey(key);
    if (active && sel) {
      setConvs((p) => p.map((c) => (c.id === active.id ? { ...c, ...sel } : c)));
    }
  }

  function deleteConv(id: string) {
    setConvs((p) => p.filter((c) => c.id !== id));
    if (activeId === id) setActiveId(null);
  }

  function appendToAssistant(convId: string, asstId: string, chunk: string) {
    setConvs((prev) =>
      prev.map((c) =>
        c.id !== convId
          ? c
          : { ...c, messages: c.messages.map((m) => (m.id === asstId ? { ...m, content: m.content + chunk } : m)) },
      ),
    );
  }

  async function onFiles(list: FileList | null) {
    if (!list) return;
    for (const f of Array.from(list)) {
      try {
        const a = await readFile(f);
        setPending((p) => [...p, a]);
      } catch (e) {
        setError((e as Error).message);
      }
    }
  }

  async function send() {
    if (busy) return;
    const text = input.trim();
    if (!text && pending.length === 0) return;

    const sel = parseKey(currentKey);
    const provider = sel && providers.find((p) => p.id === sel.providerId);
    if (!sel || !provider) {
      setError("Voeg eerst een provider met een model toe via Instellingen.");
      setShowSettings(true);
      return;
    }

    const webActive = tools.webSearchEnabled && !!tools.braveKeyEnc;
    const convId = active?.id ?? uid();
    const isNew = !active;
    const asstId = uid();
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      attachments: pending.length ? pending : undefined,
      createdAt: Date.now(),
    };
    const asstMsg: ChatMessage = { id: asstId, role: "assistant", content: "", createdAt: Date.now() };
    const history = active?.messages ?? [];
    const turns = toTurns([...history, userMsg]);
    const system = buildSystem(project, webActive);
    const fallbackTitle = pending[0]?.name ?? "Nieuwe chat";

    setConvs((prev) => {
      const base: Conversation[] = isNew
        ? [
            {
              id: convId,
              title: titleFrom(text, fallbackTitle),
              providerId: sel.providerId,
              model: sel.model,
              messages: [],
              updatedAt: Date.now(),
            },
            ...prev,
          ]
        : prev;
      return base.map((c) =>
        c.id !== convId
          ? c
          : {
              ...c,
              title: c.messages.length === 0 ? titleFrom(text, fallbackTitle) : c.title,
              messages: [...c.messages, userMsg, asstMsg],
              updatedAt: Date.now(),
            },
      );
    });
    setActiveId(convId);
    setInput("");
    setPending([]);
    setError(null);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const apiKey = provider.apiKeyEnc ? await decryptSecret(provider.apiKeyEnc) : "";
      const braveKey = webActive && tools.braveKeyEnc ? await decryptSecret(tools.braveKeyEnc) : undefined;
      const payload = {
        kind: provider.kind,
        baseUrl: provider.baseUrl,
        apiKey,
        model: sel.model,
        system,
        messages: turns,
        braveKey,
      };
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });

      if (braveKey) {
        // Tool-pad: één JSON-antwoord met bronnen
        const data = await res.json();
        if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
        setConvs((prev) =>
          prev.map((c) =>
            c.id !== convId
              ? c
              : {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === asstId ? { ...m, content: data.text, sources: data.sources } : m,
                  ),
                },
          ),
        );
      } else {
        if (!res.ok || !res.body) {
          const msg = await res.text();
          throw new Error(msg || res.statusText);
        }
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          appendToAssistant(convId, asstId, dec.decode(value, { stream: true }));
        }
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
      // Lege placeholder weghalen
      setConvs((prev) =>
        prev.map((c) =>
          c.id !== convId ? c : { ...c, messages: c.messages.filter((m) => !(m.id === asstId && m.content === "")) },
        ),
      );
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  }

  function saveProviderSettings(p: ProviderConfig[], t: ToolSettings) {
    setProviders(p);
    saveProviders(p);
    setTools(t);
    saveTools(t);
  }

  function upsertProject(p: Project) {
    setProjects((prev) => (prev.some((x) => x.id === p.id) ? prev.map((x) => (x.id === p.id ? p : x)) : [...prev, p]));
  }

  function deleteProject(id: string) {
    setProjects((prev) => prev.filter((p) => p.id !== id));
    setConvs((prev) => prev.map((c) => (c.projectId === id ? { ...c, projectId: undefined } : c)));
  }

  if (!loaded) return <div className="empty">Laden…</div>;

  const webReady = !!tools.braveKeyEnc;

  return (
    <div className="app">
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}
      <aside className={`sidebar ${sidebarOpen ? "open" : ""}`}>
        <button className="primary" onClick={() => { newChat(); setSidebarOpen(false); }}>+ Nieuwe chat</button>

        <div className="section">
          <span>Projecten</span>
          <button className="link" onClick={() => setEditingProject("new")}>+</button>
        </div>
        {projects.map((p) => (
          <button key={p.id} className="item" onClick={() => setEditingProject(p)}>
            📁 {p.name}
          </button>
        ))}

        <div className="section"><span>Chats</span></div>
        <div className="list">
          {convs.map((c) => (
            <div key={c.id} className={`item-row ${c.id === activeId ? "active" : ""}`}>
              <button
                className="item"
                onClick={() => {
                  setActiveId(c.id);
                  setSidebarOpen(false);
                  setError(null);
                  setOpenArtifact(null);
                }}
              >
                {c.title}
              </button>
              <button className="icon" title="Verwijderen" onClick={() => deleteConv(c.id)}>✕</button>
            </div>
          ))}
        </div>

        <button className="ghost" onClick={() => setShowSettings(true)}>⚙ Instellingen & API-keys</button>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="menu-btn" aria-label="Menu" onClick={() => setSidebarOpen(true)}>☰</button>
          <select value={currentKey} onChange={(e) => changeModel(e.target.value)}>
            {modelOptions.length === 0 && <option value="">Geen model beschikbaar</option>}
            {modelOptions.map((o) => (
              <option key={o.key} value={o.key}>{o.label}</option>
            ))}
          </select>
          {project && <span className="tag">📁 {project.name}</span>}
          <label className="toggle" title={webReady ? "" : "Voeg eerst een Brave-key toe in Instellingen"}>
            <input
              type="checkbox"
              disabled={!webReady}
              checked={tools.webSearchEnabled && webReady}
              onChange={(e) => {
                const t = { ...tools, webSearchEnabled: e.target.checked };
                setTools(t);
                saveTools(t);
              }}
            />
            🌐 Webzoeken
          </label>
        </header>

        <section className="messages">
          <div className="inner">
            {(!active || active.messages.length === 0) && (
              <div className="hero">Waar kan ik je mee helpen?</div>
            )}
            {active?.messages.map((m) => (
              <MessageView
                key={m.id}
                m={m}
                onOpenArtifact={(a) => setOpenArtifact(a)}
                artifacts={m.role === "assistant" ? extractArtifacts(m.id, m.content) : []}
              />
            ))}
            {error && <div className="error">{error}</div>}
            <div ref={bottomRef} />
          </div>
        </section>

        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            send();
          }}
        >
          <div className="composer-inner">
            {pending.length > 0 && (
              <div className="chips">
                {pending.map((a, i) => (
                  <span key={i} className="chip">
                    {a.name}
                    <button type="button" onClick={() => setPending((p) => p.filter((_, j) => j !== i))}>✕</button>
                  </span>
                ))}
              </div>
            )}
            <div className="row">
              <label className="attach" title="Bestand toevoegen">
                📎
                <input type="file" multiple style={{ display: "none" }} onChange={(e) => onFiles(e.target.files)} />
              </label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Stel je vraag…"
                rows={1}
              />
              {busy ? (
                <button type="button" className="stop" onClick={() => abortRef.current?.abort()}>Stop</button>
              ) : (
                <button type="submit" className="send" disabled={!input.trim() && pending.length === 0}>
                  Verstuur
                </button>
              )}
            </div>
          </div>
        </form>
      </main>

      {openArtifact && (
        <ArtifactPanel artifact={openArtifact} onClose={() => setOpenArtifact(null)} />
      )}

      {showSettings && (
        <SettingsDialog
          providers={providers}
          tools={tools}
          onSave={saveProviderSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {editingProject && (
        <ProjectDialog
          project={editingProject === "new" ? null : editingProject}
          onSave={upsertProject}
          onDelete={deleteProject}
          onStartChat={(id) => newChat(id)}
          onClose={() => setEditingProject(null)}
        />
      )}
    </div>
  );
}

function MessageView({
  m,
  artifacts,
  onOpenArtifact,
}: {
  m: ChatMessage;
  artifacts: Artifact[];
  onOpenArtifact: (a: Artifact) => void;
}) {
  return (
    <div className={`msg ${m.role}`}>
      <div className="bubble">
        {m.attachments?.map((a, i) =>
          a.dataUrl ? (
            <img key={i} src={a.dataUrl} alt={a.name} className="thumb" />
          ) : (
            <div key={i} className="file">📄 {a.name}</div>
          ),
        )}
        {m.role === "assistant" ? (
          m.content ? (
            <div className="markdown">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
            </div>
          ) : (
            <span className="dots">…</span>
          )
        ) : (
          <div className="plain">{m.content}</div>
        )}
        {m.sources && m.sources.length > 0 && (
          <div className="sources">
            {m.sources.slice(0, 8).map((s, i) => (
              <a key={i} href={s.url} target="_blank" rel="noreferrer" title={s.url}>{s.title}</a>
            ))}
          </div>
        )}
        {artifacts.map((a) => (
          <button key={a.id} className="artifact-btn" onClick={() => onOpenArtifact(a)}>
            ▢ Open {a.title}
          </button>
        ))}
      </div>
      {m.role === "assistant" && m.content && (
        <button className="link" onClick={() => navigator.clipboard.writeText(m.content)}>Kopieer</button>
      )}
    </div>
  );
}

function ArtifactPanel({ artifact, onClose }: { artifact: Artifact; onClose: () => void }) {
  const [showCode, setShowCode] = useState(false);
  return (
    <aside className="artifact-panel">
      <div className="artifact-head">
        <span className="title">{artifact.title}</span>
        <button className="ghost" onClick={() => setShowCode((s) => !s)}>{showCode ? "Voorbeeld" : "Code"}</button>
        <button className="ghost" onClick={() => navigator.clipboard.writeText(artifact.code)}>Kopieer</button>
        <button className="icon" onClick={onClose}>✕</button>
      </div>
      <div className="artifact-body">
        {showCode || artifact.kind === "code" ? (
          <pre>{artifact.code}</pre>
        ) : (
          // Sandbox zonder same-origin: de artifact kan niet bij cookies, localStorage of de API-keys
          <iframe title={artifact.title} sandbox="allow-scripts" srcDoc={artifactSrcDoc(artifact)} />
        )}
      </div>
    </aside>
  );
}
