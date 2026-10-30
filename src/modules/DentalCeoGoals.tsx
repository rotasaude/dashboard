// Metas do CEO (módulo 28, F-28.8): meta mensal por especialidade, composição, faltas em 12 meses e risco de
// suspensão. Só contagens — nenhuma pessoa, nenhuma trilha: leitura estática (ao abrir e ao filtrar), sem polling.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCeoGoals, listCeoProfiles, type CeoGoalRow, type CeoGoals } from "../lib/api";
import { CEO_GOALS_KEY, CEO_PROFILES_KEY, STATIC_QUERY, compositionLabel, dentalError, goalKeyLabel, monthOf, percentLabel } from "../lib/dental";
import { DataTable, type Column } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { Tag } from "../components/Tag";
import { EmptyState } from "../components/EmptyState";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { todayInCity } from "../lib/campaigns";
import { DentalGate } from "./dental/DentalGate";

export const SUSPENSION_TEXT = "Risco de suspensão do incentivo: meta não atingida 2 meses seguidos ou 3 em 12 meses em alguma especialidade.";

const RULE_SHORT: Record<string, string> = { restorations_min_50: "restaurações ≥ 50%", three_roots_min_20: "dentes com 3+ raízes ≥ 20%" };
function compositionText(c: NonNullable<CeoGoalRow["composition"]>): string {
  const name = Object.prototype.hasOwnProperty.call(RULE_SHORT, c.rule) ? RULE_SHORT[c.rule] : compositionLabel(c.rule);
  return `${name}: ${percentLabel(c.value)} · ${c.ok ? "ok" : "abaixo"}`;
}
function missesText(m: { consecutive: number; total: number } | undefined): string {
  const c = m?.consecutive ?? 0;
  return `${c} ${c === 1 ? "seguida" : "seguidas"} · ${m?.total ?? 0} no total`;
}

export function DentalCeoGoals({ today }: { today?: string }) {
  return (
    <DentalGate title="Metas do CEO" sub="meta mensal por especialidade e risco de suspensão" allow={(r) => r.admin || r.analyst}>
      {() => <GoalsBody today={today} />}
    </DentalGate>
  );
}

function GoalsBody({ today }: { today?: string }) {
  const profiles = useQuery({ queryKey: [ CEO_PROFILES_KEY ], queryFn: listCeoProfiles, ...STATIC_QUERY });
  const [ unitChoice, setUnitChoice ] = useState("");
  const [ monthChoice, setMonthChoice ] = useState("");
  const list = profiles.data ?? [];
  const profile = list.find((p) => p.health_unit.id === unitChoice) ?? list[0];
  const month = monthChoice || monthOf(today ?? todayInCity());
  const unitId = profile?.health_unit.id ?? "";
  const typed = !!profile && profile.ceo_type !== null;
  const goals = useQuery({ queryKey: [ CEO_GOALS_KEY, unitId, month ], queryFn: () => getCeoGoals(unitId, month), enabled: typed && !!month, ...STATIC_QUERY });

  return (
    <div style={stack}>
      {profiles.isError && <p role="alert" style={alert}>{dentalError(profiles.error)}</p>}
      {profiles.data && list.length === 0 && <EmptyState title="Nenhuma unidade CEO cadastrada." />}
      {list.length > 0 && (
        <div style={row}>
          <label style={fieldLabel}>
            Unidade CEO
            <select value={profile?.health_unit.id ?? ""} style={inputStyle} onChange={(e) => setUnitChoice(e.target.value)}>
              {list.map((p) => <option key={p.health_unit.id} value={p.health_unit.id}>{p.health_unit.name}</option>)}
            </select>
          </label>
          <label style={fieldLabel}>
            Mês
            <input type="month" value={month} style={inputStyle} onChange={(e) => setMonthChoice(e.target.value)} />
          </label>
        </div>
      )}
      {profile && !typed && <p style={muted}>Defina o tipo do CEO em CEO e lista do TSB/ASB.</p>}
      {goals.isError && <p role="alert" style={alert}>{dentalError(goals.error)}</p>}
      {goals.data && <GoalsView goals={goals.data} />}
    </div>
  );
}

function GoalsView({ goals }: { goals: CeoGoals }) {
  const cols: Column<CeoGoalRow>[] = [
    { label: "Especialidade", w: "1.4fr", card: "title", render: (r) => goalKeyLabel(r.key) },
    { label: "Meta", w: "0.6fr", align: "right", render: (r) => String(r.goal) },
    { label: "Feito", w: "0.6fr", align: "right", render: (r) => String(r.done) },
    { label: "Composição", w: "2fr", render: (r) => (r.composition ? compositionText(r.composition) : "—") },
    { label: "Situação", w: "1fr", render: (r) => <Tag tone={r.met ? "ok" : "down"}>{r.met ? "atingida" : "não atingida"}</Tag> },
    { label: "Faltas em 12 meses", w: "1.4fr", render: (r) => missesText(goals.misses_last_12[r.key]) }
  ];
  const history = goals.history ?? [];
  const keys = goals.specialties.map((s) => s.key);
  return (
    <>
      {goals.suspension_risk && <p role="alert" style={riskStyle}>{SUSPENSION_TEXT}</p>}
      <Panel title="Metas do mês">
        <DataTable cols={cols} rows={goals.specialties} rowKey={(r) => r.key} empty="sem metas para este CEO" />
      </Panel>
      {history.length > 0 && (
        <Panel title="Últimos 12 meses">
          <DataTable
            cols={[
              { label: "Mês", w: "0.8fr", card: "title", render: (h: (typeof history)[number]) => h.month } as Column<(typeof history)[number]>,
              ...keys.map((k): Column<(typeof history)[number]> => ({
                label: goalKeyLabel(k), w: "1fr",
                render: (h) => { const s = h.specialties.find((x) => x.key === k); return s ? `${s.done} · ${s.met ? "✓" : "✗"}` : "—"; }
              }))
            ]}
            rows={history} rowKey={(h) => h.month}
          />
        </Panel>
      )}
    </>
  );
}

// Texto + borda: o risco nunca é só cor.
const riskStyle = { margin: 0, padding: 12, borderRadius: 8, border: "1px solid var(--down)", background: "var(--sunken)", color: "var(--down)", fontSize: 12.5, fontWeight: 600 } as const;
