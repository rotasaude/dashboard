// src/test/examFixtures.ts
// Dados comuns aos testes do módulo 21a. Cada arquivo de teste faz o próprio
// vi.mock("…/lib/api"); aqui só tipos e a sessão.
import type {
  ExamCatalogEntry, ExamCatalogItem, ExamOrder, ExamProvider, ExamResult, ExamResultField, HealthUnit, ProviderOrder, SessionUser
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const NOW21 = "2026-10-13T10:00:00-03:00";
export const TODAY21 = "2026-10-13";
export const VALID_CPF = "52998224725";
export const VALID_CNS = "702002887429583";
export const UNIT21: HealthUnit = { id: "u1", name: "UBS Centro", kind: "ubs" };

export const HEMOGRAM_FIELDS: ExamResultField[] = [
  { key: "hemoglobina", label: "Hemoglobina", unit: "g/dL", loinc: "718-7" },
  { key: "leucocitos", label: "Leucócitos", unit: "/mm³", loinc: "6690-2" }
];
export const HEMOGRAM_ENTRY: ExamCatalogEntry = { sigtap_code: "0202020380", label: "Hemograma completo", result_fields: HEMOGRAM_FIELDS };
export const HBA1C_ENTRY: ExamCatalogEntry = {
  sigtap_code: "0202010503", label: "Dosagem de hemoglobina glicosilada",
  result_fields: [ { key: "hba1c", label: "HbA1c", unit: "%", loinc: "4548-4" } ]
};

// Sessão com o rastreamento ligado; `mfa_verified_at` = agora (janela de step-up aberta).
export function examUser(roles: string[] = [ "health_professional" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, { id: "us1", email_address: "medica@curitiba.demo", features: [ "clinical_record", "exam_tracking" ], ...over });
}

export function examResult(over: Partial<ExamResult> = {}): ExamResult {
  return {
    id: "er1", origin: "order", source: "fhir", released_on: "2026-10-12", laboratory_name: "Laboratório Simulado", critical: false,
    values: [ { key: "hemoglobina", label: "Hemoglobina", value: "13.5", unit: "g/dL", loinc: "718-7" } ],
    pdf_url: "/exams/files/tok-er1", acknowledged_at: null, ...over
  };
}

export function examOrder(over: Partial<ExamOrder> = {}): ExamOrder {
  return {
    id: "eo1", short_code: "K7M2Q9XW3P", patient: { id: "pa1", display_name: "Joana Lima" },
    sigtap_code: "0202020380", sigtap_competence: "202609", label: "Hemograma completo", priority: "routine",
    cid10_justification: null, origin: "consultation", requester: { user_id: "us1", name: "Dra. Ana Souza", cns: null },
    unit: { id: "u1", name: "UBS Centro" }, provider: { id: "pv1", name: "Laboratório Simulado" },
    scheduled_at: null, scheduled_place: null, external_reference: null, status: "awaiting_schedule",
    status_changed_at: "2026-10-10T09:00:00-03:00", overdue: null, escalated: false, escalation_reasons: null, result: null,
    events: [ { kind: "requested", occurred_at: "2026-10-10T09:00:00-03:00", actor: { type: "user", name: "Dra. Ana Souza" }, reason: null } ],
    consultation_id: "c1", consultation_exam_request_id: null, guide_url: null, result_fields: HEMOGRAM_FIELDS, ...over
  };
}

export function examCatalogItem(over: Partial<ExamCatalogItem> = {}): ExamCatalogItem {
  return {
    id: "ci1", sigtap_code: "0202020380", label: "Hemograma completo", requires_authorization: false,
    release_policy: "after_acknowledgement", deadlines: { authorize: null, schedule: null, collect: null, result: 10, acknowledge: null },
    result_fields: HEMOGRAM_FIELDS, active: true, ...over
  };
}

export function examProvider(over: Partial<ExamProvider> = {}): ExamProvider {
  return {
    id: "pv1", name: "Laboratório Simulado", cnes: "1234567", kind: "accredited", active: true,
    items: [ { catalog_item_id: "ci1", sigtap_code: "0202020380", deadlines: { authorize: null, schedule: null, collect: null, result: 5, acknowledge: null } } ],
    simulated: false, has_fhir_token: false, fhir_token_rotated_at: null, users: [], ...over
  };
}

export function providerOrder(over: Partial<ProviderOrder> = {}): ProviderOrder {
  return {
    id: "eo1", short_code: "K7M2Q9XW3P", patient: { name: "Joana Lima", birth_date: "1980-05-02", cpf_last3: "725" },
    sigtap_code: "0202020380", label: "Hemograma completo", priority: "routine", status: "awaiting_schedule",
    scheduled_at: null, scheduled_place: null, overdue: null, result_fields: HEMOGRAM_FIELDS, ...over
  };
}

export function pdfFile(name = "laudo.pdf"): File {
  return new File([ "%PDF-1.4" ], name, { type: "application/pdf" });
}
