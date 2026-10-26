"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Agent, Attachment, ChatMessage, Conversation, Project, ProviderConfig, ToolSettings } from "@/lib/types";
import {
  loadAgents,
  saveAgents,
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
import { extractArtifacts, artifactSrcDoc, fileNameFor, type Artifact } from "@/lib/artifacts";
import SettingsDialog from "./SettingsDialog";
import ModelsPanel from "./ModelsPanel";
import AgentsPanel from "./AgentsPanel";
import ArtifactsLibrary, { type LibraryItem } from "./ArtifactsLibrary";
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

function buildSystem(project: Project | undefined, webActive: boolean, agentPrompt?: string): string {
  const parts: string[] = [];
  if (agentPrompt?.trim()) parts.push(agentPrompt.trim());
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
  const [showModels, setShowModels] = useState(false);
  const [showAgents, setShowAgents] = useState(false);
  const [showLibrary, setShowLibrary] = useState(false);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [agentSel, setAgentSel] = useState("");

  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setProviders(loadProviders());
    setTools(loadTools());
    setConvs(loadConversations());
    setProjects(loadProjects());
    setAgents(loadAgents());
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
  const useAgent = agents.find((a) => a.id === (active?.agentId ?? agentSel));
  const library: LibraryItem[] = useMemo(
    () =>
      convs.flatMap((c) =>
        c.messages.flatMap((m) =>
          m.role === "assistant"
            ? extractArtifacts(m.id, m.content).map((a) => ({ ...a, chatId: c.id, chatTitle: c.title }))
            : [],
        ),
      ),
    [convs],
  );

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

  function chooseAgent(id: string) {
    setAgentSel(id);
    if (active) {
      const a = agents.find((x) => x.id === id);
      setConvs((p) =>
        p.map((c) =>
          c.id !== active.id
            ? c
            : a
              ? { ...c, agentId: id, providerId: a.providerId, model: a.model }
              : { ...c, agentId: undefined },
        ),
      );
    }
    const a = agents.find((x) => x.id === id);
    if (a) setModelKey(`${a.providerId}|${a.model}`);
  }

  function saveAgentList(a: Agent[]) {
    setAgents(a);
    saveAgents(a);
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

  function updateAssistant(convId: string, asstId: string, fn: (m: ChatMessage) => ChatMessage) {
    setConvs((prev) =>
      prev.map((c) =>
        c.id !== convId ? c : { ...c, messages: c.messages.map((m) => (m.id === asstId ? fn(m) : m)) },
      ),
    );
  }

  function applyEvent(convId: string, asstId: string, ev: { t: string; v: any }) {
    if (ev.t === "text") updateAssistant(convId, asstId, (m) => ({ ...m, content: m.content + ev.v }));
    else if (ev.t === "status") updateAssistant(convId, asstId, (m) => ({ ...m, steps: [...(m.steps ?? []), ev.v] }));
    else if (ev.t === "source") updateAssistant(convId, asstId, (m) => ({ ...m, sources: [...(m.sources ?? []), ev.v] }));
    else if (ev.t === "error") throw new Error(ev.v);
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

  /** Streamt een antwoord voor `base` (de berichten tot en met het laatste user-bericht). */
  async function generate(
    convId: string,
    base: ChatMessage[],
    o: { providerId: string; model: string; agentId?: string; isNew: boolean; title?: string },
  ) {
    const provider = providers.find((p) => p.id === o.providerId);
    if (!provider) {
      setError("Deze provider bestaat niet meer. Kies een ander model.");
      return;
    }
    const agent = agents.find((x) => x.id === o.agentId);
    const convProject = projects.find((p) => p.id === active?.projectId);
    const webActive = (agent ? agent.webSearch : tools.webSearchEnabled) && !!tools.braveKeyEnc;
    const system = buildSystem(convProject, webActive, agent?.systemPrompt);
    const asstId = uid();
    const asstMsg: ChatMessage = { id: asstId, role: "assistant", content: "", createdAt: Date.now() };
    const turns = toTurns(base);

    setConvs((prev) => {
      const exists = prev.some((c) => c.id === convId);
      const next: Conversation[] = exists
        ? prev
        : [
            {
              id: convId,
              title: o.title ?? "Nieuwe chat",
              agentId: o.agentId || undefined,
              projectId: active?.projectId,
              providerId: o.providerId,
              model: o.model,
              messages: [],
              updatedAt: Date.now(),
            },
            ...prev,
          ];
      return next.map((c) =>
        c.id !== convId
          ? c
          : {
              ...c,
              title: o.title ?? c.title,
              providerId: o.providerId,
              model: o.model,
              messages: [...base, asstMsg],
              updatedAt: Date.now(),
            },
      );
    });
    setActiveId(convId);
    setError(null);
    setBusy(true);

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const apiKey = provider.apiKeyEnc ? await decryptSecret(provider.apiKeyEnc) : "";
      const braveKey = webActive && tools.braveKeyEnc ? await decryptSecret(tools.braveKeyEnc) : undefined;
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: provider.kind,
          baseUrl: provider.baseUrl,
          apiKey,
          model: o.model,
          system,
          messages: turns,
          braveKey,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) throw new Error((await res.text()) || res.statusText);

      // Elke regel is een JSON-event: tekst, status, bron of fout
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i: number;
        while ((i = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, i);
          buf = buf.slice(i + 1);
          if (line.trim()) applyEvent(convId, asstId, JSON.parse(line));
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

  async function send() {
    if (busy) return;
    const text = input.trim();
    if (!text && pending.length === 0) return;

    const sel = parseKey(currentKey);
    if (!sel) {
      setError("Voeg eerst een provider met een model toe via Instellingen.");
      setShowSettings(true);
      return;
    }

    const convId = active?.id ?? uid();
    const userMsg: ChatMessage = {
      id: uid(),
      role: "user",
      content: text,
      attachments: pending.length ? pending : undefined,
      createdAt: Date.now(),
    };
    const history = active?.messages ?? [];
    const fallbackTitle = pending[0]?.name ?? "Nieuwe chat";
    setInput("");
    setPending([]);
    await generate(convId, [...history, userMsg], {
      providerId: sel.providerId,
      model: sel.model,
      agentId: active ? active.agentId : agentSel || undefined,
      isNew: !active,
      title: history.length === 0 ? titleFrom(text, fallbackTitle) : undefined,
    });
  }

  /** Opnieuw genereren: het laatste antwoord vervangen door een nieuw. */
  async function regenerate() {
    if (busy || !active) return;
    const lastUser = [...active.messages].reverse().find((m) => m.role === "user");
    if (!lastUser) return;
    const idx = active.messages.indexOf(lastUser);
    await generate(active.id, active.messages.slice(0, idx + 1), {
      providerId: active.providerId,
      model: active.model,
      agentId: active.agentId,
      isNew: false,
    });
  }

  /** Bewerk een eigen bericht: alles erna wordt vervangen door een nieuw antwoord. */
  async function editMessage(msgId: string, newText: string) {
    if (busy || !active) return;
    const idx = active.messages.findIndex((m) => m.id === msgId);
    if (idx < 0) return;
    const original = active.messages[idx];
    const edited: ChatMessage = { ...original, id: uid(), content: newText, createdAt: Date.now() };
    await generate(active.id, [...active.messages.slice(0, idx), edited], {
      providerId: active.providerId,
      model: active.model,
      agentId: active.agentId,
      isNew: false,
    });
  }

  function renameConv(id: string) {
    const c = convs.find((x) => x.id === id);
    const name = window.prompt("Nieuwe naam voor deze chat", c?.title ?? "");
    if (!name?.trim()) return;
    setConvs((prev) => prev.map((x) => (x.id === id ? { ...x, title: name.trim() } : x)));
  }

  function saveModels(p: ProviderConfig[]) {
    setProviders(p);
    saveProviders(p);
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
                  setAgentSel(c.agentId ?? "");
                  setSidebarOpen(false);
                  setError(null);
                  setOpenArtifact(null);
                }}
              >
                {c.title}
              </button>
              <button className="icon" title="Hernoemen" onClick={() => renameConv(c.id)}>✎</button>
              <button className="icon" title="Verwijderen" onClick={() => deleteConv(c.id)}>✕</button>
            </div>
          ))}
        </div>

        <button className="ghost" onClick={() => { setShowLibrary(true); setSidebarOpen(false); }}>📦 Artifacts</button>
        <button className="ghost" onClick={() => { setShowAgents(true); setSidebarOpen(false); }}>🤖 Agenten</button>
        <button className="ghost" onClick={() => { setShowModels(true); setSidebarOpen(false); }}>🧩 Modellen</button>
        <button className="ghost" onClick={() => setShowSettings(true)}>⚙ Instellingen & API-keys</button>
      </aside>

      <main className="main">
        <header className="topbar">
          <button className="menu-btn" aria-label="Menu" onClick={() => setSidebarOpen(true)}>☰</button>
          <select value={active?.agentId ?? agentSel} onChange={(e) => chooseAgent(e.target.value)} title="Agent">
            <option value="">Geen agent</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>🤖 {a.name}</option>
            ))}
          </select>
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
            {active?.messages.map((m, i, arr) => (
              <MessageView
                key={m.id}
                m={m}
                onOpenArtifact={(a) => setOpenArtifact(a)}
                artifacts={m.role === "assistant" ? extractArtifacts(m.id, m.content) : []}
                isLast={i === arr.length - 1}
                disabled={busy}
                onEdit={editMessage}
                onRegenerate={regenerate}
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
        <ArtifactPanel
          key={openArtifact.id}
          artifact={openArtifact}
          providers={providers}
          defaultKey={currentKey}
          onClose={() => setOpenArtifact(null)}
        />
      )}

      {showLibrary && (
        <ArtifactsLibrary
          items={library}
          onClose={() => setShowLibrary(false)}
          onOpen={(it) => {
            setShowLibrary(false);
            setActiveId(it.chatId);
            setOpenArtifact(it);
          }}
        />
      )}

      {showAgents && (
        <AgentsPanel
          agents={agents}
          providers={providers}
          onSave={saveAgentList}
          onClose={() => setShowAgents(false)}
        />
      )}

      {showModels && (
        <ModelsPanel
          providers={providers}
          onSave={saveModels}
          onClose={() => setShowModels(false)}
        />
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
  isLast,
  disabled,
  onEdit,
  onRegenerate,
}: {
  m: ChatMessage;
  artifacts: Artifact[];
  onOpenArtifact: (a: Artifact) => void;
  isLast: boolean;
  disabled: boolean;
  onEdit: (id: string, text: string) => void;
  onRegenerate: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);

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
        {m.role === "user" && editing ? (
          <div className="edit-box">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} />
            <div className="card-head">
              <button className="ghost" onClick={() => setEditing(false)}>Annuleren</button>
              <button
                className="primary"
                disabled={!draft.trim() || disabled}
                onClick={() => {
                  setEditing(false);
                  onEdit(m.id, draft.trim());
                }}
              >
                Opslaan en opnieuw
              </button>
            </div>
          </div>
        ) : m.role === "assistant" ? (
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
        {m.steps && m.steps.length > 0 && (
          <details className="steps">
            <summary>
              {m.steps.length} {m.steps.length === 1 ? "stap" : "stappen"} · tik om te zien wat het model deed
            </summary>
            <ol>
              {m.steps.map((st, i) => (
                <li key={i}>{st}</li>
              ))}
            </ol>
          </details>
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
      <div className="msg-actions">
        {m.role === "user" && !editing && (
          <button className="link" disabled={disabled} onClick={() => { setDraft(m.content); setEditing(true); }}>
            Bewerk
          </button>
        )}
        {m.role === "assistant" && m.content && (
          <button className="link" onClick={() => navigator.clipboard.writeText(m.content)}>Kopieer</button>
        )}
        {m.role === "assistant" && isLast && (
          <button className="link" disabled={disabled} onClick={onRegenerate}>↻ Opnieuw</button>
        )}
      </div>
    </div>
  );
}

function ArtifactPanel({
  artifact,
  providers,
  defaultKey,
  onClose,
}: {
  artifact: Artifact;
  providers: ProviderConfig[];
  defaultKey: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"preview" | "code">("preview");
  const [code, setCode] = useState(artifact.code);
  const [modelKey, setModelKey] = useState(defaultKey);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const current: Artifact = { ...artifact, code };
  const edited = code !== artifact.code;
  const modelOptions = providers
    .filter((p) => p.enabled)
    .flatMap((p) => p.models.map((m) => ({ key: `${p.id}|${m}`, label: `${p.name} · ${m}` })));

  // Antwoord op llm.ask() uit de app: stuur het door naar het gekozen model met jouw key
  useEffect(() => {
    async function onMessage(e: MessageEvent) {
      const frame = iframeRef.current?.contentWindow;
      if (!frame || e.source !== frame) return;
      const d = e.data;
      if (!d || d.type !== "llm-ask") return;
      const reply = (msg: Record<string, unknown>) => frame.postMessage({ type: "llm-res", id: d.id, ...msg }, "*");
      try {
        const sel = parseKey(modelKey);
        const provider = sel && providers.find((p) => p.id === sel.providerId);
        if (!sel || !provider) throw new Error("Kies eerst een model onder de artifact-knop.");
        const apiKey = provider.apiKeyEnc ? await decryptSecret(provider.apiKeyEnc) : "";
        const msgs = (Array.isArray(d.messages) ? d.messages : []) as { role: "user" | "assistant"; content: string }[];
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind: provider.kind,
            baseUrl: provider.baseUrl,
            apiKey,
            model: sel.model,
            system: typeof d.system === "string" ? d.system : undefined,
            messages: msgs.map((m) => ({ role: m.role, text: String(m.content) })),
          }),
        });
        if (!res.ok || !res.body) throw new Error((await res.text()) || res.statusText);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) !== -1) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (!line.trim()) continue;
            const ev = JSON.parse(line);
            if (ev.t === "text") reply({ chunk: ev.v });
            if (ev.t === "error") throw new Error(ev.v);
          }
        }
        reply({ done: true });
      } catch (err) {
        reply({ error: (err as Error).message });
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [modelKey, providers]);

  function download() {
    const blob = new Blob([code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileNameFor(current);
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <aside className="artifact-panel">
      <div className="artifact-head">
        <span className="title">{artifact.title}{edited ? " · bewerkt" : ""}</span>
        <select
          className="artifact-model"
          value={modelKey}
          onChange={(e) => setModelKey(e.target.value)}
          title="Model voor llm.ask() in deze app"
        >
          {modelOptions.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <button className="ghost" onClick={() => setMode((m) => (m === "preview" ? "code" : "preview"))}>
          {mode === "preview" ? "Code" : "Voorbeeld"}
        </button>
        <button className="ghost" onClick={() => navigator.clipboard.writeText(code)}>Kopieer</button>
        <button className="ghost" onClick={download}>⬇</button>
        <button className="icon" onClick={onClose}>✕</button>
      </div>
      <div className="artifact-body">
        {mode === "code" ? (
          <textarea className="artifact-code" value={code} onChange={(e) => setCode(e.target.value)} spellCheck={false} />
        ) : artifact.kind === "markdown" ? (
          <div className="artifact-doc markdown">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{code}</ReactMarkdown>
          </div>
        ) : artifact.kind === "code" ? (
          <pre>{code}</pre>
        ) : (
          // Sandbox zonder same-origin: de app kan niet bij cookies, localStorage of je keys
          <iframe ref={iframeRef} title={artifact.title} sandbox="allow-scripts" srcDoc={artifactSrcDoc(current)} />
        )}
      </div>
    </aside>
  );
}
