// src/modules/protocolEditor/UrgencyRulesPanel.tsx
// Painel "Regras de cor" da classificação de risco (módulo 32a; contrato §14
// Q1/Q3). Como o RiskRulesPanel do 18, com as 5 cores, o critério que aparece
// para quem classifica e o id de cada regra. As variáveis são as do
// fieldsFor("urgency"): sinais vitais sem a dor do 18, `pain_scale`, idade e
// sexo; a queixa nunca entra. Conteúdo assinado (ADR 0016).
import type { CSSProperties, ReactNode } from "react";
import type { UrgencyColor } from "../../lib/api";
import { ConditionBuilder } from "../protocols/ConditionBuilder";
import { fieldsFor } from "../../lib/condition";
import { URGENCY_COLORS, URGENCY_COLOR_LABEL } from "../../lib/urgency";
import {
  CRITERION_MAX, URGENCY_RULES_MAX, nextRuleId, readUrgencyRules, urgencyRuleProblems, writeUrgencyRules, type UrgencyRuleDraft
} from "../../lib/urgencyRules";
import { disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

interface Props { definition: unknown | null; onChange(next: unknown): void }

export function UrgencyRulesPanel({ definition, onChange }: Props) {
  if (definition === null) return <Section><p style={hint}>Corrija o JSON para editar as regras de cor.</p></Section>;
  const read = readUrgencyRules(definition);
  if (!read.ok) return <Section><p role="alert" style={alert}>{read.reason}</p></Section>;
  const rules = read.rules;
  const fields = fieldsFor("urgency");
  const setRules = (list: UrgencyRuleDraft[]) => onChange(writeUrgencyRules(definition, list));
  const replace = (i: number, next: UrgencyRuleDraft) => setRules(rules.map((r, j) => (j === i ? next : r)));
  const full = rules.length >= URGENCY_RULES_MAX;

  return (
    <Section>
      <p style={hint}>
        Vale a cor mais grave entre as regras que casarem. É só sugestão: a cor final é de quem classifica, com justificativa quando muda.
      </p>
      {rules.length === 0 && <p role="alert" style={alert}>Inclua ao menos uma regra de cor.</p>}
      {rules.map((r, i) => {
        const problems = urgencyRuleProblems(r, rules);
        return (
          // A chave é a posição, como no RiskRulesPanel: o id é editável no JSON.
          <div key={i} role="group" aria-label={`regra de cor ${i + 1}`} style={card}>
            <small className="mono" style={hint}>{`regra ${r.id}`}</small>
            <label style={label}>
              Cor sugerida
              <select value={r.color} style={inputStyle} onChange={(e) => replace(i, { ...r, color: e.target.value as UrgencyColor })}>
                {URGENCY_COLORS.map((c) => <option key={c} value={c}>{URGENCY_COLOR_LABEL[c]}</option>)}
              </select>
            </label>
            <ConditionBuilder label="Quando sugerir" fields={fields} value={r.when} emptyText="—"
              onChange={(tree) => replace(i, { ...r, when: tree })} />
            <label style={label}>
              Critério (aparece para quem classifica)
              <input value={r.criterion} maxLength={CRITERION_MAX} style={inputStyle}
                onChange={(e) => replace(i, { ...r, criterion: e.target.value })} />
            </label>
            {problems.map((p) => <small key={p} style={hint}>{p}</small>)}
            <div>
              <button type="button" style={secondaryButtonStyle} onClick={() => setRules(rules.filter((_, j) => j !== i))}>remover regra</button>
            </div>
          </div>
        );
      })}
      <div>
        <button type="button" disabled={full} style={full ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => setRules([ ...rules, { id: nextRuleId(rules), when: null, color: "yellow", criterion: "" } ])}>
          + regra de cor
        </button>
      </div>
    </Section>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section aria-label="Regras de cor da classificação de risco" style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</section>;
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
const card: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 10, border: "1px solid var(--rule)", borderRadius: 8 };
