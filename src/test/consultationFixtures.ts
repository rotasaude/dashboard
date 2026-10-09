// Dados comuns aos testes do módulo 19 (consulta). Relógio dos testes:
// quarta, 2026-10-07 10:00 em São Paulo (-03:00). Os códigos de tipo de
// atendimento e de conduta são ilustrativos: os reais vêm do api
// (consultation_options, fixados pela Task 1 do plano do api).
import type {
  ClinicalRecord, Consultation, ConsultationOptions, ConsultationSummary, Opening, OpeningRow, PatientProblem
} from "../lib/api";
import { revision, screening } from "./screeningFixtures";

export const NOW19 = "2026-10-07T10:00:00-03:00";
export const TODAY19 = "2026-10-07";

export function problem(over: Partial<PatientProblem> = {}): PatientProblem {
  return {
    id: "pp1", terminology: "ciap2", code: "T90", label: "Diabetes não insulino-dependente", status: "active",
    onset_on: "2019-03-01", onset_precision: "month", resolved_on: null, ...over
  };
}

export function summary(over: Partial<ConsultationSummary> = {}): ConsultationSummary {
  return {
    id: "cs0", finalized_at: "2026-09-10T14:30:00-03:00", author_name: "Dra. Helena Prado",
    cbo_label: "Médico da estratégia de saúde da família", care_type_label: "Consulta agendada",
    problems: [ { problem_id: "pp1", terminology: "ciap2", code: "T90", label: "Diabetes não insulino-dependente", action: "evaluate" } ],
    addenda_count: 1, ...over
  };
}

export function record(over: Partial<ClinicalRecord> = {}): ClinicalRecord {
  return {
    patient: { id: "pa1", display_name: "Joana Lima", full_name: "João Carlos Lima", social_name: "Joana Lima", age: 54,
      sex: "female", cpf_masked: "***.982.247-**" },
    access: "in_context",
    problems: [ problem() ],
    today_screening: screening({ status: "completed", destination: "same_day", current_revision: revision(), revisions_count: 1 }),
    consultations: [ summary() ],
    ...over
  };
}

export function consultation(over: Partial<Consultation> = {}): Consultation {
  return {
    id: "cs1", attendance_id: "a1", patient_id: "pa1", status: "draft", author: { id: "us1", name: "Dra. Helena Prado" },
    cbo_code: "225142", subjective: "", objective: "", assessment: "", plan: "", vitals: {}, care_type: "5",
    evaluated_problems: [], conducts: [], exam_requests: [], started_at: "2026-10-07T09:55:00-03:00", finalized_at: null,
    addenda: [], ...over
  };
}

export function finalized(over: Partial<Consultation> = {}): Consultation {
  return consultation({
    status: "finalized", finalized_at: "2026-10-07T10:20:00-03:00",
    subjective: "Refere sede e cansaço há duas semanas.", objective: "Bom estado geral.",
    assessment: "Diabetes descompensado.", plan: "Ajuste de dose; retorno em 30 dias.",
    vitals: { systolic: 150, diastolic: 95, capillary_glucose: 280, glucose_moment: "random" },
    evaluated_problems: [ { problem_id: "pp1", terminology: "ciap2", code: "T90", label: "Diabetes não insulino-dependente", action: "evaluate" } ],
    conducts: [ "9" ],
    exam_requests: [ { sigtap_code: "0202010503", label: "DOSAGEM DE HEMOGLOBINA GLICOSILADA", cid10_justification: "E119" } ],
    ...over
  });
}

export function options(over: Partial<ConsultationOptions> = {}): ConsultationOptions {
  return {
    care_types: [ { code: "2", label: "Consulta agendada" }, { code: "5", label: "Consulta no dia" } ],
    conducts: [ { code: "9", label: "Retorno para consulta agendada" }, { code: "12", label: "Alta do episódio" } ],
    cid10_allowed_for_cbo: true, ...over
  };
}

export function opening(over: Partial<Opening> = {}): Opening {
  return { opening_id: "op1", patient_id: "pa1", expires_at: "2026-10-07T10:30:00-03:00", ...over };
}

export function openingRow(over: Partial<OpeningRow> = {}): OpeningRow {
  return {
    id: "op1", user_name: "Enf. Lúcia Prado", cpf_masked: "***.982.247-**", reason_code: "case_review",
    created_at: "2026-10-06T15:10:00-03:00", expires_at: "2026-10-06T15:40:00-03:00", ...over
  };
}
