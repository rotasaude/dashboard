// Dados comuns aos testes do módulo 25. Hoje: terça, 2026-10-27 (semana 2026-43).
import type { LocalDisease, NotifiableDisease, NotificationCounts, SessionUser, SurveillanceNotification, SurveillancePanel, WeeklyNegatives } from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const TODAY25 = "2026-10-27";
export const UBS_CENTRO = { id: "u1", cnes: "2384299", name: "UBS Centro" };
export const UBS_VILA = { id: "u2", cnes: "2384302", name: "UBS Vila Verde" };
// Doenças ilustrativas: a lista real vem do api. `id` e `active` são nulos na nacional (A10).
export const DENGUE: NotifiableDisease = { code: "dengue", name: "Dengue", deadline: "weekly", cid10: [ "A90" ], ciap2: [],
  repeat_after_days: 30, sinan_form: "dengue", local: false, list_version: 1, notes: null, id: null, active: null };
export const MEASLES: NotifiableDisease = { code: "sarampo", name: "Sarampo", deadline: "immediate", cid10: [ "B059" ], ciap2: [ "A71" ],
  repeat_after_days: 30, sinan_form: null, local: false, list_version: 1, notes: null, id: null, active: null };

export function survUser(roles: string[] = [ "surveillance" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, { features: [ "surveillance" ], ...over });
}
export function disease(over: Partial<NotifiableDisease> = {}): NotifiableDisease { return { ...DENGUE, ...over }; }
export function notification(over: Partial<SurveillanceNotification> = {}): SurveillanceNotification {
  return {
    id: "nt1", patient: { id: "pa1", display_name: "Joana Lima", has_cpf: true, cns_masked: null },
    disease: { code: "dengue", name: "Dengue", deadline: "weekly" }, origin: "consultation", status: "notified", classification: null,
    suspected_on: "2026-10-26", symptoms_on: "2026-10-24", unit: UBS_CENTRO, notifier: { name: "Dra. Helena Prado" },
    deadline: "weekly", due_at: "2026-11-02T10:00:00-03:00", overdue: false, official_number: null, resident_elsewhere: false, residence_ibge: null,
    neighborhood: { id: "nb1", name: "Centro" }, consultation_id: "cs1", closed_at: null, entered_at: null, dismissed_at: null, version: 1, form: {},
    events: [ { status: "notified", at: "2026-10-26T10:00:00-03:00", by: { name: "Dra. Helena Prado" }, reason: null } ], ...over
  };
}
export function counts(over: Partial<NotificationCounts> = {}): NotificationCounts {
  return { possible: 2, notified: 5, investigating: 1, overdue: 3, immediate_open: 1, without_official_number: 4, ...over };
}
export function localDisease(over: Partial<LocalDisease> = {}): LocalDisease {
  return { id: "ld1", code: "local_febre_oropouche", name: "Febre do Oropouche", deadline: "immediate", cid10: [ "R17" ], ciap2: [],
    repeat_after_days: 30, sinan_form: null, local: true, list_version: null, notes: null, active: true, ...over };
}
export function negatives(over: Partial<WeeklyNegatives> = {}): WeeklyNegatives {
  return { week: "2026-42", units: [ { unit: UBS_CENTRO, status: "with_cases" }, { unit: UBS_VILA, status: "pending" } ], ...over };
}
export function panel(over: Partial<SurveillancePanel> = {}): SurveillancePanel {
  return { weeks: [ "2026-41", "2026-42" ], suppressed: true, rows: [
    { neighborhood: { id: "nb1", name: "Centro" }, counts: [ 6, 14 ], signal: [ false, true ] },
    { neighborhood: { id: null, name: "Não informado" }, counts: [ null, 0 ], signal: [ false, false ] } ], ...over };
}
