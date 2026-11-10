// Módulo 32a — F-32.4: "Retornos pedidos pela urgência" no Atendimento da UBS (contrato §7 e §14 Q11, Q20; preflight A10, C-T13).
// As altas com retorno à UBS dos últimos 60 dias, sem o motivo (Q20: o motivo fica na linha do tempo do paciente). Cada item é lido
// campo a campo, nunca espalhado: um `reason` que chegasse não aparece. Lida ao abrir a tela e no "Atualizar", sem polling, sem
// releitura no foco e fora do cache ao sair (NOMINAL_QUERY: a lista tem nome de paciente). Só na UBS (nunca na UPA, no CAPS nem em outra unidade); só com a urgência
// utilizável. O papel e o vínculo (recepção, ou profissional com vínculo ativo na unidade) são conferidos por quem monta.
import { useQuery } from "@tanstack/react-query";
import { listCounterReferrals, type CounterReferral, type HealthUnit } from "../../lib/api";
import { fmtDay } from "../../lib/audiencePhrase";
import { useAuth } from "../../lib/auth";
import { fmtDateTime } from "../../lib/format";
import { COUNTER_REFERRALS_KEY, NOMINAL_QUERY, canUseUrgency, urgencyError } from "../../lib/urgency";
import { DataTable, type Column } from "../../components/DataTable";
import { secondaryButtonStyle } from "../../components/formStyles";
import { alert, muted, panel, row } from "../exams/styles";

export const COUNTER_REFERRALS_TITLE = "Retornos pedidos pela urgência";
export const COUNTER_REFERRALS_NOTE = "O motivo está na linha do tempo do paciente.";
export const COUNTER_REFERRALS_EMPTY = "nenhum retorno pedido pela urgência nos últimos 60 dias";
export const dueText = (item: Pick<CounterReferral, "due_on">): string => `procurar a UBS até ${fmtDay(item.due_on)}`;

type Row = Pick<CounterReferral, "encounter_id" | "closed_at" | "return_days" | "due_on"> & { patientName: string; upaName: string };

// Campo a campo: só o que a lista mostra.
const toRow = (i: CounterReferral): Row => ({
  encounter_id: i.encounter_id, patientName: i.patient.name, upaName: i.upa.name, closed_at: i.closed_at, return_days: i.return_days,
  due_on: i.due_on
});

const COLS: Column<Row>[] = [
  { label: "Paciente", w: "1.6fr", card: "title", render: (r) => r.patientName },
  { label: "UPA", w: "1.2fr", render: (r) => r.upaName },
  { label: "Alta em", w: "1fr", render: (r) => <span className="mono">{fmtDateTime(r.closed_at)}</span> },
  { label: "Retorno", w: "1.4fr", render: (r) => dueText(r) }
];

export function CounterReferrals({ unit }: { unit: HealthUnit }) {
  const { user } = useAuth();
  const usable = canUseUrgency(user) && unit.kind === "ubs";
  if (!usable) return null;
  return <CounterReferralList unit={unit} />;
}

function CounterReferralList({ unit }: { unit: HealthUnit }) {
  const query = useQuery({
    queryKey: [ COUNTER_REFERRALS_KEY, unit.id ], queryFn: () => listCounterReferrals(unit.id), ...NOMINAL_QUERY
  });
  return (
    <section aria-label={COUNTER_REFERRALS_TITLE} style={panel}>
      <div style={row}>
        <strong style={{ flex: 1 }}>{COUNTER_REFERRALS_TITLE}</strong>
        <button type="button" style={secondaryButtonStyle} disabled={query.isFetching} onClick={() => void query.refetch()}>Atualizar</button>
      </div>
      <p style={muted}>{COUNTER_REFERRALS_NOTE}</p>
      {query.isPending && <p className="mono" style={muted}>carregando…</p>}
      {query.isError && <p role="alert" style={alert}>{urgencyError(query.error)}</p>}
      {query.data && !query.isError && (
        <DataTable<Row> label={COUNTER_REFERRALS_TITLE} cols={COLS} rows={query.data.map(toRow)} rowKey={(r) => r.encounter_id}
          empty={COUNTER_REFERRALS_EMPTY} />
      )}
    </section>
  );
}
