// Painel de vacinação (módulo 29; F-29.8; D13/V14). municipal_admin e analyst. Só contagens, sem pessoa e sem trilha: STATIC_QUERY, sem
// polling. "Ver painel" lê o mês e a unidade pedidos. Contagem pequena vem `null` com `suppressed: true`: mostra "menos de 5" e nunca soma
// nem calcula porcentagem com null. `unchecked_cards` vale para a cidade toda, mesmo com a unidade filtrada. `rnds.late > 0` é um aviso
// (V8): o municipal_admin não entra nas pendências da sala.
import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getVaccinationDashboard, listAllUnits, type VaccinationDashboard } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtNumber } from "../lib/format";
import { STATIC_QUERY, VAC_DASHBOARD_KEY, currentMonth, monthProblem, vaccinationError } from "../lib/vaccination";
import { DataTable } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { StatTile } from "../components/StatTile";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { VaccinationGate } from "./vaccination/VaccinationGate";

export const SMALL_COUNT = "menos de 5";
export const LATE_WARNING = "Há doses fora do prazo de 24 h para a RNDS — a equipe da sala precisa resolver as pendências.";
export const UNCHECKED_SCOPE = "vale para a cidade toda, não só para a unidade escolhida";

const count = (n: number | null): string => (n === null ? SMALL_COUNT : fmtNumber(n));
export function coveragePercent(complete: number | null, eligible: number | null): string {
  if (complete === null || eligible === null || eligible <= 0) return "—";
  return `${((complete / eligible) * 100).toFixed(1).replace(".", ",")}%`;
}

export function VaccinationPanel({ today }: { today?: string } = {}) {
  return (
    <VaccinationGate title="Painel de vacinação" sub="doses, cobertura do C2, envio à RNDS e perdas" allow={(r) => r.admin || r.analyst}>
      {() => <PanelBody today={today} />}
    </VaccinationGate>
  );
}

function PanelBody({ today }: { today?: string }) {
  const uid = useId();
  const [ month, setMonth ] = useState(() => currentMonth(today ?? todayInCity()));
  const [ unit, setUnit ] = useState("");
  const [ requested, setRequested ] = useState<{ month: string; unit: string } | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const units = useQuery({ queryKey: [ "allUnits" ], queryFn: listAllUnits, ...STATIC_QUERY });
  const dash = useQuery({
    queryKey: [ VAC_DASHBOARD_KEY, requested?.month, requested?.unit ],
    queryFn: () => getVaccinationDashboard({ month: (requested as { month: string }).month, healthUnitId: requested?.unit || null }),
    enabled: requested !== null, ...STATIC_QUERY
  });

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const found = monthProblem(month, today ?? todayInCity());
    setProblem(found);
    if (found) { field.current?.focus(); return; }
    if (requested && requested.month === month && requested.unit === unit) void dash.refetch();
    else setRequested({ month, unit });
  }

  return (
    <div style={stack}>
      <form aria-label="Escolher o mês e a unidade" style={row} onSubmit={submit} noValidate>
        <div style={fieldLabel}>
          <label htmlFor={`${uid}-month`}>Mês</label>
          <input ref={field} id={`${uid}-month`} type="month" style={inputStyle} value={month}
            {...(problem ? { "aria-invalid": true, "aria-describedby": `${uid}-err` } : {})}
            onChange={(e) => { setMonth(e.target.value); setProblem(null); }} />
        </div>
        {units.data && (
          <div style={fieldLabel}>
            <label htmlFor={`${uid}-unit`}>Unidade</label>
            <select id={`${uid}-unit`} style={inputStyle} value={unit} onChange={(e) => setUnit(e.target.value)}>
              <option value="">Todas as unidades</option>
              {units.data.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        )}
        <button type="submit" style={buttonStyle}>Ver painel</button>
      </form>
      {problem && <p id={`${uid}-err`} role="alert" style={alert}>{problem}</p>}
      {requested !== null && dash.isFetching && !dash.data && <p className="mono" style={muted}>carregando…</p>}
      {dash.isError && !dash.data && <p role="alert" style={alert}>{vaccinationError(dash.error)}</p>}
      {dash.data && <DashboardView data={dash.data} unitFiltered={!!requested?.unit} />}
    </div>
  );
}

function DashboardView({ data, unitFiltered }: { data: VaccinationDashboard; unitFiltered: boolean }) {
  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Mês: ${data.month}`}</p>
      {data.rnds.late > 0 && (
        <p role="alert" style={{ ...alert, border: "1px solid var(--warn)", padding: "8px 12px", borderRadius: "var(--radius-panel)" }}>
          {`${LATE_WARNING} (${fmtNumber(data.rnds.late)})`}
        </p>
      )}
      <section aria-label="Indicadores" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <StatTile label="Doses na fila da RNDS" value={data.rnds.pending} />
        <StatTile label="Paradas por cadastro" value={data.rnds.blocked} />
        <StatTile label="Recusadas pela RNDS" value={data.rnds.rejected} />
        <StatTile label="Fora do prazo de 24 h" value={data.rnds.late} tone={data.rnds.late > 0 ? "warn" : undefined} />
        <StatTile label="Perda técnica (doses)" value={data.losses.technical} />
        <StatTile label="Perda física (doses)" value={data.losses.physical} />
        <StatTile label="Cadernetas não conferidas" value={data.unchecked_cards} hint={unitFiltered ? UNCHECKED_SCOPE : undefined} />
      </section>
      {unitFiltered && <p style={muted}>{`Cadernetas não conferidas: ${UNCHECKED_SCOPE}.`}</p>}
      {data.suppressed && <p style={muted}>Contagens de 1 a 4 aparecem como "menos de 5", para não identificar pessoas.</p>}
      <Panel title="Doses aplicadas por vacina e sala">
        <DataTable<VaccinationDashboard["doses_by_immunobiological"][number]>
          cols={[
            { label: "Vacina", w: "1.4fr", card: "title", render: (r) => r.immunobiological.name ?? r.immunobiological.code },
            { label: "Sala", w: "1.4fr", render: (r) => r.room.name },
            { label: "Doses", w: "0.8fr", align: "right", render: (r) => <span className="mono">{count(r.count)}</span> }
          ]}
          rows={data.doses_by_immunobiological} rowKey={(r, i) => `${r.immunobiological.code}-${r.room.id}-${i}`} empty="nenhuma dose aplicada neste mês" />
      </Panel>
      <Panel title="Cobertura das vacinas do C2 por equipe" sub="completas / elegíveis">
        <DataTable<VaccinationDashboard["c2_coverage_by_team"][number]>
          cols={[
            { label: "Equipe", w: "1.4fr", card: "title", render: (r) => r.team.name },
            { label: "Completas / elegíveis", w: "1fr", align: "right", render: (r) => (
              <span className="mono">{r.eligible === null || r.complete === null ? SMALL_COUNT : `${fmtNumber(r.complete)} / ${fmtNumber(r.eligible)}`}</span>
            ) },
            { label: "Cobertura", w: "0.8fr", align: "right", render: (r) => <span className="mono">{coveragePercent(r.complete, r.eligible)}</span> }
          ]}
          rows={data.c2_coverage_by_team} rowKey={(r) => r.team.id} empty="nenhuma equipe com crianças elegíveis" />
      </Panel>
    </div>
  );
}
