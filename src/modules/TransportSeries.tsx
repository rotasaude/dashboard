// Módulo 30 (F-30.3): séries recorrentes (hemodiálise, radioterapia…). Lista, nova série, edição e suspensão.
// A suspensão é IRREVERSÍVEL no api (T33): a tela não oferece "retomar", diz "para retomar, crie uma série nova". Suspensão futura chega
// como `status: active` com `suspended_from`; a tela mostra "suspensa a partir de dd/mm/aaaa" pela data. Só o painel da central; nada clínico.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { listDestinations, listSeries, suspendSeries, type TransportSeries as Series } from "../lib/api";
import { todayInCity } from "../lib/campaigns";
import { fmtHourMinute } from "../lib/format";
import { NO_NAME } from "../lib/territoryRegistry";
import { NOMINAL_QUERY, STATIC_QUERY, TR_DESTINATIONS_KEY, TR_SERIES_KEY, fmtIsoDay, transportError, transportRefusals, weekdaysLabel } from "../lib/transport";
import { useActionMessage } from "../lib/useActionMessage";
import { ActionMessage } from "../components/ActionMessage";
import { DataTable, type Column } from "../components/DataTable";
import { Panel } from "../components/Panel";
import { SensitiveAction } from "../components/SensitiveAction";
import { Tag } from "../components/Tag";
import { secondaryButtonStyle } from "../components/formStyles";
import { alert, muted, stack } from "./exams/styles";
import { SeriesForm } from "./transport/SeriesForm";
import { TransportGate } from "./transport/TransportGate";

export const SERIES_RULE_NOTE = "As viagens das próximas três semanas são criadas todo dia de manhã; sem vaga em viagem confirmada, a série aparece em Pendências.";
export const RESUME_NOTE = "para retomar, crie uma série nova";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const REASON_TEXT = "o motivo tem de 10 a 500 caracteres";
class LocalRefusal extends Error {}

const hhmm = (t: string): string => (/^\d{2}:\d{2}/.test(t) ? t.slice(0, 5) : fmtHourMinute(t));

export function TransportSeries({ today, onGoToSecurity }: { today?: string; onGoToSecurity?: () => void }) {
  return (
    <TransportGate title="Séries recorrentes" sub="Hemodiálise, radioterapia e outros tratamentos contínuos" area="transport" allow={(r) => r.dispatcher}>
      {() => <SeriesBoard today={today ?? todayInCity()} onGoToSecurity={onGoToSecurity} />}
    </TransportGate>
  );
}

// Suspensa de fato (data de hoje ou passada) ou encerrada: não há o que suspender de novo.
const inEffect = (s: Series, today: string): boolean => s.status === "suspended" || (s.suspended_from !== null && s.suspended_from <= today);

function SeriesBoard({ today, onGoToSecurity }: { today: string; onGoToSecurity?: () => void }) {
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: [ TR_SERIES_KEY ], queryFn: () => listSeries(), ...NOMINAL_QUERY });
  const destinations = useQuery({ queryKey: [ TR_DESTINATIONS_KEY ], queryFn: () => listDestinations(), ...STATIC_QUERY });
  const [ editing, setEditing ] = useState<Series | "new" | null>(null);
  const [ suspending, setSuspending ] = useState<Series | null>(null);
  const msg = useActionMessage();
  const reload = () => queryClient.invalidateQueries({ queryKey: [ TR_SERIES_KEY ] });
  // Sem os destinos o seletor do formulário ficaria vazio: diz por quê e não oferece criar nem editar (A4).
  const destError = destinations.isError ? transportError(destinations.error) : null;
  const destBlocked = destError ? { disabled: true, "aria-describedby": "series-dest-error" } : {};

  function status(s: Series) {
    if (s.status === "ended") return <Tag>encerrada</Tag>;
    if (s.suspended_from) return <Tag tone="warn">{`suspensa a partir de ${fmtIsoDay(s.suspended_from)}`}</Tag>;
    if (s.status === "active") return <Tag tone="ok">ativa</Tag>;
    return <Tag>{s.status}</Tag>;
  }

  const cols: Column<Series>[] = [
    { label: "Paciente", w: "1.2fr", card: "title", render: (s) => s.patient.display_name ?? NO_NAME },
    { label: "Destino e prestador", w: "1.4fr", render: (s) => (
      <>
        <div>{s.provider_name ? `${s.destination.name} · ${s.provider_name}` : s.destination.name}</div>
        <div style={muted}>{`embarque: ${s.boarding_label} · volta ${hhmm(s.return_time)}${s.wheelchair ? " · cadeira de rodas" : ""}`}</div>
      </>
    ) },
    { label: "Quando", w: "1.6fr", render: (s) => `${weekdaysLabel(s.weekdays)} · atendimento ${hhmm(s.appointment_time)} · saída ${hhmm(s.departure_time)}` },
    { label: "Período", w: "1fr", render: (s) => (
      <>
        <div>{`desde ${fmtIsoDay(s.starts_on)}`}</div>
        {s.ends_on && <div>{`até ${fmtIsoDay(s.ends_on)}`}</div>}
      </>
    ) },
    { label: "Situação", w: "1.2fr", render: (s) => (
      <>
        {status(s)}
        {s.suspended_from && <div style={muted}>{RESUME_NOTE}</div>}
      </>
    ) },
    { label: "", w: "auto", card: "actions", render: (s) => {
      const name = s.patient.display_name ?? NO_NAME;
      const open = s.status !== "ended" && !inEffect(s, today);
      return (
        <>
          {open && <button type="button" style={secondaryButtonStyle} aria-label={`Editar a série de ${name}`} {...destBlocked} onClick={() => { msg.start(); setSuspending(null); setEditing(s); }}>Editar</button>}
          {open && (
            <button type="button" style={secondaryButtonStyle} aria-label={`${s.suspended_from ? "Antecipar a suspensão da série" : "Suspender a série"} de ${name}`}
              onClick={() => { msg.start(); setEditing(null); setSuspending(s); }}>{s.suspended_from ? "Antecipar suspensão" : "Suspender"}</button>
          )}
        </>
      );
    } }
  ];

  function run(s: Series) {
    return async (values: Record<string, string>) => {
      const from = (values.from_on ?? "").trim();
      const reason = (values.reason ?? "").trim();
      if (!DATE.test(from)) throw new LocalRefusal("informe a data no formato aaaa-mm-dd");
      if (from < today) throw new LocalRefusal("a data não pode ser anterior a hoje");
      if (s.suspended_from && from > s.suspended_from) throw new LocalRefusal(`a nova data tem de ser até ${fmtIsoDay(s.suspended_from)} (só dá para antecipar)`);
      if (reason.length < 10 || reason.length > 500) throw new LocalRefusal(REASON_TEXT);
      await suspendSeries(s.id, { from_on: from, reason });
    };
  }

  return (
    <Panel title="Séries" sub="tratamentos que se repetem nos mesmos dias" right={<button type="button" style={secondaryButtonStyle} {...destBlocked} onClick={() => { msg.start(); setSuspending(null); setEditing("new"); }}>Nova série</button>}>
      <div style={stack}>
        {destError && <p id="series-dest-error" role="alert" style={alert}>{`Não foi possível carregar os destinos: ${destError}`}</p>}
        <p style={muted}>{SERIES_RULE_NOTE}</p>
        <p style={muted}>{`Suspender é definitivo: ${RESUME_NOTE}.`}</p>
        {editing && !destError && (
          <SeriesForm key={editing === "new" ? "new" : editing.id} series={editing === "new" ? undefined : editing} destinations={destinations.data ?? []} today={today}
            onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); msg.ok("Série salva."); void reload(); }} />
        )}
        {suspending && (
          <SensitiveAction title={`Suspender a série de ${suspending.patient.display_name ?? NO_NAME}`} requiresStepUp={false} onGoToSecurity={onGoToSecurity}
            description="A série para de gerar viagens: o paciente sai das viagens a partir desta data; as viagens já feitas ficam como estão. Não dá para desfazer — para retomar, crie uma série nova."
            fields={[ { name: "from_on", label: "A partir de", required: true, placeholder: "aaaa-mm-dd" }, { name: "reason", label: "Motivo", required: true, multiline: true } ]}
            translateError={(err) => (err instanceof LocalRefusal ? err.message : transportRefusals(err)[0].text)}
            run={run(suspending)} onCancel={() => setSuspending(null)} onDone={() => { setSuspending(null); msg.ok("Série suspensa."); void reload(); }} />
        )}
        <ActionMessage message={msg.message} />
        {list.isError ? <p role="alert" style={alert}>{transportError(list.error)}</p> : (
          <DataTable cols={cols} rows={list.data ?? []} rowKey={(s) => s.id} empty={list.isPending ? "carregando…" : "Nenhuma série cadastrada."} />
        )}
      </div>
    </Panel>
  );
}
