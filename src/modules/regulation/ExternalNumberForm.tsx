// src/modules/regulation/ExternalNumberForm.tsx
// Número do pedido no sistema do estado (SISREG, CARE, CROSS, outro; módulo 26a, F-26.6), pelas ações da situação
// (`actionsFor(...).external`: `pending` e `external`; o api recusa nas outras). O formato é conferido antes de enviar.
// Gravado, devolve o pedido por `onApplied` (quem chama grava no cache, sem leitura nominal a mais) e a frase por
// `onChanged`. `stale_version` e `invalid_transition` deixam o número digitado: a frase sobe por `onStale` (quem a recebe
// oferece o "Recarregar"); sem ele, aparece aqui. O número não vai a log, URL nem storage.
import { useState } from "react";
import { errorCode, setRegulationExternal, type ExternalSystem, type RegulationRequest } from "../../lib/api";
import { EXTERNAL_SYSTEMS, actionsFor, externalNumberProblem, regulationError } from "../../lib/regulation";
import { buttonStyle, disabledButtonStyle, inputStyle } from "../../components/formStyles";
import { alert, fieldLabel, form, row } from "../exams/styles";

export const EXTERNAL_SAVED_TEXT = "Número externo registrado.";

export function ExternalNumberForm({ request, onChanged, onApplied, onStale, onStart }: {
  request: RegulationRequest; onChanged(text: string): void; onApplied?(updated: RegulationRequest): void; onStale?(text: string): void;
  // Uma nova ação começou: quem chama limpa a frase de sucesso anterior.
  onStart?(): void;
}) {
  const [ system, setSystem ] = useState<ExternalSystem>((request.external?.system as ExternalSystem | undefined) ?? EXTERNAL_SYSTEMS[0].key);
  const [ number, setNumber ] = useState(request.external?.number ?? "");
  const [ problem, setProblem ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  if (!actionsFor(request).external) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    onStart?.();
    const found = externalNumberProblem(number);
    if (found) { setProblem(found); return; }
    setProblem(null);
    setBusy(true);
    try {
      const updated = await setRegulationExternal(request.id, system, number.trim(), request.version);
      onApplied?.(updated);
      onChanged(EXTERNAL_SAVED_TEXT);
    } catch (err) {
      const code = errorCode(err);
      const phrase = regulationError(err);
      if ((code === "stale_version" || code === "invalid_transition") && onStale) onStale(phrase);
      else setProblem(phrase);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form aria-label="Número externo do pedido" onSubmit={submit} noValidate style={form}>
      <label style={fieldLabel}>
        Sistema
        <select value={system} style={inputStyle} onChange={(e) => setSystem(e.target.value as ExternalSystem)}>
          {EXTERNAL_SYSTEMS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
      </label>
      <label style={fieldLabel}>
        Número no sistema do estado
        <input type="text" value={number} style={inputStyle} onChange={(e) => setNumber(e.target.value)} />
      </label>
      {problem && <p role="alert" style={alert}>{problem}</p>}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>Registrar número</button>
      </div>
    </form>
  );
}
