// src/modules/attendance/VitalSignsFields.tsx
// Sinais vitais da escuta (módulo 18; spec §3.1): todos opcionais. Problema de
// plausibilidade aparece sob o campo; alerta do api (faixa de alerta) destaca o
// campo em vermelho; o IMC é calculado na hora.
import type { CSSProperties } from "react";
import type { GlucoseMoment } from "../../lib/api";
import { GLUCOSE_MOMENTS, GLUCOSE_MOMENT_LABEL, VITALS, alertField, alertLabel, type VitalKey, type VitalsForm,
  type VitalsProblems } from "../../lib/screening";
import { fmtNumber } from "../../lib/format";
import { inputStyle } from "../../components/formStyles";

interface Props {
  form: VitalsForm;
  problems: VitalsProblems;
  alerts: string[];
  bmi: number | null;
  onChange(next: VitalsForm): void;
}

export function VitalSignsFields({ form, problems, alerts, bmi, onChange }: Props) {
  const alertsByField = new Map<VitalKey, string>();
  const loose: string[] = [];
  for (const code of alerts) {
    const field = alertField(code);
    if (field) alertsByField.set(field, alertLabel(code));
    else loose.push(code);
  }
  const set = (key: keyof VitalsForm, value: string) => onChange({ ...form, [key]: value });

  return (
    <fieldset aria-label="Sinais vitais" style={box}>
      <legend style={legend}>Sinais vitais</legend>
      <div style={grid}>
        {VITALS.map((spec) => {
          const alert = alertsByField.get(spec.key);
          const problem = problems[spec.key];
          return (
            <div key={spec.key} style={cell}>
              <label style={label}>
                {spec.unit ? `${spec.label} (${spec.unit})` : spec.label}
                <input value={form[spec.key]} inputMode="decimal" aria-invalid={problem ? true : undefined}
                  style={alert ? { ...inputStyle, borderColor: "var(--down)", background: "var(--down-bg)" } : inputStyle}
                  onChange={(e) => set(spec.key, e.target.value)} />
              </label>
              {problem && <small role="alert" style={problemStyle}>{problem}</small>}
              {alert && <small style={alertStyle}>{alert}</small>}
            </div>
          );
        })}
        <div style={cell}>
          <label style={label}>
            Momento da glicemia
            <select value={form.glucose_moment} style={inputStyle} onChange={(e) => set("glucose_moment", e.target.value as GlucoseMoment | "")}>
              <option value="">—</option>
              {GLUCOSE_MOMENTS.map((m) => <option key={m} value={m}>{GLUCOSE_MOMENT_LABEL[m]}</option>)}
            </select>
          </label>
          {problems.glucose_moment && <small role="alert" style={problemStyle}>{problems.glucose_moment}</small>}
        </div>
      </div>
      {problems.bp && <small role="alert" style={problemStyle}>{problems.bp}</small>}
      {loose.length > 0 && <small style={alertStyle}>{`alertas: ${loose.join(", ")}`}</small>}
      <p style={{ margin: 0, fontSize: 12.5 }}>
        <span style={{ color: "var(--ink3)" }}>IMC: </span>
        <span className="mono">{bmi === null ? "—" : fmtNumber(bmi)}</span>
      </p>
    </fieldset>
  );
}

const box: CSSProperties = { border: "1px solid var(--rule)", borderRadius: 8, padding: "8px 12px", margin: 0, display: "flex", flexDirection: "column", gap: 8 };
const legend: CSSProperties = { fontSize: 13, fontWeight: 600 };
const grid: CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(170px, 1fr))", gap: 10 };
const cell: CSSProperties = { display: "flex", flexDirection: "column", gap: 4 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const problemStyle: CSSProperties = { fontSize: 11.5, color: "var(--down)" };
const alertStyle: CSSProperties = { fontSize: 11.5, color: "var(--down)", fontWeight: 600 };
