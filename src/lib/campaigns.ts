// src/lib/campaigns.ts
// Regras do módulo 12 sem React (spec 2026-09-29 §4 e §7; ADR 0024): chaves
// de cache, rótulos, período padrão dos critérios, validação que espelha o
// schema do api, montagem do JSON do público e tradução das recusas.
import {
  ApiError, type Audience, type AudienceGeo, type CampaignStatus, type Criterion, type CriterionKind, type SmsStatus
} from "./api";
import { TIMEZONE, parseCityLocal } from "./format";

export const CAMPAIGN_MANAGER_ROLE = "campaign_manager";

export const CAMPAIGNS_KEY = [ "campaigns" ] as const;
export const CAMPAIGN_OPTIONS_KEY = [ "campaignOptions" ] as const;
export const SMS_SETTING_KEY = [ "campaignSmsSetting" ] as const;
export const PREVIEW_KEY = [ "campaignPreview" ] as const;
export const campaignKey = (id: string) => [ "campaign", id ] as const;

export const PREVIEW_DEBOUNCE_MS = 500;
export const MAX_CRITERIA = 7;
export const MAX_NEIGHBORHOODS = 50;
export const DEFAULT_PERIOD_DAYS = 30;
export const TITLE_MIN = 3;
export const TITLE_MAX = 120;
export const BODY_MIN = 10;
export const BODY_MAX = 2000;
const MINUTE_MS = 60_000;
export const SEND_AT_MIN_MS = 5 * MINUTE_MS;
export const SEND_AT_MAX_MS = 90 * 24 * 60 * MINUTE_MS;

export const STATUS_LABEL: Record<CampaignStatus, string> = {
  draft: "rascunho", scheduled: "agendada", sending: "enviando", sent: "enviada", cancelled: "cancelada", failed: "falhou"
};
export const STATUS_TONE: Record<CampaignStatus, string | undefined> = {
  draft: undefined, scheduled: "info", sending: "info", sent: "ok", cancelled: undefined, failed: "down"
};
export const FAILURE_LABEL: Record<string, string> = {
  below_minimum: "o público tinha menos de 5 telefones no momento do envio"
};

export const SMS_STATUS_ORDER: SmsStatus[] = [
  "sent", "pending", "deferred", "failed", "unavailable", "duplicate_phone", "not_opted_in"
];
export const SMS_STATUS_LABEL: Record<SmsStatus, string> = {
  sent: "enviado",
  pending: "na fila",
  deferred: "aguardando o horário (8h–20h)",
  failed: "falhou",
  unavailable: "não enviado — sem provedor de SMS",
  duplicate_phone: "telefone já recebeu por outra pessoa",
  not_opted_in: "sem opt-in de SMS"
};

export const CRITERION_LABEL: Record<CriterionKind, string> = {
  protocol_period: "Protocolo e período",
  triage_tier: "Faixa da triagem",
  triage_incomplete: "Triagem não concluída",
  attendance_outcome: "Desfecho de atendimento",
  triaged_not_attended: "Triado e não atendido",
  appointment_no_show: "Falta em agendamento",
  appointment_request_open: "Pedido de agendamento aberto"
};
export const CRITERION_KINDS = Object.keys(CRITERION_LABEL) as CriterionKind[];

export const OUTCOME_LABEL: Record<string, string> = {
  discharged: "atendido e liberado", referred: "encaminhado", return: "retorno", left: "saiu sem atendimento"
};
export const REQUEST_KIND_LABEL: Record<string, string> = { return: "retorno", referral: "encaminhamento" };

// ─── Rascunho do público ─────────────────────────────────────────────────────
// Cada cartão tem uma chave só da tela (React key); ela nunca vai à API.
export interface CriterionDraft { key: string; criterion: Criterion }
export interface AudienceDraft { geo: AudienceGeo; criteria: CriterionDraft[] }

let keySeq = 0;
export function nextCriterionKey(): string {
  keySeq += 1;
  return `criterion-${keySeq}`;
}

export function emptyAudienceDraft(): AudienceDraft {
  return { geo: { scope: "city" }, criteria: [] };
}

export function draftFromAudience(audience: Audience): AudienceDraft {
  return { geo: audience.geo, criteria: audience.clinical.all.map((criterion) => ({ key: nextCriterionKey(), criterion })) };
}

export function isEditable(status: CampaignStatus): boolean {
  return status === "draft";
}

// ─── Datas ──────────────────────────────────────────────────────────────────
// "Hoje" é o dia da CIDADE: às 23h30 em São Paulo já é amanhã em UTC, e o
// limite "não pode terminar no futuro" do api é no fuso da cidade (spec §4.1).
const dayParts = new Intl.DateTimeFormat("en-US", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function todayInCity(now: Date = new Date()): string {
  const p = Object.fromEntries(dayParts.formatToParts(now).map((x) => [ x.type, x.value ]));
  return `${p.year}-${p.month}-${p.day}`;
}

// Aritmética de dia em UTC ao meio-dia: nenhum fuso desloca a data.
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ─── Critérios ──────────────────────────────────────────────────────────────
export function newCriterion(kind: CriterionKind, today: string): Criterion {
  const from = addDays(today, -(DEFAULT_PERIOD_DAYS - 1));
  switch (kind) {
    case "protocol_period": return { kind, protocol_name: "", from, to: today };
    case "triage_tier": return { kind, tiers: [], from, to: today };
    case "triage_incomplete": return { kind, from, to: today };
    case "attendance_outcome": return { kind, outcomes: [], from, to: today };
    case "triaged_not_attended": return { kind, from, to: today };
    case "appointment_no_show": return { kind, from, to: today };
    case "appointment_request_open": return { kind };
  }
}

// Espelha o schema do api (spec §4.1). Datas em "YYYY-MM-DD" comparam como
// texto.
export function validateCriterion(c: Criterion, today: string): string | null {
  if ("from" in c) {
    if (!c.from || !c.to) return "informe o período (de e até)";
    if (c.from > c.to) return "a data inicial é depois da final";
    if (c.to > today) return "o período não pode terminar no futuro";
  }
  if (c.kind === "protocol_period" && !c.protocol_name) return "escolha o protocolo";
  if (c.kind === "triage_tier" && c.tiers.length === 0) return "marque ao menos uma faixa";
  if (c.kind === "attendance_outcome" && c.outcomes.length === 0) return "marque ao menos um desfecho";
  return null;
}

export function validateGeo(geo: AudienceGeo): string | null {
  if (geo.scope === "unit" && !geo.health_unit_id) return "escolha a unidade de referência";
  if (geo.scope === "neighborhoods") {
    if (geo.neighborhood_ids.length === 0) return "escolha ao menos um bairro";
    if (geo.neighborhood_ids.length > MAX_NEIGHBORHOODS) return `no máximo ${MAX_NEIGHBORHOODS} bairros`;
  }
  return null;
}

export function audienceProblem(draft: AudienceDraft, today: string): string | null {
  const geo = validateGeo(draft.geo);
  if (geo) return geo;
  if (draft.criteria.length > MAX_CRITERIA) return `no máximo ${MAX_CRITERIA} critérios`;
  for (const { criterion } of draft.criteria) {
    const problem = validateCriterion(criterion, today);
    if (problem) return `${CRITERION_LABEL[criterion.kind]}: ${problem}`;
  }
  return null;
}

// ─── JSON do público ────────────────────────────────────────────────────────
// O schema do api recusa campo extra e valor inválido: opcional em branco
// SAI do objeto (nunca "", null ou []), e bairro repetido vira um só.
function cleanGeo(geo: AudienceGeo): AudienceGeo {
  switch (geo.scope) {
    case "city": return { scope: "city" };
    case "unit": return { scope: "unit", health_unit_id: geo.health_unit_id };
    case "neighborhoods": return { scope: "neighborhoods", neighborhood_ids: [ ...new Set(geo.neighborhood_ids) ] };
  }
}

function cleanCriterion(c: Criterion): Criterion {
  if (c.kind === "attendance_outcome") {
    const { health_unit_id, ...rest } = c;
    return health_unit_id ? { ...rest, health_unit_id } : rest;
  }
  if (c.kind === "appointment_request_open") {
    return {
      kind: c.kind,
      ...(c.kinds && c.kinds.length > 0 ? { kinds: c.kinds } : {}),
      ...(c.target_unit_id ? { target_unit_id: c.target_unit_id } : {})
    };
  }
  return c;
}

export function buildAudience(draft: AudienceDraft): Audience {
  return {
    version: 1,
    geo: cleanGeo(draft.geo),
    clinical: { all: draft.criteria.map((d) => cleanCriterion(d.criterion)) }
  };
}

// ─── Campanha ───────────────────────────────────────────────────────────────
// O api recusa HTML (html_not_allowed); a tela avisa antes.
const HTML_LIKE = /<[A-Za-z\/!]/;
const HTML_MESSAGE = "não use HTML no título nem no texto";

export function validateCampaignFields(title: string, body: string): string | null {
  if (HTML_LIKE.test(title) || HTML_LIKE.test(body)) return HTML_MESSAGE;
  const t = title.trim().length;
  const b = body.trim().length;
  if (t < TITLE_MIN || t > TITLE_MAX) return `o título precisa ter de ${TITLE_MIN} a ${TITLE_MAX} caracteres`;
  if (b < BODY_MIN || b > BODY_MAX) return `o texto precisa ter de ${BODY_MIN} a ${BODY_MAX} caracteres`;
  return null;
}

export type SendAtCheck = { ok: true; iso: string } | { ok: false; message: string };

// Valor de <input type="datetime-local"> lido como hora de parede da cidade.
// É uma previsão: o api confere de novo no clique, e `invalid_send_at` volta
// traduzido por campaignError.
export function validateSendAt(value: string, now: Date = new Date()): SendAtCheck {
  const at = parseCityLocal(value);
  if (!at) return { ok: false, message: "informe data e hora do envio" };
  const delta = at.getTime() - now.getTime();
  if (delta < SEND_AT_MIN_MS) return { ok: false, message: "agende para pelo menos 5 minutos a partir de agora" };
  if (delta > SEND_AT_MAX_MS) return { ok: false, message: "agende para no máximo 90 dias a partir de agora" };
  return { ok: true, iso: at.toISOString() };
}

// ─── Recusas ────────────────────────────────────────────────────────────────
const MESSAGES: Record<string, string> = {
  missing_role: "seu papel não permite esta ação",
  invalid_campaign: `confira o título (${TITLE_MIN} a ${TITLE_MAX} caracteres) e o texto (${BODY_MIN} a ${BODY_MAX})`,
  below_minimum: "o público tem menos de 5 telefones — ajuste o público",
  not_editable: "esta campanha não é mais rascunho — volte à lista e abra de novo",
  invalid_transition: "a campanha mudou de estado enquanto você decidia — volte à lista e abra de novo",
  invalid_send_at: "horário fora da janela: agende de 5 minutos a 90 dias a partir de agora",
  not_found: "campanha não encontrada — volte à lista",
  invalid_setting: "valor inválido para a chave de SMS",
  city_profile_missing: "a cidade ainda não tem perfil configurado; fale com o suporte"
};
const GENERIC = "não foi possível concluir — tente de novo";

type CampaignErrorBody = { error?: string; details?: { path?: string; message?: string }[] };

function errorBody(err: ApiError): CampaignErrorBody {
  return (err.body && typeof err.body === "object" ? err.body : {}) as CampaignErrorBody;
}

function translate(body: CampaignErrorBody): string | null {
  if (body.error === "invalid_audience") {
    // details[].path é JSON Pointer do api: não vai para a tela.
    if (body.details?.some((d) => d.message === "inactive_or_unknown")) {
      return "há bairro ou unidade inativa no recorte — desmarque ou troque";
    }
    return "público inválido — confira o recorte e os critérios";
  }
  if (body.error === "invalid_campaign" && body.details?.some((d) => d.message === "html_not_allowed")) {
    return HTML_MESSAGE;
  }
  return (body.error && MESSAGES[body.error]) || null;
}

export function campaignErrorCode(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const code = errorBody(err).error;
  return typeof code === "string" ? code : null;
}

export function campaignError(err: unknown): string {
  if (!(err instanceof ApiError)) return GENERIC;
  if (err.status === 401) return "sessão expirada — entre de novo";
  return translate(errorBody(err)) ?? GENERIC;
}

// Para SensitiveAction.translateError: null deixa a frase padrão dele (rede,
// sessão expirada, mfa_required) aparecer.
export function campaignErrorOrNull(err: unknown): string | null {
  if (!(err instanceof ApiError) || err.status === 401) return null;
  return translate(errorBody(err));
}
