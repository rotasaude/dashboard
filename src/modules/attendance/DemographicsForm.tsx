// src/modules/attendance/DemographicsForm.tsx
// Raça/cor, etnia e endereço do paciente para o BPA-I (módulo 22; contrato
// §12, D-U1). `DemographicsFields` é só os campos (a validação presencial os
// manda junto); `DemographicsForm` salva sozinho (check-in e pendência do
// faturista). Opcionais, com incentivo visual; nada de "sem informação".
import { useState, type CSSProperties } from "react";
import type { PatientDemographicsInput } from "../../lib/api";
import {
  DEMOGRAPHICS_INCENTIVE, EMPTY_DEMOGRAPHICS, INDIGENOUS, RACE_COLORS, demographicsBody, demographicsError, demographicsFilled,
  demographicsProblem, missingText, type DemographicsDraft
} from "../../lib/demographics";
import { Tag } from "../../components/Tag";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row } from "../exams/styles";

export function DemographicsFields({ value, onChange, problem = null, missing }: {
  value: DemographicsDraft; onChange(d: DemographicsDraft): void; problem?: string | null; missing?: string[];
}) {
  const set = (patch: Partial<DemographicsDraft>) => onChange({ ...value, ...patch });
  const text = (label: string, key: keyof DemographicsDraft, extra: { inputMode?: "numeric" } = {}) => (
    <label style={fieldLabel}>
      {label}
      <input value={value[key]} style={inputStyle} autoComplete="off" inputMode={extra.inputMode}
        onChange={(e) => set({ [key]: e.target.value } as Partial<DemographicsDraft>)} />
    </label>
  );
  return (
    <fieldset aria-label="dados do paciente para o faturamento" style={fieldset}>
      <div style={row}>
        <Tag tone="info" mono={false}>ajuda o faturamento</Tag>
        <p role="note" style={muted}>
          {missing && missing.length > 0 ? `Falta: ${missingText(missing)}. ${DEMOGRAPHICS_INCENTIVE}` : DEMOGRAPHICS_INCENTIVE}
        </p>
      </div>
      <div style={row}>
        <label style={fieldLabel}>
          Raça/cor
          <select value={value.raceColor} style={inputStyle} onChange={(e) => set({ raceColor: e.target.value })}>
            <option value="">não informada</option>
            {RACE_COLORS.map((r) => <option key={r.code} value={r.code}>{r.label}</option>)}
          </select>
        </label>
        {value.raceColor === INDIGENOUS && text("Etnia (código)", "ethnicity", { inputMode: "numeric" })}
      </div>
      <div style={row}>
        {text("CEP", "zip", { inputMode: "numeric" })}
        {text("Logradouro", "street")}
        {text("Número", "number")}
        {text("Complemento", "complement")}
        {text("Bairro", "district")}
      </div>
      {problem && <p role="alert" style={alert}>{problem}</p>}
    </fieldset>
  );
}

export function DemographicsForm({ title, missing, save, onSaved, onCancel }: {
  title: string; missing?: string[]; save(body: PatientDemographicsInput): Promise<void>; onSaved?(): void; onCancel?(): void;
}) {
  const [ draft, setDraft ] = useState<DemographicsDraft>(EMPTY_DEMOGRAPHICS);
  const [ error, setError ] = useState<string | null>(null);
  const [ saved, setSaved ] = useState(false);
  const [ busy, setBusy ] = useState(false);

  async function submit() {
    if (busy) return;
    setError(null);
    if (!demographicsFilled(draft)) { setError("preencha a raça/cor ou o endereço"); return; }
    const problem = demographicsProblem(draft);
    if (problem) { setError(problem); return; }
    setBusy(true);
    try {
      await save(demographicsBody(draft));
      setSaved(true);
      onSaved?.();
    } catch (err) {
      setError(demographicsError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label={title} style={box}>
      <strong>{title}</strong>
      {saved ? <p role="status" style={statusStyle}>Dados do paciente salvos.</p> : (
        <>
          <DemographicsFields value={draft} onChange={(d) => { setError(null); setDraft(d); }} missing={missing} />
          {error && <p role="alert" style={alert}>{error}</p>}
          <div style={row}>
            {/* Botão simples: o nome acessível não muda durante o envio (ActionButton acrescenta " …"). */}
            <button type="button" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle} onClick={() => void submit()}>
              Salvar dados do paciente
            </button>
            {onCancel && <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Agora não</button>}
          </div>
        </>
      )}
    </section>
  );
}

const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, border: 0, margin: 0, padding: 0 };
const statusStyle: CSSProperties = { margin: 0, fontSize: 12.5, fontWeight: 600 };
