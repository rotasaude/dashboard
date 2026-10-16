// src/modules/exams/GalRequisitionForm.tsx
// F-21.24: o número da requisição no GAL (LACEN), só como registro e uma vez
// só (B5); o laudo do LACEN entra como resultado externo do 21a.
import { useState } from "react";
import { setGalRequisition } from "../../lib/api";
import { examError, galProblem } from "../../lib/exams";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, row } from "./styles";

export function GalRequisitionForm({ orderId, current, onDone, onCancel }: {
  orderId: string; current: string | null; onDone(): void; onCancel(): void;
}) {
  const [ value, setValue ] = useState(current ?? "");
  const [ error, setError ] = useState<string | null>(null);
  async function save() {
    const problem = galProblem(value);
    if (problem) { setError(problem); return; }
    setError(null);
    try {
      await setGalRequisition(orderId, value.trim());
    } catch (err) {
      setError(examError(err));
      return;
    }
    onDone();
  }
  return (
    <div style={box}>
      <label style={fieldLabel}>Número da requisição no GAL<input value={value} autoComplete="off" style={inputStyle} onChange={(e) => setValue(e.target.value)} /></label>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <ActionButton onClick={save}>Salvar número do GAL</ActionButton>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}
