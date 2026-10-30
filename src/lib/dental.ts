// Saúde bucal (módulo 28; ADR 0046; contrato §3–§10 e §16). Regras fora do React: portão e papel, dentes e locais,
// mudanças do rascunho, limites, o que falta para finalizar (espelho dos 422 — quem garante é o api), recusas e
// painéis. Os rótulos da FAO e das situações vêm só de `consultation_options.dental` (O4): aqui não há tabela de
// código → rótulo para eles, e código sem rótulo aparece cru. Nenhuma frase repete dado clínico.
import {
  ApiError, type Arch, type CeoSpecialty, type CeoType, type CodedOption, type Consultation, type ConsultationKind, type ConsultationOptions,
  type DentalFields, type DentalFinding, type DentalLocation, type DentalPlan, type DentalPlanItem, type DentalProcedureLine, type DentalRole,
  type DentalVocabulary, type Dentition, type EndodonticEntry, type OdontogramTooth, type PeriodontalChart, type PeriodontalScreening,
  type PerioSite, type PlanAdd, type PlanCancel, type ProsthesisStage, type Sextant, type ToothFace
} from "./api";
import { hasFeature } from "./features";
import { careLineRoles, NOMINAL_QUERY, STATIC_QUERY } from "./careLines";
import { codedLabel, consultationError } from "./consultation";

export { NOMINAL_QUERY, STATIC_QUERY };

export const DENTAL_DISABLED = "a saúde bucal está desligada nesta cidade";
export const DENTAL_NO_ROLE = "seu papel não permite usar a saúde bucal";
export const DENTAL_CHART_KEY = "dentalChart";
export const CHART_EVENTS_KEY = "dentalChartEvents";
export const DENTAL_PLANS_KEY = "dentalPlans";
export const ENDO_KEY = "endodonticTreatments";
export const PROSTHESIS_KEY = "prosthesisOrders";
export const LABS_KEY = "dentalLaboratories";
export const CEO_PROFILES_KEY = "ceoProfiles";
export const AUX_PROCEDURES_KEY = "auxiliaryProcedures";
export const CEO_GOALS_KEY = "ceoGoals";
export const DENTAL_TEAMS_KEY = "dentalTeams";
export const DENTAL_INDICATORS_KEY = "dentalIndicators";

type Situations = DentalVocabulary["situations"];
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// ─── Portão e papel ──────────────────────────────────────────────────────────
// `dental_care` exige o prontuário (`clinical_record`); nunca para o operador da plataforma.
export function canUseDental(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "dental_care") && hasFeature(user, "clinical_record");
}

export function dentalRoles(user: SessionLike): { professional: boolean; admin: boolean; analyst: boolean } {
  return careLineRoles(user);
}

const AUXILIARY_CBOS = [ "322405", "322425", "322415", "322430" ];
export function dentalRole(cbo: string | null | undefined): DentalRole | null {
  if (!cbo) return null;
  if (cbo.startsWith("2232")) return "dentist";
  return AUXILIARY_CBOS.includes(cbo) ? "auxiliary" : null;
}

// Tipos de consulta oferecidos: o `kinds` do api (ausente = geral), sem o odontológico com o interruptor desligado.
export function offeredKinds(options: ConsultationOptions | undefined, dentalOn: boolean): ConsultationKind[] {
  const kinds = options?.kinds ?? [ "general" ];
  return dentalOn ? kinds : kinds.filter((k) => k !== "dental");
}

// ─── Dentes, faces e locais ──────────────────────────────────────────────────
const range = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let n = from; n !== to + Math.sign(to - from); n += Math.sign(to - from)) out.push(n);
  return out;
};
const teeth = (quadrantA: number, quadrantB: number, count: number): string[] =>
  [ ...range(count, 1).map((n) => `${quadrantA}${n}`), ...range(1, count).map((n) => `${quadrantB}${n}`) ];

const PERMANENT_UPPER = teeth(1, 2, 8);
const PERMANENT_LOWER = teeth(4, 3, 8);
const DECIDUOUS_UPPER = teeth(5, 6, 5);
const DECIDUOUS_LOWER = teeth(8, 7, 5);

// Linhas de cima para baixo, como o desenho do odontograma.
export function chartRows(dentition: Dentition): string[][] {
  if (dentition === "deciduous") return [ DECIDUOUS_UPPER, DECIDUOUS_LOWER ];
  if (dentition === "mixed") return [ PERMANENT_UPPER, DECIDUOUS_UPPER, DECIDUOUS_LOWER, PERMANENT_LOWER ];
  return [ PERMANENT_UPPER, PERMANENT_LOWER ];
}

export function isDeciduous(tooth: string): boolean {
  return /^[5-8]/.test(tooth);
}

// quadrante → [posterior, anterior]; posterior = dentes 4 em diante.
const SEXTANTS: Record<string, [ Sextant, Sextant ]> = {
  "1": [ "S1", "S2" ], "5": [ "S1", "S2" ], "2": [ "S3", "S2" ], "6": [ "S3", "S2" ],
  "3": [ "S4", "S5" ], "7": [ "S4", "S5" ], "4": [ "S6", "S5" ], "8": [ "S6", "S5" ]
};
export function toothSextant(tooth: string): Sextant {
  const [ posterior, anterior ] = SEXTANTS[tooth[0]] ?? SEXTANTS["1"];
  return Number(tooth[1]) >= 4 ? posterior : anterior;
}

// Mesial sempre para o meio da boca: quadrantes 1, 4, 5 e 8 ficam à esquerda da tela.
export function faceLayout(tooth: string): { top: ToothFace; bottom: ToothFace; left: ToothFace; right: ToothFace } {
  const upper = "1256".includes(tooth[0]);
  const leftSide = "1458".includes(tooth[0]);
  return {
    top: upper ? "V" : "L", bottom: upper ? "L" : "V",
    left: leftSide ? "D" : "M", right: leftSide ? "M" : "D"
  };
}

export const FACE_LABEL: Record<ToothFace, string> = { M: "mesial", D: "distal", O: "oclusal/incisal", V: "vestibular", L: "lingual/palatina" };
export const FACES: ToothFace[] = [ "M", "D", "O", "V", "L" ];
const ARCH_LABEL: Record<Arch, string> = { upper: "superior", lower: "inferior" };

export function locationLabel(loc: DentalLocation): string {
  if (loc.kind === "tooth") return `dente ${loc.tooth}`;
  if (loc.kind === "face") return `dente ${loc.tooth}, face ${loc.face ? FACE_LABEL[loc.face] : ""}`.trim();
  if (loc.kind === "sextant") return `sextante ${loc.sextant}`;
  if (loc.kind === "arch") return `arcada ${loc.arch ? ARCH_LABEL[loc.arch] : ""}`.trim();
  return "boca toda";
}
export function locationKey(loc: DentalLocation): string {
  return [ loc.kind, loc.tooth ?? "", loc.face ?? "", loc.sextant ?? "", loc.arch ?? "" ].join(":");
}
export const sextantLoc = (sextant: Sextant): DentalLocation => ({ kind: "sextant", tooth: null, face: null, sextant, arch: null });
export const archLoc = (arch: Arch): DentalLocation => ({ kind: "arch", tooth: null, face: null, sextant: null, arch });
export const MOUTH: DentalLocation = { kind: "mouth", tooth: null, face: null, sextant: null, arch: null };

// ─── Situações (vocabulário do api; O3, O4) ──────────────────────────────────
export type SituationGroup = keyof Situations;
const GROUPS: SituationGroup[] = [ "crown", "root", "face", "arch" ];

// Rótulo do vocabulário; código desconhecido (ou sem vocabulário) aparece cru.
export function situationLabel(code: string, situations?: Situations, group?: SituationGroup): string {
  if (!situations) return code;
  const order = group ? [ group, ...GROUPS.filter((g) => g !== group) ] : GROUPS;
  for (const g of order) {
    const hit = situations[g]?.find((o) => o.code === code);
    if (hit) return hit.label;
  }
  return code;
}

// Sigla visível (a situação nunca é só cor): 3 letras do rótulo; sem rótulo, o código cru curto.
export function situationAbbr(code: string, situations?: Situations, group?: SituationGroup): string {
  const label = situationLabel(code, situations, group);
  return label === code ? code.slice(0, 4).toUpperCase() : label.normalize("NFD").replace(/[^\p{L}]/gu, "").slice(0, 3).toUpperCase();
}

const TONES: Record<string, string> = {
  caries: "down", restored_with_caries: "down", root_caries: "down", residual_root: "down",
  extraction_indicated: "warn", sealant_indicated: "warn", fracture: "warn", furcation_lesion: "warn", calculus: "warn",
  active_white_spot: "warn", gingival_recession: "warn",
  restored: "info", crown: "info", endodontics: "info", implant: "info", post: "info", complete_denture: "info", abutment: "info",
  removable_partial_denture: "info", crown_unit_prosthesis: "info", temporary_prosthesis: "info",
  sound: "ok", sound_sealed: "ok"
};
export function situationTone(code: string): string {
  return TONES[code] ?? "neutral";
}

// Decíduo nunca recebe estas (situation_not_allowed_for_tooth); furca só em molares e pré-molares.
const NOT_DECIDUOUS = [ "crown", "abutment", "removable_partial_denture", "crown_unit_prosthesis", "temporary_prosthesis" ];
const FURCATION_TEETH = /^[1-4][4-8]$/;
export function situationAllowedFor(code: string, group: SituationGroup, tooth?: string | null): boolean {
  if (!tooth) return true;
  if (group === "crown" && isDeciduous(tooth)) return !NOT_DECIDUOUS.includes(code);
  if (group === "root" && code === "furcation_lesion") return FURCATION_TEETH.test(tooth);
  return true;
}
// O que a tela oferece para a parte (e, com o dente, só o que o api aceita nele).
export function situationsFor(group: SituationGroup, situations?: Situations, tooth?: string | null): CodedOption[] {
  return (situations?.[group] ?? []).filter((o) => situationAllowedFor(o.code, group, tooth));
}

export function toothAriaLabel(t: OdontogramTooth | undefined, tooth: string, situations?: Situations, pendingCount = 0): string {
  const lower = (code: string, group: SituationGroup) => situationLabel(code, situations, group).toLowerCase();
  const parts = [ `Dente ${tooth}: ${t?.situation ? lower(t.situation, "crown") : "sem registro"}` ];
  if (t?.root && t.root !== "none") parts.push(`raiz: ${lower(t.root, "root")}`);
  for (const face of FACES) {
    const code = t?.faces?.[face];
    if (code) parts.push(`face ${FACE_LABEL[face]}: ${lower(code, "face")}`);
  }
  if (pendingCount > 0) parts.push(`${pendingCount} ${pendingCount === 1 ? "marcação" : "marcações"} nesta consulta`);
  return parts.join("; ");
}

// ─── FAO: lógica (os rótulos vêm das opções) ─────────────────────────────────
export const REFERRAL_OUTCOMES = [ "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11" ];
export const isReferralOutcome = (code: string): boolean => REFERRAL_OUTCOMES.includes(code);
export { codedLabel };

// "99" (não identificado) exclui os demais, e vice-versa.
export function toggleSurveillance(list: string[], code: string): string[] {
  if (list.includes(code)) return list.filter((c) => c !== code);
  return code === "99" ? [ "99" ] : [ ...list.filter((c) => c !== "99"), code ];
}

// ─── Mudanças do rascunho ────────────────────────────────────────────────────
const sameFinding = (a: DentalFinding, b: DentalFinding) =>
  a.tooth === b.tooth && a.face === b.face && a.part === b.part && (a.arch ?? null) === (b.arch ?? null);
const without = <T>(list: T[], i: number): T[] => list.filter((_, n) => n !== i);

export function withFinding(f: DentalFields, x: DentalFinding): DentalFields {
  return { ...f, findings: [ ...f.findings.filter((y) => !sameFinding(x, y)), x ] };
}
export function withoutFinding(f: DentalFields, i: number): DentalFields {
  return { ...f, findings: without(f.findings, i) };
}
export function withProcedure(f: DentalFields, line: DentalProcedureLine): DentalFields {
  return { ...f, procedures: [ ...f.procedures, line ] };
}
export function withoutProcedure(f: DentalFields, i: number): DentalFields {
  return { ...f, procedures: without(f.procedures, i) };
}
export function linkPlanItem(f: DentalFields, i: number, itemId: string | null): DentalFields {
  return { ...f, procedures: f.procedures.map((p, n) => (n === i ? { ...p, plan_item_id: itemId } : p)) };
}
export function withPlanAdd(f: DentalFields, add: PlanAdd): DentalFields {
  return { ...f, plan_changes: { ...f.plan_changes, add: [ ...f.plan_changes.add, add ] } };
}
// Um cancelamento por item: o novo motivo substitui o anterior.
export function withPlanCancel(f: DentalFields, c: PlanCancel): DentalFields {
  return { ...f, plan_changes: { ...f.plan_changes, cancel: [ ...f.plan_changes.cancel.filter((x) => x.item_id !== c.item_id), c ] } };
}
export function withoutPlanChange(f: DentalFields, kind: "add" | "cancel", i: number): DentalFields {
  return { ...f, plan_changes: { ...f.plan_changes, [kind]: without(f.plan_changes[kind] as unknown[], i) } as DentalFields["plan_changes"] };
}

// ─── Limites por local (recusar em vez de cortar) ────────────────────────────
export const LOCATION_LIMIT = { tooth: 32, face: 32, sextant: 6, arch: 2, mouth: 1 } as const;
type LimitGroup = "tooth" | "sextant" | "arch" | "mouth";
const GROUP_OF: Record<DentalLocation["kind"], LimitGroup> = { tooth: "tooth", face: "tooth", sextant: "sextant", arch: "arch", mouth: "mouth" };
const GROUP_LABEL: Record<LimitGroup, string> = { tooth: "dente", sextant: "sextante", arch: "arcada", mouth: "boca toda" };
const INTEGER_PHRASE = "a quantidade é um número inteiro a partir de 1";

export function quantityProblems(procs: DentalProcedureLine[]): string[] {
  const bySigtap = new Map<string, DentalProcedureLine[]>();
  for (const p of procs) bySigtap.set(p.sigtap, [ ...(bySigtap.get(p.sigtap) ?? []), p ]);
  const out: string[] = [];
  for (const lines of bySigtap.values()) {
    const name = lines.find((l) => l.name)?.name ?? lines[0].sigtap;
    const valid = lines.filter((l) => Number.isInteger(l.quantity) && l.quantity >= 1);
    if (valid.length < lines.length) out.push(`${name}: ${INTEGER_PHRASE}`);
    const totals = new Map<LimitGroup, number>();
    for (const l of valid) totals.set(GROUP_OF[l.location.kind], (totals.get(GROUP_OF[l.location.kind]) ?? 0) + l.quantity);
    for (const [ group, total ] of totals) {
      if (total > LOCATION_LIMIT[group]) out.push(`${name}: no máximo ${LOCATION_LIMIT[group]} por ${GROUP_LABEL[group]} nesta consulta`);
    }
  }
  return out;
}

// ─── Plano ───────────────────────────────────────────────────────────────────
export type PlanItemState = "planned" | "done_here" | "cancelled_here" | "done" | "cancelled";
export function planItemsAfter(plan: DentalPlan | null, f: DentalFields): { item: DentalPlanItem; state: PlanItemState }[] {
  return (plan?.items ?? []).map((item) => {
    if (item.status === "done") return { item, state: "done" };
    if (item.status === "cancelled") return { item, state: "cancelled" };
    if (f.procedures.some((p) => p.plan_item_id === item.id)) return { item, state: "done_here" };
    if (f.plan_changes.cancel.some((c) => c.item_id === item.id)) return { item, state: "cancelled_here" };
    return { item, state: "planned" };
  });
}

// O26: plano aberto com ao menos 1 item, nenhum `planned` depois do rascunho e nenhuma inclusão nova.
export function suggestCompleted(plan: DentalPlan | null, f: DentalFields): boolean {
  if (!plan || plan.status !== "open" || plan.items.length === 0 || f.plan_changes.add.length > 0) return false;
  return planItemsAfter(plan, f).every((x) => x.state !== "planned");
}

// Dentista; no CEO sempre; na UBS com plano aberto, ou sem plano só na primeira consulta programática (O6, D11).
export function canAddPlanItems(unit: { kind: string }, plan: DentalPlan | null, f: DentalFields, role: DentalRole): boolean {
  if (role !== "dentist") return false;
  if (unit.kind === "ceo") return true;
  return plan?.status === "open" || f.dental_consultation_type === "1";
}

// ─── Finalização (espelho das recusas do contrato §4, O7, O8, O22) ───────────
export interface DentalCheckCtx { role: DentalRole; baseline: boolean; sex: "female" | "male"; problemsCount: number }

const PROBLEM_TEXT: Record<string, string> = {
  care_type_required: "escolha o tipo de atendimento",
  oral_health_surveillance_required: "marque a vigilância em saúde bucal (ou \"não identificado\")",
  dental_consultation_type_required: "consulta agendada exige o tipo de consulta odontológica",
  dental_consultation_type_forbidden: "escuta inicial não leva tipo de consulta odontológica",
  return_forbidden_on_urgency: "atendimento de urgência não pode ser consulta de retorno",
  dental_outcome_required: "marque ao menos um desfecho",
  completed_requires_first_or_return: "\"tratamento concluído\" só vale com primeira consulta programática ou retorno",
  discharge_forbidden_with_first_or_return: "\"alta do episódio\" não vale com primeira consulta programática ou retorno",
  pregnant_required: "informe se a paciente está gestante",
  pregnant_forbidden_male: "gestante não se aplica a paciente do sexo masculino",
  problem_required: "inclua ao menos um problema (CID-10 ou CIAP-2)",
  auxiliary_cannot_refer: "TSB e ASB não registram encaminhamento",
  auxiliary_procedure_not_allowed: "procedimento fora da lista do TSB/ASB da cidade",
  auxiliary_cannot_plan: "TSB e ASB não criam nem cancelam item do plano",
  auxiliary_cannot_issue: "TSB e ASB não emitem documento",
  quantity_exceeds_location_limit: "quantidade acima do limite do local",
  baseline_only_findings: "o registro inicial só aceita a situação dos dentes",
  baseline_requires_findings: "marque ao menos um dente no registro inicial",
  baseline_requires_dentist: "só o dentista faz o registro inicial do odontograma",
  plan_item_not_open: "um item do plano já foi feito ou cancelado em outra consulta — o plano foi relido; confira o procedimento",
  plan_requires_first_consultation: "na UBS, o plano começa na primeira consulta programática",
  dental_referral_request_required: "o encaminhamento ao CEO precisa do pedido de regulação da especialidade",
  cbo_not_allowed: "seu CBO não registra consulta odontológica",
  invalid_transition: "o pedido de prótese mudou de etapa — a lista foi relida",
  invalid_location: "o local não vale para este procedimento",
  invalid_procedure: "o procedimento não vale para o local escolhido",
  invalid_situation: "situação não reconhecida para esta parte do dente",
  situation_not_allowed_for_tooth: "esta situação não vale para este dente",
  prosthesis_order_not_received: "o pedido de prótese ainda não foi recebido do laboratório",
  prosthesis_order_mismatch: "o pedido de prótese não corresponde a este paciente ou procedimento",
  installation_through_consultation: "a instalação da prótese se registra pela consulta, não pelas etapas",
  reason_required: "informe o motivo (10 a 500 caracteres)",
  unit_not_ceo: "esta unidade não é um CEO",
  feature_disabled: DENTAL_DISABLED
};

// Código desconhecido aparece cru, nunca some.
export function dentalProblemText(code: string): string {
  return PROBLEM_TEXT[code] ?? code;
}

export function pregnantFor(f: DentalFields, sex: "female" | "male"): boolean | null {
  return sex === "male" ? null : f.pregnant;
}

export function dentalFinalizeProblems(f: DentalFields, ctx: DentalCheckCtx): { code: string; text: string }[] {
  const out: { code: string; text: string }[] = [];
  const add = (code: string, text = dentalProblemText(code)) => out.push({ code, text });
  if (ctx.baseline) {
    const extras = f.procedures.length > 0 || f.dental_outcomes.length > 0 || !!f.dental_consultation_type || !!f.care_type
      || f.plan_changes.add.length > 0 || f.plan_changes.cancel.length > 0;
    if (extras) add("baseline_only_findings");
    if (f.findings.length === 0) add("baseline_requires_findings");
    return out;
  }
  const firstOrReturn = f.dental_consultation_type === "1" || f.dental_consultation_type === "2";
  if (!f.care_type) add("care_type_required");
  if (f.oral_health_surveillance.length === 0) add("oral_health_surveillance_required");
  if (f.care_type === "2" && !f.dental_consultation_type) add("dental_consultation_type_required");
  if (f.care_type === "4" && f.dental_consultation_type) add("dental_consultation_type_forbidden");
  if (f.care_type === "6" && f.dental_consultation_type === "2") add("return_forbidden_on_urgency");
  if (f.dental_outcomes.length === 0) add("dental_outcome_required");
  if (f.dental_outcomes.includes("15") && !firstOrReturn) add("completed_requires_first_or_return");
  if (f.dental_outcomes.includes("17") && firstOrReturn) add("discharge_forbidden_with_first_or_return");
  if (ctx.sex === "female" && f.pregnant === null) add("pregnant_required");
  if (ctx.sex === "male" && f.pregnant === true) add("pregnant_forbidden_male");
  if (ctx.problemsCount === 0) add("problem_required");
  if (ctx.role === "auxiliary") {
    if (f.dental_outcomes.some(isReferralOutcome)) add("auxiliary_cannot_refer");
    if (f.plan_changes.add.length > 0 || f.plan_changes.cancel.length > 0) add("auxiliary_cannot_plan");
  }
  for (const text of quantityProblems(f.procedures)) add("quantity_exceeds_location_limit", text);
  return out;
}

// ─── Recusas do api ──────────────────────────────────────────────────────────
type ErrorBody = { error?: string; feature?: string; path?: string | null; problems?: { path?: string | null; error?: string }[] };
const bodyOf = (err: unknown): ErrorBody | null => (err instanceof ApiError ? ((err.body ?? {}) as ErrorBody) : null);

export function dentalError(err: unknown): string {
  const body = bodyOf(err);
  if (body?.error === "feature_disabled" && body.feature === "dental_care") return DENTAL_DISABLED;
  if (body?.error === "missing_role") return DENTAL_NO_ROLE;
  if (body?.error && body.error !== "feature_disabled" && body.error in PROBLEM_TEXT) return PROBLEM_TEXT[body.error];
  return consultationError(err);
}

// `problems` do corpo (todas de uma vez, 27a §13 H8); sem ele, a do topo; outro erro → [].
export function dentalApiProblems(err: unknown): { code: string; path: string | null; text: string }[] {
  const body = bodyOf(err);
  if (!body) return [];
  if (Array.isArray(body.problems) && body.problems.length > 0) {
    return body.problems.filter((p) => typeof p.error === "string")
      .map((p) => ({ code: p.error as string, path: p.path ?? null, text: dentalProblemText(p.error as string) }));
  }
  return body.error ? [ { code: body.error, path: body.path ?? null, text: dentalProblemText(body.error) } ] : [];
}

// "dental.procedures[2].plan_item_id" → 2
export function planItemPathIndex(path: string | null): number | null {
  const m = path?.match(/procedures\[(\d+)\]\.plan_item_id$/);
  return m ? Number(m[1]) : null;
}

// ─── Corpo ───────────────────────────────────────────────────────────────────
export function emptyDentalFields(): DentalFields {
  return {
    care_type: null, dental_consultation_type: null, oral_health_surveillance: [], supplies: [], dental_outcomes: [], pregnant: null,
    special_needs: false, procedures: [], findings: [], plan_changes: { add: [], cancel: [] }, periodontal_screening: null,
    periodontal_chart: null, endodontics: []
  };
}

export function dentalFieldsFrom(c: Consultation): DentalFields {
  if (!c.dental) return emptyDentalFields();
  const { suggest_completed: _suggest, ...fields } = c.dental;
  return fields;
}

// O `name` só existe na leitura e na tela; o api ignora na escrita (O14).
export function dentalPayload(f: DentalFields): DentalFields {
  const strip = <T extends { name?: string }>({ name: _name, ...rest }: T): Omit<T, "name"> => rest;
  return {
    ...f,
    procedures: f.procedures.map((p) => strip(p)),
    plan_changes: { ...f.plan_changes, add: f.plan_changes.add.map((a) => strip(a)) }
  };
}

// ─── Especialidades (recusar em vez de cortar) ───────────────────────────────
export const PERIO_SITES: PerioSite[] = [ "MV", "V", "DV", "ML", "L", "DL" ];

// Faixa e inteiro; recusa com a frase, nada é arredondado nem cortado.
function outOfRange(v: number | null, min: number, max: number, label: string, rangePhrase: string, wholePhrase: string): string | null {
  if (v === null) return null;
  if (!Number.isInteger(v)) return `${label}: ${wholePhrase}`;
  return v < min || v > max ? `${label}: ${rangePhrase}` : null;
}

export function perioProblems(chart: PeriodontalChart): string[] {
  const out: string[] = [];
  const push = (p: string | null) => { if (p) out.push(p); };
  for (const t of chart.teeth) {
    const tooth = `dente ${t.tooth}`;
    push(outOfRange(t.mobility, 0, 3, tooth, "mobilidade de 0 a 3", "mobilidade em número inteiro"));
    push(outOfRange(t.furcation, 0, 3, tooth, "furca de 0 a 3", "furca em número inteiro"));
    for (const s of t.sites) {
      const label = `${tooth}, sítio ${s.site}`;
      push(outOfRange(s.probing_depth_mm, 0, 20, label, "profundidade de sondagem de 0 a 20 mm", "profundidade de sondagem em milímetros inteiros"));
      push(outOfRange(s.recession_mm, -10, 20, label, "recessão de -10 a 20 mm", "recessão em milímetros inteiros"));
    }
  }
  return out;
}

export function screeningProblems(s: PeriodontalScreening): string[] {
  return s.sextants.filter((x) => x.code !== null && (!Number.isInteger(x.code) || x.code < 0 || x.code > 4))
    .map((x) => `sextante ${x.sextant}: o código vai de 0 a 4 (ou marque o sextante como excluído)`);
}

export function endoProblems(list: EndodonticEntry[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of list) {
    if (!Number.isInteger(e.canals) || e.canals < 1 || e.canals > 5) out.push(`dente ${e.tooth}: canais de 1 a 5`);
    if (seen.has(e.tooth)) out.push(`dente ${e.tooth}: tratamento repetido`);
    seen.add(e.tooth);
  }
  return out;
}

// ─── Prótese, CEO e painéis ──────────────────────────────────────────────────
const STAGE_LABEL: Record<string, string> = {
  impression: "Moldagem", sent: "Enviada ao laboratório", received: "Recebida do laboratório", installed: "Instalada", cancelled: "Cancelada"
};
export const prosthesisStageLabel = (code: string): string => STAGE_LABEL[code] ?? code;
const STAGE_TONE: Record<string, string> = { impression: "neutral", sent: "info", received: "warn", installed: "ok", cancelled: "down" };
export const prosthesisStageTone = (code: string): string => STAGE_TONE[code] ?? "neutral";

// `installed` só pela consulta (installation_through_consultation); a rota de etapas não o aceita.
export function nextStages(stage: ProsthesisStage | string): ("sent" | "received" | "cancelled")[] {
  if (stage === "impression") return [ "sent", "cancelled" ];
  if (stage === "sent") return [ "received", "cancelled" ];
  if (stage === "received") return [ "cancelled" ];
  return [];
}

export const REASON_MIN = 10;
export const REASON_MAX = 500;
export function reasonProblem(text: string): string | null {
  const n = text.trim().length;
  return n < REASON_MIN || n > REASON_MAX ? `o motivo precisa de ${REASON_MIN} a ${REASON_MAX} caracteres` : null;
}
export const LAB_NAME_MIN = 3;
export const LAB_NAME_MAX = 120;
export function labNameProblem(text: string): string | null {
  const n = text.trim().length;
  return n < LAB_NAME_MIN || n > LAB_NAME_MAX ? `o nome do laboratório precisa de ${LAB_NAME_MIN} a ${LAB_NAME_MAX} caracteres` : null;
}

export const CEO_TYPES: { key: CeoType; label: string }[] = [ { key: "I", label: "CEO tipo I" }, { key: "II", label: "CEO tipo II" }, { key: "III", label: "CEO tipo III" } ];
export const CEO_SPECIALTIES: { key: CeoSpecialty; label: string }[] = [
  { key: "endodontics", label: "Endodontia" }, { key: "periodontics", label: "Periodontia" }, { key: "oral_surgery", label: "Cirurgia oral" },
  { key: "stomatology", label: "Estomatologia" }, { key: "special_needs", label: "Pacientes com necessidades especiais" },
  { key: "prosthesis", label: "Prótese dentária" }
];

const GOAL_LABEL: Record<string, string> = { basic: "Procedimentos básicos", periodontics: "Periodontia", endodontics: "Endodontia", oral_surgery: "Cirurgia oral" };
export const goalKeyLabel = (key: string): string => GOAL_LABEL[key] ?? key;

const COMPOSITION_LABEL: Record<string, string> = {
  restorations_min_50: "ao menos 50% de restaurações", three_roots_min_20: "ao menos 20% em dentes de três raízes ou mais"
};
export const compositionLabel = (rule: string): string => COMPOSITION_LABEL[rule] ?? rule;

const PERCENT = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
// Denominador nulo (eSB sem equipe associada) ou zero → "—".
export function ratioLabel(n: number, d: number | null): string {
  return d === null || d === 0 ? "—" : `${PERCENT.format((n / d) * 100)}%`;
}
// O24: o api manda percentual com ponto ("62.00"); a vírgula só aparece na tela.
export function percentLabel(value: string | number | null | undefined): string {
  const n = typeof value === "string" ? Number(value) : value;
  return n === null || n === undefined || !Number.isFinite(n) ? "—" : `${PERCENT.format(n)}%`;
}

export const monthOf = (today: string): string => today.slice(0, 7);
