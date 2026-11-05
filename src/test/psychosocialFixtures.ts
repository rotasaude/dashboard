// Dados dos testes do módulo 31 (CAPS). Hoje: quarta, 2026-11-04, 10h. Formas do api real (api-truth.md, ruling R1),
// não as do plano: lista sem texto clínico, `problems`/`warnings` como códigos, mapa dos leitos em `items`, vínculo sem o
// nome do CAPS (P46). Rótulos e códigos de `options` vêm do `config/psychosocial/raas.yml` e da SIGTAP de exemplo do api.
import type {
  PsyAction, PsyActionRow, PsyBedBoard, PsyCarePlan, PsyDashboard, PsyEnrollment, PsyEnrollmentRow, PsyGroup, PsyLink, PsyMatrixSupport,
  PsyMatrixSupportRow, PsyMonth, PsyMonthRecord, PsyNightStay, PsyOptions, PsyPro, PsyRaasExport, PsyReferral, PsyReferralRow, PsySettings,
  PsyToday, PsyUnit, SessionUser
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const TODAY31 = "2026-11-04";
export const NOW31 = new Date("2026-11-04T10:00:00-03:00");
export const MONTH31 = "2026-11";
export const CAPS_II: PsyUnit = { id: "caps2", name: "CAPS II Centro", caps_modality: "caps_ii", night_capable: false };
export const CAPS_AD_III: PsyUnit = { id: "capsad3", name: "CAPS AD III Boqueirão", caps_modality: "caps_ad_iii", night_capable: true };
export const ME_PSY: PsyPro = { user_id: "u-1", name: "Lia Psicóloga", cbo_code: "251510" };
export const ME_DOCTOR: PsyPro = { user_id: "u-1", name: "Dr. Caio Psiquiatra", cbo_code: "225133" };
export const NURSE: PsyPro = { user_id: "u-2", name: "Rui Enfermeiro", cbo_code: "223505" };

const proc = (code: string, name: string, instrument_codes: string[], o: Partial<PsyOptions["procedures"][number]> = {}) =>
  ({ code, name, instrument_codes, family_care: false, collective: false, max_quantity: null, requires_authorization: false, ...o });

export const OPTIONS: PsyOptions = {
  origins: [ { code: "01", label: "Demanda espontânea" }, { code: "02", label: "Atenção básica" }, { code: "04", label: "Outro CAPS" } ],
  destinations: [
    { code: "00", label: "Permanência" }, { code: "01", label: "Alta" }, { code: "02", label: "Transferência para outro CAPS" },
    { code: "04", label: "Abandono" }
  ],
  substances: [ { code: "01", label: "Álcool" }, { code: "02", label: "Crack" }, { code: "99", label: "Nenhuma" } ],
  intensities: [ "intensive", "semi_intensive", "non_intensive" ],
  places: [ "caps", "territory" ],
  group_kinds: [ "group", "workshop", "assembly" ],
  reception_outcomes: [ "enrolled", "referred_elsewhere", "no_follow_up" ],
  referral_priorities: [ "routine", "priority" ],
  night_sigtap_code: "0301080020",
  competence: "202611",
  care_plan_review_days: 90,
  procedures: [
    proc("0301080232", "ACOLHIMENTO INICIAL POR CENTRO DE ATENCAO PSICOSSOCIAL", [ "02", "09" ], { max_quantity: 1 }),
    proc("0301080208", "ATENDIMENTO INDIVIDUAL DE PACIENTE EM CENTRO DE ATENCAO PSICOSSOCIAL", [ "09" ], { max_quantity: 31 }),
    proc("0301080216", "ATENDIMENTO EM GRUPO DE PACIENTES EM CENTRO DE ATENCAO PSICOSSOCIAL", [ "09" ], { max_quantity: 31, collective: true }),
    proc("0301080224", "ATENDIMENTO FAMILIAR EM CENTRO DE ATENCAO PSICOSSOCIAL", [ "09" ], { max_quantity: 31, family_care: true }),
    proc("0301080291", "ATENCAO AS SITUACOES DE CRISE EM CENTRO DE ATENCAO PSICOSSOCIAL", [ "09" ], { requires_authorization: true }),
    proc("0301080305", "MATRICIAMENTO DE EQUIPES DA ATENCAO BASICA", [ "01" ])
  ],
  team: [ ME_PSY, NURSE ],
  health_teams: [ { id: "ht1", name: "ESF Vila Verde", ine: "0001234567", health_unit: { id: "ubs1", name: "UBS Vila Verde" } } ]
};

const MARIA = { patient_id: "pt1", name: "Maria da Silva", cns_masked: "*** **** **** 1234" };
const JOSE = { patient_id: "pt2", name: "José Pereira", cns_masked: null };

export function referralRow(o: Partial<PsyReferralRow> = {}): PsyReferralRow {
  return { id: "rf1", patient: MARIA, from_unit: { id: "ubs1", name: "UBS Vila Verde" }, priority: "priority", status: "pending",
    created_at: "2026-11-03T14:00:00-03:00", ...o };
}

export function referral(o: Partial<PsyReferral> = {}): PsyReferral {
  return { ...referralRow(), reason: "Ideação suicida relatada na consulta de hoje.", received_at: null,
    referred_by: { user_id: "u-9", name: "Dra. Ana Clínica" }, ...o };
}

export function enrollmentRow(o: Partial<PsyEnrollmentRow> = {}): PsyEnrollmentRow {
  return { id: "en1", patient: MARIA, started_on: "2026-09-10", reference: ME_PSY, next_visit_at: "2026-11-04T14:00:00-03:00",
    status: "open", care_plan_review_on: "2026-12-01", ...o };
}

export function enrollment(o: Partial<PsyEnrollment> = {}): PsyEnrollment {
  return { ...enrollmentRow(), health_unit_id: CAPS_II.id, origin: "02", cid_main: "F322", cid_secondary: [], substances: [ "99" ],
    esf_covered: true, esf_cnes: "2384299", closed_on: null, destination: null, reception_id: "re1",
    created_at: "2026-09-10T11:00:00-03:00", ...o };
}

export function carePlan(o: Partial<PsyCarePlan> = {}): PsyCarePlan {
  return { id: "cp1", version: 1, needs: "Isolamento social e insônia.",
    goals: [ { text: "Voltar ao grupo de convivência", responsible_user_id: ME_PSY.user_id, due_on: null } ],
    intensity: "semi_intensive", review_on: "2026-12-01", created_by: ME_PSY, created_at: "2026-09-10T11:00:00-03:00", ...o };
}

export function group(o: Partial<PsyGroup> = {}): PsyGroup {
  return { id: "g1", health_unit_id: CAPS_II.id, name: "Oficina de artes", kind: "workshop", weekday: 3, starts_at: "14:00", ends_at: "16:00",
    responsible: ME_PSY, capacity: 25, sigtap_code: "0301080216", active: true, ...o };
}

// `today.groups` traz `sigtap_code` e `action_id` (ruling R3, api na onda final).
export function today(o: Partial<PsyToday> = {}): PsyToday {
  const { id, name, kind, starts_at, ends_at, responsible, capacity, sigtap_code } = group();
  return { date: TODAY31, groups: [ { id, name, kind, starts_at, ends_at, responsible, capacity, sigtap_code, action_id: null } ],
    visits: [ { enrollment_id: "en1", patient: MARIA, next_visit_at: "2026-11-04T14:00:00-03:00", reference: ME_PSY } ], ...o };
}

export function actionRow(o: Partial<PsyActionRow> = {}): PsyActionRow {
  return { id: "ac1", sigtap: { code: "0301080208", name: "ATENDIMENTO INDIVIDUAL DE PACIENTE EM CENTRO DE ATENCAO PSICOSSOCIAL", instrument: "raas_psi" },
    instrument: "raas_psi", performed_at: "2026-11-04T09:00:00-03:00", place: "caps", quantity: 1, professional: ME_PSY, group_id: null,
    participants_count: 1, cancelled: false, ...o };
}

export function action(o: Partial<PsyAction> = {}): PsyAction {
  return { ...actionRow(), health_unit_id: CAPS_II.id, month: MONTH31, origin: "manual", notes: "Relata melhora do sono.",
    authorization_number: null, participants: [ { enrollment_id: "en1", patient: MARIA } ], cancelled_at: null, cancel_reason: null,
    created_at: "2026-11-04T09:30:00-03:00", ...o };
}

export function bedBoard(o: Partial<PsyBedBoard> = {}): PsyBedBoard {
  return { date: TODAY31, window_days: 30, items: [
    { bed: { id: "b1", health_unit_id: CAPS_AD_III.id, label: "Leito 1", active: true }, stay: null, nights_used: null, limit: null },
    { bed: { id: "b2", health_unit_id: CAPS_AD_III.id, label: "Leito 2", active: true },
      stay: { id: "ns1", patient: JOSE, started_at: "2026-11-02T19:00:00-03:00", expected_end_at: "2026-11-06T08:00:00-03:00" },
      nights_used: 9, limit: 14 }
  ], ...o };
}

export function nightStay(o: Partial<PsyNightStay> = {}): PsyNightStay {
  return { id: "ns1", patient: JOSE, started_at: "2026-11-02T19:00:00-03:00", expected_end_at: "2026-11-06T08:00:00-03:00",
    health_unit_id: CAPS_AD_III.id, bed: { id: "b2", health_unit_id: CAPS_AD_III.id, label: "Leito 2", active: true }, enrollment_id: "en2",
    ended_at: null, end_reason: null, nights: [ "2026-11-02", "2026-11-03" ], reassessment: null, started_by: NURSE, closed_by: null,
    created_at: "2026-11-02T19:05:00-03:00", ...o };
}

export function psySettings(o: Partial<PsySettings> = {}): PsySettings {
  return { night_limits: { caps_iii: { consecutive: 7, alternate: 10, window_days: 30 }, caps_ad_iii: { total: 14, window_days: 30 },
    caps_ad_iv: { total: 14, window_days: 30 } }, care_plan_review_days: 90, ...o };
}

export function monthRecord(o: Partial<PsyMonthRecord> = {}): PsyMonthRecord {
  return { id: "mr1", enrollment_id: "en1", patient: MARIA, status: "open", homeless: null, actions_count: 3,
    problems: [ "homeless_missing" ], warnings: [], ...o };
}

export function month(o: Partial<PsyMonth> = {}): PsyMonth {
  return { month: MONTH31, health_unit_id: CAPS_II.id, status: "open", closure: null,
    counts: { records: 1, open: 1, closed: 0, exported: 0, with_problems: 1, with_warnings: 0, actions: 3 }, records: [ monthRecord() ], ...o };
}

export function raasExport(o: Partial<PsyRaasExport> = {}): PsyRaasExport {
  return { id: "rx1", health_unit_id: CAPS_II.id, month: MONTH31, competence: "202612", layout_version: "2026.1", records_count: 1,
    sha256: "a".repeat(64), created_at: "2026-12-02T10:00:00-03:00", created_by: ME_PSY, ...o };
}

export function matrixSupportRow(o: Partial<PsyMatrixSupportRow> = {}): PsyMatrixSupportRow {
  return { id: "ms1", health_unit_id: CAPS_II.id, health_team: { id: "ht1", name: "ESF Vila Verde", ine: "0001234567", health_unit_id: "ubs1" },
    held_on: "2026-11-03", participants: [ ME_PSY ],
    sigtap: { code: "0301080305", name: "MATRICIAMENTO DE EQUIPES DA ATENCAO BASICA", instrument: "bpa_c" }, action_id: "ac5",
    action_cancelled_at: null, cases_count: 1, created_at: "2026-11-03T16:00:00-03:00", ...o };
}

export function matrixSupport(o: Partial<PsyMatrixSupport> = {}): PsyMatrixSupport {
  return { ...matrixSupportRow(), topic: "Casos de risco do território",
    cases: [ { id: "mc1", patient: MARIA, shared_text: "Acompanhar adesão à medicação.", created_at: "2026-11-03T16:10:00-03:00" } ], ...o };
}

// O vínculo visto pela UBS: sem nome nem modalidade do CAPS (P46/P48).
export function psyLink(o: Partial<Extract<PsyLink, { enrolled: true }>> = {}): PsyLink {
  return { enrolled: true, caps: { phone: "4133334444" }, since: "2026-09-10", reference: { name: ME_PSY.name },
    shared_cases: [ { held_on: "2026-11-03", shared_text: "Acompanhar adesão à medicação." } ], ...o };
}

export function psyDashboard(o: Partial<PsyDashboard> = {}): PsyDashboard {
  return { month: MONTH31, enrollments_active: [ { health_unit_id: CAPS_II.id, name: CAPS_II.name, caps_modality: "caps_ii", count: 42 } ],
    new_in_month: 7, closed_by_destination: { "01": 3, "02": "lt5", "03": 0, "04": 0, "05": 0, "06": 0, "07": 0 }, care_plans_overdue: "lt5",
    actions_by_instrument: { raas_psi: 120, bpa_c: 8, bpa_i: "lt5" }, bed_occupancy: { nights: 40, bed_days: 60 },
    raas_month: { open: 1, closed: 0, exported: 0, no_actions: 0 }, ...o };
}

export function psyUser(roles: string[] = [ "psychosocial_staff" ], features: string[] = [ "psychosocial_care", "clinical_record" ]): SessionUser {
  return sessionWith(roles, { features });
}
