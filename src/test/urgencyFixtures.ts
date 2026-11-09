// Dados dos testes do módulo 32a (urgência). Agora: quinta, 2026-11-05, 10h. Formas do api real (preflight §A):
// a fila (Urgency::Queue), o detalhe (Urgency::Json, com e sem acesso clínico), o painel (Urgency::Dashboard),
// a TV (WaitingRoom::Board) e os itens de locais, TVs, retornos e provisórios.
import type {
  CallLocation, CounterReferral, HealthUnit, MyProfessional, ProfessionalLink, ProvisionalEncounter, SessionUser,
  UrgencyClassificationView, UrgencyColorRow, UrgencyDashboard, UrgencyDuplicateCandidate, UrgencyEncounter,
  UrgencyInCareRow, UrgencyPatientRef, UrgencyQueue, UrgencySuggestion, UrgencyWaitingRow, WaitingRoomBoard,
  WaitingRoomDisplay
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const NOW32 = new Date("2026-11-05T10:00:00-03:00");
export const MONTH32 = "2026-11";
export const UPA: HealthUnit = { id: "upa1", name: "UPA Boqueirão", kind: "upa", ticket_prefix: "U", show_wait_times: true };
export const UBS: HealthUnit = { id: "ubs1", name: "UBS Centro", kind: "ubs", ticket_prefix: "A", show_wait_times: false };

const link = (o: Partial<ProfessionalLink>): ProfessionalLink => ({
  id: "l1", health_unit_id: "upa1", unit_name: "UPA Boqueirão", cbo_code: "223505", cbo_title: "Enfermeiro",
  started_at: "2026-01-01", started_by: "admin", ended_at: null, ended_by: null, ...o
});
export const NURSE_LINK = link({});
export const DOCTOR_LINK = link({ id: "l2", cbo_code: "225125", cbo_title: "Médico clínico" });
export const myProfessional = (links: ProfessionalLink[]): MyProfessional =>
  ({ professional: { id: "p1", user_id: "u-1", professional_name: "Ana Souza" }, links, shifts: [] } as unknown as MyProfessional);

export const patientRef = (o: Partial<UrgencyPatientRef> = {}): UrgencyPatientRef =>
  ({ patient_id: "pa1", name: "Maria Lima", cns_masked: "*** **** **** 1234", unidentified: false, ...o });
// O provisório (A:app/models/patient.rb UNIDENTIFIED_NAME); a descrição só no detalhe.
export const unidentifiedRef = (o: Partial<UrgencyPatientRef> = {}): UrgencyPatientRef =>
  patientRef({ patient_id: "pa9", name: "Paciente não identificado", cns_masked: null, unidentified: true, ...o });

// Fila: aguardando classificação manda `max_wait_minutes: null`.
export const waitingRow = (o: Partial<UrgencyWaitingRow> = {}): UrgencyWaitingRow => ({
  encounter_id: "en1", attendance_id: "at1", ticket: "U-042", patient: patientRef(), arrived_at: "2026-11-05T09:48:00-03:00",
  waited_minutes: 12, last_call: null, max_wait_minutes: null, ...o
});
// `classified_at` é a 1ª classificação (o relógio do estouro, Q18).
export const colorRow = (o: Partial<UrgencyColorRow> = {}): UrgencyColorRow => ({
  ...waitingRow({ encounter_id: "en2", attendance_id: "at2", ticket: "U-040", arrived_at: "2026-11-05T09:30:00-03:00", waited_minutes: 30 }),
  color: "yellow", overdue: false, max_wait_minutes: 60, classified_at: "2026-11-05T09:33:00-03:00", ...o
});
// Em atendimento: todos os campos da espera, sem `overdue`.
export const inCareRow = (o: Partial<UrgencyInCareRow> = {}): UrgencyInCareRow => ({
  ...waitingRow({
    encounter_id: "en3", attendance_id: "at3", ticket: "U-038", patient: patientRef({ patient_id: "pa3", name: "João Reis" }),
    arrived_at: "2026-11-05T09:20:00-03:00", waited_minutes: 40,
    last_call: { kind: "care", location: "Consultório 2", called_at: "2026-11-05T09:55:00-03:00" }
  }),
  color: "orange", max_wait_minutes: 10, consultation_id: null, consultation_status: null, called_by_name: "Dr. Caio",
  called_at: "2026-11-05T09:55:00-03:00", ...o
});
export const queue = (o: Partial<UrgencyQueue> = {}): UrgencyQueue =>
  ({ awaiting_classification: [ waitingRow() ], by_color: [ colorRow() ], in_care: [ inCareRow() ], ...o });

// Classificação com acesso clínico. `criterion` do topo só quando a cor final é a sugerida.
export const classification = (o: Partial<UrgencyClassificationView> = {}): UrgencyClassificationView => ({
  id: "c1", position: 1, color: "yellow", suggested_color: "yellow",
  suggested: { color: "yellow", criterion: "Temperatura de 39 °C ou mais" }, criterion: "Temperatura de 39 °C ou mais",
  complaint: "febre e dor de cabeça", vital_signs: { temperature_c: 39.4 }, pain_scale: 5, justification: null,
  max_wait_minutes: 60, protocol_definition_id: "pd1", classified_at: "2026-11-05T09:52:00-03:00",
  by: { name: "Ana Souza", cbo_code: "223505" }, ...o
});
export const encounter = (o: Partial<UrgencyEncounter> = {}): UrgencyEncounter => ({
  id: "en1", attendance_id: "at1", health_unit_id: "upa1", state: "waiting_classification", ticket: "U-042",
  arrived_at: "2026-11-05T09:48:00-03:00", patient: patientRef(), color: null, max_wait_minutes: null, overdue: false,
  first_classified_at: null, classifications: [], consultation_id: null, consultation_status: null, outcome: null, ...o
});
// O detalhe que a recepção lê (Q19): sem queixa, sinais, dor, justificativa nem critério; o provisório com a descrição.
export const receptionEncounter = (o: Partial<UrgencyEncounter> = {}): UrgencyEncounter => {
  const { complaint: _c, vital_signs: _v, pain_scale: _p, justification: _j, criterion: _k, ...rest } = classification();
  return encounter({
    id: "en9", attendance_id: "at9", state: "classified", ticket: "U-043",
    patient: unidentifiedRef({ description: "homem, cerca de 40 anos, achado na rodoviária" }),
    color: "yellow", max_wait_minutes: 60, first_classified_at: "2026-11-05T09:52:00-03:00",
    classifications: [ { ...rest, suggested: { color: "yellow" } } ], ...o
  });
};
// 409 duplicate_suspected (Q23): `candidates` na forma do 24a/27a.
export const duplicateCandidates = (): UrgencyDuplicateCandidate[] => [
  { patient_id: "pa5", display_name: "Maria Lima", birth_date: "1980-03-02", has_cpf: true },
  { patient_id: "pa6", display_name: "Maria Lima Souza", birth_date: "1980-03-12", has_cpf: false }
];

export const LEVELS = [
  { color: "red", max_wait_minutes: 0 }, { color: "orange", max_wait_minutes: 10 }, { color: "yellow", max_wait_minutes: 60 },
  { color: "green", max_wait_minutes: 120 }, { color: "blue", max_wait_minutes: 240 }
] as UrgencySuggestion["levels"];
export const suggestion = (o: Partial<UrgencySuggestion> = {}): UrgencySuggestion =>
  ({ suggested: { color: "yellow", criterion: "Temperatura de 39 °C ou mais", rule_id: "febre-alta" }, levels: LEVELS, ...o });
// Definição do protocolo de urgência (contracts, Q1): `levels` + `classification_rules`; o nome é o da semente.
export const UPA_PROTOCOL = {
  name: "classificacao-urgencia", version: 1, kind: "urgency_classification", levels: LEVELS,
  classification_rules: [
    { id: "spo2-critica", when: { lt: [ "vitals.spo2", 90 ] }, color: "red", criterion: "Saturação de oxigênio abaixo de 90%" },
    { id: "febre-alta", when: { gte: [ "vitals.temperature_c", 39 ] }, color: "yellow", criterion: "Temperatura de 39 °C ou mais" },
    { id: "dor-leve", when: { gte: [ "pain_scale", 2 ] }, color: "green", criterion: "Dor leve (2 a 4)" }
  ]
};

export const callLocation = (o: Partial<CallLocation> = {}): CallLocation =>
  ({ id: "loc1", health_unit_id: "upa1", name: "Consultório 1", active: true, ...o });
export const waitingRoomDisplay = (o: Partial<WaitingRoomDisplay> = {}): WaitingRoomDisplay => ({
  id: "d1", health_unit_id: "upa1", name: "TV da recepção", active: true, show_wait_times: true, paired: true,
  paired_at: "2026-11-04T08:00:00-03:00", last_seen_at: "2026-11-05T09:59:00-03:00", revoked: false, revoked_at: null, ...o
});
// Quando vem, `wait_times` traz as 5 cores; o local da chamada pode ser nulo.
export const board = (o: Partial<WaitingRoomBoard> = {}): WaitingRoomBoard => ({
  unit: { name: "UPA Boqueirão" },
  calls: [ { ticket: "U-042", location: "Consultório 2", kind: "care", called_at: "2026-11-05T09:59:00-03:00" },
    { ticket: "U-041", location: "Classificação", kind: "classification", called_at: "2026-11-05T09:57:00-03:00" } ],
  wait_times: [ { color: "red", median_minutes: "lt5_patients" }, { color: "orange", median_minutes: "lt5_patients" },
    { color: "yellow", median_minutes: 34 }, { color: "green", median_minutes: "lt5_patients" },
    { color: "blue", median_minutes: "lt5_patients" } ],
  updated_at: "2026-11-05T10:00:00-03:00", ...o
});

// Painel do gestor (Urgency::Dashboard): contagens 1–4 → "lt5"; tempos com contagem 0 → null.
const times = (color: UrgencyDashboard["door_to_classification"][number]["color"], count: number | "lt5", median: number | "lt5" | null,
  p90: number | "lt5" | null) => ({ color, count, median_minutes: median, p90_minutes: p90 });
export const dashboard = (o: Partial<UrgencyDashboard> = {}): UrgencyDashboard => ({
  month: MONTH32, units: [ { id: "upa1", name: "UPA Boqueirão" } ],
  door_to_classification: [ times("red", "lt5", "lt5", "lt5"), times("orange", 12, 4, 9), times("yellow", 40, 8, 15),
    times("green", 55, 11, 22), times("blue", 0, null, null) ],
  classification_to_physician: [ times("red", "lt5", "lt5", "lt5"), times("orange", 12, 7, 13), times("yellow", 38, 41, 70),
    times("green", 50, 85, 130), times("blue", 0, null, null) ],
  over_max_wait: [ { color: "red", count: "lt5", over: 0 }, { color: "orange", count: 12, over: "lt5" },
    { color: "yellow", count: 38, over: 6 }, { color: "green", count: 50, over: 7 }, { color: "blue", count: 0, over: 0 } ],
  by_color: { red: "lt5", orange: 12, yellow: 40, green: 55, blue: 0, unclassified: 6 },
  by_outcome: { discharged: 70, discharged_to_primary_care: 18, transferred: 6, left_without_care: 9, left_against_advice: "lt5", death: 0 },
  evasion: { before_classification: "lt5", after_classification: 6 },
  stay: { count: 104, median_minutes: 95, p90_minutes: 210 }, ...o
});

export const counterReferral = (o: Partial<CounterReferral> = {}): CounterReferral => ({
  encounter_id: "en4", patient: patientRef({ patient_id: "pa4", name: "José Alves" }), upa: { name: "UPA Boqueirão" },
  closed_at: "2026-11-04T16:20:00-03:00", return_days: 7, due_on: "2026-11-11", ...o
});
// Q29: provisórios abertos ou fechados nos últimos 7 dias, para a recepção identificar (nenhum dado clínico).
export const provisionalEncounter = (o: Partial<ProvisionalEncounter> = {}): ProvisionalEncounter => ({
  encounter_id: "en9", attendance_id: "at9", arrived_at: "2026-11-04T22:10:00-03:00", closed_at: "2026-11-05T03:40:00-03:00",
  outcome_kind: "death", patient: unidentifiedRef({ description: "homem, cerca de 40 anos, achado na rodoviária" }), ...o
});

export const urgencyUser = (roles: string[], features = [ "urgency_care", "clinical_record", "waiting_room_display" ]): SessionUser =>
  sessionWith(roles, { features } as Partial<SessionUser>);
