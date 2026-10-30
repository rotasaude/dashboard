// Dados dos testes do módulo 28 (saúde bucal). Hoje: sexta, 2026-10-30. Formas do contrato §2 e §16.
// Códigos SIGTAP ilustrativos, como os do `consultationFixtures`; os reais e o vocabulário vêm do api.
import type { CeoGoals, CeoProfile, ChartEvent, Consultation, ConsultationOptions, DentalFields, DentalLocation, DentalPlan, DentalPlanItem,
  DentalProcedureRef, DentalTeam, DentalVocabulary, Odontogram, ProsthesisOrder, SessionUser, ToothFace } from "../lib/api";
import { consultation, finalized, options } from "./consultationFixtures";
import { sessionWith } from "./campaignFixtures";

export const TODAY28 = "2026-10-30";
export const UBS = { id: "u1", name: "UBS Centro", kind: "ubs" };
export const CEO_UNIT = { id: "u9", name: "CEO Boqueirão", kind: "ceo" };

// O4: situações no formato do api (código em string; coroa, raiz, arcada e face). Sem `applies_to`.
export const SITUATIONS: DentalVocabulary["situations"] = {
  crown: [ { code: "sound", label: "Hígido" }, { code: "caries", label: "Cariado" }, { code: "restored", label: "Restaurado" },
    { code: "missing", label: "Ausente" }, { code: "extraction_indicated", label: "Extração indicada" }, { code: "crown", label: "Coroa" } ],
  root: [ { code: "root_remnant", label: "Resto radicular" }, { code: "endodontic_treated", label: "Tratamento endodôntico" } ],
  arch: [ { code: "complete_denture", label: "Prótese total" } ],
  face: [ { code: "sound", label: "Hígido" }, { code: "caries", label: "Cariado" }, { code: "restored", label: "Restaurado" } ]
};
// O vocabulário que `consultation_options.dental` traz; os rótulos dos testes saem daqui.
export const DENTAL_VOCABULARY: DentalVocabulary = {
  care_types: [ { code: "2", label: "Consulta agendada" }, { code: "4", label: "Escuta inicial" }, { code: "5", label: "Consulta no dia" },
    { code: "6", label: "Atendimento de urgência" } ],
  consultation_types: [ { code: "1", label: "Primeira consulta odontológica programática" }, { code: "2", label: "Consulta de retorno" },
    { code: "4", label: "Consulta de manutenção" } ],
  surveillance: [ { code: "1", label: "Abscesso dentoalveolar" }, { code: "3", label: "Dor de dente" }, { code: "99", label: "Não identificado" } ],
  supplies: [ { code: "1", label: "Escova dental" }, { code: "2", label: "Creme dental" }, { code: "3", label: "Fio dental" } ],
  outcomes: [ { code: "1", label: "Encaminhamento: endodontia" }, { code: "10", label: "Retorno para consulta agendada" },
    { code: "11", label: "Agendamento para outro profissional" }, { code: "16", label: "Tratamento concluído" } ],
  situations: SITUATIONS
};
export const RESIN: DentalProcedureRef = { sigtap: "0307010031", name: "RESTAURAÇÃO DE DENTE PERMANENTE POSTERIOR COM RESINA COMPOSTA",
  locations: [ "face", "tooth" ], max_quantity: 32, auxiliary_allowed: false, prosthesis: false };
export const SCALING: DentalProcedureRef = { sigtap: "0307030024", name: "RASPAGEM SUPRAGENGIVAL (POR SEXTANTE)",
  locations: [ "sextant" ], max_quantity: 6, auxiliary_allowed: true, prosthesis: false };
export const FLUOR: DentalProcedureRef = { sigtap: "0101020074", name: "APLICAÇÃO TÓPICA DE FLÚOR (INDIVIDUAL POR SESSÃO)",
  locations: [ "mouth" ], max_quantity: 1, auxiliary_allowed: true, prosthesis: false };
export const DENTURE: DentalProcedureRef = { sigtap: "0701070137", name: "PRÓTESE TOTAL MAXILAR",
  locations: [ "arch" ], max_quantity: 2, auxiliary_allowed: false, prosthesis: true };

export const dentalUser = (roles = [ "health_professional" ], over: Partial<SessionUser> = {}) =>
  sessionWith(roles, { id: "us1", features: [ "clinical_record", "clinical_documents", "dental_care" ], ...over });
export const dentalOptions = (over: Partial<ConsultationOptions> = {}) =>
  options({ kinds: [ "dental" ], dental_role: "dentist", dental: DENTAL_VOCABULARY, ...over });
export const auxOptions = (over: Partial<ConsultationOptions> = {}) => dentalOptions({ dental_role: "auxiliary", ...over });
export function toothLoc(tooth: string, face: ToothFace | null = null): DentalLocation {
  return { kind: face ? "face" : "tooth", tooth, face, sextant: null, arch: null };
}
export function fields(over: Partial<DentalFields> = {}): DentalFields {
  return { care_type: "2", dental_consultation_type: "1", oral_health_surveillance: [ "99" ], supplies: [], dental_outcomes: [ "16" ],
    pregnant: false, special_needs: false, procedures: [], findings: [], plan_changes: { add: [], cancel: [] },
    periodontal_screening: null, periodontal_chart: null, endodontics: [], ...over };
}
export const dentalDraft = (over: Partial<Consultation> = {}) =>
  consultation({ kind: "dental", baseline: false, cbo_code: "223208", care_type: null, author: { id: "us1", name: "Dr. Caio Nunes" }, dental: fields(), ...over });
export const dentalFinalized = (over: Partial<Consultation> = {}) =>
  finalized({ kind: "dental", baseline: false, cbo_code: "223208", care_type: null, conducts: [], author: { id: "us1", name: "Dr. Caio Nunes" },
    dental: fields({ procedures: [ { id: "dpr1", sigtap: RESIN.sigtap, name: RESIN.name, location: toothLoc("16", "O"), quantity: 1, plan_item_id: "pi1" } ] }), ...over });
export function odontogram(over: Partial<Odontogram> = {}): Odontogram {
  const perm = [ 18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38 ];
  return { patient: { id: "pa1", display_name: "Joana Lima", has_cpf: true, cns_masked: null }, dentition: "permanent",
    teeth: perm.map(String).map((tooth) => ({ tooth, situation: tooth === "36" ? "missing" : "sound", root: null,
      faces: tooth === "16" ? { O: "caries" } : tooth === "26" ? { M: "restored", O: "restored" } : {},
      last_event_at: "2026-09-10T14:30:00-03:00", notes_count: 0 })),
    open_plans: [ { id: "dp1", health_unit: UBS } ], ...over };
}
export function chartEvent(over: Partial<ChartEvent> = {}): ChartEvent {
  return { id: "ev1", tooth: "16", part: "crown", face: "O", situation: "caries", procedure: null, consultation_id: "cs0", addendum_id: null,
    by: { name: "Dr. Caio Nunes", cbo: "223208" }, at: "2026-09-10T14:30:00-03:00", ...over };
}
export function planItem(over: Partial<DentalPlanItem> = {}): DentalPlanItem {
  return { id: "pi1", sigtap: RESIN.sigtap, name: RESIN.name, location: toothLoc("16", "O"), status: "planned",
    done_in_consultation_id: null, cancel_reason: null, ...over };
}
export function plan(over: Partial<DentalPlan> = {}): DentalPlan {
  return { id: "dp1", health_unit: UBS, status: "open", opened_in_consultation_id: "cs0", closed_in_consultation_id: null, items: [ planItem() ], ...over };
}
export function prosthesisOrder(over: Partial<ProsthesisOrder> = {}): ProsthesisOrder {
  return { id: "po1", patient: { id: "pa1", display_name: "Joana Lima" }, health_unit: UBS, sigtap: DENTURE.sigtap, name: DENTURE.name,
    laboratory: { care_provider_id: null, name: "Lab Sorriso" }, stage: "impression",
    stages: [ { stage: "impression", at: "2026-10-20T10:00:00-03:00", by: { name: "Dr. Caio Nunes" } } ],
    installed_in_consultation_id: null, ...over };
}
export const ceoProfile = (over: Partial<CeoProfile> = {}): CeoProfile =>
  ({ health_unit: { id: CEO_UNIT.id, name: CEO_UNIT.name }, ceo_type: "II", specialties: [ "endodontics", "periodontics", "oral_surgery", "special_needs" ], ...over });
export function ceoGoals(over: Partial<CeoGoals> = {}): CeoGoals {
  return { ceo_type: "II", specialties: [
    { key: "basic", goal: 110, done: 120, composition: { rule: "restorations_min_50", ok: true, value: "62.00" }, met: true },
    { key: "periodontics", goal: 90, done: 40, composition: null, met: false },
    { key: "endodontics", goal: 60, done: 70, composition: { rule: "three_roots_min_20", ok: false, value: "10.00" }, met: false },
    { key: "oral_surgery", goal: 90, done: 95, composition: null, met: true } ],
    misses_last_12: { periodontics: { consecutive: 1, total: 2 }, endodontics: { consecutive: 0, total: 1 } }, suspension_risk: true, ...over };
}
export const dentalTeam = (over: Partial<DentalTeam> = {}): DentalTeam =>
  ({ id: "t1", name: "eSB Centro 1", ine: "0001234567", health_unit: { id: UBS.id, name: UBS.name }, ...over });
