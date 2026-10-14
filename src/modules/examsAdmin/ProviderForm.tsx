// src/modules/examsAdmin/ProviderForm.tsx
// Um prestador (contrato §5): nome, CNES opcional, tipo, ativo e os exames
// que ele faz, cada um com prazos próprios opcionais (o placeholder mostra o
// que ele herda do catálogo ou da plataforma).
import { useState, type FormEvent } from "react";
import type { ExamCatalogItem, ExamProvider, ExamProviderInput, ExamProviderKind } from "../../lib/api";
import { EXAM_STAGES, PROVIDER_KINDS, STAGE_LABEL, deadlineDraft, effectiveDeadline } from "../../lib/exams";
import { providerBody, providerDraft, providerProblem, type ProviderDraft } from "../../lib/examsAdmin";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, checkLabel, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

export function ProviderForm({ initial, catalog, onReview, onCancel }: {
  initial?: ExamProvider; catalog: ExamCatalogItem[]; onReview(input: ExamProviderInput): void; onCancel(): void;
}) {
  const [ draft, setDraft ] = useState<ProviderDraft>(() => providerDraft(initial));
  const [ error, setError ] = useState<string | null>(null);
  const set = (patch: Partial<ProviderDraft>) => setDraft((d) => ({ ...d, ...patch }));
  // Exame inativo só aparece se o prestador já o tinha (para poder tirá-lo).
  const shown = catalog.filter((c) => c.active || draft.items[c.id]);
  const labelOf = (id: string) => catalog.find((c) => c.id === id)?.label ?? id;

  function toggle(id: string, on: boolean) {
    setDraft((d) => {
      const items = { ...d.items };
      if (on) items[id] = deadlineDraft(null); else delete items[id];
      return { ...d, items };
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = providerProblem(draft, labelOf);
    if (problem) { setError(problem); return; }
    setError(null);
    onReview(providerBody(draft));
  }

  return (
    <form aria-label={initial ? `Editar ${initial.name}` : "Novo prestador"} onSubmit={submit} style={form}>
      <label style={fieldLabel}>Nome<input value={draft.name} style={inputStyle} onChange={(e) => set({ name: e.target.value })} /></label>
      <label style={fieldLabel}>
        CNES (opcional)
        <input value={draft.cnes} inputMode="numeric" style={inputStyle} onChange={(e) => set({ cnes: e.target.value })} />
      </label>
      <label style={fieldLabel}>
        Tipo
        <select value={draft.kind} style={inputStyle} onChange={(e) => set({ kind: e.target.value as ExamProviderKind })}>
          {PROVIDER_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
        </select>
      </label>
      <label style={checkLabel}>
        <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} />Ativo
      </label>
      <fieldset style={fieldset}>
        <legend style={legend}>Exames que este prestador faz</legend>
        {shown.length === 0 && <p style={muted}>o catálogo da cidade está vazio — inclua os exames primeiro</p>}
        {shown.map((c) => (
          <div key={c.id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <label style={checkLabel}>
              <input type="checkbox" checked={!!draft.items[c.id]} onChange={(e) => toggle(c.id, e.target.checked)} />
              {`Faz ${c.label}`}
            </label>
            {draft.items[c.id] && (
              <div role="group" aria-label={`Prazos — ${c.label}`} style={{ ...row, paddingLeft: 24 }}>
                {EXAM_STAGES.map((s) => (
                  <label key={s} style={fieldLabel}>
                    {`Prazo de ${STAGE_LABEL[s]}`}
                    <input value={draft.items[c.id][s]} inputMode="numeric" placeholder={`herda ${effectiveDeadline(s, null, c.deadlines)}`}
                      style={{ ...inputStyle, width: 110 }}
                      onChange={(e) => {
                        const value = e.target.value;
                        setDraft((d) => ({ ...d, items: { ...d.items, [c.id]: { ...d.items[c.id], [s]: value } } }));
                      }} />
                  </label>
                ))}
              </div>
            )}
          </div>
        ))}
      </fieldset>
      {error && <p role="alert" style={alert}>{error}</p>}
      <div style={row}>
        <button type="submit" style={buttonStyle}>Revisar e salvar</button>
        <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Voltar</button>
      </div>
    </form>
  );
}
