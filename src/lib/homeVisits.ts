// src/lib/homeVisits.ts
// Regras de tela da visita domiciliar e da atividade coletiva (módulo 24b; ADR 0052; contrato 2026-11-12 §3, §5–§9).
// As regras da visita (§3) vêm de `context.domains`: motivos, imóveis, faixas e limites nunca são escritos aqui (Q39).
// O api decide; aqui só se recusa antes o que ele recusaria e se traduzem os códigos. Nenhuma frase repete dado
// enviado (nome, documento, texto), e código desconhecido aparece cru.
import {
  ApiError, errorCode, type FichaSituation, type HomeVisitDomains, type HomeVisitInput, type MeasurementKey, type PatientSex, type QuickPatient,
  type VisitHousehold, type VisitHouseholdDetail, type VisitMeasurements, type VisitOutcome, type VisitSubject, type WhoToVisitReason, type HomeVisitTeam
} from "./api";
import { COUNT_QUERY, NOMINAL_QUERY, STATIC_QUERY, fmtDay } from "./careLines";
import { featureDisabledKey, featureLabel, hasFeature } from "./features";
import { cityLocalIso, parseCityLocal } from "./format";
import type { Refusal, Problem } from "./pharmacy";
import { FICHA_STATUS, reasonsLabel } from "./production";
import { canUseTerritory, territoryRoles, DUPLICATE_SUSPECTED_TEXT } from "./territoryRegistry";
import { newPatientProblem } from "./territoryDictionaries";

export { COUNT_QUERY, NOMINAL_QUERY, STATIC_QUERY, fmtDay };

// ─── Frases ─────────────────────────────────────────────────────────────────
export const HOME_VISITS_DISABLED = "a visita domiciliar está desligada nesta cidade";
export const COLLECTIVE_DISABLED = "a atividade coletiva está desligada nesta cidade";
export const HV_NO_ROLE = "seu papel não permite usar a visita domiciliar";
export const HV_CANNOT_REGISTER = "seu CBO não registra visita — enfermeiro e médico leem as visitas da equipe";
export const DAY_CHANGED = "a folha mudou enquanto a tela estava aberta — os dados foram relidos; confira antes de repetir";
export const VISIT_CHANGED = "a visita mudou enquanto a tela estava aberta — os dados foram relidos";
export const REPLAYED_VISIT = "Esta visita já estava gravada.";
export const OTHER_DAY_TEXT = (d: { day: string; sequence: number }): string =>
  `Visita registrada na folha de ${fmtDay(d.day)}${d.sequence > 1 ? ` (complementar ${d.sequence})` : ""}`;
export const CLOSE_EFFECT = "Depois de fechar, as visitas deste dia não mudam e a ficha de visita vai ao e-SUS.";
export const NETWORK_RETRY = "não foi possível confirmar a gravação — tente de novo: a mesma visita não é gravada duas vezes";
// Q50: a cidade desligou a exportação LEDI (a ficha sai `not_exported`).
export const LEDI_EXPORT_OFF = "Exportação para o e-SUS desligada nesta cidade";
// 422 `cbo_not_allowed` na atribuição de microárea é do profissional ESCOLHIDO (o 403 do mesmo código é de quem pede).
export const ASSIGNEE_CBO_NOT_ALLOWED = "este profissional não pode receber microárea (só CBOs de campo da Tabela 7, nunca o ACS responsável)";
const OFFLINE = "não foi possível falar com o servidor — tente de novo";
const SERVER_DOWN = "o servidor não respondeu — tente de novo";
const SESSION_EXPIRED = "sessão expirada — entre de novo";
const CHECK_FIELD = "confira o campo destacado";

// ─── Chaves de cache ────────────────────────────────────────────────────────
export const HV_CONTEXT_KEY = "hvContext";
export const HV_TODAY_KEY = "hvToday";
export const HV_DAYS_KEY = "hvDays";
export const HV_DAY_KEY = "hvDay";
export const HV_VISITS_KEY = "hvVisits";
export const HV_VISIT_KEY = "hvVisit";
export const HV_COUNT_KEY = "hvCount";
export const HV_HOUSEHOLDS_KEY = "hvHouseholds";
export const HV_HOUSEHOLD_KEY = "hvHousehold";
export const HV_ASSIGNMENTS_KEY = "hvAssignments";
export const WHO_KEY = "hvWho";
export const WHO_COUNT_KEY = "hvWhoCount";
export const CA_OPTIONS_KEY = "caOptions";
export const CA_LIST_KEY = "caList";
export const CA_DETAIL_KEY = "caDetail";
export const FD_KEY = "fieldDevices";
export const FD_ADMIN_KEY = "fieldDevicesAdmin";

// ─── Portões ────────────────────────────────────────────────────────────────
type SessionLike = Parameters<typeof canUseTerritory>[0];

// `home_visits` exige o cadastro territorial utilizável e o prontuário; nunca o operador da plataforma.
export function canUseHomeVisits(user: SessionLike): boolean {
  return canUseTerritory(user) && hasFeature(user, "home_visits");
}
// `collective_activities` exige só o prontuário (não o cadastro territorial).
export function canUseCollectiveActivities(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "collective_activities") && hasFeature(user, "clinical_record");
}
export function hvRoles(user: SessionLike): { professional: boolean; admin: boolean } {
  return territoryRoles(user);
}

// ─── Rótulos (código desconhecido aparece cru) ──────────────────────────────
const OUTCOME: Record<string, string> = { "1": "Visita realizada", "2": "Visita recusada", "3": "Ausente" };
const SHIFT: Record<string, string> = { "1": "Manhã", "2": "Tarde", "3": "Noite" };
const SUBJECT: Record<string, string> = { resident: "Morador", family_responsible: "Família — documento do responsável", none: "Imóvel sem pessoa" };
const ORIGIN: Record<string, string> = { dashboard: "Dashboard", field_app: "App de campo" };
const DAY_STATE: Record<string, string> = { open: "Aberta", closed: "Fechada" };
const CLOSED_BY: Record<string, string> = { job: "automático de madrugada", full: "folha cheia (99 visitas)" };
const REVOKED: Record<string, string> = {
  user: "por você", admin: "pelo administrador", membership_ended: "fim do vínculo na equipe", user_disabled: "usuário desativado"
};
const pick = (map: Record<string, string>, key: string | number): string => (Object.prototype.hasOwnProperty.call(map, String(key)) ? map[String(key)] : String(key));

export const outcomeLabel = (code: number | string): string => pick(OUTCOME, code);
export const shiftLabel = (code: number | string): string => pick(SHIFT, code);
export const subjectLabel = (code: string): string => pick(SUBJECT, code);
export const originLabel = (code: string): string => pick(ORIGIN, code);
export const dayStateLabel = (code: string): string => pick(DAY_STATE, code);
export const revokedReasonLabel = (code: string): string => pick(REVOKED, code);
// `own`: a folha é de quem olha ("por você") ou de outro ("pelo profissional").
export function closedByLabel(code: string | null | undefined, own = false): string {
  if (!code) return "—";
  if (code === "user") return own ? "por você" : "pelo profissional";
  return pick(CLOSED_BY, code);
}
export const reasonLabel = (domains: HomeVisitDomains, code: number): string => domains.motivo_visita.find((r) => r.code === code)?.label ?? String(code);
export const propertyLabel = (domains: HomeVisitDomains, code: string): string => domains.tipo_de_imovel.find((p) => p.code === code)?.label ?? code;
export const glucoseTypeLabel = (domains: HomeVisitDomains, code: number): string => domains.tipo_glicemia.find((g) => g.code === code)?.label ?? String(code);

// Situação da ficha de uma folha ou atividade (Q5): os da própria tela, os da Produção e o resto cru.
export function fichaLabel(f: { status: FichaSituation; reasons: string[] }): { text: string; tone: "neutral" | "info" | "ok" | "down" } {
  switch (f.status) {
    case "open": return { text: "folha aberta", tone: "neutral" };
    case "empty": return { text: "sem visita válida — sem ficha", tone: "neutral" };
    case "not_exported": return { text: "não exportada — exportação para o e-SUS desligada", tone: "neutral" };
    case "not_generated": return { text: `ficha não gerada: ${reasonsLabel(f.reasons)}`, tone: "down" };
    default: {
      const known = Object.prototype.hasOwnProperty.call(FICHA_STATUS, f.status) ? FICHA_STATUS[f.status] : null;
      return known ? { text: known.label, tone: known.tone } : { text: String(f.status), tone: "neutral" };
    }
  }
}

// "Pessoa com hipertensão · Visitas do agente de saúde · vencida desde 01/11/2026"; "cadastro vence em 20/12/2026".
export function whoReasonText(r: WhoToVisitReason): string {
  if (r.code === "care_line") {
    const c = r as Extract<WhoToVisitReason, { code: "care_line" }>;
    const when = c.due_on === null ? "nunca feita" : c.status === "overdue" ? `vencida desde ${fmtDay(c.due_on)}` : `vence em ${fmtDay(c.due_on)}`;
    return `${c.care_line} · ${c.practice} · ${when}`;
  }
  if (r.code === "registration_due") {
    const c = r as Extract<WhoToVisitReason, { code: "registration_due" }>;
    return c.status === "expired" ? `cadastro vencido em ${fmtDay(c.due_on)}` : `cadastro vence em ${fmtDay(c.due_on)}`;
  }
  if (r.code === "never_visited") return "nunca visitada";
  return r.code;
}

// Pendências da folha que impedem a ficha (§6). Código novo aparece cru.
export const BLOCKER_TEXT: Record<string, string> = {
  professional_without_cns: "Seu CNS não está no cadastro de profissionais",
  unit_without_cnes: "A unidade da equipe não tem CNES",
  cbo_not_in_ledi_table: "Seu CBO não está na tabela de quem registra visita no e-SUS",
  city_profile_incomplete: "O perfil da cidade está incompleto (UF ou código IBGE)",
  siaps_deadline_passed: "O prazo do SIAPS para esta competência já passou",
  // Q67: o CNS sozinho não basta; falta o motivo de não ter CPF no cadastro territorial.
  patient_without_identifier: "Pessoa visitada sem CPF e sem o motivo de não ter CPF — inclua o motivo no Cadastro territorial (o CNS sozinho não basta)",
  citizen_without_birth_date: "Pessoa visitada sem data de nascimento",
  citizen_without_sex: "Pessoa visitada sem sexo no cadastro"
};
export const blockerText = (code: string): string => (Object.prototype.hasOwnProperty.call(BLOCKER_TEXT, code) ? BLOCKER_TEXT[code] : code);

// ─── Regras da visita (§3), lidas de `domains` ──────────────────────────────
export const isNonResidential = (domains: HomeVisitDomains, propertyType: string): boolean => domains.non_residential_property_types.includes(propertyType);

export type OfferedReason = { code: number; label: string; group: string; group_label: string; disabled: string | null };
export const MALE_REASON_TEXT = "não se aplica a pessoa do sexo masculino";
export const FAMILY_REASON_TEXT = "com família ativa no domicílio, escolha a família";
export const REASON_NOT_OFFERED = "este motivo não vale para esta visita";

// Motivos da visita, agrupados na ordem do domínio. `subject` e `hasActiveFamily` (Q34/Q44): sem pessoa, só
// `without_person_allowed_reasons`, mais os do documento do responsável quando o domicílio não tem família ativa.
// Sem domicílio vale `hasActiveFamily: false`. `sex` é o da pessoa da ficha (o do responsável quando a visita vira da família, Q35/Q43).
export function reasonsFor(
  domains: HomeVisitDomains,
  o: { propertyType: string; outcome: VisitOutcome | null; sex: PatientSex | null; subject?: VisitSubject | null; hasActiveFamily?: boolean }
): OfferedReason[] {
  if (o.outcome !== 1) return [];
  const rows = domains.motivo_visita;
  if (isNonResidential(domains, o.propertyType)) {
    return rows.filter((r) => domains.non_residential_reasons.includes(r.code)).map((r) => ({ ...r, disabled: null }));
  }
  if (o.subject === "none") {
    const document = domains.responsible_document_reasons;
    return rows.flatMap((r): OfferedReason[] => {
      if (domains.without_person_allowed_reasons.includes(r.code)) return [ { ...r, disabled: null } ];
      if (!document.includes(r.code)) return [];
      return [ { ...r, disabled: o.hasActiveFamily ? FAMILY_REASON_TEXT : null } ];
    });
  }
  return rows.map((r) => ({ ...r, disabled: o.sex === "male" && domains.male_forbidden_reasons.includes(r.code) ? MALE_REASON_TEXT : null }));
}

const MEASUREMENT_KEYS: MeasurementKey[] = [ "weight_kg", "height_cm", "systolic", "diastolic", "temperature_c", "glucose_mg_dl" ];
export type MeasureDraft = Record<MeasurementKey | "glucose_type", string>;
export const EMPTY_MEASURES: MeasureDraft = { weight_kg: "", height_cm: "", systolic: "", diastolic: "", temperature_c: "", glucose_mg_dl: "", glucose_type: "" };
const MEASURE_LABEL: Record<MeasurementKey | "glucose_type", string> = {
  weight_kg: "peso (kg)", height_cm: "altura (cm)", systolic: "pressão sistólica", diastolic: "pressão diastólica", temperature_c: "temperatura (°C)",
  glucose_mg_dl: "glicemia (mg/dL)", glucose_type: "tipo da glicemia"
};
const WITHOUT_PERSON_NO_MEASURES: MeasurementKey[] = [ "weight_kg", "height_cm" ];

// Q34: por chave. Só visita realizada em imóvel residencial leva medida; sem pessoa, nunca peso e altura.
export function measurementsAllowed(
  domains: HomeVisitDomains, o: { propertyType: string; outcome: VisitOutcome | null; subject?: VisitSubject | null }
): Record<MeasurementKey, boolean> {
  const open = o.outcome === 1 && !isNonResidential(domains, o.propertyType);
  return Object.fromEntries(MEASUREMENT_KEYS.map((k) => [ k, open && !(o.subject === "none" && WITHOUT_PERSON_NO_MEASURES.includes(k)) ])) as Record<MeasurementKey, boolean>;
}
export const measurementsAnyAllowed = (allowed: Record<MeasurementKey, boolean>): boolean => Object.values(allowed).some(Boolean);

// Vírgula ou ponto; "" = null (sem medida); fora do formato = undefined.
export function parseMeasure(raw: string): number | null | undefined {
  const s = raw.trim();
  if (s === "") return null;
  return /^\d+([.,]\d+)?$/.test(s) ? Number(s.replace(",", ".")) : undefined;
}
const decimalsOf = (raw: string): number => (raw.trim().replace(",", ".").split(".")[1] ?? "").replace(/0+$/, "").length;
const filled = (raw: string | undefined): boolean => (raw ?? "").trim() !== "";
const rangeText = (min: number, max: number): string => `de ${String(min).replace(".", ",")} a ${String(max).replace(".", ",")}`;

// Faixa, casas (a tela recusa o excesso que o api arredondaria, Q72) e os pares pressão e glicemia.
export function measurementsProblems(domains: HomeVisitDomains, m: MeasureDraft): Problem[] {
  const out: Problem[] = [];
  const at = (key: MeasurementKey | "glucose_type", text: string) => out.push({ path: `measurements.${key}`, text });
  for (const key of MEASUREMENT_KEYS) {
    if (!filled(m[key])) continue;
    const range = domains.measurement_ranges[key];
    const value = parseMeasure(m[key]);
    if (value === null || value === undefined) { at(key, `${MEASURE_LABEL[key]}: informe um número`); continue; }
    if (value < range.min || value > range.max) { at(key, `${MEASURE_LABEL[key]}: ${rangeText(range.min, range.max)}`); continue; }
    if (decimalsOf(m[key]) > range.decimals) {
      at(key, range.decimals === 0 ? `${MEASURE_LABEL[key]}: só número inteiro` : `${MEASURE_LABEL[key]}: até ${range.decimals} ${range.decimals === 1 ? "casa decimal" : "casas decimais"}`);
    }
  }
  if (filled(m.systolic) && !filled(m.diastolic)) at("diastolic", "informe também a pressão diastólica");
  if (filled(m.diastolic) && !filled(m.systolic)) at("systolic", "informe também a pressão sistólica");
  if (filled(m.glucose_mg_dl) && !filled(m.glucose_type)) at("glucose_type", "escolha o tipo da glicemia");
  if (filled(m.glucose_type)) {
    if (!filled(m.glucose_mg_dl)) at("glucose_mg_dl", "informe também a glicemia");
    if (!domains.tipo_glicemia.some((g) => String(g.code) === m.glucose_type.trim())) at("glucose_type", "escolha o tipo da glicemia da lista");
  }
  return out;
}

// Data e hora de parede da cidade, com o deslocamento ("2026-11-12T09:15:00-03:00"); incompleto → null.
export function occurredAt(day: string, time: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{2}:\d{2}$/.test(time)) return null;
  return cityLocalIso(`${day}T${time}`);
}
// O turno nunca vai no corpo (o api o calcula pela hora); isto só mostra "Manhã/Tarde/Noite" ao lado da hora.
export function shiftPreview(time: string): string | null {
  const m = /^(\d{2}):\d{2}$/.exec(time);
  if (!m) return null;
  const hour = Number(m[1]);
  return SHIFT[hour < 12 ? "1" : hour < 18 ? "2" : "3"];
}

// ─── Rascunho, problemas e corpo da visita ──────────────────────────────────
export type VisitPlace =
  | { kind: "household"; householdId: string; propertyType: string; microAreaId: string | null }
  | { kind: "no_household"; propertyType: string; microAreaId: string | null; outOfArea: boolean };
export type VisitPerson =
  | { kind: "patient"; patientId: string; sex: PatientSex | null }
  | { kind: "new"; patient: QuickPatient; duplicatesReviewed: boolean };
export interface VisitDraft {
  day: string; time: string; place: VisitPlace | null; subject: VisitSubject | null; person: VisitPerson | null; familyId: string | null;
  outcome: VisitOutcome | null; reasons: number[]; shared: boolean; measurements: MeasureDraft; note: string;
}
export const emptyVisitDraft = (): VisitDraft => ({
  day: "", time: "", place: null, subject: null, person: null, familyId: null, outcome: null, reasons: [], shared: false,
  measurements: { ...EMPTY_MEASURES }, note: ""
});

// Domicílio como a tela o tem: com `residents` (detalhe) a conversão em família é conhecida; sem eles, não.
export type DraftHousehold = VisitHousehold & { residents?: VisitHouseholdDetail["residents"] };

const NO_PERSON_TEXT = "imóvel não residencial não leva dados de pessoa";
const propertyOf = (draft: VisitDraft, household?: DraftHousehold | null): string => household?.property_type ?? draft.place?.propertyType ?? "";
const isResidential = (domains: HomeVisitDomains, propertyType: string): boolean => propertyType !== "" && !isNonResidential(domains, propertyType);

type Conversion = { kind: "family"; sex: PatientSex | null } | { kind: "without_family" };
// Q43/Q51 (record.rb `family_visit`): morador com motivo 29/34–37 em imóvel residencial vira visita da FAMÍLIA dele (ativa neste
// domicílio) ou, sem ela, visita sem pessoa (a pessoa digitada não é cadastrada). Sem os moradores do domicílio, desconhecido (null).
function conversionOf(domains: HomeVisitDomains, draft: VisitDraft, household?: DraftHousehold | null): Conversion | null {
  if (draft.subject !== "resident" || !draft.person || !draft.place) return null;
  if (!draft.reasons.some((r) => domains.responsible_document_reasons.includes(r))) return null;
  if (!isResidential(domains, propertyOf(draft, household))) return null;
  if (draft.person.kind === "new") return { kind: "without_family" };
  if (draft.place.kind !== "household" || !household) return { kind: "without_family" };
  if (!household.residents) return null;
  const resident = household.residents.find((r) => r.patient_id === (draft.person as { patientId: string }).patientId);
  const family = resident?.family_id ? household.families.find((f) => f.id === resident.family_id && !f.moved_out) : undefined;
  return family ? { kind: "family", sex: family.responsible.sex } : { kind: "without_family" };
}

export const FAMILY_NOTICE = "A visita será registrada para a família, no nome do responsável";
export const NO_FAMILY_NOTICE = "Sem família ativa: a visita será registrada ao imóvel";
export const TYPED_NOT_REGISTERED = "A pessoa digitada não será cadastrada";

// Aviso antes de gravar (Q43/Q51); null quando a visita fica como foi escolhida.
export function familyVisitNotice(domains: HomeVisitDomains, draft: VisitDraft, household?: DraftHousehold | null): string | null {
  const conversion = conversionOf(domains, draft, household);
  if (!conversion) return null;
  if (conversion.kind === "family") return FAMILY_NOTICE;
  return draft.person?.kind === "new" ? `${NO_FAMILY_NOTICE}. ${TYPED_NOT_REGISTERED}` : NO_FAMILY_NOTICE;
}

// O que a regra do api vê: sujeito, família ativa e o sexo da pessoa da ficha, depois da conversão.
function effective(domains: HomeVisitDomains, draft: VisitDraft, household?: DraftHousehold | null): {
  subject: VisitSubject | null; hasActiveFamily: boolean; sex: PatientSex | null
} {
  const conversion = conversionOf(domains, draft, household);
  if (conversion?.kind === "family") return { subject: "family_responsible", hasActiveFamily: true, sex: conversion.sex };
  if (conversion?.kind === "without_family") return { subject: "none", hasActiveFamily: false, sex: null };
  const hasActiveFamily = household?.has_active_family ?? false;
  if (draft.subject === "resident" && draft.person) {
    return { subject: "resident", hasActiveFamily, sex: draft.person.kind === "patient" ? draft.person.sex : draft.person.patient.sex };
  }
  if (draft.subject === "family_responsible") {
    return { subject: "family_responsible", hasActiveFamily, sex: household?.families.find((f) => f.id === draft.familyId)?.responsible.sex ?? null };
  }
  return { subject: draft.subject, hasActiveFamily, sex: null };
}

export type VisitContext = { domains: HomeVisitDomains; today: string; minDate: string; team: HomeVisitTeam; household?: DraftHousehold | null; now?: Date };

// Code points depois do `trim` (o api conta assim).
export function textProblem(text: string, o: { min: number; max: number; path: string }): Problem | null {
  const n = [ ...text.trim() ].length;
  if (n >= o.min && n <= o.max) return null;
  return { path: o.path, text: o.min > 0 ? `escreva de ${o.min} a ${o.max} caracteres` : `escreva até ${o.max} caracteres` };
}

export function quickPatientProblems(p: QuickPatient, today: string): Problem[] {
  const found = newPatientProblem(p, today);
  return found ? [ { path: found.path, text: found.message } ] : [];
}

// Todas as recusas de uma vez (não para na primeira), com o `path` do api.
export function visitProblems(draft: VisitDraft, ctx: VisitContext): Problem[] {
  const { domains } = ctx;
  const out: Problem[] = [];
  const add = (path: string, text: string) => out.push({ path, text });

  const at = occurredAt(draft.day, draft.time);
  const moment = at ? parseCityLocal(`${draft.day}T${draft.time}`) : null;
  const outOfRange = `a data da visita vai de ${fmtDay(ctx.minDate)} até agora`;
  if (!at || !moment || draft.day < ctx.minDate || draft.day > ctx.today || moment.getTime() > (ctx.now ?? new Date()).getTime()) add("occurred_at", outOfRange);

  const place = draft.place;
  const property = propertyOf(draft, ctx.household);
  if (!place) add("household_id", "escolha o domicílio ou o imóvel sem cadastro");
  else if (place.kind === "no_household") {
    if (place.propertyType === "") add("property_type", "escolha o tipo de imóvel");
    if (!place.outOfArea && !place.microAreaId) add("micro_area_id", "escolha a microárea");
    if (place.outOfArea && !ctx.team.out_of_area_allowed) add("out_of_area", "fora de área é só para o ACS");
  }

  const nonResidential = property !== "" && isNonResidential(domains, property);
  const residential = isResidential(domains, property);
  if (nonResidential) {
    if (draft.person || (draft.subject && draft.subject !== "none")) add("subject", NO_PERSON_TEXT);
  } else if (residential) {
    if (!draft.subject) add("subject", "escolha quem foi visitado");
    else if (draft.subject === "resident" && !draft.person) add("patient_id", "escolha a pessoa visitada");
    else if (draft.subject === "family_responsible") {
      if (place?.kind !== "household") add("subject", "a visita à família precisa de um domicílio");
      else if (!draft.familyId) add("family_id", "escolha a família");
    }
    if (draft.subject === "resident" && draft.person?.kind === "new") out.push(...quickPatientProblems(draft.person.patient, ctx.today));
  }

  if (!draft.outcome) add("outcome", "escolha o desfecho");
  else if (draft.outcome !== 1) {
    if (draft.reasons.length > 0) add("reasons", "visita recusada ou ausente não leva motivo");
  } else if (property !== "") {
    const eff = effective(domains, draft, ctx.household);
    if (draft.reasons.length > domains.reasons_max) add("reasons", `no máximo ${domains.reasons_max} motivos`);
    const offered = reasonsFor(domains, { propertyType: property, outcome: 1, sex: eff.sex, subject: eff.subject, hasActiveFamily: eff.hasActiveFamily });
    draft.reasons.forEach((code, i) => {
      const row = offered.find((r) => r.code === code);
      if (draft.reasons.indexOf(code) !== i) add(`reasons[${i}]`, "motivo repetido");
      else if (!row) add(`reasons[${i}]`, REASON_NOT_OFFERED);
      else if (row.disabled) add(`reasons[${i}]`, row.disabled);
    });
  }

  if (draft.outcome) {
    const eff = effective(domains, draft, ctx.household);
    const allowed = measurementsAllowed(domains, { propertyType: property, outcome: draft.outcome, subject: eff.subject });
    const refused = new Set<string>();
    for (const key of MEASUREMENT_KEYS) {
      if (filled(draft.measurements[key]) && !allowed[key]) { add(`measurements.${key}`, "esta medida não vale para esta visita"); refused.add(key); }
    }
    if (filled(draft.measurements.glucose_type) && !allowed.glucose_mg_dl) { add("measurements.glucose_type", "esta medida não vale para esta visita"); refused.add("glucose_type"); }
    for (const p of measurementsProblems(domains, draft.measurements)) if (!refused.has(p.path.replace("measurements.", ""))) out.push(p);
  }

  const note = textProblem(draft.note, { min: 0, max: 500, path: "note" });
  if (note) out.push(note);
  return out;
}

const present = <T extends object>(o: T): Partial<T> =>
  Object.fromEntries(Object.entries(o).filter(([ , v ]) => v !== null && v !== undefined && !(typeof v === "string" && v.trim() === ""))) as Partial<T>;

// O corpo do POST /home_visits (sem `client_uuid` nem `team_id`, que a tela acrescenta). Opcional vazio não vai; com domicílio, nunca
// imóvel nem microárea; `out_of_area` só como true; nenhum turno (o api o calcula).
export function visitBody(draft: VisitDraft): Omit<HomeVisitInput, "client_uuid" | "team_id"> {
  const place = draft.place;
  const subject: VisitSubject = draft.subject ?? "none";
  const m: VisitMeasurements = {};
  for (const key of MEASUREMENT_KEYS) {
    const v = parseMeasure(draft.measurements[key]);
    if (typeof v === "number") m[key] = v;
  }
  if (filled(draft.measurements.glucose_type)) m.glucose_type = Number(draft.measurements.glucose_type);
  const note = draft.note.trim();
  const person = draft.person;
  return {
    occurred_at: occurredAt(draft.day, draft.time) ?? "",
    ...(place?.kind === "household" ? { household_id: place.householdId } : {}),
    ...(place?.kind === "no_household" ? {
      property_type: place.propertyType, ...(place.outOfArea ? { out_of_area: true } : { micro_area_id: place.microAreaId ?? undefined })
    } : {}),
    subject,
    ...(subject === "resident" && person?.kind === "patient" ? { patient_id: person.patientId } : {}),
    ...(subject === "resident" && person?.kind === "new" ? {
      new_patient: present(person.patient) as QuickPatient, ...(person.duplicatesReviewed ? { duplicates_reviewed: true } : {})
    } : {}),
    ...(subject === "family_responsible" && draft.familyId ? { family_id: draft.familyId } : {}),
    outcome: (draft.outcome ?? 1) as VisitOutcome,
    reasons: draft.reasons,
    shared: draft.shared,
    ...(Object.keys(m).length > 0 ? { measurements: m } : {}),
    ...(note !== "" ? { note } : {})
  };
}

// ─── Erros do api ───────────────────────────────────────────────────────────
export function duplicateParticipantText(confirmable: boolean): string {
  return confirmable
    ? "este participante parece repetido — se for outra pessoa, confirme; ao confirmar, o api não confere duplicados dele de novo"
    : "este participante já está na lista (mesmo paciente, CPF ou CNS) — retire o repetido";
}

export const HOME_VISIT_ERRORS: Record<string, string> = {
  // herdados (convenções e contrato)
  feature_disabled: HOME_VISITS_DISABLED,
  mfa_required: "confirme sua identidade com o segundo fator e tente de novo",
  not_found: "não encontrado — os dados foram relidos",
  invalid_request: "pedido inválido — recarregue a tela e tente de novo",
  invalid_cursor: "a lista mudou — ela será lida do início",
  invalid_limit: "tamanho de página inválido — recarregue a tela",
  // Q67/Q68: vale para as buscas de pessoa e para as duas gravações; nada foi gravado, o formulário fica como está.
  too_many_requests: "muitas buscas de pessoa em pouco tempo — espere um minuto e tente de novo",
  payload_too_large: "o envio é grande demais — reduza o texto",
  missing_role: "seu papel não permite esta ação",
  // §13
  cbo_not_allowed: "seu CBO não permite esta ação",
  out_of_scope: "esta microárea não está no seu escopo",
  invalid_home_visit: CHECK_FIELD,
  visit_date_out_of_range: "a data da visita está fora do período aceito — confira a data e o prazo do SIAPS da competência",
  non_residential_with_person: NO_PERSON_TEXT,
  reasons_forbidden: "visita recusada ou ausente não leva motivo",
  reason_not_allowed: REASON_NOT_OFFERED,
  measurements_forbidden: "esta medida não vale para esta visita",
  patient_in_other_household: "esta pessoa tem cadastro ativo em outro domicílio — visite-a por lá",
  family_without_responsible: "a família está sem responsável ativo — escolha a pessoa moradora",
  day_changed: DAY_CHANGED,
  day_closed: "esta folha já foi fechada — a visita não pode mais ser retirada",
  visit_changed: VISIT_CHANGED,
  invalid_collective_activity: CHECK_FIELD,
  activity_date_out_of_range: "a data da atividade está fora do período aceito — confira a data e o prazo do SIAPS da competência",
  duplicate_participant: duplicateParticipantText(false),
  professional_without_cns: "este profissional não tem CNS no cadastro de profissionais",
  activity_changed: "esta atividade foi marcada como registrada por engano — a ficha não é gerada de novo",
  duplicate_suspected: DUPLICATE_SUSPECTED_TEXT,
  cpf_taken: "este CPF já pertence a outro paciente — confira o número",
  cns_taken: "este CNS já pertence a outro paciente — confira o número",
  already_assigned: "esta microárea já está atribuída a este profissional",
  device_limit: "você já tem 3 aparelhos ativos — revogue um antes de cadastrar outro",
  // Q21
  household_inactive: "o domicílio está inativo — escolha outro ou registre o imóvel sem cadastro",
  family_moved_out: "a família se mudou do domicílio — escolha outra pessoa",
  micro_area_inactive: "a microárea está inativa",
  assignment_already_ended: "esta atribuição já foi encerrada — a lista foi relida",
  device_already_revoked: "este aparelho já foi revogado — a lista foi relida",
  // do 24a, que a busca e o registro rápido devolvem
  invalid_cpf: "CPF inválido: confira os 11 dígitos",
  invalid_cns: "CNS inválido: confira os 15 dígitos",
  // Só o cadastro do 24a devolve este; a frase fica por segurança, nenhuma rota do 24b o manda (Q73).
  identity_locked: "a identidade desta pessoa já foi validada presencialmente — não se altera aqui",
  person_not_found: "nenhuma pessoa com este documento — preencha os dados para cadastrar",
  citizen_not_verified: "este CPF tem cadastro declarado pelo cidadão, ainda sem validação presencial — valide a identidade antes",
  // pré-voo §2.3 e Q71
  patient_unidentified: "pessoa com cadastro provisório da urgência (sem identificação) não pode ser registrada aqui — identifique-a no posto antes",
  invalid_patient: "confira o campo destacado da pessoa digitada",
  cpf_or_reason_required: "informe o CPF ou o motivo de não ter CPF",
  client_uuid_conflict: "este envio já foi usado por outro registro — a tela gerou um novo identificador; confira os dados e grave de novo"
};

export type HomeVisitRefusal = Refusal & { confirmable?: boolean };
const CODE_FORMAT = /^[a-z0-9_]{1,64}$/;
const PATH_FORMAT = /^[a-z0-9_.[\]-]{1,64}$/;
const safeCode = (v: unknown): string => (typeof v === "string" && CODE_FORMAT.test(v) ? v : "");
const safePath = (v: unknown): string => (typeof v === "string" && PATH_FORMAT.test(v) ? v : "");
const bodyOf = (err: unknown): Record<string, unknown> | null =>
  err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as Record<string, unknown>) : null;

function disabledText(err: ApiError): string | null {
  const key = featureDisabledKey(err);
  if (key === null) return null;
  if (key === "collective_activities") return COLLECTIVE_DISABLED;
  return key === "" || key === "home_visits" ? HOME_VISITS_DISABLED : `${featureLabel(key)} está desligado nesta cidade`;
}

function codeText(code: string, status: number, confirmable: boolean): string {
  if (code === "duplicate_participant") return duplicateParticipantText(confirmable);
  if (Object.prototype.hasOwnProperty.call(HOME_VISIT_ERRORS, code)) return HOME_VISIT_ERRORS[code];
  if (code === "") {
    if (status === 404) return HOME_VISIT_ERRORS.not_found;
    if (status === 429) return HOME_VISIT_ERRORS.too_many_requests;
    if (status >= 500) return SERVER_DOWN;
    return `recusado pelo servidor (${status})`;
  }
  return `recusado pelo servidor (${code})`;
}

// Todas as recusas, uma por `problems[]` (o 24b só manda `error` e `path` no topo, mas lê as duas formas); a do topo se não houver lista.
// `path` leva a recusa ao campo; sem ele, `""` (frase geral). `confirmable` segue na recusa de participante repetido.
export function homeVisitRefusals(err: unknown): HomeVisitRefusal[] {
  if (!(err instanceof ApiError)) return [ { path: "", code: "", text: OFFLINE } ];
  const disabled = disabledText(err);
  if (disabled) return [ { path: "", code: "feature_disabled", text: disabled } ];
  if (err.status === 401) return [ { path: "", code: "unauthenticated", text: SESSION_EXPIRED } ];
  const body = bodyOf(err);
  const one = (row: Record<string, unknown> | null): HomeVisitRefusal => {
    const raw = row?.error ?? row?.code;
    const code = safeCode(raw);
    const confirmable = typeof row?.confirmable === "boolean" ? row.confirmable : undefined;
    const text = typeof raw === "string" && raw !== "" && code === "" ? "recusado pelo servidor" : codeText(code, err.status, confirmable === true);
    return { path: safePath(row?.path), code, text, ...(confirmable === undefined ? {} : { confirmable }) };
  };
  const list = Array.isArray(body?.problems) ? (body!.problems as unknown[]) : [];
  const mapped = list.flatMap((item): HomeVisitRefusal[] =>
    item && typeof item === "object" && (typeof (item as Record<string, unknown>).error === "string" || typeof (item as Record<string, unknown>).code === "string")
      ? [ one(item as Record<string, unknown>) ] : []);
  return mapped.length > 0 ? mapped : [ one(body) ];
}

export const homeVisitError = (err: unknown): string => homeVisitRefusals(err)[0].text;

// A tela está velha: a folha ou a visita mudou, fechou ou sumiu. Quem chama relê uma vez e não reenvia sozinho.
export const isDayStale = (err: unknown): boolean => [ "day_changed", "day_closed", "visit_changed", "not_found" ].includes(errorCode(err) ?? "");
// Não houve resposta do api, ou ele falhou: não se sabe se gravou. Guarda o `client_uuid` e tenta de novo com o mesmo.
export const isNetworkOrServer = (err: unknown): boolean => !(err instanceof ApiError) || err.status >= 500;
