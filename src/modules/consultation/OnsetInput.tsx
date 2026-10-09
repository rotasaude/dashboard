// src/modules/consultation/OnsetInput.tsx
// Início de um problema com precisão (dia, mês ou ano; spec §3). "Hoje" é o da
// cidade, recebido como texto: nenhum fuso desloca o dia.
import { useState, type CSSProperties } from "react";
import type { OnsetPrecision } from "../../lib/api";
import { PRECISIONS, PRECISION_LABEL, onsetInputValue, parseOnset, type Onset } from "../../lib/consultation";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

interface Props { code: string; today: string; initial?: Onset | null; onApply(onset: Onset): void; onCancel(): void }

export function OnsetInput({ code, today, initial, onApply, onCancel }: Props) {
  const [ precision, setPrecision ] = useState<OnsetPrecision>(initial?.onset_precision ?? "month");
  const [ text, setText ] = useState(initial ? onsetInputValue(initial.onset_on, initial.onset_precision) : "");
  const [ problem, setProblem ] = useState<string | null>(null);

  function apply() {
    const result = parseOnset(precision, text, today);
    if ("problem" in result) { setProblem(result.problem); return; }
    onApply(result);
  }

  return (
    <div role="group" aria-label={`Início de ${code}`} style={box}>
      <label style={label}>
        Precisão
        <select value={precision} style={inputStyle}
          onChange={(e) => { setPrecision(e.target.value as OnsetPrecision); setText(""); setProblem(null); }}>
          {PRECISIONS.map((p) => <option key={p} value={p}>{PRECISION_LABEL[p]}</option>)}
        </select>
      </label>
      <label style={label}>
        Início
        <input type={precision === "day" ? "date" : precision === "month" ? "month" : "text"}
          inputMode={precision === "year" ? "numeric" : undefined} placeholder={precision === "year" ? "ex.: 2019" : undefined}
          value={text} max={precision === "day" ? today : undefined} style={inputStyle}
          onChange={(e) => { setText(e.target.value); setProblem(null); }} />
      </label>
      {problem && <small role="alert" style={alert}>{problem}</small>}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" style={buttonStyle} onClick={apply}>Aplicar início</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

const box: CSSProperties = { display: "flex", flexDirection: "column", gap: 6, padding: 10, border: "1px dashed var(--rule)", borderRadius: 6, maxWidth: 320 };
const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
