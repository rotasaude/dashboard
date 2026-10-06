// Minha agenda (módulo 17; spec §7, contratos §3): o profissional lê os
// próprios turnos, faixas e horários, por dia ou semana (segunda a domingo,
// no fuso da cidade). Só leitura: quem marca é a recepção. O api devolve um
// item por dia do período, com `shifts` vazio quando não há turno.
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ApiError, getMyAgenda, type MyAgendaShift } from "../lib/api";
import { ATTENDANCE_REFETCH_MS, attendanceError } from "../lib/attendance";
import { useAuth } from "../lib/auth";
import { cityIsoDate, fmtHourMinute } from "../lib/format";
import { MY_AGENDA_DAYS, addDaysIso, blockLine, dayLabel, weekStart } from "../lib/scheduling";
import { PageHeader } from "../components/PageHeader";
import { Panel } from "../components/Panel";
import { EmptyState } from "../components/EmptyState";
import { inputStyle, secondaryButtonStyle } from "../components/formStyles";
import { SegmentedControl } from "../shell/SegmentedControl";
import { AppointmentsTable } from "./attendance/Agenda";

type View = "day" | "week";
const VIEWS: { key: View; label: string }[] = [ { key: "day", label: "Dia" }, { key: "week", label: "Semana" } ];

const NO_PROFILE = "Seu cadastro profissional ainda não foi feito. Fale com a administração da cidade.";

export function MyAgenda() {
  const { user } = useAuth();
  const [ view, setView ] = useState<View>("day");
  const [ date, setDate ] = useState(() => cityIsoDate());
  const from = view === "day" ? date : weekStart(date);
  const to = view === "day" ? date : addDaysIso(from, MY_AGENDA_DAYS - 1);
  const step = view === "day" ? 1 : MY_AGENDA_DAYS;
  // Chave por usuário (F-10.5): o QueryClient sobrevive à troca de sessão.
  const query = useQuery({ queryKey: [ "myAgenda", user?.id ?? null, from, to ], queryFn: () => getMyAgenda(from, to),
    refetchInterval: ATTENDANCE_REFETCH_MS });
  // 404 no_profile: o usuário tem o papel, mas ainda não tem cadastro profissional.
  const noProfile = query.error instanceof ApiError && query.error.status === 404;
  const days = (query.data?.days ?? []).filter((d) => d.shifts.length > 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <PageHeader title="Minha agenda" sub="só leitura · quem marca é a recepção" />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <SegmentedControl options={VIEWS} value={view} onChange={setView} />
        <button type="button" style={secondaryButtonStyle} onClick={() => setDate(addDaysIso(date, -step))}>← anterior</button>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ink2)" }}>Data
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)}
            style={{ ...inputStyle, width: "auto", marginTop: 0 }} />
        </label>
        <button type="button" style={secondaryButtonStyle} onClick={() => setDate(addDaysIso(date, step))}>próximo →</button>
      </div>
      {noProfile ? <EmptyState title={NO_PROFILE} />
        : query.isError ? <p role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--down)" }}>{attendanceError(query.error)}</p>
        : query.isPending ? <p className="mono" style={{ margin: 0, fontSize: 10.5, color: "var(--ink3)" }}>carregando…</p>
        : days.length === 0 ? <EmptyState title="nenhum turno no período" />
        : days.map((d) => (
          <Panel key={d.date} title={dayLabel(d.date)}>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {d.shifts.map((s) => <ShiftBlock key={s.shift_id} shift={s} />)}
            </div>
          </Panel>
        ))}
    </div>
  );
}

function ShiftBlock({ shift }: { shift: MyAgendaShift }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <strong style={{ fontSize: 13 }}>{shift.unit.name}</strong>
      <span style={{ fontSize: 12.5 }}>
        {`Turno ${fmtHourMinute(shift.starts_at)}–${fmtHourMinute(shift.ends_at)}${shift.cancelled_at ? " · cancelado" : ""}`}
      </span>
      {shift.blocks.map((b, i) => <span key={i} style={{ fontSize: 12, color: "var(--ink3)" }}>{blockLine(b, null)}</span>)}
      <AppointmentsTable rows={shift.appointments} />
    </div>
  );
}
