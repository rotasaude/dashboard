// Plano de tratamento ao lado do odontograma (F-28.4). A situação de cada item vem do rascunho (`planItemsAfter`);
// a sugestão de "tratamento concluído" e as regras de quem inclui/cancela ficam em `lib/dental`.
import { useState } from "react";
import type { DentalFields, DentalPlan, DentalRole } from "../../lib/api";
import { canAddPlanItems, locationLabel, planItemsAfter, reasonProblem, suggestCompleted, withPlanCancel, withoutPlanChange, type PlanItemState } from "../../lib/dental";
import { Tag } from "../../components/Tag";
import { buttonStyle, inputStyle, secondaryButtonStyle } from "../../components/formStyles";
import { alert, box, fieldLabel, muted, row } from "../exams/styles";

interface Props {
  plan: DentalPlan | null;
  value: DentalFields;
  unit: { kind: string };
  role: DentalRole;
  readOnly?: boolean;
  onChange(f: DentalFields): void;
  onMarkCompleted(): void;
}

const STATE: Record<PlanItemState, { label: string; tone: string }> = {
  planned: { label: "planejado", tone: "info" },
  done_here: { label: "feito nesta consulta", tone: "ok" },
  cancelled_here: { label: "cancelado nesta consulta", tone: "warn" },
  done: { label: "feito", tone: "ok" },
  cancelled: { label: "cancelado", tone: "neutral" }
};

export function TreatmentPlanPanel({ plan, value, unit, role, readOnly = false, onChange, onMarkCompleted }: Props) {
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const isDentist = role === "dentist" && !readOnly;
  const completedMarked = value.dental_outcomes.includes("15");

  function close() { setCancelling(null); setReason(""); setProblem(null); }
  function confirm(itemId: string) {
    const p = reasonProblem(reason);
    if (p) { setProblem(p); return; }
    onChange(withPlanCancel(value, { item_id: itemId, reason: reason.trim() }));
    close();
  }

  return (
    <aside aria-label="Plano de tratamento" style={{ ...box, minWidth: 240 }}>
      <h3 style={{ margin: 0, fontSize: 14 }}>Plano de tratamento</h3>
      {!plan && (
        <>
          <p style={muted}>Sem plano aberto nesta unidade.</p>
          {role === "dentist" && unit.kind !== "ceo" && !canAddPlanItems(unit, plan, value, role) && (
            <p style={muted}>O plano começa na primeira consulta programática.</p>
          )}
        </>
      )}
      {plan && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 8 }}>
          {planItemsAfter(plan, value).map(({ item, state }) => (
            <li key={item.id} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 12.5 }}>
                <span className="mono">{item.sigtap}</span> {item.name}
              </span>
              <span style={row}>
                <span style={muted}>{locationLabel(item.location)}</span>
                <Tag tone={STATE[state].tone}>{STATE[state].label}</Tag>
              </span>
              {isDentist && state === "cancelled_here" && (
                <button type="button" style={secondaryButtonStyle} aria-label={`Desfazer cancelamento — ${item.name}`}
                  onClick={() => onChange(withoutPlanChange(value, "cancel", value.plan_changes.cancel.findIndex((c) => c.item_id === item.id)))}>Desfazer cancelamento</button>
              )}
              {isDentist && state === "planned" && cancelling !== item.id && (
                <button type="button" style={secondaryButtonStyle} aria-label={`Cancelar item — ${item.name}`}
                  onClick={() => { setCancelling(item.id); setReason(""); setProblem(null); }}>Cancelar item</button>
              )}
              {isDentist && cancelling === item.id && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <label style={fieldLabel}>
                    Motivo do cancelamento
                    <textarea rows={2} value={reason} style={inputStyle} onChange={(e) => setReason(e.target.value)} />
                  </label>
                  {problem && <p role="alert" style={alert}>{problem}</p>}
                  <span style={row}>
                    <button type="button" style={buttonStyle} onClick={() => confirm(item.id)}>Confirmar cancelamento</button>
                    <button type="button" style={secondaryButtonStyle} onClick={close}>Voltar</button>
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {value.plan_changes.add.map((a, i) => (
        <div key={`add-${i}`} style={row}>
          <span style={{ fontSize: 12.5 }}>{`novo — ${a.name ?? a.sigtap} · ${locationLabel(a.location)}`}</span>
          {!readOnly && (
            <button type="button" style={secondaryButtonStyle} aria-label={`Desfazer — ${a.name ?? a.sigtap}`}
              onClick={() => onChange(withoutPlanChange(value, "add", i))}>Desfazer</button>
          )}
        </div>
      ))}
      {completedMarked && plan && <p style={muted}>Tratamento concluído marcado — o plano fecha ao finalizar.</p>}
      {!completedMarked && suggestCompleted(plan, value) && (
        <>
          <p role="status" style={{ margin: 0, fontSize: 12.5 }}>
            Todos os itens do plano estão feitos ou cancelados. Marque o desfecho "Tratamento concluído".
          </p>
          {isDentist && <button type="button" style={buttonStyle} onClick={onMarkCompleted}>Marcar tratamento concluído</button>}
        </>
      )}
    </aside>
  );
}
