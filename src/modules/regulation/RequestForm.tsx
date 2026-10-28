// src/modules/regulation/RequestForm.tsx
// Formulário do pedido de regulação (módulo 26a): criar (consulta) e complementar (devolvido). As regras vêm de lib/regulation:
// quem pode pedir o quê (`allowedTypes`), CID-10 e/ou CIAP-2 pela regra do CBO (`diagnosisRule`), recusa antes de enviar
// (`requestProblem`) e o corpo (`requestBody`). A recusa do api aparece no formulário, que mantém o que foi digitado.
import { useEffect, useRef, useState } from "react";
import type { RegulationRequestInput, RegulationType, RiskColor } from "../../lib/api";
import {
  COLORS, EMPTY_DRAFT, JUSTIFICATION_MAX, allowedTypes, diagnosisRule, regulationError, requestBody, requestProblem, typeLabel,
  type RequestDraft, type RequestField
} from "../../lib/regulation";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";
import { TargetSearch } from "./TargetSearch";

const TYPE_RADIO: Record<RegulationType, string> = { specialty: "Especialidade", procedure: "Procedimento" };
const snapshot = (d: RequestDraft) => JSON.stringify([ d.type, d.target?.code ?? null, d.cid10, d.ciap2, d.justification, d.color, d.stateRegulated ]);

export function RequestForm({ cbo, cid10Allowed, initial, submitLabel, mode, delayMs, onSubmit, onCancel, onDirty }: {
  cbo: string | null; cid10Allowed: boolean; initial?: RequestDraft; submitLabel: string; mode: "create" | "complement"; delayMs?: number;
  onSubmit(body: RegulationRequestInput): Promise<void>; onCancel(): void; onDirty?(dirty: boolean): void;
}) {
  const types = allowedTypes(cbo);
  const start = useRef<RequestDraft>(initial ?? EMPTY_DRAFT(types[0] ?? "specialty")).current;
  const [ draft, setDraft ] = useState<RequestDraft>(start);
  const [ message, setMessage ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const refs = useRef<Partial<Record<RequestField, HTMLElement | null>>>({});
  const rule = diagnosisRule(cbo, cid10Allowed);
  const complement = mode === "complement";

  const dirty = snapshot(draft) !== snapshot(start);
  const onDirtyRef = useRef(onDirty);
  onDirtyRef.current = onDirty;
  useEffect(() => { onDirtyRef.current?.(dirty); }, [ dirty ]);

  const set = <K extends keyof RequestDraft>(key: K, value: RequestDraft[K]) => setDraft((d) => ({ ...d, [key]: value }));
  const field = (name: RequestField) => (el: HTMLElement | null) => { refs.current[name] = el; };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = requestProblem(draft, cbo, cid10Allowed);
    if (problem) {
      setMessage(problem.text);
      refs.current[problem.field]?.focus();
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      // Em `complement` o "regulado pelo estado" não aparece nem vai: o pedido já nasceu assim ou não.
      await onSubmit(requestBody(complement ? { ...draft, stateRegulated: false } : draft, cbo, cid10Allowed));
    } catch (err) {
      setMessage(regulationError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate style={form}>
      {!complement && types.length > 1 && (
        <fieldset style={fieldset}>
          <legend style={legend}>Tipo</legend>
          <div style={row}>
            {types.map((t) => (
              <label key={t} style={checkLabel}>
                <input type="radio" name="regulation-type" checked={draft.type === t}
                  onChange={() => setDraft((d) => (d.type === t ? d : { ...d, type: t, target: null }))} />
                {TYPE_RADIO[t]}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      {draft.target ? (
        <div style={row}>
          <span style={{ fontSize: 13 }}>
            {typeLabel(draft.type)}: <strong>{draft.target.name}</strong> <span className="mono" style={muted}>{draft.target.code}</span>
          </span>
          {!complement && <button type="button" style={secondaryButtonStyle} onClick={() => set("target", null)}>Trocar</button>}
        </div>
      ) : (
        <TargetSearch type={draft.type} cbo={cbo} delayMs={delayMs} inputRef={field("target")} onPick={(t) => set("target", t)} />
      )}
      {rule !== "ciap2" && (
        <label style={fieldLabel}>
          CID-10
          <input ref={field("cid10")} value={draft.cid10} style={inputStyle} autoComplete="off" onChange={(e) => set("cid10", e.target.value)} />
        </label>
      )}
      <label style={fieldLabel}>
        {rule === "cid10" ? "CIAP-2 (opcional)" : "CIAP-2"}
        <input ref={field("ciap2")} value={draft.ciap2} style={inputStyle} autoComplete="off" onChange={(e) => set("ciap2", e.target.value)} />
      </label>
      <label style={fieldLabel}>
        Justificativa
        <textarea ref={field("justification")} value={draft.justification} rows={5} style={inputStyle}
          onChange={(e) => set("justification", e.target.value)} />
      </label>
      <p className="mono" style={muted}>{`${draft.justification.length} de ${JUSTIFICATION_MAX}`}</p>
      <label style={fieldLabel}>
        Cor de risco sugerida
        <select ref={field("color")} value={draft.color} style={inputStyle} onChange={(e) => set("color", e.target.value as RiskColor | "")}>
          <option value="">escolha…</option>
          {COLORS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>
      {!complement && (
        <label style={checkLabel}>
          <input type="checkbox" checked={draft.stateRegulated} onChange={(e) => set("stateRegulated", e.target.checked)} />
          Regulado pelo estado (SISREG, CARE, CROSS)
        </label>
      )}
      {message && <p role="alert" style={alert}>{message}</p>}
      <div style={row}>
        <button type="submit" style={busy ? disabledButtonStyle : buttonStyle} disabled={busy}>{submitLabel}</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
      </div>
    </form>
  );
}
