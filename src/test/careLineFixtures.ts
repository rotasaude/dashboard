// src/test/careLineFixtures.ts
// Dados comuns aos testes do módulo 23. Cada arquivo de teste faz o próprio
// vi.mock("…/lib/api"); aqui só tipos e a sessão. Códigos com cara de real
// (INE, SIGTAP, CIAP/CID — semente realista), nomes fictícios.
import type {
  CareContext, CareEnrollment, CareLine, CareLineTemplate, CarePracticeStatus, CarePreview, CareSuggestion, HealthUnit, RequestRow,
  SessionUser
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const TODAY23 = "2026-10-22";
export const TEAM_A = { id: "tm1", ine: "0001234567", name: "ESF Vila Verde", unit: { id: "u1", name: "UBS Vila Verde" }, can_confirm: true };
export const TEAM_B = { id: "tm2", ine: "0001234575", name: "ESF Boqueirão", unit: { id: "u2", name: "UBS Boqueirão" }, can_confirm: true };
export const DIABETES_REF = { id: "cl4", name: "Pessoa com diabetes", indicator: "C4", requires_anchor: null };
export const PREGNANCY_REF = { id: "cl3", name: "Gestante e puérpera", indicator: "C3", requires_anchor: "lmp" };
export const UBS_VILA_VERDE: HealthUnit = { id: "u1", name: "UBS Vila Verde", kind: "ubs" };

// Sessão com as linhas ligadas; `mfa_verified_at` = agora (janela de step-up aberta).
export function careUser(roles: string[] = [ "health_professional" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, { id: "us23", email_address: "enfermeira@curitiba.demo", features: [ "clinical_record", "care_lines" ], ...over });
}

// `canConfirm: false` = a técnica de enfermagem (D2: can_confirm por equipe).
export function careContext(over: Partial<CareContext> & { canConfirm?: boolean } = {}): CareContext {
  const { canConfirm = true, ...rest } = over;
  return { teams: [ TEAM_A, TEAM_B ].map((t) => ({ ...t, can_confirm: canConfirm })), lines: [ DIABETES_REF, PREGNANCY_REF ], ...rest };
}

export function practice(over: Partial<CarePracticeStatus> = {}): CarePracticeStatus {
  return { key: "consultation", label: "Consulta com médico ou enfermeiro", status: "ok", done_at: "2026-07-10", due_on: "2027-01-06",
    count: null, expected: null, ...over };
}

export function enrollment(over: Partial<CareEnrollment> = {}): CareEnrollment {
  return {
    id: "en1", person: { patient_id: "pa1", citizen_id: "ci1", display_name: "Maria das Dores", age: 58 }, care_line: DIABETES_REF,
    team: { id: TEAM_A.id, ine: TEAM_A.ine, name: TEAM_A.name }, anchor_date: null, status: "active",
    enrolled_at: "2026-03-02T10:00:00-03:00", worst_status: "overdue",
    practices: [
      practice(),
      practice({ key: "blood_pressure", label: "Aferição da pressão arterial", done_at: "2026-07-10", due_on: "2027-01-06" }),
      practice({ key: "weight_height", label: "Peso e altura", status: "due_soon", done_at: "2025-11-12", due_on: "2026-11-12" }),
      practice({ key: "acs_visit", label: "Visita do ACS", status: "untracked", done_at: null, due_on: null }),
      practice({ key: "hba1c", label: "Hemoglobina glicada", status: "overdue", done_at: "2025-08-20", due_on: "2026-08-20" })
    ],
    last_contact: null, ended_reason: null, ended_at: null, ...over
  };
}

export function suggestion(over: Partial<CareSuggestion> = {}): CareSuggestion {
  return {
    id: "sg1", person: { patient_id: "pa2", citizen_id: "ci2", display_name: "João Batista", age: 63 }, care_line: DIABETES_REF,
    reason: "problem", created_at: "2026-10-21T06:00:00-03:00", team_id: TEAM_A.id, enrollment_id: null, ...over
  };
}

const MD_NURSE = [ "2231", "2251", "2252", "2253", "2235" ];
export const DIABETES_TEMPLATE: CareLineTemplate = {
  key: "diabetes_c4", name: "Pessoa com diabetes", indicator: "C4", version: 2,
  eligibility: { problems: { ciap2: [ "T89", "T90" ], cid10: [ "E10", "E11", "E14" ] }, declared: [ "diabetes" ], requires_anchor: null },
  practices: [
    { key: "c4_a", label: "Consulta com médico ou enfermeiro", citizen_label: "consulta com a equipe", source: "consultation",
      window_days: 183, min_count: 1, schedule: "end_of_window", anchor: "rolling", cbo_filter: MD_NURSE, points: 20 },
    { key: "c4_e", label: "Hemoglobina glicada", citizen_label: "exame de hemoglobina glicada", source: "exam:0202010503",
      window_days: 365, min_count: 1, schedule: "end_of_window", anchor: "rolling", cbo_filter: null, points: 15 }
  ]
};
export const PREGNANCY_TEMPLATE: CareLineTemplate = {
  key: "pregnancy_c3", name: "Gestante e puérpera", indicator: "C3", version: 1,
  eligibility: { problems: { ciap2: [ "W78" ], cid10: [ "Z34", "Z35" ] }, declared: [ "pregnancy" ], requires_anchor: "lmp" },
  practices: [
    { key: "c3_b", label: "Consultas de pré-natal", citizen_label: "consulta de pré-natal", source: "consultation", window_start_days: 0,
      window_days: 294, min_count: 7, schedule: "proportional", anchor: "lmp", cbo_filter: MD_NURSE, points: 9 }
  ]
};

export function cityLine(over: Partial<CareLine> = {}): CareLine {
  return {
    id: "cl4", name: "Pessoa com diabetes", source: "template", template_key: "diabetes_c4", template_version: 1, indicator: "C4",
    eligibility: DIABETES_TEMPLATE.eligibility, practices: DIABETES_TEMPLATE.practices, declared_condition: "diabetes", active: true,
    latest_template_version: 2, ...over
  };
}

export function preview(indicator: string, over: Partial<CarePreview> = {}): CarePreview {
  return {
    indicator, team: { id: TEAM_A.id, ine: TEAM_A.ine, name: TEAM_A.name }, template_version: 1, denominator: 41, score: "37.5",
    max_score: 100, concept: "sufficient",
    practices: [
      { key: "c4_a", label: "Consulta com médico ou enfermeiro", tracked: true, points: 20, weight: "25.0", achieved: 30, denominator: 41 },
      { key: "c4_d", label: "Visitas do ACS", tracked: false, points: 20, weight: "0.0", achieved: 0, denominator: 41 }
    ],
    // C4 só tira a visita do ACS (P17); `excluded_practices` diz por prática.
    excluded: [ "acs_visit" ], excluded_practices: [ { key: "c4_d", reason: "untracked" } ], estimate: true, ...over
  };
}

export function requestRow(over: Partial<RequestRow> = {}): RequestRow {
  return {
    id: "rq1", kind: "return", origin: "attendance", origin_unit_name: "UBS Vila Verde", created_at: "2026-10-22T09:00:00-03:00",
    cpf_masked: "***.982.247-**", note: null, reopened_reason: null, appointment_type_key: "consulta_enfermagem",
    appointment_type_name: "Consulta de enfermagem", priority: "routine", due_on: "2026-11-21", triage_priority: null, overdue: false,
    reschedule_requested: false, reschedule_reason_code: null, preferred_period: null, reschedule_count: 0, needs_reschedule: false,
    target_unit_id: "u1", appointment: null, ...over
  };
}
