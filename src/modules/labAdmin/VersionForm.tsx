// Nova versão do exame (spec §4; contrato §3): parte da versão atual; cada
// salvamento cria versão nova e imutável (o laudo guarda a versão). Step-up
// pelo SensitiveAction.
import { useState } from "react";
import { createLabExamVersion, type LabExam, type LabValueType } from "../../lib/api";
import { EMPTY_RANGE, LIMITS, versionBody, versionDraft, versionProblem, type AgeUnit, type AnalyteDraft, type RangeDraft, type VersionDraft } from "../../lib/labAdmin";
import { labError } from "../../lib/lab";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, fieldset, form, legend, muted, row } from "../exams/styles";

const AGE_UNITS: { value: AgeUnit; label: string }[] = [ { value: "years", label: "anos" }, { value: "months", label: "meses" }, { value: "days", label: "dias" } ];
const SEX: { value: RangeDraft["sex"]; label: string }[] = [ { value: "any", label: "qualquer" }, { value: "female", label: "feminino" }, { value: "male", label: "masculino" } ];
const VALUE_TYPES: { value: LabValueType; label: string }[] = [ { value: "numeric", label: "numérico" }, { value: "text", label: "texto" }, { value: "choice", label: "escolha" } ];

export function VersionForm({ exam, onSaved, onCancel, onGoToSecurity }: { exam: LabExam; onSaved(): void; onCancel(): void; onGoToSecurity?(): void }) {
  const [ draft, setDraft ] = useState<VersionDraft>(() => versionDraft(exam.current_version));
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const next = (exam.current_version?.version ?? 0) + 1;
  const set = (patch: Partial<VersionDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const setA = (i: number, patch: Partial<AnalyteDraft>) => setDraft((d) => ({ ...d, analytes: d.analytes.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  const setR = (i: number, k: number, patch: Partial<RangeDraft>) =>
    setDraft((d) => ({
      ...d,
      analytes: d.analytes.map((a, j) => (j === i ? { ...a, ranges: a.ranges.map((r, m) => (m === k ? { ...r, ...patch } : r)) } : a))
    }));

  function review() {
    const problem = versionProblem(draft);
    if (problem) { setError(problem); return; }
    setError(null);
    setConfirming(true);
  }

  const text = (label: string, value: string, onChange: (v: string) => void, numeric = false, maxLength?: number) => (
    <label style={fieldLabel}>{label}<input value={value} maxLength={maxLength} inputMode={numeric ? "decimal" : "text"} style={inputStyle} onChange={(e) => onChange(e.target.value)} /></label>
  );

  return (
    <section aria-label={`Nova versão de ${exam.name} (atual v${exam.current_version?.version ?? 0})`} style={box}>
      <p style={muted}>A versão atual não muda: salvar cria a versão {next}, que passa a valer para as próximas requisições.</p>
      <fieldset disabled={confirming} style={{ ...form, border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        {text("Método", draft.method, (v) => set({ method: v }), false, LIMITS.method)}
        {text("Material", draft.material, (v) => set({ material: v }), false, LIMITS.material)}
        {text("Recipiente", draft.container, (v) => set({ container: v }), false, LIMITS.container)}
        {text("Código do exame no aparelho (HL7)", draft.instrumentTestCode, (v) => set({ instrumentTestCode: v }), false, 30)}
        {draft.analytes.map((a, i) => (
          <fieldset key={i} role="group" aria-label={`Componente ${i + 1}`} style={fieldset}>
            <legend style={legend}>{`Componente ${i + 1}${a.name ? ` — ${a.name}` : ""}`}</legend>
            <div style={row}>
              {text("Chave", a.key, (v) => setA(i, { key: v }))}
              {text("Nome", a.name, (v) => setA(i, { name: v }), false, LIMITS.name)}
              {text("LOINC", a.loinc, (v) => setA(i, { loinc: v }))}
              {text("Unidade", a.unit, (v) => setA(i, { unit: v }), false, LIMITS.unit)}
              <label style={fieldLabel}>Tipo de valor
                <select value={a.valueType} style={inputStyle} onChange={(e) => {
                  const valueType = e.target.value as LabValueType;
                  // Limites, críticos e fórmula só existem em numérico: não ficam valores velhos.
                  setA(i, valueType === "numeric" ? { valueType } : { valueType, entryMin: "", entryMax: "", criticalLow: "", criticalHigh: "", formula: "" });
                }}>
                  {VALUE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              {text("Casas decimais (0 a 4)", a.decimals, (v) => setA(i, { decimals: v }), true)}
            </div>
            {a.valueType === "choice" && text("Opções (até 20, separadas por ;)", a.choices, (v) => setA(i, { choices: v }))}
            {a.valueType === "numeric" && <div style={row}>
              {text("Limite de digitação mínimo", a.entryMin, (v) => setA(i, { entryMin: v }), true)}
              {text("Limite de digitação máximo", a.entryMax, (v) => setA(i, { entryMax: v }), true)}
              {text("Crítico abaixo de", a.criticalLow, (v) => setA(i, { criticalLow: v }), true)}
              {text("Crítico acima de", a.criticalHigh, (v) => setA(i, { criticalHigh: v }), true)}
            </div>}
            {a.valueType === "numeric" && text("Fórmula (calculado; deixe em branco se digitado)", a.formula, (v) => setA(i, { formula: v }), false, LIMITS.formula)}
            {a.ranges.map((r, k) => (
              <fieldset key={k} role="group" aria-label={`Faixa ${k + 1}`} style={fieldset}>
                <legend style={legend}>{`Faixa ${k + 1}`}</legend>
                <p style={muted}>Idade em branco: mínima 0 e máxima sem limite.</p>
                <div style={row}>
                  <label style={fieldLabel}>Sexo
                    <select value={r.sex} style={inputStyle} onChange={(e) => setR(i, k, { sex: e.target.value as RangeDraft["sex"] })}>
                      {SEX.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </label>
                  {text("Idade mínima", r.ageMin, (v) => setR(i, k, { ageMin: v }), true)}
                  <label style={fieldLabel}>Unidade da idade mínima
                    <select value={r.ageMinUnit} style={inputStyle} onChange={(e) => setR(i, k, { ageMinUnit: e.target.value as AgeUnit })}>
                      {AGE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </label>
                  {text("Idade máxima", r.ageMax, (v) => setR(i, k, { ageMax: v }), true)}
                  <label style={fieldLabel}>Unidade da idade máxima
                    <select value={r.ageMaxUnit} style={inputStyle} onChange={(e) => setR(i, k, { ageMaxUnit: e.target.value as AgeUnit })}>
                      {AGE_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
                    </select>
                  </label>
                </div>
                <div style={row}>
                  {text("Mínimo", r.low, (v) => setR(i, k, { low: v }), true)}
                  {text("Máximo", r.high, (v) => setR(i, k, { high: v }), true)}
                  {text("Texto da referência", r.text, (v) => setR(i, k, { text: v }), false, LIMITS.rangeText)}
                  <button type="button" style={secondaryButtonStyle} onClick={() => setA(i, { ranges: a.ranges.filter((_, j) => j !== k) })}>Tirar faixa</button>
                </div>
              </fieldset>
            ))}
            <div><button type="button" style={secondaryButtonStyle} disabled={a.ranges.length >= LIMITS.ranges} onClick={() => setA(i, { ranges: [ ...a.ranges, EMPTY_RANGE ] })}>Incluir faixa</button></div>
          </fieldset>
        ))}
      </fieldset>
      {error && <p role="alert" style={alert}>{error}</p>}
      {!confirming && (
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={review}>Revisar e salvar versão</button>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
      )}
      {confirming && (
        <SensitiveAction
          title={`Criar versão ${next} de ${exam.name}`}
          description="Os laudos já emitidos continuam com a versão deles; a nova vale para as próximas requisições."
          requiresStepUp confirmLabel={`Criar versão ${next}`}
          run={async () => { await createLabExamVersion(exam.id, versionBody(draft)); }}
          onDone={() => { setConfirming(false); onSaved(); }}
          onCancel={() => setConfirming(false)} onGoToSecurity={onGoToSecurity}
          translateError={(err) => labError(err)}
        />
      )}
    </section>
  );
}
