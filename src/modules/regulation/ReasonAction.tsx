// src/modules/regulation/ReasonAction.tsx
// Ação do regulador que pede só um motivo (devolver, negar, cancelar; módulo 26a). O motivo tem de 10 a 500 caracteres
// (G7): a recusa vem antes de enviar e nunca corta o texto; só os espaços das pontas saem. A recusa do api aparece no
// formulário, que mantém o motivo digitado. O motivo não vai a log nem a URL.
import { useState } from "react";
import { reasonProblem, regulationError } from "../../lib/regulation";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, row } from "../exams/styles";

export function ReasonAction({ label, submitLabel, onSubmit, onCancel }: {
  label: string; submitLabel: string; onSubmit(reason: string): Promise<void>; onCancel(): void;
}) {
  const [ reason, setReason ] = useState("");
  const [ message, setMessage ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = reasonProblem(reason);
    if (problem) { setMessage(problem); return; }
    setMessage(null);
    setBusy(true);
    try {
      await onSubmit(reason.trim());
    } catch (err) {
      setMessage(regulationError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate style={form}>
      <label style={fieldLabel}>
        {label}
        <textarea value={reason} rows={4} style={inputStyle} onChange={(e) => setReason(e.target.value)} />
      </label>
      {message && <p role="alert" style={alert}>{message}</p>}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>{submitLabel}</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
