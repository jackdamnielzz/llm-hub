"use client";

import { useState } from "react";
import type { ProviderConfig, ProviderKind, ToolSettings } from "@/lib/types";
import { encryptSecret } from "@/lib/crypto";
import { uid } from "@/lib/id";

type Draft = ProviderConfig & { newKey?: string; clearKey?: boolean; modelsText: string };

interface Props {
  providers: ProviderConfig[];
  tools: ToolSettings;
  onSave: (providers: ProviderConfig[], tools: ToolSettings) => void;
  onClose: () => void;
}

export default function SettingsDialog({ providers, tools, onSave, onClose }: Props) {
  const [drafts, setDrafts] = useState<Draft[]>(
    providers.map((p) => ({ ...p, modelsText: p.models.join(", ") })),
  );
  const [webOn, setWebOn] = useState(tools.webSearchEnabled);
  const [braveNew, setBraveNew] = useState("");
  const [braveClear, setBraveClear] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Draft>) =>
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const addCustom = () =>
    setDrafts((d) => [
      ...d,
      {
        id: `custom-${uid()}`,
        name: "Eigen endpoint",
        kind: "openai-compatible" as ProviderKind,
        baseUrl: "https://",
        models: [],
        modelsText: "",
        enabled: true,
      },
    ]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const out: ProviderConfig[] = [];
      for (const d of drafts) {
        const { newKey, clearKey, modelsText, ...rest } = d;
        let apiKeyEnc = clearKey ? undefined : rest.apiKeyEnc;
        if (newKey?.trim()) apiKeyEnc = await encryptSecret(newKey.trim());
        out.push({
          ...rest,
          apiKeyEnc,
          models: modelsText.split(",").map((s) => s.trim()).filter(Boolean),
        });
      }
      let braveKeyEnc = braveClear ? undefined : tools.braveKeyEnc;
      if (braveNew.trim()) braveKeyEnc = await encryptSecret(braveNew.trim());
      onSave(out, { webSearchEnabled: webOn, braveKeyEnc });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          Instellingen & API-keys
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="hint">
            Keys worden versleuteld in deze browser opgeslagen en per verzoek naar de provider gestuurd via de
            server van deze app. Ze worden niet in een database bewaard.
          </p>

          {drafts.map((d, i) => (
            <div className="card" key={d.id}>
              <div className="card-head">
                <input
                  type="text"
                  value={d.name}
                  onChange={(e) => update(i, { name: e.target.value })}
                  style={{ background: "none", border: 0, fontSize: 15 }}
                />
                <label className="check">
                  <input type="checkbox" checked={d.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} />
                  Aan
                </label>
              </div>
              <div className="field">
                Base URL
                <input value={d.baseUrl} onChange={(e) => update(i, { baseUrl: e.target.value })} />
              </div>
              <div className="field">
                Type
                <select value={d.kind} onChange={(e) => update(i, { kind: e.target.value as ProviderKind })}>
                  <option value="anthropic">Anthropic (Messages API)</option>
                  <option value="openai-compatible">OpenAI-compatibel (chat/completions)</option>
                </select>
              </div>
              <div className="field">
                Modellen (komma-gescheiden)
                <input value={d.modelsText} onChange={(e) => update(i, { modelsText: e.target.value })} />
              </div>
              <div className="field">
                API-key {d.apiKeyEnc && !d.clearKey ? "(opgeslagen, laat leeg om te behouden)" : ""}
                <input
                  type="password"
                  autoComplete="off"
                  placeholder={d.apiKeyEnc ? "••••••••" : "Plak je key"}
                  value={d.newKey ?? ""}
                  onChange={(e) => update(i, { newKey: e.target.value })}
                />
              </div>
              <div className="card-head">
                {d.apiKeyEnc && (
                  <label className="check">
                    <input type="checkbox" checked={!!d.clearKey} onChange={(e) => update(i, { clearKey: e.target.checked })} />
                    Key wissen
                  </label>
                )}
                {d.id.startsWith("custom-") && (
                  <button className="link" onClick={() => setDrafts((x) => x.filter((_, j) => j !== i))}>
                    Verwijder endpoint
                  </button>
                )}
              </div>
            </div>
          ))}
          <button className="ghost" onClick={addCustom}>+ Eigen endpoint toevoegen</button>

          <div className="card">
            <div className="card-head">
              <strong>Webzoeken & pagina's lezen</strong>
              <label className="check">
                <input type="checkbox" checked={webOn} onChange={(e) => setWebOn(e.target.checked)} />
                Aan
              </label>
            </div>
            <p className="hint">
              Het model kan zoeken op het web (Brave Search API) en pagina's ophalen. Vraag een gratis of betaalde
              key aan op brave.com/search/api. {tools.braveKeyEnc && !braveClear ? "Er staat al een key opgeslagen." : ""}
            </p>
            <div className="field">
              Brave Search API-key
              <input
                type="password"
                autoComplete="off"
                placeholder={tools.braveKeyEnc ? "••••••••" : "Plak je key"}
                value={braveNew}
                onChange={(e) => setBraveNew(e.target.value)}
              />
            </div>
            {tools.braveKeyEnc && (
              <label className="check">
                <input type="checkbox" checked={braveClear} onChange={(e) => setBraveClear(e.target.checked)} />
                Key wissen
              </label>
            )}
          </div>
          {err && <div className="error">{err}</div>}
        </div>
        <div className="modal-foot">
          <button className="ghost" onClick={onClose}>Annuleren</button>
          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Opslaan…" : "Opslaan"}
          </button>
        </div>
      </div>
    </div>
  );
}
