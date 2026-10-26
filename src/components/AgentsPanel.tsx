"use client";

import { useState } from "react";
import type { Agent, ProviderConfig } from "@/lib/types";
import { uid } from "@/lib/id";

interface Props {
  agents: Agent[];
  providers: ProviderConfig[];
  onSave: (a: Agent[]) => void;
  onClose: () => void;
}

export default function AgentsPanel({ agents, providers, onSave, onClose }: Props) {
  const [list, setList] = useState<Agent[]>(agents);
  const [editing, setEditing] = useState<Agent | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const modelOptions = providers
    .filter((p) => p.enabled)
    .flatMap((p) => p.models.map((m) => ({ key: `${p.id}|${m}`, label: `${p.name} · ${m}` })));

  function startNew() {
    const first = providers.find((p) => p.enabled && p.models.length) ?? providers[0];
    setEditing({
      id: uid(),
      name: "",
      description: "",
      providerId: first?.id ?? "",
      model: first?.models[0] ?? "",
      systemPrompt: "",
      webSearch: false,
    });
    setIsNew(true);
    setErr(null);
  }

  function startEdit(a: Agent) {
    setEditing({ ...a });
    setIsNew(false);
    setErr(null);
  }

  function saveEditing() {
    if (!editing) return;
    if (!editing.name.trim()) return setErr("Geef de agent een naam.");
    if (!editing.model) return setErr("Kies eerst een model. Zet modellen aan via 🧩 Modellen.");
    const a = { ...editing, name: editing.name.trim(), description: editing.description.trim() };
    setList((l) => (isNew ? [...l, a] : l.map((x) => (x.id === a.id ? a : x))));
    setEditing(null);
  }

  function commit() {
    onSave(list);
    onClose();
  }

  const currentKey = editing ? `${editing.providerId}|${editing.model}` : "";
  const optionsWithCurrent =
    editing && !modelOptions.some((o) => o.key === currentKey) && editing.model
      ? [{ key: currentKey, label: `${editing.model} (niet aan)` }, ...modelOptions]
      : modelOptions;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {editing ? (isNew ? "Nieuwe agent" : "Agent bewerken") : "Agenten"}
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {!editing && (
            <>
              <p className="hint">
                Een agent is een opgeslagen profiel: een model, een eigen systeemprompt en webzoeken aan of uit.
                Kies in de chat bovenin een agent om die instellingen te gebruiken.
              </p>
              {list.length === 0 && <div className="hint">Nog geen agenten.</div>}
              {list.map((a) => (
                <div className="card" key={a.id}>
                  <div className="card-head">
                    <strong>🤖 {a.name}</strong>
                    <span className="hint">{a.model}{a.webSearch ? " · webzoeken" : ""}</span>
                  </div>
                  {a.description && <div className="hint">{a.description}</div>}
                  <div className="card-head">
                    <button className="ghost" onClick={() => startEdit(a)}>Bewerk</button>
                    <button className="link" onClick={() => setList((l) => l.filter((x) => x.id !== a.id))}>
                      Verwijder
                    </button>
                  </div>
                </div>
              ))}
              <button className="primary" onClick={startNew}>+ Nieuwe agent</button>
            </>
          )}

          {editing && (
            <>
              <div className="field">
                Naam
                <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div className="field">
                Beschrijving (alleen voor jezelf)
                <input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </div>
              <div className="field">
                Model
                <select
                  value={currentKey}
                  onChange={(e) => {
                    const i = e.target.value.indexOf("|");
                    setEditing({
                      ...editing,
                      providerId: e.target.value.slice(0, i),
                      model: e.target.value.slice(i + 1),
                    });
                  }}
                >
                  {optionsWithCurrent.length === 0 && <option value="">Geen modellen aan</option>}
                  {optionsWithCurrent.map((o) => (
                    <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                Systeemprompt (hoe de agent zich gedraagt)
                <textarea
                  style={{ minHeight: 220 }}
                  placeholder="Bijv. Je bent een nuchtere ISO 27001-adviseur. Antwoord in het Nederlands, kort en met bronnen waar mogelijk."
                  value={editing.systemPrompt}
                  onChange={(e) => setEditing({ ...editing, systemPrompt: e.target.value })}
                />
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={editing.webSearch}
                  onChange={(e) => setEditing({ ...editing, webSearch: e.target.checked })}
                />
                Webzoeken aan (vereist een Brave-key in Instellingen)
              </label>
              {err && <div className="error">{err}</div>}
              <div className="card-head">
                <button className="ghost" onClick={() => setEditing(null)}>Terug</button>
                <button className="primary" onClick={saveEditing}>Agent klaar</button>
              </div>
            </>
          )}
        </div>
        <div className="modal-foot">
          <button className="ghost" onClick={onClose}>Annuleren</button>
          <button className="primary" onClick={commit} disabled={!!editing}>Opslaan</button>
        </div>
      </div>
    </div>
  );
}
