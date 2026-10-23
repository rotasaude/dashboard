// src/modules/careLines/CustomLineForm.tsx
// Linha própria da cidade (contrato §3; spec, decisões do coordenador): a
// mesma forma das linhas do catálogo — elegibilidade por CIAP-2/CID-10 ativos,
// idade e sexo; boas práticas por fonte, janela, quantidade, cronograma e
// âncora — e a condição declarada que a sugere (ex.: saúde mental). Salvar
// passa pelo step-up. Formato é conferido aqui (recusar, nunca cortar) e de
// novo no api (invalid_practices, invalid_eligibility).
import { useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { createCustomCareLine, errorCode, updateCareLine, type CareLine } from "../../lib/api";
import {
  CONDITIONS, CUSTOM_ANCHORS, LINES_KEY, SOURCE_KINDS, customLineBody, customLineProblem, draftOfLine, emptyCustomLine, emptyPractice,
  isDoctorNurse, knownCareLineError, type CustomLineDraft, type PracticeDraft
} from "../../lib/careLines";
import { SensitiveAction } from "../../components/SensitiveAction";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, checkLabel, fieldLabel, fieldset, form, legend, row } from "../exams/styles";

export function CustomLineForm({ line, onSaved, onCancel, onGoToSecurity }: {
  line: CareLine | null; onSaved(message: string): void; onCancel(): void; onGoToSecurity?(): void;
}) {
  const queryClient = useQueryClient();
  const [ draft, setDraft ] = useState<CustomLineDraft>(() => (line ? draftOfLine(line) : emptyCustomLine()));
  const [ error, setError ] = useState<string | null>(null);
  const [ confirming, setConfirming ] = useState(false);
  const set = (patch: Partial<CustomLineDraft>) => { setError(null); setDraft((d) => ({ ...d, ...patch })); };
  const setPractice = (i: number, patch: Partial<PracticeDraft>) =>
    set({ practices: draft.practices.map((p, j) => (j === i ? { ...p, ...patch } : p)) });

  function review() {
    const problem = customLineProblem(draft);
    if (problem) { setError(problem); return; }
    setConfirming(true);
  }

  // O corpo já leva `declared_condition` (null ao tirar a condição: ausente seria "manter a antiga" no api).
  async function save() {
    const body = customLineBody(draft);
    if (line) await updateCareLine(line.id, body);
    else await createCustomCareLine(body);
  }

  const text = (label: string, value: string, onChange: (v: string) => void, hint?: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <label style={fieldLabel}>
        {label}
        <input value={value} style={inputStyle} onChange={(e) => onChange(e.target.value)} />
      </label>
      {hint && <span style={hintStyle}>{hint}</span>}
    </div>
  );

  if (confirming) {
    const name = draft.name.trim();
    return (
      <SensitiveAction
        title={line ? `Salvar ${name}` : `Criar a linha ${name}`}
        description={`${draft.practices.length} boa(s) prática(s). ${line
          ? "As inscrições desta linha passam a ser avaliadas pela forma nova."
          : "A linha entra no painel das equipes; ninguém é inscrito sem um profissional confirmar."}`}
        requiresStepUp
        confirmLabel="Salvar linha"
        run={save}
        onDone={() => onSaved(line ? `Linha ${name} salva.` : `Linha ${name} criada.`)}
        onCancel={() => setConfirming(false)}
        onGoToSecurity={onGoToSecurity}
        translateError={(err) => {
          // Outra pessoa já criou a linha dessa condição: a lista da tela está velha.
          if (errorCode(err) === "duplicate_declared_condition") void queryClient.invalidateQueries({ queryKey: [ LINES_KEY ] });
          return knownCareLineError(err);
        }}
      />
    );
  }

  return (
    <section aria-label="Linha própria" style={box}>
      <div style={form}>
        {text("Nome da linha", draft.name, (v) => set({ name: v }), "até 120 caracteres")}
        <label style={fieldLabel}>
          Condição declarada que sugere esta linha
          <select value={draft.declaredCondition} style={inputStyle}
            onChange={(e) => set({ declaredCondition: e.target.value as CustomLineDraft["declaredCondition"] })}>
            <option value="">nenhuma</option>
            {CONDITIONS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <fieldset style={fieldset}>
          <legend style={legend}>Quem é sugerido (problema ativo, idade e sexo)</legend>
          {text("Códigos CIAP-2", draft.ciap, (v) => set({ ciap: v }), "separados por vírgula, ex.: P76, P74")}
          {text("Códigos CID-10", draft.cid10, (v) => set({ cid10: v }), "separados por vírgula, ex.: F32, F41")}
          <div style={row}>
            {text("Idade mínima (anos)", draft.ageMinYears, (v) => set({ ageMinYears: v }), "vazio = sem limite")}
            {text("Idade máxima (anos)", draft.ageMaxYears, (v) => set({ ageMaxYears: v }), "vazio = sem limite")}
            <label style={fieldLabel}>
              Sexo
              <select value={draft.sex} style={inputStyle} onChange={(e) => set({ sex: e.target.value as CustomLineDraft["sex"] })}>
                <option value="">qualquer</option>
                <option value="female">feminino</option>
                <option value="male">masculino</option>
              </select>
            </label>
          </div>
        </fieldset>
        {draft.practices.map((p, i) => (
          <fieldset key={i} role="group" aria-label={`Boa prática ${i + 1}`} style={fieldset}>
            <legend style={legend}>Boa prática {i + 1}</legend>
            {text("O que deve ser feito", p.label, (v) => setPractice(i, { label: v }), "até 120 caracteres, ex.: consulta de acompanhamento")}
            {text("Como o cidadão lê (opcional)", p.citizenLabel, (v) => setPractice(i, { citizenLabel: v }),
              "até 80 caracteres, em linguagem simples, ex.: consulta com a equipe — aparece em Meu acompanhamento")}
            <div style={row}>
              <label style={fieldLabel}>
                Fonte
                <select value={p.sourceKind} style={inputStyle} onChange={(e) => setPractice(i, { sourceKind: e.target.value })}>
                  {SOURCE_KINDS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
                </select>
              </label>
              {(p.sourceKind === "exam" || p.sourceKind === "procedure") &&
                text("Código SIGTAP", p.sigtap, (v) => setPractice(i, { sigtap: v }), "10 dígitos")}
              {text("Janela (dias)", p.windowDays, (v) => setPractice(i, { windowDays: v }))}
              {text("Quantidade na janela", p.minCount, (v) => setPractice(i, { minCount: v }))}
            </div>
            <div style={row}>
              <label style={fieldLabel}>
                Contar a partir de
                <select value={p.anchor} style={inputStyle} onChange={(e) => setPractice(i, { anchor: e.target.value })}>
                  {CUSTOM_ANCHORS.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
                </select>
              </label>
              <label style={fieldLabel}>
                Cronograma
                <select value={p.schedule} style={inputStyle} onChange={(e) => setPractice(i, { schedule: e.target.value })}>
                  <option value="end_of_window">até o fim da janela</option>
                  <option value="proportional">proporcional ao tempo</option>
                </select>
              </label>
            </div>
            {p.sourceKind === "consultation" && (
              <>
                <label style={checkLabel}>
                  <input type="checkbox" checked={p.doctorOrNurse} onChange={(e) => setPractice(i, { doctorOrNurse: e.target.checked })} />
                  Só consulta de médico ou enfermeiro conta
                </label>
                {/* Outro conjunto de CBO (ex.: semente de saúde mental): a caixa fica desmarcada e os CBOs reais aparecem. */}
                {p.baseCbo && p.baseCbo.length > 0 && !isDoctorNurse(p.baseCbo) && (
                  <span style={hintStyle}>
                    CBO desta boa prática: {p.baseCbo.join(", ")}{p.doctorOrNurse ? " — será trocado por médico ou enfermeiro" : " — mantido ao salvar"}
                  </span>
                )}
              </>
            )}
            {draft.practices.length > 1 && (
              <div>
                <button type="button" style={secondaryButtonStyle}
                  onClick={() => set({ practices: draft.practices.filter((_, j) => j !== i) })}>Tirar boa prática {i + 1}</button>
              </div>
            )}
          </fieldset>
        ))}
        <div>
          <button type="button" style={secondaryButtonStyle} onClick={() => set({ practices: [ ...draft.practices, emptyPractice() ] })}>
            Incluir boa prática
          </button>
        </div>
        {error && <p role="alert" style={alert}>{error}</p>}
        <div style={row}>
          <button type="button" style={buttonStyle} onClick={review}>Revisar e salvar</button>
          <button type="button" style={secondaryButtonStyle} onClick={onCancel}>Cancelar</button>
        </div>
      </div>
    </section>
  );
}

const hintStyle: CSSProperties = { fontSize: 11.5, color: "var(--ink3)" };
