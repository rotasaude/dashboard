// src/modules/exams/ReasonForm.tsx
// Motivo obrigatório (contrato §3–§4): cancelar, negar e a ciência pela equipe.
import { useState, type FormEvent } from "react";
import { examError, reasonProblem } from "../../lib/exams";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, row } from "./styles";

const REASON_MAX = 500;

export function ReasonForm({ label, submitLabel, onSubmit, onCancel }: {
  label: string; submitLabel: string; onSubmit(reason: string): Promise<void>; onCancel(): void;
}) {
  const [ text, setText ] = useState("");
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = text.trim().length > REASON_MAX ? `o motivo passa de ${REASON_MAX} caracteres` : reasonProblem(text);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try { await onSubmit(text.trim()); } catch (err) { setError(examError(err)); } finally { setBusy(false); }
  }

  return (
    <form aria-label={label} onSubmit={submit} noValidate style={form}>
      <label style={fieldLabel}>
        {label}
        <textarea rows={3} maxLength={REASON_MAX} value={text} style={inputStyle} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>{submitLabel}</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar</button>
      </div>
    </form>
  );
}
