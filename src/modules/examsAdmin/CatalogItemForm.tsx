// src/modules/examsAdmin/CatalogItemForm.tsx
// Um exame do catálogo da cidade (contrato §5): SIGTAP (travado na edição),
// autorização, política de liberação ao cidadão, prazos por etapa (em branco
// = padrão da plataforma, mostrado no placeholder) e os campos de resultado.
import { useState, type FormEvent } from "react";
import type { ExamCatalogItem, ExamCatalogItemInput, ExamResultField } from "../../lib/api";
import { DEFAULT_DEADLINES, EXAM_STAGES, RELEASE_POLICIES, STAGE_LABEL } from "../../lib/exams";
import { EMPTY_FIELD, catalogBody, catalogDraft, catalogProblem, type CatalogDraft } from "../../lib/examsAdmin";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

export function CatalogItemForm({ initial, onReview, onCancel }: {
  initial?: ExamCatalogItem; onReview(input: ExamCatalogItemInput): void; onCancel(): void;
}) {
  const [ draft, setDraft ] = useState<CatalogDraft>(() => catalogDraft(initial));
  const [ error, setError ] = useState<string | null>(null);
  const set = (patch: Partial<CatalogDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setField = (i: number, patch: Partial<ExamResultField>) =>
    setDraft((d) => ({ ...d, fields: d.fields.map((f, j) => (j === i ? { ...f, ...patch } : f)) }));

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = catalogProblem(draft);
    if (problem) { setError(problem); return; }
    setError(null);
    onReview(catalogBody(draft));
  }

  return (
    <form aria-label={initial ? `Editar ${initial.label}` : "Novo exame"} onSubmit={submit} style={form}>
      <label style={fieldLabel}>
        Código SIGTAP
        <input value={draft.sigtapCode} inputMode="numeric" disabled={!!initial} style={inputStyle}
          onChange={(e) => set({ sigtapCode: e.target.value })} />
      </label>
      <label style={checkLabel}>
        <input type="checkbox" checked={draft.requiresAuthorization} onChange={(e) => set({ requiresAuthorization: e.target.checked })} />
        Exige autorização (entra na fila de regulação)
      </label>
      <fieldset style={fieldset}>
        <legend style={legend}>Liberação do laudo ao cidadão</legend>
        {RELEASE_POLICIES.map((p) => (
          <label key={p.value} style={checkLabel}>
            <input type="radio" name="release-policy" checked={draft.releasePolicy === p.value} onChange={() => set({ releasePolicy: p.value })} />
            {`${p.label} — ${p.hint}`}
          </label>
        ))}
      </fieldset>
      <fieldset style={fieldset}>
        <legend style={legend}>Prazos em dias (em branco = padrão da plataforma; urgente usa a metade)</legend>
        <div style={row}>
          {EXAM_STAGES.map((s) => (
            <label key={s} style={fieldLabel}>
              {`Prazo de ${STAGE_LABEL[s]}`}
              <input value={draft.deadlines[s]} inputMode="numeric" placeholder={`padrão ${DEFAULT_DEADLINES[s]}`} style={{ ...inputStyle, width: 120 }}
                onChange={(e) => { const value = e.target.value; setDraft((d) => ({ ...d, deadlines: { ...d.deadlines, [s]: value } })); }} />
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset style={fieldset}>
        <legend style={legend}>Campos de resultado</legend>
        {draft.fields.length === 0 && <p style={muted}>sem campos — o resultado será só o laudo</p>}
        {draft.fields.map((f, i) => (
          <div key={i} role="group" aria-label={`Campo ${i + 1}`} style={{ ...row, alignItems: "flex-end" }}>
            <label style={fieldLabel}>Chave<input value={f.key} style={inputStyle} onChange={(e) => setField(i, { key: e.target.value })} /></label>
            <label style={fieldLabel}>Nome<input value={f.label} style={inputStyle} onChange={(e) => setField(i, { label: e.target.value })} /></label>
            <label style={fieldLabel}>Unidade<input value={f.unit ?? ""} style={inputStyle} onChange={(e) => setField(i, { unit: e.target.value })} /></label>
            <label style={fieldLabel}>LOINC<input value={f.loinc ?? ""} style={inputStyle} onChange={(e) => setField(i, { loinc: e.target.value })} /></label>
            <button type="button" aria-label={`Remover campo ${i + 1}`} style={secondaryButtonStyle}
              onClick={() => setDraft((d) => ({ ...d, fields: d.fields.filter((_, j) => j !== i) }))}>Remover</button>
          </div>
        ))}
        <div>
          <button type="button" style={secondaryButtonStyle} onClick={() => setDraft((d) => ({ ...d, fields: [ ...d.fields, { ...EMPTY_FIELD } ] }))}>
            Adicionar campo
          </button>
        </div>
      </fieldset>
      <label style={checkLabel}>
        <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />
        Ativo
      </label>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <button type="submit" style={buttonStyle}>Revisar e salvar</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar</button>
      </div>
    </form>
  );
}
