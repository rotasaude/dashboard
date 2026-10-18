// Rodada do CEQ (spec §5.10; contrato §4): programa, código, data, por
// analito o enviado, o alvo, os limites aceitáveis, a adequação (sugerida
// pelos limites, a pessoa confirma) e a ação para o inadequado. Decimais com
// vírgula. Salvar passa por step-up (C-E39). O relatório anual não é da
// rodada: é registro próprio (AnnualReportForm, C-E24).
import { useState } from "react";
import { createEqaRound, errorCode, type LabExamRef } from "../../lib/api";
import { EMPTY_EQA_ITEM, EMPTY_EQA_ROUND, eqaBody, eqaProblem, qcError, suggestAdequacy, type EqaItemDraft, type EqaRoundDraft } from "../../lib/qc";
import { todayInCity } from "../../lib/campaigns";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, fieldset, form, legend, row } from "../exams/styles";

export function RoundForm({ providerId, exams, onSaved, onCancel, onStale, onGoToSecurity }: {
  providerId: string; exams: LabExamRef[]; onSaved(): void; onCancel(): void; onStale?(): void; onGoToSecurity?(): void;
}) {
  const today = todayInCity();
  const [ draft, setDraft ] = useState<EqaRoundDraft>(EMPTY_EQA_ROUND);
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const options = exams.filter((e) => e.id).flatMap((e) => (e.analytes ?? []).map((a) => ({ token: `${e.id}:${a.key}`, label: `${a.name} (${e.name})` })));
  const set = (patch: Partial<EqaRoundDraft>) => setDraft((d) => ({ ...d, ...patch }));

  function setItem(i: number, patch: Partial<EqaItemDraft>) {
    setDraft((d) => ({
      ...d,
      items: d.items.map((item, j) => {
        if (j !== i) return item;
        const next = { ...item, ...patch };
        // Sugestão só enquanto a pessoa não escolheu a adequação.
        if (!("adequacy" in patch) && item.adequacy === "") next.adequacy = suggestAdequacy(next);
        return next;
      })
    }));
  }

  function review() {
    const problem = eqaProblem(draft, today);
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  return (
    <section aria-label="Nova rodada do CEQ" style={box}>
      <fieldset disabled={confirming} style={{ ...form, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div style={row}>
          <label style={fieldLabel}>Programa
            <select value={draft.program} style={inputStyle} onChange={(e) => set({ program: e.target.value as EqaRoundDraft["program"] })}>
              <option value="">—</option>
              <option value="PNCQ">PNCQ</option>
              <option value="Controllab">Controllab</option>
              <option value="outro">outro</option>
            </select>
          </label>
          {draft.program === "outro" && (
            <label style={fieldLabel}>Nome do programa<input value={draft.programOther} style={inputStyle} onChange={(e) => set({ programOther: e.target.value })} /></label>
          )}
          <label style={fieldLabel}>Código da rodada<input value={draft.roundCode} style={inputStyle} onChange={(e) => set({ roundCode: e.target.value })} /></label>
          <label style={fieldLabel}>Data da rodada<input type="date" value={draft.roundDate} max={today} style={inputStyle} onChange={(e) => set({ roundDate: e.target.value })} /></label>
        </div>
        {draft.items.map((item, i) => (
          <fieldset key={i} role="group" aria-label={`Item ${i + 1}`} style={fieldset}>
            <legend style={legend}>{`Item ${i + 1}`}</legend>
            <div style={row}>
              <label style={fieldLabel}>Analito
                <select value={item.token} style={inputStyle} onChange={(e) => setItem(i, { token: e.target.value })}>
                  <option value="">—</option>
                  {options.map((o) => <option key={o.token} value={o.token}>{o.label}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>Enviado<input value={item.submitted} inputMode="decimal" style={inputStyle} onChange={(e) => setItem(i, { submitted: e.target.value })} /></label>
              <label style={fieldLabel}>Alvo<input value={item.target} inputMode="decimal" style={inputStyle} onChange={(e) => setItem(i, { target: e.target.value })} /></label>
              <label style={fieldLabel}>Limite inferior<input value={item.low} inputMode="decimal" style={inputStyle} onChange={(e) => setItem(i, { low: e.target.value })} /></label>
              <label style={fieldLabel}>Limite superior<input value={item.high} inputMode="decimal" style={inputStyle} onChange={(e) => setItem(i, { high: e.target.value })} /></label>
              <label style={fieldLabel}>Adequação
                <select value={item.adequacy} style={inputStyle} onChange={(e) => setItem(i, { adequacy: e.target.value as EqaItemDraft["adequacy"] })}>
                  <option value="">—</option>
                  <option value="adequate">adequado</option>
                  <option value="inadequate">inadequado</option>
                </select>
              </label>
            </div>
            {item.adequacy === "inadequate" && (
              <label style={fieldLabel}>Ação para o inadequado
                <textarea value={item.action} rows={2} style={inputStyle} onChange={(e) => setItem(i, { action: e.target.value })} />
              </label>
            )}
            {draft.items.length > 1 && (
              <div><button type="button" style={secondaryButtonStyle} onClick={() => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }))}>Tirar item</button></div>
            )}
          </fieldset>
        ))}
        <div><button type="button" style={secondaryButtonStyle} onClick={() => setDraft((d) => ({ ...d, items: [ ...d.items, EMPTY_EQA_ITEM ] }))}>Incluir analito</button></div>
      </fieldset>
      {error && <p role="alert" style={alert}>{error}</p>}
      {!confirming && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={review}>Revisar e salvar rodada</button>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
      )}
      {confirming && (
        <SensitiveAction title="Salvar rodada" description="A rodada do controle externo entra no histórico do laboratório e não pode ser alterada depois."
          requiresStepUp confirmLabel="Salvar rodada"
          run={async () => { await createEqaRound(eqaBody(draft, providerId)); }}
          onDone={onSaved} onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity}
          translateError={(err) => {
            const code = errorCode(err);
            if (code === "not_found" || code === "conflict") onStale?.();
            return qcError(err);
          }} />
      )}
    </section>
  );
}
