// src/modules/exams/ResultForm.tsx
// Resultado do exame (contrato §3 "result" e §6; resultado externo §3):
// laudo, data de liberação, laboratório, os campos do catálogo (todos
// opcionais) e a marca "crítico" — que manda o exame direto para a fila da
// equipe (spec §5). O resultado externo não tem a marca.
import { useState, type FormEvent } from "react";
import type { ExamResultField, ResultInput } from "../../lib/api";
import { emptyResultDraft, examError, resultBody, resultProblem, type ResultDraft } from "../../lib/exams";
import { buttonStyle, disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { UploadField } from "./UploadField";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "./styles";

const REPORT_TYPES = [ "application/pdf" ] as const;

interface Props {
  fields: ExamResultField[]; today: string; submitLabel: string; allowCritical?: boolean;
  onSubmit(input: ResultInput): Promise<void>; onCancel(): void;
}

export function ResultForm({ fields, today, submitLabel, allowCritical = true, onSubmit, onCancel }: Props) {
  const [ draft, setDraft ] = useState<ResultDraft>(() => emptyResultDraft(today));
  const [ error, setError ] = useState<string | null>(null);
  const [ busy, setBusy ] = useState(false);
  const set = (patch: Partial<ResultDraft>) => setDraft((d) => ({ ...d, ...patch }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const problem = resultProblem(draft, today);
    if (problem) { setError(problem); return; }
    setBusy(true);
    setError(null);
    try { await onSubmit(resultBody(draft)); } catch (err) { setError(examError(err)); } finally { setBusy(false); }
  }

  return (
    <form aria-label={submitLabel} onSubmit={submit} noValidate style={form}>
      <UploadField label="Laudo (PDF, até 10 MB)" types={REPORT_TYPES} uploadId={draft.uploadId} onUploaded={(uploadId) => set({ uploadId })} />
      <label style={fieldLabel}>
        Data de liberação
        <input type="date" max={today} value={draft.releasedOn} style={inputStyle} onChange={(e) => set({ releasedOn: e.target.value })} />
      </label>
      <label style={fieldLabel}>
        Laboratório
        <input value={draft.laboratoryName} style={inputStyle} onChange={(e) => set({ laboratoryName: e.target.value })} />
      </label>
      {fields.length > 0 ? (
        <fieldset style={fieldset}>
          <legend style={legend}>Valores (opcionais)</legend>
          {fields.map((f) => (
            <label key={f.key} style={fieldLabel}>
              {f.unit ? `${f.label} (${f.unit})` : f.label}
              <input value={draft.values[f.key] ?? ""} style={inputStyle}
                onChange={(e) => { const value = e.target.value; setDraft((d) => ({ ...d, values: { ...d.values, [f.key]: value } })); }} />
            </label>
          ))}
        </fieldset>
      ) : <p style={muted}>este exame não tem campos no catálogo — o laudo basta</p>}
      {allowCritical && (
        <label style={checkLabel}>
          <input type="checkbox" checked={draft.critical} onChange={(e) => set({ critical: e.target.checked })} />
          Resultado crítico (vai direto para a fila da equipe)
        </label>
      )}
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <button type="submit" aria-disabled={busy || undefined} style={busy ? disabledButtonStyle : buttonStyle}>{submitLabel}</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar</button>
      </div>
    </form>
  );
}
