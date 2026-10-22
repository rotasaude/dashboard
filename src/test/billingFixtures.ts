// src/test/billingFixtures.ts
// Dados comuns aos testes do módulo 22. Cada arquivo de teste faz o próprio
// vi.mock("…/lib/api"); aqui só tipos e a sessão. Códigos SIGTAP, CBO e CNES
// com cara de real (semente realista), nomes fictícios.
import type {
  BillingEstablishment, BillingExport, BillingPatient, BillingPeriod, BillingProfessional, BillingSettings, HealthUnit, PendingItem,
  PerformedProcedure, SessionUser, SigtapProcedure
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const NOW22 = "2026-10-21T10:00:00-03:00";
export const TODAY22 = "2026-10-21";
export const UPA: HealthUnit = { id: "u7", name: "UPA Boa Vista", kind: "upa" };
export const UBS: HealthUnit = { id: "u1", name: "UBS Centro", kind: "ubs" };
export const UPA_EST: BillingEstablishment = { type: "health_unit", id: "u7", cnes: "2384299", name: "UPA Boa Vista" };
export const LAB_EST: BillingEstablishment = { type: "lab_provider", id: "pv9", cnes: "7654321", name: "Laboratório Municipal" };
export const PATIENT: BillingPatient = { id: "pa1", display_name: "Joana Lima", cpf_masked: "***.982.247-**" };

// Sessão com o faturamento ligado; `mfa_verified_at` = agora (janela de step-up aberta).
export function billingUser(roles: string[] = [ "billing_clerk" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, { id: "us22", email_address: "faturamento@curitiba.demo", features: [ "procedure_billing" ], ...over });
}

const sigtap = (code: string, name: string, instruments: string[], requiresCid = false): SigtapProcedure => ({
  code, name, instruments, requires_cid: requiresCid, sex: null, age_min_months: null, age_max_months: null
});
export const URGENCY = sigtap("0301060061", "ATENDIMENTO DE URGENCIA EM ATENCAO ESPECIALIZADA", [ "bpa_i" ]);
export const SUTURE = sigtap("0401010066", "EXCISAO E/OU SUTURA SIMPLES DE PEQUENAS LESOES/FERIMENTOS DE PELE/ANEXOS E MUCOSA", [ "bpa_i" ], true);
export const GLUCOSE = sigtap("0202010473", "DOSAGEM DE GLICOSE", [ "bpa_c" ]);

export function procedure(over: Partial<PerformedProcedure> = {}): PerformedProcedure {
  return {
    id: "pp1", patient: { id: "pa1", display_name: "Joana Lima" }, establishment: UPA_EST,
    professional: { user_id: "us1", name: "Dra. Helena Prado", cbo_code: "225125" }, performed_on: TODAY22,
    sigtap_code: URGENCY.code, label: URGENCY.name, sigtap_competence: "202610", quantity: 1, cid10: null, character: "urgent",
    source: "attendance", source_ref: { type: "attendance", id: "a1" }, instrument: "bpa_i", billable: true, blocking_reasons: [], status: "recorded",
    cancel_reason: null, billing_competence: null, sigtap_fallback: false, ...over
  };
}

export function period(over: Partial<BillingPeriod> = {}): BillingPeriod {
  return {
    id: "bp1", establishment: UPA_EST, competence: "202609", status: "open", version: 0, closed_at: null, closed_by: null,
    reopened_reason: null, summary: { bpa_i_lines: 12, bpa_c_lines: 3, not_billable: { cbo_not_allowed: 2, missing_professional_cns: 1 }, pending: 1 },
    ...over
  };
}

export function pending(over: Partial<PendingItem> = {}): PendingItem {
  return {
    procedure_id: "pp2", reasons: [ "missing_professional_cns" ], fix: "professional", performed_on: "2026-09-14",
    sigtap_code: URGENCY.code, label: URGENCY.name, patient: { id: "pa1", display_name: "Joana Lima" },
    professional: { user_id: "us3", name: "Enf. Lúcia Prado" }, ...over
  };
}

export function billingExport(over: Partial<BillingExport> = {}): BillingExport {
  const base: BillingExport = {
    id: "ex1", version: 1, sha256: "", lines_bpa_i: 12, lines_bpa_c: 3, generated_at: "2026-10-05T09:00:00-03:00",
    generated_by: "Rita Faturista", ...over
  };
  // E10: sha256 diferente por versão (o getByTitle de um hash acha um só).
  return over.sha256 ? base : { ...base, sha256: `9f2c4e7a1b3d5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d${String(base.version).padStart(2, "0")}` };
}

export const PROFESSIONALS: BillingProfessional[] = [
  { user_id: "us1", name: "Dra. Helena Prado", cbo_codes: [ "225125" ] },
  { user_id: "us3", name: "Enf. Lúcia Prado", cbo_codes: [ "223505", "223565" ] },
  { user_id: "us4", name: "Téc. Caio Lima", cbo_codes: [] }
];

export const SETTINGS: BillingSettings = {
  origin_name: "SMS CURITIBA", origin_acronym: "SMS", origin_cnpj: "11222333000181",
  destination_body: "SECRETARIA MUNICIPAL DE SAUDE", management: "M"
};
