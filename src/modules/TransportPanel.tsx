// Painel de transporte e TFD (módulo 30; F-30.8). Só contagens e somas, sem pessoa nem destino de tratamento: STATIC_QUERY, sem polling.
// Contagem de 1 a 4 chega "lt5" e aparece como "menos de 5", nunca entra em soma (a tela não calcula total). Soma (km, R$) nunca vem
// suprimida. `occupancy_pct` é número ou null (sem viagem concluída), nunca "lt5". Status de TFD sem caso não vem na resposta: vale 0;
// status que a tela não conhece aparece cru. O bloco do TFD só existe com `canUseTfd`.
import { useId, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTransportDashboard, type TransportCount, type TransportDashboard } from "../lib/api";
import { useAuth } from "../lib/auth";
import { todayInCity } from "../lib/campaigns";
import { fmtNumber } from "../lib/format";
import { canUseTfd, tfdStatusLabel } from "../lib/tfd";
import { STATIC_QUERY, TR_DASHBOARD_KEY, fmtCents, fmtTransportCount } from "../lib/transport";
import { monthLabel } from "../lib/regulation";
import { currentMonth, monthProblem } from "../lib/vaccination";
import { DataTable } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { StatTile } from "../components/StatTile";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { TransportGate } from "./transport/TransportGate";

export const NO_TRIPS = "sem viagens concluídas";
const STATUSES = [ "submitted", "returned", "authorized", "denied", "scheduled", "travelling", "completed", "cancelled" ];
const SMALL_NOTE = "Contagens de 1 a 4 aparecem como 'menos de 5' para não identificar ninguém; elas nunca entram em soma.";

export function occupancyText30(v: number | null): string {
  return v === null ? NO_TRIPS : `${fmtNumber(v)}%`;
}

export function TransportPanel({ today }: { today?: string } = {}) {
  return (
    <TransportGate title="Painel de transporte e TFD" sub="Viagens, ocupação, faltas, km e TFD do mês" area="transport" allow={(r) => r.admin || r.dispatcher || r.committee}>
      {() => <PanelBody today={today} />}
    </TransportGate>
  );
}

function PanelBody({ today }: { today?: string }) {
  const uid = useId();
  const { user } = useAuth();
  const [ month, setMonth ] = useState(() => currentMonth(today ?? todayInCity()));
  const [ requested, setRequested ] = useState<string | null>(null);
  const [ problem, setProblem ] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const dash = useQuery({
    queryKey: [ TR_DASHBOARD_KEY, requested ],
    queryFn: () => getTransportDashboard(requested as string),
    enabled: requested !== null, ...STATIC_QUERY
  });

  function submit(e: { preventDefault(): void }) {
    e.preventDefault();
    const found = monthProblem(month, today ?? todayInCity());
    setProblem(found);
    if (found) { field.current?.focus(); return; }
    if (requested === month) void dash.refetch();
    else setRequested(month);
  }

  return (
    <div style={stack}>
      <form aria-label="Escolher o mês" style={row} onSubmit={submit} noValidate>
        <div style={fieldLabel}>
          <label htmlFor={`${uid}-month`}>Mês</label>
          <input ref={field} id={`${uid}-month`} type="month" style={inputStyle} value={month}
            {...(problem ? { "aria-invalid": true, "aria-describedby": `${uid}-err` } : {})}
            onChange={(e) => { setMonth(e.target.value); setProblem(null); }} />
        </div>
        <button type="submit" style={buttonStyle}>Ver painel</button>
      </form>
      {problem && <p id={`${uid}-err`} role="alert" style={alert}>{problem}</p>}
      {requested !== null && dash.isFetching && !dash.data && <p className="mono" style={muted}>carregando…</p>}
      {dash.isError && !dash.data && <p role="alert" style={alert}>não foi possível ler o painel agora</p>}
      {dash.data && <DashboardView data={dash.data} tfd={!!user && canUseTfd(user)} />}
    </div>
  );
}

interface StatusRow { status: string; count: TransportCount }

function DashboardView({ data, tfd }: { data: TransportDashboard; tfd: boolean }) {
  const byStatus = data.tfd_by_status as Record<string, TransportCount | undefined>;
  const extra = Object.keys(byStatus).filter((k) => !STATUSES.includes(k) && k !== "draft");
  const rows: StatusRow[] = [ ...STATUSES, ...extra ].map((status) => ({ status, count: byStatus[status] ?? 0 }));
  return (
    <div style={stack}>
      <p className="mono" style={muted}>{`Mês: ${monthLabel(data.month)}`}</p>
      <section aria-label="Indicadores" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 12 }}>
        <StatTile label="Viagens" value={fmtTransportCount(data.trips)} />
        <StatTile label="Ocupação" value={occupancyText30(data.occupancy_pct)} />
        <StatTile label="Faltas" value={fmtTransportCount(data.no_shows)} />
        <StatTile label="Km rodados" value={fmtNumber(data.km)} />
        <StatTile label="Combustível (R$)" value={fmtCents(data.fuel_cents)} />
        <StatTile label="Viagens sem atendimento marcado" value={fmtTransportCount(data.exceptions)} />
        {tfd && <StatTile label="Pago no TFD (R$)" value={fmtCents(data.tfd_paid_cents)} />}
      </section>
      <p style={muted}>{SMALL_NOTE}</p>
      {tfd && (
        <Panel title="TFD por situação">
          <DataTable<StatusRow>
            cols={[
              { label: "Situação", w: "1.4fr", card: "title", render: (r) => tfdStatusLabel(r.status) },
              { label: "Quantidade", w: "0.8fr", align: "right", render: (r) => <span className="mono">{fmtTransportCount(r.count)}</span> }
            ]}
            rows={rows} rowKey={(r) => r.status} empty="nenhum processo neste mês" />
        </Panel>
      )}
    </div>
  );
}
