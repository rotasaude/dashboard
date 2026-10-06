// src/modules/protocolEditor/SchedulingPanel.tsx
// Painel "Agendamento" (módulo 17; spec §5.1 e §7). Lê `scheduling` da
// definição a cada render e devolve uma definição nova a cada edição, como o
// painel "Oferta e sugestões". O conteúdo é parte da versão assinada (ADR 0016).
// `types` nulo = sem a lista de tipos (403 para quem chega ao editor sem um dos
// papéis que leem GET /professionals/appointment_types — municipal_admin,
// citizen_verifier, health_professional, protocol_author, protocol_reviewer —
// ou falha de rede): o tipo vira texto com o padrão da chave, e o gate avisa
// tipo inexistente. Tipo inativo ou desconhecido só avisa, nunca bloqueia.
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { AppointmentType, SchedulingPriority } from "../../lib/api";
import { ConditionBuilder } from "../protocols/ConditionBuilder";
import { fieldsFor } from "../../lib/condition";
import { PRIORITY_LABEL, typeLabel } from "../../lib/scheduling";
import {
  SCHEDULING_MAX, moveRule, parseDueDays, readScheduling, schedulingRuleProblem, writeScheduling, type SchedulingRuleDraft
} from "../../lib/schedulingRules";
import { disabledButtonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";

interface Props { definition: unknown | null; types: AppointmentType[] | null; onChange(next: unknown): void }

export function SchedulingPanel({ definition, types, onChange }: Props) {
  if (definition === null) return <Section><p style={hint}>Corrija o JSON para editar o agendamento.</p></Section>;
  const read = readScheduling(definition);
  if (!read.ok) return <Section><p role="alert" style={alert}>{read.reason}</p></Section>;
  return <SchedulingForm definition={definition} rules={read.rules} types={types} onChange={onChange} />;
}

function SchedulingForm({ definition, rules, types, onChange }: {
  definition: unknown; rules: SchedulingRuleDraft[]; types: AppointmentType[] | null; onChange(next: unknown): void;
}) {
  const fields = fieldsFor("suggestion", { definition });
  const setRules = (list: SchedulingRuleDraft[]) => onChange(writeScheduling(definition, list));
  const replace = (i: number, next: SchedulingRuleDraft) => setRules(rules.map((r, j) => (j === i ? next : r)));
  const activeTypes = (types ?? []).filter((t) => t.active);

  return (
    <Section>
      <p style={hint}>Vale a primeira regra que casar. Resultado urgente nunca gera pedido. Sem regra, a triagem só orienta.</p>
      {types === null && (
        <p style={hint}>Sem acesso à lista de tipos da cidade: digite a chave (o gate avisa se ela não existir).</p>
      )}
      {rules.map((r, i) => {
        const problem = schedulingRuleProblem(r, types);
        return (
          <div key={i} role="group" aria-label={`regra ${i + 1}`} style={card}>
            {types ? (
              <label style={label}>Tipo de atendimento
                <select value={r.appointmentType} style={inputStyle} onChange={(e) => replace(i, { ...r, appointmentType: e.target.value })}>
                  <option value="">escolha…</option>
                  {activeTypes.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                  {r.appointmentType !== "" && !activeTypes.some((t) => t.key === r.appointmentType) && (
                    <option value={r.appointmentType}>{typeLabel(r.appointmentType, types)}</option>
                  )}
                </select>
              </label>
            ) : (
              <label style={label}>Tipo de atendimento (chave)
                <input value={r.appointmentType} style={inputStyle} placeholder="consulta_medica"
                  onChange={(e) => replace(i, { ...r, appointmentType: e.target.value.trim() })} />
              </label>
            )}
            <label style={label}>Prioridade
              <select value={r.priority} style={inputStyle}
                onChange={(e) => replace(i, { ...r, priority: e.target.value as SchedulingPriority })}>
                <option value="routine">{PRIORITY_LABEL.routine}</option>
                <option value="priority">{PRIORITY_LABEL.priority}</option>
              </select>
            </label>
            <DueField days={r.dueInDays} onChange={(days) => replace(i, { ...r, dueInDays: days })} />
            <ConditionBuilder label="Quando gerar o pedido" fields={fields} value={r.when} emptyText="—"
              onChange={(tree) => replace(i, { ...r, when: tree })} />
            {problem && <small style={hint}>{problem}</small>}
            <div style={{ display: "flex", gap: 8 }}>
              <button type="button" style={secondaryButtonStyle} disabled={i === 0} onClick={() => setRules(moveRule(rules, i, -1))}>subir</button>
              <button type="button" style={secondaryButtonStyle} disabled={i === rules.length - 1}
                onClick={() => setRules(moveRule(rules, i, 1))}>descer</button>
              <button type="button" style={secondaryButtonStyle}
                onClick={() => setRules(rules.filter((_, j) => j !== i))}>remover regra</button>
            </div>
          </div>
        );
      })}
      <div>
        <button type="button" disabled={rules.length >= SCHEDULING_MAX}
          style={rules.length >= SCHEDULING_MAX ? disabledButtonStyle : secondaryButtonStyle}
          onClick={() => setRules([ ...rules, { when: null, appointmentType: "", priority: "routine", dueInDays: null } ])}>
          + regra de agendamento
        </button>
      </div>
    </Section>
  );
}

// Texto digitado fica local: só valor válido (ou vazio) chega ao JSON.
function DueField({ days, onChange }: { days: number | null; onChange(days: number | null): void }) {
  const [ text, setText ] = useState(days === null ? "" : String(days));
  useEffect(() => {
    if (parseDueDays(text).days !== days) setText(days === null ? "" : String(days));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ days ]);
  const { problem } = parseDueDays(text);
  return (
    <>
      <label style={label}>Prazo (dias)
        <input inputMode="numeric" value={text} style={inputStyle} onChange={(e) => {
          setText(e.target.value);
          const parsed = parseDueDays(e.target.value);
          if (!parsed.problem) onChange(parsed.days);
        }} />
      </label>
      {problem && <small role="alert" style={alert}>{problem}</small>}
    </>
  );
}

function Section({ children }: { children: ReactNode }) {
  return <section aria-label="Agendamento" style={{ display: "flex", flexDirection: "column", gap: 8 }}>{children}</section>;
}

const label: CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 12, color: "var(--ink2)" };
const hint: CSSProperties = { margin: 0, fontSize: 12, color: "var(--ink3)" };
const alert: CSSProperties = { margin: 0, fontSize: 12, color: "var(--down)" };
const card: CSSProperties = { display: "flex", flexDirection: "column", gap: 8, padding: 10, border: "1px solid var(--rule)", borderRadius: 8 };
