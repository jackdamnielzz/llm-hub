"use client";

import type { Artifact } from "@/lib/artifacts";

export interface LibraryItem extends Artifact {
  chatId: string;
  chatTitle: string;
}

interface Props {
  items: LibraryItem[];
  onOpen: (item: LibraryItem) => void;
  onClose: () => void;
}

export default function ArtifactsLibrary({ items, onOpen, onClose }: Props) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          Artifacts
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {items.length === 0 && (
            <div className="hint">
              Nog geen artifacts. Vraag het model om een pagina, document, diagram of stuk code, bijvoorbeeld
              "maak een rekenmachine in HTML".
            </div>
          )}
          {items.map((it) => (
            <div className="card" key={it.id}>
              <div className="card-head">
                <strong>{it.title}</strong>
                <span className="hint">{it.kind}</span>
              </div>
              <div className="hint">uit: {it.chatTitle}</div>
              <button className="ghost" onClick={() => onOpen(it)}>Openen</button>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button className="primary" onClick={onClose}>Sluiten</button>
        </div>
      </div>
    </div>
  );
}
