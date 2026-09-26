import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listUnitAgenda, type AgendaAppointment, type HealthUnit } from "../../lib/api";
import { ATTENDANCE_REFETCH_MS, attendanceError } from "../../lib/attendance";
import { fmtHourMinute } from "../../lib/format";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { inputStyle } from "../../components/formStyles";

// Agenda (Task 8) — horários de hoje na unidade (spec §6 "Agenda do dia").
// O seletor de data começa em hoje (fuso da cidade) mas deixa a recepção
// olhar outro dia.
interface Props {
  unit: HealthUnit;
}

// en-CA formata como YYYY-MM-DD — o mesmo formato do <input type="date">.
const isoDateFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit"
});
function todayIso(): string {
  return isoDateFmt.format(new Date());
}

function kindLabel(kind: AgendaAppointment["kind"]): string {
  return kind === "return" ? "Retorno" : "Encaminhamento";
}

const STATUS_LABEL: Record<string, string> = {
  scheduled: "aguardando confirmação",
  confirmed: "confirmado",
  checked_in: "check-in feito",
  cancelled_by_citizen: "cancelado pelo cidadão",
  expired: "sem confirmação no prazo",
  no_show: "faltou"
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function Agenda({ unit }: Props) {
  const [ date, setDate ] = useState(() => todayIso());
  const query = useQuery({ queryKey: [ "unitAgenda", unit.id, date ], queryFn: () => listUnitAgenda(unit.id, date),
    refetchInterval: ATTENDANCE_REFETCH_MS
  });
  const rows = query.data ?? [];

  return (
    <Panel
      title="Agenda do dia"
      right={
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink2)" }}>
          Data
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ ...inputStyle, width: "auto", marginTop: 0 }} />
        </label>
      }
    >
      {query.isError ? (
        <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{attendanceError(query.error)}</p>
      ) : query.isPending ? (
        <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="nenhum horário para este dia" />
      ) : (
        <DataTable<AgendaAppointment>
          cols={[
            { label: "Hora", w: "1fr", render: (r) => fmtHourMinute(r.scheduled_at) },
            { label: "CPF", w: "1.5fr", render: (r) => r.cpf_masked },
            { label: "Tipo", w: "1fr", render: (r) => kindLabel(r.kind) },
            { label: "Estado", w: "1.5fr", render: (r) => statusLabel(r.status) }
          ]}
          rows={rows}
          rowKey={(r) => r.id}
        />
      )}
    </Panel>
  );
}
