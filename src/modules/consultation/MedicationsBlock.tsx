// src/modules/consultation/MedicationsBlock.tsx
// Medicamentos em uso do paciente (módulo 19c; spec §5; contrato §4), ao lado
// dos problemas: estado atual reconstruído de eventos no api. Suspender,
// reativar e "informar medicamento em uso de fora" só pela consulta em
// rascunho da autora (o api confere); a receita de uso contínuo inclui sozinha.
// Leitura com gcTime 0 (prontuário).
import { useRef, useState, type CSSProperties } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { changeMedication, listPatientMedications } from "../../lib/api";
import {
  EMPTY_EXTERNAL, MEDICATIONS_KEY, MEDICATION_ORIGIN_LABEL, MEDICATION_STATUS_LABEL, documentError, externalChange, externalProblem,
  medicationLine, sortMedications, type ExternalDraft
} from "../../lib/clinicalDocuments";
import { fmtDay } from "../../lib/exams";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { MedicationSearch } from "../documents/MedicationSearch";

interface Props {
  patientId: string;
  // A consulta em rascunho da autora; null = só leitura.
  draftConsultationId: string | null;
  unitId?: string;
  searchDelayMs?: number;
}

export function MedicationsBlock({ patientId, draftConsultationId, unitId, searchDelayMs }: Props) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: [ MEDICATIONS_KEY, patientId ], queryFn: () => listPatientMedications(patientId), gcTime: 0, retry: false
  });
  // Uma mudança por vez: o estado desliga os botões; a ref barra o segundo clique antes do render.
  const [ busy, setBusy ] = useState<string | null>(null);
  const inFlight = useRef(false);
  const [ error, setError ] = useState<string | null>(null);
  const [ adding, setAdding ] = useState(false);
  const reload = () => void queryClient.invalidateQueries({ queryKey: [ MEDICATIONS_KEY, patientId ] });

  async function change(id: string, action: "suspend" | "reactivate") {
    if (!draftConsultationId || inFlight.current) return;
    inFlight.current = true;
    setBusy(id); setError(null);
    try {
      await changeMedication(draftConsultationId, { action, medication_id: id });
    } catch (err) {
      setError(documentError(err));
    } finally {
      inFlight.current = false;
      setBusy(null);
      reload();
    }
  }

  const items = sortMedications(query.data ?? []);

  return (
    <div style={block}>
      <strong style={sub}>Medicamentos em uso</strong>
      {query.isPending && <p className="mono" style={muted}>carregando…</p>}
      {query.isError && <p role="alert" style={alert}>{documentError(query.error)}</p>}
      {error && <p role="alert" style={alert}>{error}</p>}
      {query.isSuccess && (items.length === 0 ? <p style={muted}>nenhum medicamento registrado</p> : (
        <ul aria-label="medicamentos em uso" style={list}>
          {items.map((m) => (
            <li key={m.id} style={row}>
              <span style={{ flex: 1 }}>{medicationLine(m)}</span>
              <Tag tone={m.status === "active" ? "ok" : "neutral"} mono={false}>{MEDICATION_STATUS_LABEL[m.status] ?? m.status}</Tag>
              <Tag mono={false}>{MEDICATION_ORIGIN_LABEL[m.origin] ?? m.origin}</Tag>
              {m.continuous && <Tag mono={false}>uso contínuo</Tag>}
              {m.last_dispensed_on && <Tag mono={false}>{`última retirada ${fmtDay(m.last_dispensed_on)}`}</Tag>}
              {draftConsultationId && m.status === "active" && (
                <button type="button" aria-label={`Suspender ${m.label}`} disabled={busy !== null}
                  style={busy !== null ? disabledButtonStyle : secondaryButtonStyle} onClick={() => void change(m.id, "suspend")}>Suspender</button>
              )}
              {draftConsultationId && m.status === "suspended" && (
                <button type="button" aria-label={`Reativar ${m.label}`} disabled={busy !== null}
                  style={busy !== null ? disabledButtonStyle : secondaryButtonStyle} onClick={() => void change(m.id, "reactivate")}>Reativar</button>
              )}
            </li>
          ))}
        </ul>
      ))}
      {draftConsultationId && !adding && (
        <div>
          <button type="button" style={secondaryButtonStyle} onClick={() => setAdding(true)}>Informar medicamento em uso de fora</button>
        </div>
      )}
      {draftConsultationId && adding && (
        <ExternalForm consultationId={draftConsultationId} unitId={unitId} searchDelayMs={searchDelayMs}
          onDone={() => { setAdding(false); reload(); }} onRefresh={reload} onCancel={() => setAdding(false)} />
      )}
    </div>
  );
}

function ExternalForm({ consultationId, unitId, searchDelayMs, onDone, onRefresh, onCancel }: {
  consultationId: string; unitId?: string; searchDelayMs?: number; onDone(): void; onRefresh(): void; onCancel(): void;
}) {
  const [ draft, setDraft ] = useState<ExternalDraft>(EMPTY_EXTERNAL);
  const [ busy, setBusy ] = useState(false);
  const inFlight = useRef(false);
  const [ problem, setProblem ] = useState<string | null>(null);

  async function save() {
    if (inFlight.current) return;
    const found = externalProblem(draft);
    if (found) { setProblem(found); return; }
    inFlight.current = true;
    setBusy(true); setProblem(null);
    try {
      await changeMedication(consultationId, externalChange(draft));
      onDone();
    } catch (err) {
      setProblem(documentError(err));
      onRefresh();
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <section aria-label="Medicamento em uso de fora" style={panel}>
      {draft.medication ? (
        <p style={text}>
          {draft.medication.label}{" "}
          <button type="button" style={linkButton} onClick={() => setDraft((d) => ({ ...d, medication: null }))}>trocar</button>
        </p>
      ) : (
        <>
          <MedicationSearch label="Buscar no catálogo" unitId={unitId} blockControlled={false} delayMs={searchDelayMs}
            onPick={(m) => setDraft((d) => ({ ...d, medication: m, freeText: "" }))} />
          <label style={labelStyle}>
            Ou escreva o nome (texto livre)
            <input value={draft.freeText} style={inputStyle} onChange={(e) => setDraft((d) => ({ ...d, freeText: e.target.value }))} />
          </label>
        </>
      )}
      <label style={labelStyle}>
        Como usa (resumo)
        <input value={draft.dosage} style={inputStyle} onChange={(e) => setDraft((d) => ({ ...d, dosage: e.target.value }))} />
      </label>
      <label style={checkLabel}>
        <input type="checkbox" checked={draft.continuous} onChange={(e) => setDraft((d) => ({ ...d, continuous: e.target.checked }))} />
        Uso contínuo
      </label>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        <button type="button" disabled={busy} style={busy ? disabledButtonStyle : buttonStyle} onClick={() => void save()}>Incluir na lista</button>
        <button type="button" disabled={busy} style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </section>
  );
}

const block: CSSProperties = { display: "flex", flexDirection: "column", gap: 6 };
const sub: CSSProperties = { fontSize: 12.5 };
const list: CSSProperties = { margin: 0, paddingLeft: 0, listStyle: "none", fontSize: 12.5, display: "flex", flexDirection: "column", gap: 4 };
const row: CSSProperties = { display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" };
const panel: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 12, border: "1px solid var(--rule)", borderRadius: 8 };
const labelStyle: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const checkLabel: CSSProperties = { display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "var(--ink2)" };
const text: CSSProperties = { margin: 0, fontSize: 12.5 };
const muted: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12.5, color: "var(--down)" };
const linkButton: CSSProperties = {
  border: "none", background: "transparent", padding: 0, cursor: "pointer", fontSize: 12, color: "var(--accent)", textDecoration: "underline"
};
