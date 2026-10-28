import type { CareOffer, CareProvider, NurseItem, RegulationCounts, RegulationRequest, RegulationTarget, RiskDeadlines, SessionUser } from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const TODAY26 = "2026-10-28";
export const UBS_CENTRO = { id: "u1", name: "UBS Centro" };
export const AMB_ESPEC = { id: "u2", name: "Ambulatório de Especialidades" };
export const CARDIO: RegulationTarget = { type: "specialty", code: "225120", name: "Cardiologia", group: null, nurse_allowed: false };
export const ECO: RegulationTarget = { type: "procedure", code: "0205010032", name: "Ecocardiografia transtorácica", group: null, nurse_allowed: true };
export const ENDO: RegulationTarget = { type: "specialty", code: "223212", name: "Endodontia", group: null, nurse_allowed: false };

export function regUser(roles: string[] = [ "care_regulator" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, { features: [ "care_regulation", "clinical_record" ], ...over });
}
export function regRequest(over: Partial<RegulationRequest> = {}): RegulationRequest {
  return {
    id: "rr1", patient: { id: "pa1", display_name: "Joana Lima", has_cpf: true, cns_masked: null }, type: "specialty",
    target: { code: "225120", name: "Cardiologia" }, cid10: "I209", ciap2: null,
    justification: "Dor torácica aos esforços há 3 meses, teste ergométrico alterado.", suggested_color: "yellow", color: null,
    color_reason: null, status: "pending", requested_at: "2026-10-08T10:00:00-03:00", due_on: "2026-11-07", overdue: false,
    requester: { name: "Dra. Helena Prado", cbo: "225142", unit: UBS_CENTRO }, consultation_id: "cs1", authorization: null,
    appointment_request_id: null, schedule: null, outcome: null, misses: 0, external: null, state_regulated: false, version: 3,
    events: [ { status: "pending", at: "2026-10-08T10:00:00-03:00", by: { name: "Dra. Helena Prado" }, reason: null } ], ...over
  };
}
export function regCounts(over: Partial<RegulationCounts> = {}): RegulationCounts {
  return { pending: 12, overdue: 3, returned: 2, authorized: 5, external: 1, ...over };
}
export function provider(over: Partial<CareProvider> = {}): CareProvider {
  return { id: "pr1", name: "Ambulatório de Especialidades", cnes: "2384310", kind: "own", health_unit: AMB_ESPEC, active: true, ...over };
}
export function offer(over: Partial<CareOffer> = {}): CareOffer {
  return { id: "of1", provider: { id: "pr1", name: "Ambulatório de Especialidades", kind: "own" }, target: CARDIO, month: "2026-10",
    quantity: 10, used: 8, available: 2, ...over };
}
export function deadlines(over: Partial<RiskDeadlines> = {}): RiskDeadlines { return { red: 7, yellow: 30, green: 90, blue: 180, ...over }; }
export function nurseItem(over: Partial<NurseItem> = {}): NurseItem {
  return { target_type: "procedure", target_code: "0205010032", name: "Ecocardiografia transtorácica", ...over };
}
