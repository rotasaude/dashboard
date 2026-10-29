// Módulo 26a (regulação municipal): regras de tela. Rótulos, cores, prazos, validações, ações por situação, quem pode pedir e textos.
// Código novo do api aparece cru; a frase nunca repete valor enviado (CPF, CID, justificativa, motivo e alvo do paciente não vão a log).
import { ApiError, errorCode } from "./api";
import type {
  ExternalSystem, RegulationNotSent, RegulationRequest, RegulationRequestInput, RegulationTarget, RegulationType, RiskColor
} from "./api";
import { featureDisabledKey, hasFeature } from "./features";
import { cid10Problem, normalizeCid10 } from "./consultation";
import { cityIsoDate, parseCityLocal } from "./format";
import { fmtDueOn } from "./scheduling";

export { NOMINAL_QUERY, COUNT_QUERY, STATIC_QUERY } from "./careLines";

// ─── Frases ────────────────────────────────────────────────────────────────
export const REGULATION_DISABLED = "a regulação municipal está desligada nesta cidade";
export const REGULATION_NO_ROLE = "seu papel não permite usar a regulação municipal";
export const OUTCOME_BEFORE_SCHEDULE_TEXT = "O desfecho pode ser registrado a partir do dia do agendamento.";
export const STALE_TEXT = "outra pessoa alterou este pedido enquanto você decidia — recarregue para ver a versão nova";
export const QUOTA_EXHAUSTED_TEXT = "a cota desta oferta acabou enquanto você decidia — escolha outra oferta";
export const SKIP_REASON_TEXT =
  "Há pedido mais antigo, de cor igual ou mais grave, esperando nesta especialidade ou procedimento com oferta disponível. Para autorizar este antes, registre o motivo.";
export const COLOR_REASON_TEXT = "ao mudar a cor, informe o motivo";
export const REFERRAL_HINT =
  "Encaminhamento a especialista ou procedimento é pelo “Pedir regulação” na consulta; este desfecho é só para outra unidade da rede.";
export const UNSAVED_REQUEST_NOTE = "O pedido de regulação que você está escrevendo ainda não foi salvo e não vai junto.";
export const ADDENDUM_NOTE = "Pedidos feitos aqui ficam em rascunho e vão para a regulação quando você registrar um adendo.";
export const REGULATION_REQUIRED_TEXT =
  "encaminhamento sem unidade de destino exige um pedido de regulação: escolha a unidade da rede ou use “Pedir regulação” na consulta";
export const NOT_SENT_LABEL = "não enviado";

const GENERIC = "não foi possível concluir — tente de novo";

// ─── Chaves de consulta ────────────────────────────────────────────────────
export const REG_LIST_KEY = "regulationList";
export const REG_DETAIL_KEY = "regulationDetail";
export const REG_COUNT_KEY = "regulationCount";
export const REG_CONSULTATION_KEY = "regulationConsultation";
export const REG_TARGETS_KEY = "regulationTargets";
export const REG_OFFERS_KEY = "regulationOffers";
export const REG_PROVIDERS_KEY = "regulationProviders";
export const REG_DEADLINES_KEY = "regulationDeadlines";
export const REG_NURSE_KEY = "regulationNurse";
export const REG_RETURNED_KEY = "regulationReturned";

// ─── Portão e papéis ───────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// O interruptor `care_regulation` exige o prontuário (`clinical_record`); nunca para o operador da plataforma.
export function canUseRegulation(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "care_regulation") && hasFeature(user, "clinical_record");
}

export interface RegulationRoles { regulator: boolean; admin: boolean; professional: boolean }

export function regulationRoles(user: SessionLike): RegulationRoles {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  return { regulator: roles.includes("care_regulator"), admin: roles.includes("municipal_admin"), professional: roles.includes("health_professional") };
}

export function canRequestRegulation(user: SessionLike): boolean {
  return canUseRegulation(user) && regulationRoles(user).professional;
}

export type RequesterKind = "physician" | "nurse" | "dentist";

// Contrato §1: médico 225*, enfermeiro 2235*, dentista 2232*.
export function requesterKind(cbo: string | null | undefined): RequesterKind | null {
  const c = cbo ?? "";
  if (c.startsWith("2235")) return "nurse";
  if (c.startsWith("2232")) return "dentist";
  if (c.startsWith("225")) return "physician";
  return null;
}

export function allowedTypes(cbo: string | null | undefined): RegulationType[] {
  switch (requesterKind(cbo)) {
    case "physician":
    case "nurse": return [ "specialty", "procedure" ];
    case "dentist": return [ "specialty" ];
    default: return [];
  }
}

// O que cada CBO vê na busca (o api recusa de novo). Sem CBO (regulador, admin) e médico: tudo.
export function targetsFor(cbo: string | null | undefined, targets: RegulationTarget[]): RegulationTarget[] {
  const kind = requesterKind(cbo);
  if (kind === "nurse") return targets.filter((t) => t.nurse_allowed === true);
  if (kind === "dentist") return targets.filter((t) => t.type === "specialty" && t.code.startsWith("2232"));
  if (kind === "physician" || !cbo) return targets;
  return [];
}

// ─── Rótulos ───────────────────────────────────────────────────────────────
export const COLORS: { key: RiskColor; label: string; tone: string }[] = [
  { key: "red", label: "vermelho", tone: "down" },
  { key: "yellow", label: "amarelo", tone: "warn" },
  { key: "green", label: "verde", tone: "ok" },
  { key: "blue", label: "azul", tone: "info" }
];
export function colorLabel(code: string | null | undefined): string {
  return COLORS.find((c) => c.key === code)?.label ?? code ?? "—";
}
export function colorTone(code: string | null | undefined): string {
  return COLORS.find((c) => c.key === code)?.tone ?? "neutral";
}

// A cor que ordena a fila: a confirmada pelo regulador, ou a sugerida enquanto ele não confirmou (o api manda `color: null`).
export function effectiveColor(r: Pick<RegulationRequest, "color" | "suggested_color">): string {
  return r.color ?? r.suggested_color;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "rascunho", pending: "aguardando regulação", returned: "devolvido para complementar", authorized: "autorizado", scheduled: "agendado",
  completed: "realizado", missed: "faltou", denied: "negado", cancelled: "cancelado", closed: "encerrado (segunda falta)", external: "regulado pelo estado"
};
const STATUS_TONE: Record<string, string> = {
  pending: "warn", returned: "warn", authorized: "info", scheduled: "info", completed: "ok", denied: "down", closed: "down"
};
export function statusLabel(code: string | null | undefined): string {
  return code ? STATUS_LABEL[code] ?? code : "—";
}
export function statusTone(code: string | null | undefined): string {
  return (code && STATUS_TONE[code]) || "neutral";
}

const TYPE_LABEL: Record<string, string> = { specialty: "consulta especializada", procedure: "procedimento" };
export function typeLabel(code: string | null | undefined): string {
  return code ? TYPE_LABEL[code] ?? code : "—";
}

const PROVIDER_KIND_LABEL: Record<string, string> = { own: "rede própria", contracted: "contratado", consortium: "consórcio", ppi: "PPI" };
export function providerKindLabel(code: string | null | undefined): string {
  return code ? PROVIDER_KIND_LABEL[code] ?? code : "—";
}

export const EXTERNAL_SYSTEMS: { key: ExternalSystem; label: string }[] = [
  { key: "sisreg", label: "SISREG" }, { key: "care", label: "CARE" }, { key: "cross", label: "CROSS" }, { key: "other", label: "outro" }
];
export function systemLabel(code: string | null | undefined): string {
  return EXTERNAL_SYSTEMS.find((s) => s.key === code)?.label ?? code ?? "—";
}

// ─── Ações por situação (D13, D16; G12 #7) ─────────────────────────────────
export interface RegulationActions {
  authorize: boolean; returnBack: boolean; deny: boolean; cancel: boolean; schedule: boolean; outcome: boolean; external: boolean;
}

export function actionsFor(r: RegulationRequest): RegulationActions {
  const s = r.status;
  const own = r.authorization?.provider.kind === "own";
  // Fora da rede própria: o prestador (ou o estado) marca o horário; na própria, a unidade e o cidadão.
  const outside = r.state_regulated || (r.authorization !== null && !own);
  return {
    authorize: s === "pending",
    returnBack: s === "pending",
    deny: s === "pending" || s === "returned",
    // O api recusa com 422 `appointment_scheduled` na rede própria com horário marcado (R4).
    cancel: s === "pending" || s === "returned" || s === "authorized" || s === "external" || (s === "scheduled" && !own),
    schedule: ((s === "authorized" || s === "scheduled") && outside) || (r.state_regulated && s === "external"),
    outcome: s === "scheduled" && outside,
    external: s === "pending" || s === "returned" || s === "external"
  };
}

// ─── Espera e prazo, no dia da cidade ──────────────────────────────────────
const DAY_MS = 86_400_000;
const noon = (iso: string) => Date.parse(`${iso.slice(0, 10)}T12:00:00Z`);
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function waitDays(requestedAt: string, today: string): number {
  return Math.max(0, Math.round((noon(today) - noon(cityIsoDate(new Date(requestedAt)))) / DAY_MS));
}

export function waitText(days: number): string {
  return days <= 0 ? "hoje" : plural(days, "dia", "dias");
}

export function dueText(dueOn: string | null, overdue: boolean, today: string): string {
  if (!dueOn) return "—";
  const late = Math.round((noon(today) - noon(dueOn)) / DAY_MS);
  if (overdue) return late >= 1 ? `vencido há ${plural(late, "dia", "dias")}` : "vencido";
  return late === 0 ? "vence hoje" : fmtDueOn(dueOn, today);
}

export function currentMonth(today: string): string {
  return today.slice(0, 7);
}

const MONTHS = [ "janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro" ];
export function monthLabel(month: string): string {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  return m ? `${MONTHS[Number(m[2]) - 1]} de ${m[1]}` : month;
}

// ─── Pedido: rascunho, formato, corpo ──────────────────────────────────────
export interface RequestDraft {
  type: RegulationType; target: RegulationTarget | null; cid10: string; ciap2: string; justification: string; color: RiskColor | ""; stateRegulated: boolean;
}

export const EMPTY_DRAFT = (type: RegulationType): RequestDraft =>
  ({ type, target: null, cid10: "", ciap2: "", justification: "", color: "", stateRegulated: false });

export function draftFromRequest(r: RegulationRequest): RequestDraft {
  const type = r.type as RegulationType;
  return {
    type, target: { type, code: r.target.code, name: r.target.name }, cid10: r.cid10 ?? "", ciap2: r.ciap2 ?? "",
    justification: r.justification, color: r.suggested_color as RiskColor, stateRegulated: r.state_regulated
  };
}

export const JUSTIFICATION_MIN = 10;
export const JUSTIFICATION_MAX = 2000;

export function justificationProblem(text: string): string | null {
  const n = text.trim().length;
  if (n < JUSTIFICATION_MIN) return `a justificativa precisa de pelo menos ${JUSTIFICATION_MIN} caracteres`;
  if (n > JUSTIFICATION_MAX) return `a justificativa passa de ${JUSTIFICATION_MAX} caracteres`;
  return null;
}

export type DiagnosisRule = "cid10" | "either" | "ciap2";

// G10/G12: médico e quem não tem CBO (regulador, admin) → CID-10 obrigatório; enfermeiro e dentista → um dos dois
// (CID-10 só se o CBO puder, senão só o CIAP-2).
export function diagnosisRule(cbo: string | null | undefined, cid10Allowed: boolean): DiagnosisRule {
  const kind = requesterKind(cbo);
  if (kind === "nurse" || kind === "dentist") return cid10Allowed ? "either" : "ciap2";
  return "cid10";
}

export function normalizeCiap2(text: string): string {
  return text.toUpperCase().replace(/[.\s]/g, "");
}

// Mesmo formato de `Terminology::Ciap2Reader::CODE` no api.
export function ciap2Problem(text: string | null | undefined): string | null {
  const n = normalizeCiap2(text ?? "");
  if (n === "") return null;
  return /^[A-Z]\d{2}$/.test(n) ? null : "use um código CIAP-2, ex.: K86";
}

export type RequestField = "target" | "cid10" | "ciap2" | "justification" | "color";

// G12: no complemento, o CID-10 que já estava no pedido conta. Quem não é médico (regra ≠ "cid10") não o edita nem o reenvia:
// o api o guarda (`kept_cid10`) e o diagnóstico já está satisfeito. O médico segue editando o campo.
export function cid10IsKept(rule: DiagnosisRule, keptCid10: boolean): boolean {
  return keptCid10 && rule !== "cid10";
}

export function requestProblem(
  d: RequestDraft, cbo: string | null | undefined, cid10Allowed: boolean, keptCid10 = false
): { field: RequestField; text: string } | null {
  if (!d.target) return { field: "target", text: "escolha a especialidade ou o procedimento" };
  const rule = diagnosisRule(cbo, cid10Allowed);
  const kept = cid10IsKept(rule, keptCid10);
  const cid10 = normalizeCid10(d.cid10);
  const ciap2 = normalizeCiap2(d.ciap2);
  if (rule !== "ciap2" && !kept) {
    if (rule === "cid10" && cid10 === "") return { field: "cid10", text: "informe o CID-10" };
    const bad = cid10Problem(d.cid10);
    if (bad) return { field: "cid10", text: bad };
  }
  const badCiap = ciap2Problem(d.ciap2);
  if (badCiap) return { field: "ciap2", text: badCiap };
  if (!kept) {
    if (rule === "ciap2" && ciap2 === "") return { field: "ciap2", text: "informe o CIAP-2" };
    if (rule === "either" && cid10 === "" && ciap2 === "") return { field: "ciap2", text: "informe o CID-10 ou o CIAP-2" };
  }
  const j = justificationProblem(d.justification);
  if (j) return { field: "justification", text: j };
  if (d.color === "") return { field: "color", text: "escolha a cor sugerida" };
  return null;
}

// O texto nunca é cortado: só sem espaços nas pontas.
export function requestBody(d: RequestDraft, cbo: string | null | undefined, cid10Allowed: boolean, keptCid10 = false): RegulationRequestInput {
  const rule = diagnosisRule(cbo, cid10Allowed);
  const cid10 = normalizeCid10(d.cid10);
  const ciap2 = normalizeCiap2(d.ciap2);
  const body: RegulationRequestInput = {
    type: d.type, target_code: d.target?.code ?? "", justification: d.justification.trim(), suggested_color: d.color as RiskColor
  };
  if (rule !== "ciap2" && !cid10IsKept(rule, keptCid10) && cid10 !== "") body.cid10 = cid10;
  if (ciap2 !== "") body.ciap2 = ciap2;
  if (d.stateRegulated) body.state_regulated = true;
  return body;
}

// D8: o motivo da devolução é o `reason` do último evento `returned` (os devolvidos da unidade vêm com `events`, G6).
export function returnReason(r: RegulationRequest): string | null {
  const last = [ ...(r.events ?? []) ].reverse().find((e) => e.status === "returned");
  return last?.reason ?? null;
}

// ─── Outros formatos ───────────────────────────────────────────────────────
export function reasonProblem(text: string): string | null {
  const n = text.trim().length;
  return n >= 10 && n <= 500 ? null : "o motivo precisa de 10 a 500 caracteres";
}

export function placeProblem(text: string): string | null {
  const n = text.trim().length;
  return n >= 1 && n <= 200 ? null : "informe o local (até 200 caracteres)";
}

export function notesProblem(text: string): string | null {
  return text.trim().length > 500 ? "a observação passa de 500 caracteres" : null;
}

export function targetTermProblem(text: string): string | null {
  const n = text.trim().length;
  return n >= 3 && n <= 60 ? null : "o termo de busca tem de 3 a 60 caracteres";
}

export function externalNumberProblem(text: string): string | null {
  return /^[A-Za-z0-9./-]{1,30}$/.test(text.trim()) ? null : "número inválido: até 30 letras, números, ponto, barra ou hífen";
}

export function cnesProblem(text: string): string | null {
  return /^\d{7}$/.test(text.trim()) ? null : "CNES tem 7 dígitos";
}

export function providerNameProblem(text: string): string | null {
  const n = text.trim().length;
  return n >= 3 && n <= 120 ? null : "o nome tem de 3 a 120 caracteres";
}

const QUANTITY_TEXT = "quantidade é um número inteiro de 0 a 9999";
export function quantityProblem(raw: string): string | null {
  return /^\s*\d{1,4}\s*$/.test(raw) ? null : QUANTITY_TEXT;
}
export function parseQuantity(raw: string): number {
  return Number.parseInt(raw.trim(), 10);
}

export function monthProblem(month: string, today: string = cityIsoDate(new Date())): string | null {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return "mês inválido";
  return month < currentMonth(today) ? "o mês da oferta não pode ser anterior ao corrente" : null;
}

// Hora de parede da cidade, no formato do <input type="datetime-local">; recusa o que o `Date` empurraria (30/02, 24h).
export function scheduleAtProblem(local: string): string | null {
  const bad = "data e hora inválidas";
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!m || !parseCityLocal(local)) return bad;
  const [ y, mo, d, h, mi ] = m.slice(1).map(Number);
  const wall = new Date(Date.UTC(y, mo - 1, d, h, mi));
  const same = wall.getUTCFullYear() === y && wall.getUTCMonth() === mo - 1 && wall.getUTCDate() === d && wall.getUTCHours() === h && wall.getUTCMinutes() === mi;
  return same ? null : bad;
}

const DEADLINE_ORDER: RiskColor[] = [ "red", "yellow", "green", "blue" ];
export function deadlinesProblem(raw: Record<RiskColor, string>): string | null {
  const days: Partial<Record<RiskColor, number>> = {};
  for (const color of DEADLINE_ORDER) {
    const text = (raw[color] ?? "").trim();
    const n = /^\d{1,3}$/.test(text) ? Number(text) : NaN;
    if (!(n >= 1 && n <= 365)) return `${colorLabel(color)}: prazo é um número inteiro de 1 a 365 dias`;
    days[color] = n;
  }
  for (let i = 1; i < DEADLINE_ORDER.length; i += 1) {
    const [ prev, cur ] = [ DEADLINE_ORDER[i - 1], DEADLINE_ORDER[i] ];
    if ((days[cur] as number) < (days[prev] as number)) {
      return `o prazo do ${colorLabel(cur)} não pode ser menor que o do ${colorLabel(prev)}`;
    }
  }
  return null;
}

// ─── Recusas do api ────────────────────────────────────────────────────────
const FIELD_LABEL: Record<string, string> = {
  justification: "justificativa", cid10: "CID-10", ciap2: "CIAP-2", reason: "motivo", place: "local", at: "data e hora", number: "número",
  cnes: "CNES", quantity: "quantidade"
};

const MESSAGES: Record<string, string> = {
  color_reason_required: COLOR_REASON_TEXT,
  cbo_not_allowed:
    "seu CBO não pode pedir este encaminhamento: médico pede qualquer especialidade ou procedimento; enfermeiro, só os da lista do município; dentista, só especialidades odontológicas",
  appointment_scheduled: "a unidade já marcou o horário: o cidadão cancela pelo celular, ou a falta devolve o pedido à regulação",
  citizen_not_verified:
    "o paciente não tem cadastro validado no posto, e a rede própria precisa dele para marcar o horário — escolha um prestador externo ou peça a validação",
  invalid_offer: "esta oferta não serve para este pedido (outro alvo, outro mês ou prestador inativo) — escolha outra",
  invalid_ciap2: "CIAP-2 inválido",
  cid10_not_allowed_for_cbo: "sua ocupação não pode usar CID-10 — use o CIAP-2",
  invalid_cid10: "CID-10 inválido",
  invalid_transition: "este pedido mudou de situação — recarregue",
  not_draft: "este pedido mudou de situação — recarregue",
  not_found: "pedido não encontrado",
  invalid_month: "o mês da oferta não pode ser anterior ao corrente",
  cnes_taken: "já existe prestador com este CNES",
  unit_taken: "esta unidade já é um prestador da rede própria",
  invalid_query: "o termo de busca tem de 3 a 60 caracteres",
  duplicate_offer: "já existe oferta deste prestador para este alvo neste mês",
  duplicate_item: "este item já está na lista",
  // G5: a recusa do api não diz qual cor; a frase também não.
  invalid_deadlines: "o prazo de uma cor menos grave não pode ser menor que o de uma mais grave",
  skip_reason_required: SKIP_REASON_TEXT,
  stale_version: STALE_TEXT,
  outcome_before_schedule: OUTCOME_BEFORE_SCHEDULE_TEXT,
  quota_exhausted: QUOTA_EXHAUSTED_TEXT,
  missing_role: REGULATION_NO_ROLE,
  regulation_request_required: REGULATION_REQUIRED_TEXT
};

export function regulationError(err: unknown): string {
  if (err instanceof TypeError) return "sem conexão com o servidor — tente de novo";
  if (featureDisabledKey(err) !== null) return REGULATION_DISABLED;
  if (!(err instanceof ApiError)) return GENERIC;
  const body = (err.body ?? {}) as { path?: unknown; hint?: unknown; used?: unknown };
  const code = errorCode(err);
  const path = typeof body.path === "string" ? body.path : null;
  switch (code) {
    case "invalid_target":
      return body.hint === "exam_order" ? "este procedimento é exame: peça pelo pedido de exame da consulta" : "especialidade ou procedimento inválido";
    case "diagnosis_required":
      return path === "cid10" ? "informe o CID-10" : "informe o CIAP-2 (ou o CID-10, se a sua ocupação usa)";
    case "quantity_below_used":
      return typeof body.used === "number"
        ? `a quantidade não pode ficar abaixo do que já foi autorizado no mês (${body.used})`
        : "a quantidade não pode ficar abaixo do que já foi autorizado no mês";
    case "invalid_request":
      if (path === "consultation") return "no máximo 10 pedidos em rascunho por consulta";
      return path ? `confira o campo: ${FIELD_LABEL[path] ?? path}` : GENERIC;
    default:
      return (code && MESSAGES[code]) || GENERIC;
  }
}

// A finalização (e o adendo) nunca é recusada por rascunho (G4): o que sobra é o encaminhamento sem unidade de destino.
// Outra recusa → null, e o editor usa a frase de hoje.
export function regulationFinalizeError(err: unknown): string | null {
  return errorCode(err) === "regulation_request_required" ? REGULATION_REQUIRED_TEXT : null;
}

// Por que um rascunho não seguiu junto (`regulation_not_sent`); a mesma frase da recusa avulsa.
export function notSentReason(n: RegulationNotSent): string {
  return regulationError(new ApiError(422, { error: n.error, path: n.path }, ""));
}

// ─── Arquivos e avisos ─────────────────────────────────────────────────────
export function guideFilename(id: string): string {
  return `guia-regulacao-${id.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}

export function exportFilename(today: string): string {
  return `regulacao-estado-${today}.csv`;
}

export function draftsNote(n: number): string {
  return n === 1
    ? "1 pedido de regulação vai para a fila da regulação ao finalizar."
    : `${n} pedidos de regulação vão para a fila da regulação ao finalizar.`;
}
