// Módulo 31 — F-31.8: painel do CAPS (Task 14; P52, preflight R6 e R7). Portão sem CAPS (`unit="none"`): o painel lê os CAPS que o
// papel alcança (`listPsyUnits`: a coordenação só os de lotação; gestão e analista todos os ativos) e oferece "Todos os CAPS" ou um.
// Só contagens: de 1 a 4 chega "lt5" e aparece "menos de 5", nunca calculado nem somado (a tela não faz total). A ocupação dos leitos
// é `nights / bed_days` só com os dois em número. O nome do CAPS aparece só na linha por unidade (agregado, não nominal; P46). O rótulo
// do destino vem do mapa local (R6: gestão e analista não leem `options`); código desconhecido aparece cru. STATIC_QUERY, sem polling;
// a chave leva o CAPS escolhido (ou "all") e o mês. O painel não grava trilha (é do api).
import { useId, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getPsyDashboard, listPsyUnits, type PsyCount, type PsyDashboard } from "../lib/api";
import { useAuth } from "../lib/auth";
import { todayInCity } from "../lib/campaigns";
import { fmtNumber } from "../lib/format";
import { monthLabel } from "../lib/regulation";
import {
  NO_ACTIVE_CAPS, NO_CAPS_UNIT, PSY_DASHBOARD_KEY, PSY_UNITS_KEY, STATIC_QUERY, countLabel, destinationLabel, instrumentLabel, modalityLabel,
  monthStatusLabel, psyError, recentMonths, type PsyRoles
} from "../lib/psychosocial";
import { DataTable } from "../components/DataTable";
import { EmptyState } from "../components/EmptyState";
import { Panel } from "../components/Panel";
import { StatTile } from "../components/StatTile";
import { inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { PsychosocialGate } from "./psychosocial/PsychosocialGate";

export type CapsPanelProps = { today?: string };

export const NO_BEDS = "sem leitos";
export const OCCUPANCY_NOT_COMPUTED = "não calculada";
export const PANEL_SMALL_NOTE = "Contagens de 1 a 4 aparecem como “menos de 5”.";
export const PANEL_OVERDUE_NOTE = "PTS vencidos é a situação de hoje, qualquer que seja o mês escolhido.";
const INSTRUMENTS = [ "raas_psi", "bpa_c", "bpa_i" ];
const RAAS_STATES = [ "open", "closed", "exported", "no_actions" ];
const raasStateLabel = (k: string): string => (k === "no_actions" ? "sem ação no mês" : monthStatusLabel(k));

// Nunca calcula com "lt5" (o número escondido voltaria pela conta); sem leito-dia, não há leito.
export function occupancyText31(b: { nights: PsyCount; bed_days: PsyCount }): string {
  if (b.bed_days === 0) return NO_BEDS;
  if (typeof b.nights !== "number" || typeof b.bed_days !== "number") return OCCUPANCY_NOT_COMPUTED;
  return `${fmtNumber(Math.round((b.nights / b.bed_days) * 100))}%`;
}

export function CapsPanel({ today }: CapsPanelProps) {
  return (
    <PsychosocialGate title="Painel do CAPS" sub="Matrículas, PTS, ações, leitos e RAAS do mês" unit="none" allow={(r) => r.lead || r.admin || r.analyst}>
      {({ roles }) => <PanelBody roles={roles} today={today} />}
    </PsychosocialGate>
  );
}

function PanelBody({ roles, today }: { roles: PsyRoles; today?: string }) {
  const uid = useId();
  const { user } = useAuth();
  const months = recentMonths(today ?? todayInCity());
  const [ month, setMonth ] = useState(months[0]);
  const [ unitId, setUnitId ] = useState("");
  const units = useQuery({ queryKey: [ PSY_UNITS_KEY, user?.id ], queryFn: listPsyUnits, ...STATIC_QUERY });
  const hasUnits = (units.data ?? []).length > 0;
  const dash = useQuery({
    queryKey: [ PSY_DASHBOARD_KEY, unitId || "all", month ],
    queryFn: () => getPsyDashboard({ month, unitId: unitId || null }),
    enabled: hasUnits, ...STATIC_QUERY
  });
  // O mês escolhido continua na lista mesmo que a virada do mês o tire das 13.
  const choices = months.includes(month) ? months : [ ...months, month ];

  if (units.isPending) return <p className="mono" style={muted}>carregando…</p>;
  if (units.isError && !units.data) return <p role="alert" style={alert}>{psyError(units.error)}</p>;
  if (!hasUnits) return <EmptyState title={roles.admin || roles.analyst ? NO_ACTIVE_CAPS : NO_CAPS_UNIT} />;

  return (
    <div style={stack}>
      <div style={row}>
        <div style={fieldLabel}>
          <label htmlFor={`${uid}-month`}>Mês</label>
          <select id={`${uid}-month`} value={month} style={inputStyle} onChange={(e) => setMonth(e.target.value)}>
            {choices.map((m) => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>
        </div>
        <div style={fieldLabel}>
          <label htmlFor={`${uid}-caps`}>CAPS do painel</label>
          <select id={`${uid}-caps`} value={unitId} style={inputStyle} onChange={(e) => setUnitId(e.target.value)}>
            <option value="">Todos os CAPS</option>
            {(units.data ?? []).map((u) => <option key={u.id} value={u.id}>{`${u.name} · ${modalityLabel(u.caps_modality)}`}</option>)}
          </select>
        </div>
      </div>
      {dash.isPending && <p className="mono" style={muted}>carregando…</p>}
      {dash.isError && <p role="alert" style={alert}>{psyError(dash.error)}</p>}
      {dash.data && !dash.isError && <DashboardView data={dash.data} />}
    </div>
  );
}

type CountRow = { key: string; label: string; count: PsyCount };
const countCol = { label: "Quantidade", w: "0.8fr", align: "right" as const, render: (r: CountRow) => <span className="mono">{countLabel(r.count)}</span> };
const rowsOf = (map: Record<string, PsyCount>, known: string[], label: (k: string) => string): CountRow[] => {
  const extra = Object.keys(map).filter((k) => !known.includes(k)).sort();
  return [ ...known.filter((k) => k in map), ...extra ].map((key) => ({ key, label: label(key), count: map[key] }));
};

function CountTable({ title, head, rows }: { title: string; head: string; rows: CountRow[] }) {
  return (
    <Panel title={title}>
      <DataTable<CountRow>
        cols={[ { label: head, w: "1.6fr", card: "title", render: (r) => r.label }, countCol ]}
        rows={rows} rowKey={(r) => r.key} empty="nada no mês" />
    </Panel>
  );
}

function DashboardView({ data }: { data: PsyDashboard }) {
  const active: CountRow[] = data.enrollments_active.map((u) => ({
    key: u.health_unit_id, label: `${u.name} · ${modalityLabel(u.caps_modality)}`, count: u.count
  }));
  const destinations = rowsOf(data.closed_by_destination, [], destinationLabel);
  const instruments = rowsOf(data.actions_by_instrument as unknown as Record<string, PsyCount>, INSTRUMENTS, instrumentLabel);
  const raas = rowsOf(data.raas_month as unknown as Record<string, PsyCount>, RAAS_STATES, raasStateLabel);
  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Mês: ${monthLabel(data.month)}`}</p>
      <section aria-label="Indicadores" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <StatTile label="Matrículas novas no mês" value={countLabel(data.new_in_month)} />
        <StatTile label="PTS vencidos" value={countLabel(data.care_plans_overdue)} />
        <StatTile label="Ocupação dos leitos" value={occupancyText31(data.bed_occupancy)} />
        <StatTile label="Noites no acolhimento noturno" value={countLabel(data.bed_occupancy.nights)} />
        <StatTile label="Leitos-dia" value={countLabel(data.bed_occupancy.bed_days)} />
      </section>
      <p style={muted}>{PANEL_SMALL_NOTE}</p>
      <p style={muted}>{PANEL_OVERDUE_NOTE}</p>
      <CountTable title="Matrículas ativas por CAPS" head="CAPS" rows={active} />
      <CountTable title="Encerradas por destino" head="Destino" rows={destinations} />
      <CountTable title="Ações por instrumento" head="Instrumento" rows={instruments} />
      <CountTable title="RAAS do mês" head="Situação" rows={raas} />
    </div>
  );
}
