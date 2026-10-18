// Ação corretiva de um bloqueio (spec §5.7; contrato §3; C-E3/C-E4). Qualquer
// membro do laboratório registra, uma vez, sem step-up (C-E39). Registrar não
// fecha: o bloqueio fecha sozinho na corrida aprovada com todos os níveis. O
// texto nunca vai a console, log ou storage.
import { useState } from "react";
import { errorCode, recordCorrectiveAction, type QcBlock } from "../../lib/api";
import { qcError, reasonProblem } from "../../lib/qc";
import { ActionButton } from "../../components/ActionButton";
import { inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, fieldLabel, fieldset, legend, row } from "../exams/styles";

export function CorrectiveActionForm({ block, label, onDone, onCancel, onStale }: {
  block: QcBlock; label: string; onDone(): void; onCancel(): void; onStale?(): void;
}) {
  const [ text, setText ] = useState("");
  const [ error, setError ] = useState<string | null>(null);

  async function save() {
    const problem = reasonProblem(text, "a ação corretiva");
    if (problem) { setError(problem); return; }
    setError(null);
    try {
      await recordCorrectiveAction(block.id, text.trim());
      onDone();
    } catch (err) {
      const code = errorCode(err);
      // 404/409: a frase diz que a tela foi atualizada, então relê de fato.
      if (code === "not_found" || code === "conflict" || code === "invalid_transition") onStale?.();
      setError(qcError(err));
    }
  }

  return (
    <fieldset role="group" aria-label={`Ação corretiva — ${label}`} style={fieldset}>
      <legend style={legend}>{`Ação corretiva — ${label}`}</legend>
      <label style={fieldLabel}>O que foi feito
        <textarea value={text} rows={3} style={inputStyle} onChange={(e) => setText(e.target.value)} />
      </label>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <ActionButton onClick={save}>Registrar</ActionButton>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </fieldset>
  );
}
