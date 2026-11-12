// Anexos da ouvidoria (módulo 33; Q2, D17): PDF, JPEG ou PNG, até 10 MB, até 3. A lista mostra "Anexo N (tipo)", nunca o nome do
// arquivo (pode trazer o nome da pessoa); o upload manda `anexo-N.<ext>` (cliente). Escolha recusada não entra na lista e diz
// por quê. Os arquivos sobem um a um antes do registro; o id de um arquivo já subido é reaproveitado se o registro falhar e a
// pessoa tentar de novo (o api aceita anexo órfão do mesmo usuário; subir de novo gastaria o limite de 20/h).
import { useId, useState } from "react";
import { uploadOmbudsmanAttachment } from "../../lib/api";
import { attachmentProblems } from "../../lib/ombudsman";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, list, muted, row } from "../exams/styles";
import type { FieldAria } from "./actions/ExtractField";

const TYPE_LABEL: Record<string, string> = { "application/pdf": "PDF", "image/jpeg": "JPEG", "image/png": "PNG" };
const ACCEPT = "application/pdf,image/jpeg,image/png";

// Paths e códigos do api que dizem respeito aos anexos (upload e registro): a tela os mostra junto da lista.
const ATTACHMENT_PATHS = [ "attachment_ids", "filename", "content_type", "data" ];
const ATTACHMENT_CODES = [ "invalid_file", "too_many_attachments" ];
export const isAttachmentRefusal = (r: { path: string; code: string }): boolean =>
  ATTACHMENT_PATHS.includes(r.path) || ATTACHMENT_CODES.includes(r.code);

// Sobe na ordem da tela (n = posição); a primeira recusa para tudo (quem chama não registra).
export async function uploadAll(files: File[], uploaded: Map<File, string>): Promise<string[]> {
  const ids: string[] = [];
  for (const [ i, file ] of files.entries()) {
    let id = uploaded.get(file);
    if (id === undefined) {
      id = (await uploadOmbudsmanAttachment(file, i + 1)).id;
      uploaded.set(file, id);
    }
    ids.push(id);
  }
  return ids;
}

export function AttachmentPicker({ files, onChange, aria = {}, disabled = false, label = "Anexos" }: {
  files: File[]; onChange(next: File[]): void; aria?: FieldAria; disabled?: boolean; label?: string;
}) {
  const uid = useId();
  const [ rejected, setRejected ] = useState<string[]>([]);
  const describedBy = [ `${uid}-hint`, rejected.length > 0 ? `${uid}-rejected` : null, aria["aria-describedby"] ].filter(Boolean).join(" ");
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <label style={fieldLabel}>
        {label}
        <input type="file" multiple accept={ACCEPT} aria-label={label} disabled={disabled}
          aria-invalid={aria["aria-invalid"] ?? (rejected.length > 0 ? true : undefined)} aria-describedby={describedBy}
          onChange={(ev) => {
            const picked = Array.from(ev.target.files ?? []);
            ev.target.value = "";
            if (picked.length === 0) return;
            const next = [ ...files, ...picked ];
            const problems = attachmentProblems(next);
            if (problems.length > 0) { setRejected([ ...new Set(problems.map((p) => p.text)) ]); return; }
            setRejected([]);
            onChange(next);
          }} />
      </label>
      <p id={`${uid}-hint`} style={muted}>PDF, JPEG ou PNG, de até 10 MB cada, no máximo 3.</p>
      {rejected.length > 0 && (
        <div id={`${uid}-rejected`} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {rejected.map((t) => <p key={t} role="alert" style={alert}>{t}</p>)}
        </div>
      )}
      {files.length > 0 && (
        <ul style={list}>
          {files.map((f, i) => (
            <li key={i} style={row}>
              <span>{`Anexo ${i + 1} (${TYPE_LABEL[f.type] ?? f.type})`}</span>
              <button type="button" style={secondaryButtonStyle} disabled={disabled} aria-label={`Remover anexo ${i + 1}`}
                onClick={() => { setRejected([]); onChange(files.filter((_, j) => j !== i)); }}>
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
