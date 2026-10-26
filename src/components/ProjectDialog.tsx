"use client";

import { useState } from "react";
import type { Attachment, Project } from "@/lib/types";
import { readFile } from "@/lib/files";
import { uid } from "@/lib/id";

interface Props {
  project: Project | null;
  onSave: (p: Project) => void;
  onDelete: (id: string) => void;
  onStartChat: (id: string) => void;
  onClose: () => void;
}

export default function ProjectDialog({ project, onSave, onDelete, onStartChat, onClose }: Props) {
  const [id] = useState(() => project?.id ?? uid());
  const [name, setName] = useState(project?.name ?? "");
  const [instructions, setInstructions] = useState(project?.instructions ?? "");
  const [files, setFiles] = useState<Attachment[]>(project?.files ?? []);
  const [err, setErr] = useState<string | null>(null);

  async function addFiles(list: FileList | null) {
    if (!list) return;
    for (const f of Array.from(list)) {
      try {
        const a = await readFile(f);
        setFiles((p) => [...p, a]);
      } catch (e) {
        setErr((e as Error).message);
      }
    }
  }

  function save() {
    if (!name.trim()) return setErr("Geef het project een naam.");
    onSave({ id, name: name.trim(), instructions, files });
    onClose();
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          {project ? "Project bewerken" : "Nieuw project"}
          <button className="icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="field">
            Naam
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            Instructies (systeemprompt voor alle chats in dit project)
            <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)} />
          </div>
          <div className="field">
            Projectbestanden (tekst en afbeeldingen, worden bij elke chat meegegeven)
            <input type="file" multiple onChange={(e) => addFiles(e.target.files)} />
          </div>
          {files.length > 0 && (
            <div className="chips">
              {files.map((f, i) => (
                <span className="chip" key={i}>
                  {f.name}
                  <button onClick={() => setFiles((p) => p.filter((_, j) => j !== i))}>✕</button>
                </span>
              ))}
            </div>
          )}
          {err && <div className="error">{err}</div>}
        </div>
        <div className="modal-foot">
          {project && (
            <>
              <button className="link" onClick={() => { onDelete(id); onClose(); }}>Verwijderen</button>
              <button className="ghost" onClick={() => { onStartChat(id); onClose(); }}>Nieuwe chat in project</button>
            </>
          )}
          <button className="ghost" onClick={onClose}>Annuleren</button>
          <button className="primary" onClick={save}>Opslaan</button>
        </div>
      </div>
    </div>
  );
}
