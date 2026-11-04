// Módulo 30 (F-30.3): pendências das séries (dias que a rotina não conseguiu pôr em viagem) e faltas por paciente num período.
// O paciente da pendência vem da lista de séries (pelo `series_id`). A pendência se resolve em "Viagens do dia". As faltas não mostram
// destino de tratamento. Sem atualização automática: o painel lê ao abrir e ao trocar o período.
import { useState, type FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { listNoShows, listSeries, listTransportPending, type NoShowRow, type TransportPendingItem } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { NO_NAME } from "../lib/territoryRegistry";
import { NOMINAL_QUERY, TR_NO_SHOWS_KEY, TR_PENDING_KEY, TR_SERIES_KEY, fmtIsoDay, pendingReasonLabel, transportError } from "../lib/transport";
import { DataTable, type Column } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { buttonStyle, inputStyle } from "../components/formStyles";
import { alert, fieldLabel, muted, row, stack } from "./exams/styles";
import { TransportGate } from "./transport/TransportGate";

export { pendingReasonLabel };
export const PENDING_HOW = 'Ponha o paciente numa viagem do dia em "Viagens do dia" ou crie uma viagem nova; resolva em "Viagens do dia".';
const DAY_MS = 86_400_000;
const MAX_SPAN_DAYS = 365;

const utc = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);
const addDays = (iso: string, n: number): string => new Date(utc(iso) + n * DAY_MS).toISOString().slice(0, 10);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function TransportPending({ today }: { today?: string }) {
  return (
    <TransportGate title="Pendências e faltas" sub="Séries sem vaga e faltas por paciente" area="transport" allow={(r) => r.dispatcher}>
      {() => (
        <div style={stack}>
          <PendingPanel />
          <NoShowsPanel today={today ?? todayInCity()} />
        </div>
      )}
    </TransportGate>
  );
}

function PendingPanel() {
  const pending = useQuery({ queryKey: [ TR_PENDING_KEY ], queryFn: () => listTransportPending(), ...NOMINAL_QUERY });
  const series = useQuery({ queryKey: [ TR_SERIES_KEY ], queryFn: () => listSeries(), ...NOMINAL_QUERY });
  const byId = new Map((series.data ?? []).map((s) => [ s.id, s ]));
  const cols: Column<TransportPendingItem>[] = [
    { label: "Data", w: "0.8fr", render: (p) => fmtIsoDay(p.date) },
    { label: "Paciente", w: "1.4fr", card: "title", render: (p) => {
      const s = byId.get(p.series_id);
      return s ? s.patient.display_name ?? NO_NAME : `série ${p.series_id}`;
    } },
    { label: "Destino", w: "1fr", render: (p) => byId.get(p.series_id)?.destination.name ?? "—" },
    { label: "Motivo", w: "1.6fr", render: (p) => pendingReasonLabel(p.reason) }
  ];
  return (
    <Panel title="Pendências das séries" sub="dias das próximas três semanas sem lugar">
      <div style={stack}>
        <p style={muted}>{PENDING_HOW}</p>
        {pending.isError ? <p role="alert" style={alert}>{transportError(pending.error)}</p> : (
          <DataTable cols={cols} rows={pending.data ?? []} rowKey={(p, i) => `${p.series_id}-${p.date}-${i}`} empty={pending.isPending ? "carregando…" : "Nenhuma pendência."} />
        )}
      </div>
    </Panel>
  );
}

function NoShowsPanel({ today }: { today: string }) {
  const [ from, setFrom ] = useState(addDays(today, -30));
  const [ to, setTo ] = useState(today);
  const [ applied, setApplied ] = useState({ from: addDays(today, -30), to: today });
  const [ problem, setProblem ] = useState<string | null>(null);
  const shows = useQuery({ queryKey: [ TR_NO_SHOWS_KEY, applied.from, applied.to ], queryFn: () => listNoShows(applied), ...NOMINAL_QUERY });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!DATE.test(from) || !DATE.test(to)) { setProblem("informe o início e o fim do período"); return; }
    if (to < from) { setProblem("o fim não pode ser antes do início"); return; }
    if ((utc(to) - utc(from)) / DAY_MS > MAX_SPAN_DAYS - 1) { setProblem("o período tem de ter menos de 366 dias"); return; }
    setProblem(null); setApplied({ from, to });
  }

  const cols: Column<NoShowRow>[] = [
    { label: "Paciente", w: "1.4fr", card: "title", render: (n) => n.patient.display_name ?? NO_NAME },
    { label: "Faltas", w: "0.6fr", render: (n) => n.count },
    { label: "Datas", w: "2fr", render: (n) => n.dates.map(fmtIsoDay).join(", ") }
  ];
  return (
    <Panel title="Faltas" sub="pacientes que faltaram em viagens concluídas">
      <div style={stack}>
        <form aria-label="Período das faltas" noValidate style={{ ...row, alignItems: "flex-end" }} onSubmit={submit}>
          <label style={fieldLabel}>De<input type="date" value={from} style={inputStyle} onChange={(e) => setFrom(e.target.value)} /></label>
          <label style={fieldLabel}>Até<input type="date" value={to} style={inputStyle} onChange={(e) => setTo(e.target.value)} /></label>
          <button type="submit" style={buttonStyle}>Ver faltas</button>
        </form>
        {problem && <p role="alert" style={alert}>{problem}</p>}
        {shows.isError ? <p role="alert" style={alert}>{transportError(shows.error)}</p> : (
          <DataTable cols={cols} rows={shows.data ?? []} rowKey={(n) => n.patient.id} empty={shows.isPending ? "carregando…" : "Nenhuma falta no período."} />
        )}
      </div>
    </Panel>
  );
}
