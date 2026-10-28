// src/lib/surveillance.ts
// Regras de tela da vigilância epidemiológica (módulo 25; ADR 0043; contrato
// 2026-10-27 §1–§10). Prazos, transições válidas, supressão e sinal são do api;
// aqui só se traduzem os códigos e se recusa o que o api recusaria por formato.
// Nada aqui guarda dado nem escreve em log; a frase de erro nunca repete o enviado.
import { ApiError, errorCode, type NotificationStatus } from "./api";
import { featureDisabledKey, featureLabel, hasFeature } from "./features";
import { COUNT_QUERY, NOMINAL_QUERY, STATIC_QUERY, fmtDay } from "./careLines";
import { DUPLICATE_SUSPECTED_TEXT, territoryError } from "./territoryRegistry";

export { COUNT_QUERY, NOMINAL_QUERY, STATIC_QUERY, fmtDay };

export const SURVEILLANCE_DISABLED = "a vigilância epidemiológica está desligada nesta cidade";
export const SURVEILLANCE_NO_ROLE = "seu papel não permite usar a vigilância epidemiológica";
export const STALE_TEXT = "outra pessoa alterou esta notificação enquanto você editava — recarregue para ver a versão nova";
export const NO_NAME = "pessoa sem nome no cadastro";
export const NO_NEIGHBORHOOD = "não informado";
// K14: semanas com 1 a 4 casos entram na média como 2,5 (o api decide; a tela só explica).
export const SIGNAL_NOTE =
  "Sinal para avaliar: a semana passou do dobro da média das 4 semanas anteriores, com pelo menos 5 casos (semanas com 1 a 4 casos entram como 2,5). É um aviso para a vigilância olhar, não uma conclusão.";

export const DISEASES_KEY = "surveillanceDiseases";
export const SUGGESTIONS_KEY = "surveillanceSuggestions";
export const NOTIFICATIONS_KEY = "surveillanceNotifications";
export const NOTIFICATION_KEY = "surveillanceNotification";
export const SURVEILLANCE_COUNT_KEY = "surveillanceCount";
export const UNITS_KEY = "surveillanceUnits";
export const NEGATIVES_KEY = "surveillanceNegatives";
export const PANEL_KEY = "surveillancePanel";
export const LOCAL_DISEASES_KEY = "surveillanceLocalDiseases";

// ─── Portão e papéis ───────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// Nunca para o operador da plataforma; o interruptor da cidade manda.
export function canUseSurveillance(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "surveillance");
}

export interface SurveillanceRoles { surveillance: boolean; analyst: boolean; professional: boolean; admin: boolean }

export function surveillanceRoles(user: SessionLike): SurveillanceRoles {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  return {
    surveillance: roles.includes("surveillance"), analyst: roles.includes("analyst"),
    professional: roles.includes("health_professional"), admin: roles.includes("municipal_admin")
  };
}

// A sugestão na consulta exige também o prontuário (K12(b)).
export function canSuggestNotification(user: SessionLike): boolean {
  return canUseSurveillance(user) && hasFeature(user, "clinical_record") && surveillanceRoles(user).professional;
}

// Médico (225*) e enfermeiro (2235*); o api confere de novo (cbo_not_allowed).
export function cboCanNotify(cbo: string | null | undefined): boolean {
  return !!cbo && (/^225/.test(cbo) || /^2235/.test(cbo));
}

// ─── Rótulos. Código novo do api aparece cru. ──────────────────────────────
const STATUS_LABEL: Record<string, string> = {
  possible: "possível notificação não feita", notified: "notificada", investigating: "em investigação",
  closed: "encerrada, sem número oficial", entered: "digitada no sistema oficial", dismissed: "descartada (não era caso)"
};
export function statusLabel(code: string | null | undefined): string {
  return code ? STATUS_LABEL[code] ?? code : "—";
}

const STATUS_TONE: Record<string, string> = {
  possible: "warn", notified: "warn", investigating: "warn", closed: "neutral", entered: "ok", dismissed: "neutral"
};
export function statusTone(code: string | null | undefined): string {
  return (code && STATUS_TONE[code]) || "neutral";
}

const ORIGIN_LABEL: Record<string, string> = {
  consultation: "na consulta", manual: "manual", safety_net: "rede de segurança (consulta finalizada)"
};
export function originLabel(code: string): string { return ORIGIN_LABEL[code] ?? code; }

export const CLASSIFICATIONS: { key: "confirmed" | "discarded" | "inconclusive"; label: string }[] = [
  { key: "confirmed", label: "confirmado" }, { key: "discarded", label: "descartado" }, { key: "inconclusive", label: "inconclusivo" }
];
export function classificationLabel(code: string | null | undefined): string {
  return code ? CLASSIFICATIONS.find((c) => c.key === code)?.label ?? code : "—";
}

const DEADLINE_LABEL: Record<string, string> = { immediate: "imediata (24 h)", weekly: "semanal (7 dias)" };
export function deadlineLabel(code: string): string { return DEADLINE_LABEL[code] ?? code; }

const NEGATIVE_LABEL: Record<string, string> = { with_cases: "com casos", negative: "negativa registrada", pending: "pendente" };
export function negativeStatusLabel(code: string): string { return NEGATIVE_LABEL[code] ?? code; }

// ─── Transições (D5): o api valida; a tela só oferece o passo seguinte ─────
export const NEXT: Record<string, NotificationStatus[]> = {
  possible: [ "notified" ], notified: [ "investigating" ], investigating: [ "closed" ], closed: [ "entered" ], entered: [], dismissed: []
};
const TRANSITION_LABEL: Record<string, string> = {
  notified: "Confirmar notificação", investigating: "Iniciar investigação", closed: "Encerrar", entered: "Registrar número oficial"
};
export function transitionLabel(to: string): string { return TRANSITION_LABEL[to] ?? to; }

// ─── Semana epidemiológica (K1): domingo a sábado; a semana 1 contém 4 de janeiro ──
// Tudo em UTC sobre AAAA-MM-DD: a data já é a da cidade, nenhum fuso desloca.
const DAY = 86_400_000;
const WEEK_FORMAT = /^(\d{4})-(\d{2})$/;
const DATE_FORMAT = /^(\d{4})-(\d{2})-(\d{2})$/;
const WEEK_FORMAT_PROBLEM = "semana inválida: use AAAA-SS (ex.: 2026-43)";

// ms UTC do domingo que abre a semana 1 do ano.
function week1Start(year: number): number {
  const jan4 = Date.UTC(year, 0, 4);
  return jan4 - new Date(jan4).getUTCDay() * DAY;
}
const isoOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const weekText = (year: number, n: number): string => `${String(year).padStart(4, "0")}-${String(n).padStart(2, "0")}`;

export function epiWeekOf(iso: string): string {
  const t = Date.parse(`${iso}T00:00:00Z`);
  let year = Number(iso.slice(0, 4)) + 1;
  while (t < week1Start(year)) year -= 1;
  return weekText(year, Math.floor((t - week1Start(year)) / (7 * DAY)) + 1);
}

// Início (domingo) da semana "AAAA-SS" (sem conferir se a semana existe: ver weekProblem).
export function epiWeekStart(week: string): string {
  const m = WEEK_FORMAT.exec(week);
  if (!m) return week;
  return isoOf(week1Start(Number(m[1])) + (Number(m[2]) - 1) * 7 * DAY);
}

export function shiftEpiWeek(week: string, delta: number): string {
  return epiWeekOf(isoOf(Date.parse(`${epiWeekStart(week)}T00:00:00Z`) + delta * 7 * DAY));
}

export function previousEpiWeek(today: string): string { return shiftEpiWeek(epiWeekOf(today), -1); }

const dayMonth = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export function weekLabel(week: string): string {
  const m = WEEK_FORMAT.exec(week);
  if (!m) return week;
  const start = epiWeekStart(week);
  const end = isoOf(Date.parse(`${start}T00:00:00Z`) + 6 * DAY);
  return `semana ${m[2]}/${m[1]} (${dayMonth(start)} a ${dayMonth(end)})`;
}

// Formato, existência (só alguns anos têm a 53) e não depois da semana de hoje.
export function weekProblem(week: string, today: string): string | null {
  const m = WEEK_FORMAT.exec(week);
  if (!m || Number(m[2]) < 1 || epiWeekOf(epiWeekStart(week)) !== week) return WEEK_FORMAT_PROBLEM;
  return week > epiWeekOf(today) ? "semana no futuro" : null;
}

// Negativa: só semana já encerrada (anterior à de hoje).
export function closedWeekProblem(week: string, today: string): string | null {
  const problem = weekProblem(week, today);
  if (problem) return problem;
  return week >= epiWeekOf(today) ? "a semana ainda não terminou" : null;
}

// Painel: as duas pontas válidas, da inicial até a final, no máximo 53 semanas contando as duas.
export function weekRangeProblem(from: string, to: string, today: string): string | null {
  const problem = weekProblem(from, today) ?? weekProblem(to, today);
  if (problem) return problem;
  if (from > to) return "a semana inicial vem depois da final";
  return shiftEpiWeek(from, 52) < to ? "no máximo 53 semanas por consulta" : null;
}

// ─── Formato: recusar, nunca cortar ────────────────────────────────────────
const length = (text: string): number => [ ...text ].length;

function validDate(value: string): boolean {
  const m = DATE_FORMAT.exec(value);
  if (!m) return false;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return isoOf(t) === value;
}

// Data de calendário que não pode ser futura (ex.: data da suspeita).
export function pastDateProblem(value: string, label: string, today: string, required: boolean): string | null {
  if (!value) return required ? `informe a ${label}` : null;
  if (!validDate(value)) return `${label} inválida`;
  return value > today ? `${label} depois de hoje` : null;
}

export function symptomsProblem(symptoms: string, suspected: string, today: string): string | null {
  if (!symptoms) return null;
  if (!validDate(symptoms)) return "data dos primeiros sintomas inválida";
  if (symptoms > today) return "data dos primeiros sintomas depois de hoje";
  return suspected && symptoms > suspected ? "primeiros sintomas depois da data da suspeita" : null;
}

const OFFICIAL_NUMBER = /^[0-9A-Za-z./-]{1,30}$/;
export function officialNumberProblem(text: string): string | null {
  if (!text) return "informe o número da notificação no sistema oficial";
  return OFFICIAL_NUMBER.test(text) ? null : "número oficial de 1 a 30 caracteres: letras, números, ponto, barra ou hífen";
}

// Residência em outro município: o código IBGE tem 7 dígitos (o api recusa o da própria cidade).
export function residenceProblem(elsewhere: boolean, ibge: string): string | null {
  if (!elsewhere) return null;
  return /^\d{7}$/.test(ibge) ? null : "código IBGE do município de residência com 7 dígitos";
}

export function reasonProblem(text: string, required: boolean): string | null {
  const n = length(text.trim());
  if (n === 0) return required ? "informe o motivo" : null;
  if (n > 500) return "motivo com mais de 500 caracteres";
  return n < 3 ? "motivo de 3 a 500 caracteres" : null;
}

// Maiúsculas, sem ponto, separados por espaço, vírgula ou ponto e vírgula; sem repetidos, na ordem.
export function codesOf(text: string): string[] {
  const seen = new Set<string>();
  for (const part of text.split(/[\s,;]+/)) {
    const code = part.replace(/\./g, "").toUpperCase();
    if (code) seen.add(code);
  }
  return [ ...seen ];
}

export interface LocalDiseaseDraft {
  code: string; name: string; deadline: string; cid10: string; ciap2: string; repeat_after_days: string;
}
const LOCAL_CODE = /^local_[a-z0-9_]{1,40}$/;
const CID10 = /^[A-Z]\d{2}[0-9X]?$/;
const CIAP2 = /^[A-Z]\d{2}$/;

export function localDiseaseProblem(draft: LocalDiseaseDraft, creating: boolean): string | null {
  if (creating && !LOCAL_CODE.test(draft.code)) return "código começa com local_ e segue com letras minúsculas, números ou _ (até 46)";
  const name = length(draft.name.trim());
  if (name < 1 || name > 120) return "nome de 1 a 120 caracteres";
  if (draft.deadline !== "immediate" && draft.deadline !== "weekly") return "escolha o prazo";
  const badCid = codesOf(draft.cid10).find((c) => !CID10.test(c));
  if (badCid) return `CID-10 inválido: ${badCid}`;
  const badCiap = codesOf(draft.ciap2).find((c) => !CIAP2.test(c));
  if (badCiap) return `CIAP-2 inválido: ${badCiap}`;
  const days = draft.repeat_after_days.trim();
  return /^\d+$/.test(days) && Number(days) >= 1 && Number(days) <= 36500 ? null : "janela de repetição de 1 a 36500 dias";
}

// ─── Recusas do api (frase, nunca o corpo nem o valor enviado) ─────────────
const ERRORS: Record<string, string> = {
  missing_role: SURVEILLANCE_NO_ROLE,
  cbo_not_allowed: "só médico ou enfermeiro notifica pela consulta",
  not_author: "só quem atendeu a consulta pode notificar por ela",
  not_found: "não encontrado — recarregue",
  already_notified: "já existe notificação desta doença em aberto (ou recente) para o paciente",
  already_recorded: "a negativa desta unidade e semana já foi registrada",
  unit_has_notifications: "a unidade tem notificação nesta semana; a negativa não cabe",
  classification_required: "escolha a classificação final para encerrar",
  official_number_required: "informe o número da notificação no sistema oficial",
  future_week: "a semana ainda não terminou",
  invalid_week: "semana inválida",
  invalid_range: "faixa de semanas inválida",
  invalid_filter: "filtro inválido — recarregue a tela",
  invalid_limit: "tamanho de página inválido — recarregue a tela",
  invalid_cursor: "a lista mudou — recarregue",
  invalid_request: "pedido inválido — recarregue a tela e tente de novo",
  invalid_reason: "motivo de 3 a 500 caracteres",
  invalid_residence: "município de residência inválido (não pode ser o desta cidade)",
  invalid_symptoms_on: "data dos primeiros sintomas inválida",
  invalid_patient: "confira os dados da pessoa",
  invalid_notifying: "só unidade ativa pode ser marcada como notificadora",
  stale_version: STALE_TEXT,
  invalid_transition: "essa mudança não vale para a situação atual da notificação — recarregue",
  invalid_disease: "doença fora da lista vigente — recarregue a lista",
  duplicate_code: "já existe doença com este código",
  duplicate_suspected: DUPLICATE_SUSPECTED_TEXT,
  citizen_not_verified: "cidadão sem identidade validada no posto"
};
const has = (code: string): boolean => Object.prototype.hasOwnProperty.call(ERRORS, code);

function bodyString(err: unknown, key: string): string | null {
  if (!(err instanceof ApiError) || !err.body || typeof err.body !== "object") return null;
  const value = (err.body as Record<string, unknown>)[key];
  return typeof value === "string" ? value : null;
}

// `invalid_unit` depende de onde: a notificação manual aceita qualquer unidade ativa; a negativa exige notificadora (A14).
export type SurveillanceContext = "manual" | "negative";
const UNIT_TEXT: Record<SurveillanceContext, string> = {
  manual: "unidade inexistente ou inativa", negative: "unidade inexistente, inativa ou não notificadora"
};

// `path` de doença local: "code", "cid10.N", "ciap2.N" (N de zero; a frase conta de um).
function diseasePathText(path: string | null, invalid: boolean): string | null {
  if (path === "code") return invalid ? "código da doença inválido" : "já existe doença com este código";
  const m = /^(cid10|ciap2)\.(\d+)$/.exec(path ?? "");
  if (!m) return null;
  const label = m[1] === "cid10" ? "CID-10" : "CIAP-2";
  const position = Number(m[2]) + 1;
  return invalid ? `${label} da posição ${position} inválido` : `o ${label} da posição ${position} já pertence a outra doença da lista`;
}

export function surveillanceError(err: unknown, context?: SurveillanceContext): string {
  const feature = featureDisabledKey(err);
  if (feature !== null) {
    if (feature === "surveillance") return SURVEILLANCE_DISABLED;
    return feature ? `${featureLabel(feature)} está desligado nesta cidade` : SURVEILLANCE_DISABLED;
  }
  const code = errorCode(err);
  const path = bodyString(err, "path");
  if (code === "invalid_request" && bodyString(err, "field") === "suspected_on") return "data da suspeita inválida ou no futuro";
  if (code === "invalid_unit") return UNIT_TEXT[context ?? "negative"];
  if (code === "invalid_form") return path === "form" ? "a ficha tem dado que o sistema não aceita — confira os campos" : "confira o campo indicado na ficha";
  if (code === "invalid_transition" && path === "form") return "ficha travada — recarregue";
  if (code === "invalid_disease" || code === "duplicate_code") {
    const text = diseasePathText(path, code === "invalid_disease");
    if (text) return text;
    if (code === "invalid_disease" && path) return "confira os dados da doença";
  }
  if (code && has(code)) return ERRORS[code];
  // Fora do mapa (inclui os códigos de pessoa e paciente): o mapa e o fallback do cadastro territorial.
  return territoryError(err);
}

export function isStale(err: unknown): boolean { return errorCode(err) === "stale_version"; }

// already_notified traz a notificação existente, para a tela abrir.
export function existingNotificationId(err: unknown): string | null {
  return errorCode(err) === "already_notified" ? bodyString(err, "notification_id") : null;
}
