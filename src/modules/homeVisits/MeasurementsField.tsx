// src/modules/homeVisits/MeasurementsField.tsx
// Medidas da visita (módulo 24b): só as chaves permitidas (`allowedMeasurements`, Q34), empilhadas para 375 px; pressão em par
// (sistólica e diastólica lado a lado) e glicemia com o tipo (do domínio `tipo_glicemia`). Vírgula ou ponto; a conferência
// (faixa, casas, par) é do `visitProblems`, no envio.
import type { ReactNode } from "react";
import type { HomeVisitDomains, MeasurementKey } from "../../lib/api";
import type { MeasureDraft } from "../../lib/homeVisits";
import { inputStyle } from "../../components/formStyles";
import { fieldLabel, fieldset, legend, row } from "../exams/styles";

const col = { display: "flex", flexDirection: "column", gap: 4, flex: "1 1 140px", minWidth: 0 } as const;
type Aria = { "aria-invalid"?: true; "aria-describedby"?: string };
const LABEL: Record<MeasurementKey, string> = {
  weight_kg: "Peso (kg)", height_cm: "Altura (cm)", systolic: "Pressão sistólica", diastolic: "Pressão diastólica",
  temperature_c: "Temperatura (°C)", glucose_mg_dl: "Glicemia (mg/dL)"
};

export function MeasurementsField({ domains, allowed, value, disabled, onChange, aria, errNode }: {
  domains: HomeVisitDomains; allowed: Record<MeasurementKey, boolean>; value: MeasureDraft; disabled: boolean;
  onChange(key: keyof MeasureDraft, v: string): void; aria(path: string): Aria; errNode(path: string): ReactNode;
}) {
  // A frase de erro fica fora do <label>, para não entrar no nome do campo.
  const field = (key: MeasurementKey) => allowed[key] && (
    <div key={key} style={col}>
      <label style={fieldLabel}>
        {LABEL[key]}
        <input value={value[key]} inputMode="decimal" autoComplete="off" disabled={disabled} style={inputStyle}
          {...aria(`measurements.${key}`)} onChange={(e) => onChange(key, e.target.value)} />
      </label>
      {errNode(`measurements.${key}`)}
    </div>
  );
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Medidas (opcionais)</legend>
      <div style={row}>{field("weight_kg")}{field("height_cm")}</div>
      <div style={row}>{field("systolic")}{field("diastolic")}</div>
      {field("temperature_c")}
      {allowed.glucose_mg_dl && (
        <div style={row}>
          {field("glucose_mg_dl")}
          <div style={col}>
            <label style={fieldLabel}>
              Tipo da glicemia
              <select value={value.glucose_type} disabled={disabled} style={inputStyle} {...aria("measurements.glucose_type")}
                onChange={(e) => onChange("glucose_type", e.target.value)}>
                <option value="">— escolha —</option>
                {domains.tipo_glicemia.map((g) => <option key={g.code} value={String(g.code)}>{g.label}</option>)}
              </select>
            </label>
            {errNode("measurements.glucose_type")}
          </div>
        </div>
      )}
    </fieldset>
  );
}
