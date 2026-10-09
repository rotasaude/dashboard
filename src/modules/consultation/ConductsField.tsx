// src/modules/consultation/ConductsField.tsx
// Condutas da consulta: códigos LEDI vindos de consultation_options (contratos §4).
import type { CSSProperties } from "react";
import type { CodedOption } from "../../lib/api";

interface Props { options: CodedOption[]; value: string[]; onChange(next: string[]): void }

export function ConductsField({ options, value, onChange }: Props) {
  return (
    <fieldset style={fieldset}>
      <legend style={legend}>Condutas</legend>
      {options.map((o) => (
        <label key={o.code} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
          <input type="checkbox" checked={value.includes(o.code)}
            onChange={(e) => onChange(e.target.checked ? [ ...value, o.code ] : value.filter((c) => c !== o.code))} />
          {o.label}
        </label>
      ))}
    </fieldset>
  );
}

const fieldset: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, border: "1px solid var(--rule)", borderRadius: 8, padding: 12 };
const legend: CSSProperties = { fontSize: 12.5, fontWeight: 600 };
