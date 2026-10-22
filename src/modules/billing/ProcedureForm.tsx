// Registro de um procedimento realizado (contrato §3; spec §5.1): busca na
// SIGTAP da competência da data, quantidade, CID-10 e caráter. A crítica é do
// api e nunca impede o registro (ADR 0039): CID ausente num procedimento que
// exige só avisa — o 201 volta "não faturável". `before` são os campos de
// quem chama (lançamento manual) e `beforeProblem`, o que falta neles.
import { useState, type ReactNode } from "react";
import type { PerformedProcedure, ProcedureCharacter } from "../../lib/api";
import {
  CHARACTER_OPTIONS, billingError, cidHint, emptyProcedure, procedureProblem, sigtapCompetence, type ProcedureDraft
} from "../../lib/billing";
import { competenceLabel } from "../../lib/competence";
import { fmtDay } from "../../lib/exams";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, form, muted, row } from "../exams/styles";
import { SigtapSearch } from "./SigtapSearch";

interface Props {
  today: string;
  // No atendimento e na consulta a data é a de hoje; no avulso e no manual, editável.
  dateEditable: boolean;
  before?: ReactNode;
  beforeProblem?: string | null;
  searchDelayMs?: number;
  submit(draft: ProcedureDraft): Promise<PerformedProcedure>;
  onSaved(p: PerformedProcedure): void;
  onCancel(): void;
}

export function ProcedureForm({ today, dateEditable, before, beforeProblem = null, searchDelayMs, submit, onSaved, onCancel }: Props) {
  const [ draft, setDraft ] = useState<ProcedureDraft>(() => emptyProcedure(today));
  const [ error, setError ] = useState<string | null>(null);
  const set = (patch: Partial<ProcedureDraft>) => { setError(null); setDraft((d) => ({ ...d, ...patch })); };
  const hint = cidHint(draft);
  const competence = sigtapCompetence(draft);

  async function save() {
    const problem = beforeProblem ?? procedureProblem(draft, today);
    if (problem) { setError(problem); return; }
    setError(null);
    try {
      onSaved(await submit(draft));
    } catch (err) {
      setError(billingError(err));
    }
  }

  return (
    <section aria-label="Registrar procedimento" style={box}>
      <div style={form}>
        {before}
        {dateEditable ? (
          <label style={fieldLabel}>
            Data do procedimento
            <input type="date" value={draft.performedOn} max={today} style={inputStyle} onChange={(e) => set({ performedOn: e.target.value })} />
          </label>
        ) : <p style={muted}>{`Data: ${fmtDay(draft.performedOn)}`}</p>}
        {draft.sigtap ? (
          <div style={row}>
            <span>{`${draft.sigtap.code} — ${draft.sigtap.name}`}</span>
            <button type="button" style={secondaryButtonStyle} onClick={() => set({ sigtap: null })}>Trocar procedimento</button>
          </div>
        ) : (
          <SigtapSearch competence={competence} delayMs={searchDelayMs} onPick={(p) => set({ sigtap: p })} />
        )}
        <p style={muted}>{`tabela SIGTAP da competência ${competenceLabel(competence)}`}</p>
        <div style={row}>
          <label style={fieldLabel}>
            Quantidade
            <input value={draft.quantity} inputMode="numeric" style={inputStyle} onChange={(e) => set({ quantity: e.target.value })} />
          </label>
          <label style={fieldLabel}>
            CID-10
            <input value={draft.cid10} autoComplete="off" style={inputStyle} onChange={(e) => set({ cid10: e.target.value })} />
          </label>
          <label style={fieldLabel}>
            Caráter
            <select value={draft.character} style={inputStyle} onChange={(e) => set({ character: e.target.value as ProcedureCharacter })}>
              {CHARACTER_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </label>
        </div>
        {hint && <p role="note" style={muted}>{hint}</p>}
        {error && <p role="alert" style={alert}>{error}</p>}
        <div style={row}>
          <ActionButton onClick={save}>Registrar procedimento</ActionButton>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}
