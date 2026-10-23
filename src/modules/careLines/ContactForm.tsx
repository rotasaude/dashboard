// src/modules/careLines/ContactForm.tsx
// Tentativa de contato da busca ativa (contrato §5): canal, resultado e nota
// opcional (até 500; guardada cifrada pelo api). Só acréscimo. A nota vai só
// no corpo; vazia não vai.
import { useState } from "react";
import { recordCareContact, type ContactChannel, type ContactOutcome } from "../../lib/api";
import { CHANNELS, EMPTY_CONTACT, NOTE_MAX, OUTCOMES, contactProblem, type ContactDraft } from "../../lib/careLines";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, row } from "../exams/styles";
import { useCareSubmit } from "./useCareSubmit";

export function ContactForm({ enrollmentId, initialOutcome, onSaved, onStale, onCancel }: {
  enrollmentId: string; initialOutcome?: ContactOutcome; onSaved(): void; onStale(message: string): void; onCancel(): void;
}) {
  const [ d, setD ] = useState<ContactDraft>({ ...EMPTY_CONTACT, outcome: initialOutcome ?? "" });
  const { busy, error, setError, submit } = useCareSubmit();
  const set = (patch: Partial<ContactDraft>) => { setError(null); setD((x) => ({ ...x, ...patch })); };

  async function save() {
    const problem = contactProblem(d);
    if (problem) { setError(problem); return; }
    const ok = await submit(
      () => recordCareContact(enrollmentId, { channel: d.channel as ContactChannel, outcome: d.outcome as ContactOutcome, note: d.note }),
      onStale
    );
    if (ok) onSaved();
  }

  return (
    <section aria-label="Registrar contato" style={box}>
      <div style={form}>
        <div style={row}>
          <label style={fieldLabel}>
            Como foi o contato
            <select value={d.channel} style={inputStyle} onChange={(e) => set({ channel: e.target.value as ContactDraft["channel"] })}>
              <option value="">escolha</option>
              {CHANNELS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Resultado
            <select value={d.outcome} style={inputStyle} onChange={(e) => set({ outcome: e.target.value as ContactDraft["outcome"] })}>
              <option value="">escolha</option>
              {OUTCOMES.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <label style={fieldLabel}>
          Nota (opcional)
          <textarea rows={3} value={d.note} style={inputStyle} onChange={(e) => set({ note: e.target.value })} />
        </label>
        <p style={muted}>até {NOTE_MAX} caracteres; a nota fica guardada cifrada e só a equipe a vê</p>
        {error && <p role="alert" style={alert}>{error}</p>}
        <div style={row}>
          <button type="button" style={buttonStyle} disabled={busy} onClick={() => void save()}>Salvar contato</button>
          <button type="button" style={secondaryButtonStyle} disabled={busy} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}
