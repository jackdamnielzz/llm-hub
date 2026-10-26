"use client";

import { useEffect, useState } from "react";
import type { ProviderConfig } from "@/lib/types";
import { decryptSecret } from "@/lib/crypto";

type Row = ProviderConfig & { filter: string; fetching: boolean; fetchErr?: string; manual: string };

interface Props {
  providers: ProviderConfig[];
  onSave: (p: ProviderConfig[]) => void;
  onClose: () => void;
}

const isLocal = (url: string) => url.includes("localhost") || url.includes("127.0.0.1");

async function fetchIds(p: ProviderConfig): Promise<string[]> {
  const apiKey = p.apiKeyEnc ? await decryptSecret(p.apiKeyEnc) : "";
  if (!apiKey && !isLocal(p.baseUrl)) {
    throw new Error("Geen API-key. Voeg die toe via Instellingen & API-keys.");
  }
  const res = await fetch("/api/models", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind: p.kind, baseUrl: p.baseUrl, apiKey }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error ?? res.statusText);
  return data.ids as string[];
}

export default function ModelsPanel({ providers, onSave, onClose }: Props) {
  const [rows, setRows] = useState<Row[]>(() =>
    providers.map((p) => ({ ...p, filter: "", fetching: false, manual: "" })),
  );

  const patch = (i: number, p: Partial<Row>) =>
    setRows((r) => r.map((x, j) => (j === i ? { ...x, ...p } : x)));

  async function refresh(i: number) {
    patch(i, { fetching: true, fetchErr: undefined });
    try {
      const ids = await fetchIds(providers[i]);
      patch(i, { available: ids, fetching: false });
    } catch (e) {
      patch(i, { fetching: false, fetchErr: (e as Error).message });
    }
  }

  // Bij openen: lijst automatisch ophalen voor aangezette providers die nog geen lijst hebben
  useEffect(() => {
    providers.forEach((p, i) => {
      const canFetch = p.apiKeyEnc || isLocal(p.baseUrl);
      if (p.enabled && canFetch && !(p.available && p.available.length)) void refresh(i);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggle(i: number, id: string) {
    setRows((r) =>
      r.map((x, j) =>
        j !== i
          ? x
          : { ...x, models: x.models.includes(id) ? x.models.filter((m) => m !== id) : [...x.models, id] },
      ),
    );
  }

  function setVisible(i: number, ids: string[], on: boolean) {
    setRows((r) =>
      r.map((x, j) => {
        if (j !== i) return x;
        const set = new Set(x.models);
        for (const id of ids) (on ? set.add(id) : set.delete(id));
        return { ...x, models: [...set] };
      }),
    );
  }

  function addManual(i: number) {
    const id = rows[i].manual.trim();
    if (!id) return;
    setRows((r) =>
      r.map((x, j) =>
        j !== i ? x : { ...x, models: x.models.includes(id) ? x.models : [...x.models, id], manual: "" },
      ),
    );
  }

  function save() {
    onSave(rows.map(({ filter, fetching, fetchErr, manual, ...p }) => p));
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          Modellen
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p className="hint">
            Vink hier de modellen aan die je wilt gebruiken. Alleen die verschijnen in de modelkeuze bovenin de chat.
            Keys stel je in via Instellingen & API-keys.
          </p>

          {rows.map((r, i) => {
            const all = Array.from(new Set([...(r.available ?? []), ...r.models])).sort();
            const f = r.filter.toLowerCase();
            const visible = all.filter((id) => id.toLowerCase().includes(f));
            const hasKey = !!r.apiKeyEnc || isLocal(r.baseUrl);
            return (
              <div className="card" key={r.id} style={{ opacity: r.enabled ? 1 : 0.6 }}>
                <div className="card-head">
                  <strong>{r.name}</strong>
                  <span className="hint">
                    {!r.enabled ? "Uit in instellingen" : hasKey ? `${r.models.length} geselecteerd` : "Geen key"}
                  </span>
                </div>

                {hasKey && (
                  <div className="card-head">
                    <button className="ghost" onClick={() => refresh(i)} disabled={r.fetching}>
                      {r.fetching ? "Ophalen…" : "Lijst verversen"}
                    </button>
                    {r.available && <span className="hint">{r.available.length} beschikbaar</span>}
                  </div>
                )}
                {r.fetchErr && <div className="error">{r.fetchErr}</div>}

                {all.length > 0 && (
                  <>
                    <input
                      placeholder="Zoeken, bijv. claude of gpt"
                      value={r.filter}
                      onChange={(e) => patch(i, { filter: e.target.value })}
                    />
                    <div className="card-head">
                      <button className="link" onClick={() => setVisible(i, visible, true)}>Alles zichtbare aan</button>
                      <button className="link" onClick={() => setVisible(i, visible, false)}>Alles zichtbare uit</button>
                    </div>
                    <div className="model-list">
                      {visible.map((id) => (
                        <label className="check model-row" key={id}>
                          <input type="checkbox" checked={r.models.includes(id)} onChange={() => toggle(i, id)} />
                          {id}
                        </label>
                      ))}
                    </div>
                  </>
                )}

                <div className="card-head">
                  <input
                    placeholder="Model-id handmatig toevoegen"
                    value={r.manual}
                    onChange={(e) => patch(i, { manual: e.target.value })}
                    style={{ flex: 1 }}
                  />
                  <button className="ghost" onClick={() => addManual(i)}>Toevoegen</button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="modal-foot">
          <button className="ghost" onClick={onClose}>Annuleren</button>
          <button className="primary" onClick={save}>Opslaan</button>
        </div>
      </div>
    </div>
  );
}
