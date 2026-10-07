// src/modules/protocolEditor/RiskRulesPanel.tsx
// Painel "Regras de cor" do protocolo de acolhimento (módulo 18; spec §3.3).
// Lê `risk_rules` da definição a cada render e devolve uma definição nova a
// cada edição, como o painel "Agendamento". Conteúdo assinado (ADR 0016).
import type { CSSProperties, ReactNode } from "react";
import type { ScreeningColor } from "../../lib/api";
import { ConditionBuilder } from "../protocols/ConditionBuilder";
import { fieldsFor } from "../../lib/condition";
import { COLORS, COLOR_HINT, COLOR_LABEL } from "../../lib/screening";
import { RISK_RULES_MAX, readRiskRules, riskRuleProblem, writeRiskRules, type RiskRuleDraft } from "../../lib/riskRules";
import { disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

interface Props { definition: unknown | null; onChange(next: unknown): void }

export function RiskRulesPanel({ definition, onChange }: Props) {
  if (definition === null) return <Section><p style={hint}>Corrija o JSON para editar as regras de cor.</p></Section>;
  const read = readRiskRules(definition);
  if (!read.ok) return <Section><p role="alert" style={alert}>{read.reason}</p></Section>;
  const rules = read.rules;
  const fields = fieldsFor("screening");
  const setRules = (list: RiskRuleDraft[]) => onChange(writeRiskRules(definition, list));
  const replace = (i: number, next: RiskRuleDraft) => setRules(rules.map((r, j) => (j === i ? next : r)));

  return (
    <Section>
      <p style={hint}>
        Vale a cor mais grave entre as regras que casarem (vermelho, amarelo, verde, azul). É só sugestão: a cor final é de quem escuta.
      </p>
      {rules.length === 0 && <p role="alert" style={alert}>Inclua ao menos uma regra de cor.</p>}
      {rules.map((r, i) => {
        const problem = riskRuleProblem(r);
        return (
          <div key={i} role="group" aria-label={`regra de cor ${i + 1}`} style={card}>
            <label style={label}>
              Cor sugerida
              <select value={r.color} style={inputStyle} onChange={(e) => replace(i, { ...r, color: e.target.value as ScreeningColor })}>
                {COLORS.map((c) => <option key={c} value={c}>{`${COLOR_LABEL[c]} — ${COLOR_HINT[c]}`}</option>)}
              </select>
            </label>
            <ConditionBuilder label="Quando sugerir" fields={fields} value={r.when} emptyText="—"
              onChange={(tree) => replace(i, { ...r, when: tree })} />
            {problem && <small style={hint}>{problem}</small>}
            <div>
              <button type="button" style={secondaryButtonStyle} onClick={() => setRules(rules.filter((_, j) => j !== i))}>remover regra</button>
            </div>
          </div>
        );
      })}
      <div>
        <button type="button" disabled={rules.length >= RISK_RULES_MAX}
          style={rules.length >= RISK_RULES_MAX ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => setRules([ ...rules, { when: null, color: "yellow" } ])}>
          + regra de cor
        </button>
      </div>
    </Section>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section aria-label="Regras de cor" style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</section>;
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
const card: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 10, border: "1px solid var(--rule)", borderRadius: 8 };
