// Campos do desfecho (os do "Encerrar" de antes), usados pelo ClosePanel e pela
// finalização da consulta (módulo 19). `idPrefix` separa os ids dos avisos
// quando os dois estão na tela.
import type { CareOutcome, HealthUnit } from "../../lib/api";
import { CARE_OUTCOMES, OUTCOME_LABEL, outcomeView, type OutcomeDraft } from "../../lib/outcome";
import { inputStyle } from "../../components/formStyles";
import { FrozenTextNotice } from "../../components/FrozenTextNotice";

interface Props {
  value: OutcomeDraft;
  onChange(next: OutcomeDraft): void;
  referenceIds?: string[];
  unit: HealthUnit;
  units: HealthUnit[];
  idPrefix?: string;
}

export function OutcomeFields({ value, onChange, referenceIds, unit, units, idPrefix = "" }: Props) {
  const { referenceUnits, otherUnits, referralUnitId, targetUnitName } = outcomeView(value, referenceIds, unit, units);
  const set = (patch: Partial<OutcomeDraft>) => onChange({ ...value, ...patch });

  return (
    <>
      <label style={labelStyle}>
        Desfecho
        <select value={value.outcome} onChange={(e) => set({ outcome: e.target.value as CareOutcome })} style={inputStyle}>
          {CARE_OUTCOMES.map((o) => <option key={o} value={o}>{OUTCOME_LABEL[o]}</option>)}
        </select>
      </label>

      {value.outcome === "referred" && (
        <>
          <label style={labelStyle}>
            Unidade de destino
            <select value={referralUnitId} onChange={(e) => set({ referralChoice: e.target.value })} style={inputStyle}>
              <option value="">—</option>
              {referenceUnits.map((u) => <option key={u.id} value={u.id}>{`${u.name} · referência`}</option>)}
              {otherUnits.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </label>
          <label style={labelStyle}>
            Descrição
            <input value={value.note} onChange={(e) => set({ note: e.target.value })} style={inputStyle}
              aria-describedby={`${idPrefix}referral-note-notice`} />
          </label>
          <FrozenTextNotice id={`${idPrefix}referral-note-notice`} />
        </>
      )}

      {value.outcome === "return" && (
        <>
          <label style={labelStyle}>
            Nota (opcional)
            <input value={value.note} onChange={(e) => set({ note: e.target.value })} style={inputStyle}
              aria-describedby={`${idPrefix}return-note-notice`} />
          </label>
          <FrozenTextNotice id={`${idPrefix}return-note-notice`} />
        </>
      )}

      {targetUnitName && (
        <p className="mono" style={{ margin: 0, fontSize: 11, color: "var(--ink3)" }}>
          Gera pedido de agendamento na {targetUnitName}
        </p>
      )}
    </>
  );
}

const labelStyle = { display: "flex", flexDirection: "column" as const, gap: 4, fontSize: 12, color: "var(--ink2)" };
