// src/modules/clinicalDocumentsAdmin/ProtocolForm.tsx
// Protocolo de enfermagem (módulo 19c; spec §3; COFEN 801/2026): título,
// número e ano de publicação; vigência; os medicamentos que a enfermagem pode
// prescrever, com dose máxima opcional (Divergência D6: limite da quantidade
// por item da receita). Só valida e entrega o rascunho; quem grava (com
// step-up) é o painel.
import { useState, type CSSProperties, type FormEvent } from "react";
import { todayInCity } from "../../lib/campaigns";
import { addProtocolItem, protocolProblem, type ProtocolDraft } from "../../lib/clinicalDocuments";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { MedicationSearch } from "../documents/MedicationSearch";

interface Props {
  title: string;
  initial: ProtocolDraft;
  withHeader: boolean;
  searchDelayMs?: number;
  onReady(d: ProtocolDraft): void;
  onCancel(): void;
}

export function ProtocolForm({ title, initial, withHeader, searchDelayMs, onReady, onCancel }: Props) {
  const [ d, setD ] = useState<ProtocolDraft>(initial);
  const [ problem, setProblem ] = useState<string | null>(null);
  const set = (patch: Partial<ProtocolDraft>) => setD((prev) => ({ ...prev, ...patch }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = protocolProblem(d, withHeader, todayInCity());
    setProblem(found);
    if (!found) onReady(d);
  }

  return (
    <form aria-label={title} onSubmit={submit} style={box}>
      <strong>{title}</strong>
      {withHeader && (
        <div style={row}>
          <label style={label}>Título<input value={d.title} style={inputStyle} onChange={(e) => set({ title: e.target.value })} /></label>
          <label style={label}>Número<input value={d.number} style={inputStyle} onChange={(e) => set({ number: e.target.value })} /></label>
          <label style={label}>
            Ano de publicação
            <input inputMode="numeric" value={d.year} style={inputStyle} onChange={(e) => set({ year: e.target.value })} />
          </label>
        </div>
      )}
      <div style={row}>
        <label style={label}>
          Vigência — de
          <input type="date" value={d.validFrom} style={inputStyle} onChange={(e) => set({ validFrom: e.target.value })} />
        </label>
        <label style={label}>
          Vigência — até (opcional)
          <input type="date" value={d.validUntil} style={inputStyle} onChange={(e) => set({ validUntil: e.target.value })} />
        </label>
      </div>
      <MedicationSearch label="Incluir medicamento no protocolo" blockControlled delayMs={searchDelayMs}
        onPick={(item) => setD((prev) => addProtocolItem(prev, item))} />
      {d.items.length === 0 ? <p style={muted}>nenhum medicamento no protocolo</p> : (
        <ul aria-label="medicamentos do protocolo" style={list}>
          {d.items.map((i) => (
            <li key={i.item.id} style={row}>
              <span style={{ flex: 1, fontSize: 12.5 }}>{i.item.label}</span>
              <label style={label}>
                {`Dose máxima — ${i.item.label}`}
                <input inputMode="numeric" value={i.maxDose} style={inputStyle}
                  onChange={(e) => set({ items: d.items.map((x) => (x.item.id === i.item.id ? { ...x, maxDose: e.target.value } : x)) })} />
              </label>
              <label style={label}>
                {`Unidade da dose máxima — ${i.item.label}`}
                <input value={i.maxUnit} style={inputStyle}
                  onChange={(e) => set({ items: d.items.map((x) => (x.item.id === i.item.id ? { ...x, maxUnit: e.target.value } : x)) })} />
              </label>
              <button type="button" aria-label={`Tirar ${i.item.label}`} style={secondaryButtonStyle}
                onClick={() => set({ items: d.items.filter((x) => x.item.id !== i.item.id) })}>Tirar</button>
            </li>
          ))}
        </ul>
      )}
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        <button type="submit" style={buttonStyle}>Revisar e salvar</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}

const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 10, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
const row: CSSProperties = { display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" };
const list: CSSProperties = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
