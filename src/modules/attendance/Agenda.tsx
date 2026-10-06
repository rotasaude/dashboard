// Agenda da unidade por dia (módulo 17; contratos §4.5): um bloco por
// profissional com turnos (faixas, contador de encaixes, cancelado) e
// horários (encaixe, fora do modelo, turno cancelado), e os horários de
// marcação livre sem profissional. Marcação livre vem do api sem tipo, fim,
// profissional e turno: a coluna do tipo mostra "—". O motivo do encaixe só
// vem para quem marca e para o municipal_admin (o api filtra); a tela mostra
// só o que veio. O seletor de data começa em hoje no fuso da cidade.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getUnitAgenda, type AgendaProfessional, type AppointmentView, type HealthUnit } from "../../lib/api";
import { ATTENDANCE_REFETCH_MS, attendanceError } from "../../lib/attendance";
import { cityIsoDate, fmtHourMinute } from "../../lib/format";
import { appointmentFlags, blockLine, statusLabel } from "../../lib/scheduling";
import { Panel } from "../../components/Panel";
import { DataTable } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { Tag } from "../../components/Tag";
import { inputStyle } from "../../components/formStyles";
import { unitAgendaKey } from "./FitInPanel";

interface Props { unit: HealthUnit }

const span = (a: AppointmentView) =>
  a.ends_at ? `${fmtHourMinute(a.scheduled_at)}–${fmtHourMinute(a.ends_at)}` : fmtHourMinute(a.scheduled_at);

export function AppointmentsTable({ rows }: { rows: AppointmentView[] }) {
  return (
    <DataTable<AppointmentView>
      cols={[
        { label: "Hora", w: "1fr", render: span },
        { label: "CPF", w: "1.5fr", render: (a) => a.citizen.cpf_masked },
        { label: "Atendimento", w: "1.5fr", render: (a) => a.appointment_type_name ?? "—" },
        { label: "Estado", w: "1.5fr", render: (a) => statusLabel(a.status) },
        { label: "Marcas", w: "2fr", render: (a) => {
          const flags = appointmentFlags(a);
          if (flags.length === 0 && !a.fit_in_reason) return "—";
          return (
            <span style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
              {flags.map((f) => <Tag key={f} tone={f === "turno cancelado" ? "down" : "warn"}>{f}</Tag>)}
              {a.fit_in_reason && <small style={{ color: "var(--ink3)" }}>{a.fit_in_reason}</small>}
            </span>
          );
        } }
      ]}
      rows={rows}
      rowKey={(a) => a.id}
      empty="nenhum horário"
    />
  );
}

function ProfessionalBlock({ p }: { p: AgendaProfessional }) {
  return (
    <section aria-label={p.name} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <strong style={{ fontSize: 13 }}>{p.name}</strong>
      {p.shifts.map((s) => (
        <div key={s.shift_id} style={{ display: "flex", flexDirection: "column", gap: 2, fontSize: 12.5 }}>
          <span>{`Turno ${fmtHourMinute(s.starts_at)}–${fmtHourMinute(s.ends_at)} · encaixes ${s.fit_in_count} de ${s.fit_in_limit}${s.cancelled_at ? " · cancelado" : ""}`}</span>
          {s.blocks.map((b, i) => <span key={i} style={{ color: "var(--ink3)" }}>{blockLine(b, null)}</span>)}
        </div>
      ))}
      <AppointmentsTable rows={p.appointments} />
    </section>
  );
}

export function Agenda({ unit }: Props) {
  const [ date, setDate ] = useState(() => cityIsoDate());
  const query = useQuery({ queryKey: unitAgendaKey(unit.id, date), queryFn: () => getUnitAgenda(unit.id, date),
    refetchInterval: ATTENDANCE_REFETCH_MS
  });
  const data = query.data;
  const empty = !!data && data.professionals.length === 0 && data.unassigned.length === 0;

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
      ) : query.isPending || !data ? (
        <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
      ) : empty ? (
        <EmptyState title="nenhum turno nem horário neste dia" />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {data.professionals.map((p) => <ProfessionalBlock key={p.id} p={p} />)}
          {data.unassigned.length > 0 && (
            <section aria-label="Sem profissional (marcação livre)" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <strong style={{ fontSize: 13 }}>Sem profissional (marcação livre)</strong>
              <AppointmentsTable rows={data.unassigned} />
            </section>
          )}
        </div>
      )}
    </Panel>
  );
}
