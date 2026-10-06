// Dados comuns aos testes do módulo 17. Relógio dos testes: segunda,
// 2026-10-05 10:00 em São Paulo (-03:00).
import type {
  AgendaShift, AppointmentType, AppointmentView, AvailabilitySlot, RequestRow, ScheduleTemplate, UnitAgenda
} from "../lib/api";

export const NOW = "2026-10-05T10:00:00-03:00";

export const TYPES: AppointmentType[] = [
  { key: "consulta_medica", name: "Consulta médica", duration_minutes: 20, cbo_prefixes: [ "2251", "2252", "2253" ], active: true, origin: "platform" },
  { key: "consulta_enfermagem", name: "Consulta de enfermagem", duration_minutes: 15, cbo_prefixes: [ "2235" ], active: true, origin: "platform" },
  { key: "retorno", name: "Retorno", duration_minutes: 15, cbo_prefixes: [ "2251", "2252", "2253", "2235", "2232" ], active: true, origin: "platform" },
  { key: "puericultura", name: "Puericultura", duration_minutes: 30, cbo_prefixes: [ "2235" ], active: false, origin: "city" }
];

export const MORNING: ScheduleTemplate = {
  id: "t1", name: "Manhã", fit_in_limit: 2, active: true,
  blocks: [
    { starts: "07:00", ends: "09:00", kind: "walk_in" },
    { starts: "09:00", ends: "11:00", kind: "bookable", appointment_type_key: "consulta_medica" },
    { starts: "11:00", ends: "12:00", kind: "blocked" }
  ]
};

export function slot(over: Partial<AvailabilitySlot> = {}): AvailabilitySlot {
  return { professional_id: "p1", professional_name: "Helena Duarte", shift_id: "s1",
    starts_at: "2026-10-06T09:00:00-03:00", ends_at: "2026-10-06T09:20:00-03:00", ...over };
}

export function appointmentView(over: Partial<AppointmentView> = {}): AppointmentView {
  return {
    id: "a1", status: "confirmed", booking_kind: "slot", scheduled_at: "2026-10-06T09:00:00-03:00",
    ends_at: "2026-10-06T09:20:00-03:00", appointment_type_key: "consulta_medica", appointment_type_name: "Consulta médica",
    professional: { id: "p1", name: "Helena Duarte" }, shift_id: "s1", fit_in: false, outside_template: false,
    shift_cancelled: false, citizen: { id: "c1", cpf_masked: "***.982.247-**" }, ...over
  };
}

// Item da fila como o api manda (Scheduling::RequestJson): pedido aberto, sem
// horário vivo.
export function requestRow(over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: "r1", kind: "return", origin: "attendance", origin_unit_name: "UBS Centro", target_unit_id: "u1",
    created_at: "2026-09-24T10:00:00Z", cpf_masked: "***.982.247-**", note: "controle de pressão", reopened_reason: null,
    appointment_type_key: "consulta_medica", appointment_type_name: "Consulta médica", priority: "routine",
    triage_priority: 2, due_on: "2026-10-20", overdue: false, reschedule_requested: false, reschedule_reason_code: null,
    preferred_period: null, reschedule_count: 0, needs_reschedule: false, appointment: null, ...over
  };
}

export function agendaShift(over: Partial<AgendaShift> = {}): AgendaShift {
  return { shift_id: "s1", starts_at: "2026-10-06T07:00:00-03:00", ends_at: "2026-10-06T12:00:00-03:00",
    blocks: MORNING.blocks, fit_in_count: 1, fit_in_limit: 2, cancelled_at: null, ...over };
}

// Agenda da unidade em 06/10: Helena com turno da manhã (1 de 2 encaixes) e
// Marta com o turno cancelado.
export function unitAgenda(over: Partial<UnitAgenda> = {}): UnitAgenda {
  return {
    date: "2026-10-06",
    professionals: [
      { id: "p1", name: "Helena Duarte", shifts: [ agendaShift() ], appointments: [ appointmentView() ] },
      { id: "p2", name: "Marta Lima", shifts: [ agendaShift({ shift_id: "s2", cancelled_at: "2026-10-05T08:00:00-03:00" }) ], appointments: [] }
    ],
    unassigned: [],
    ...over
  };
}
