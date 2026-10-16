// src/lib/exams.ts
// Rastreamento de exames no painel da cidade (módulo 21a, ADR 0036; contrato
// 2026-10-13). Regras de tela, puras: rótulos, quem vê qual botão, validação
// dos formulários e as frases das recusas. Quem pode o quê de verdade, a
// situação, os prazos vencidos e a política de liberação são do api.
import type { QueryClient } from "@tanstack/react-query";
import {
  ApiError, EXAM_UPLOAD_MAX_BYTES, EXAM_UPLOAD_TYPES, errorCode, isExamLinkExpired,
  type ExamDeadlines, type ExamEvent, type ExamOrder, type ExamOverdue, type ExamPriority, type ExamProviderKind, type ExamReleasePolicy,
  type ExamResultField, type ExamStage, type ReceptionOrderInput, type ResultInput, type ScheduleInput, type ScheduleWhen
} from "./api";
import { OPENING_ENDED } from "./clinicalRecord";
import { cid10Problem } from "./consultation";
import { featureDisabledKey, hasFeature } from "./features";
import { cityLocalIso } from "./format";
import { TIMELINE_KEY } from "./timeline";
import { isValidCns } from "./professionals";
import type { Tone } from "../theme/tokens";

export const EXAM_ORDERS_KEY = "examOrders";
export const EXAM_ORDER_KEY = "examOrder";
export const EXAM_PENDING_KEY = "examPending";
export const EXAM_TEAM_KEY = "examTeam";
export const EXAM_REGULATION_KEY = "examRegulation";
export const EXAM_CATALOG_KEY = "examCatalog";
export const EXAM_ADMIN_CATALOG_KEY = "examAdminCatalog";
export const EXAM_PROVIDER_REFS_KEY = "examProviderRefs";
export const EXAM_ADMIN_PROVIDERS_KEY = "examAdminProviders";
export const EXAM_REPORT_KEY = "examReport";
export const PROVIDER_ORDERS_KEY = "providerOrders";
export const EXTERNAL_RESULTS_KEY = "examExternalResults";
export const EXAM_REQUESTERS_KEY = "examRequesters";

// Tudo o que muda quando um exame anda (as listas, o detalhe e a linha do
// tempo, que também abre o exame).
const MOVING_KEYS = [
  EXAM_ORDERS_KEY, EXAM_ORDER_KEY, EXAM_PENDING_KEY, EXAM_TEAM_KEY, EXAM_REGULATION_KEY, PROVIDER_ORDERS_KEY, EXTERNAL_RESULTS_KEY, TIMELINE_KEY
];

export const EXAMS_DISABLED = "o rastreamento de exames está desligado nesta cidade";
export const EXAMS_NO_ROLE = "seu papel não permite ver esta tela";
export const PDF_LINK_EXPIRED = "o link do laudo expirou — abra de novo";
// 404 no laudo: token de outro usuário, forjado ou o laudo trocou — relê o exame.
export const PDF_NOT_FOUND = "laudo não encontrado — abra o exame de novo";
// 409 no detalhe: a tela já relê sozinha, não manda o usuário atualizar.
export const DETAIL_TRANSITION_REREAD = "a situação do exame mudou; a tela foi atualizada";

const STATUS_LABEL: Record<string, string> = {
  awaiting_authorization: "aguardando autorização",
  denied: "negado",
  awaiting_schedule: "a agendar",
  scheduled: "agendado",
  collected: "coletado",
  resulted: "resultado registrado",
  acknowledged: "ciência dada",
  cancelled: "cancelado"
};
const STATUS_TONE: Record<string, Tone> = {
  awaiting_authorization: "info", denied: "neutral", resulted: "warn", acknowledged: "ok", cancelled: "neutral"
};

export function examStatusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

export function examStatusTone(status: string): Tone | undefined {
  return STATUS_TONE[status];
}

export const EXAM_STAGES: ExamStage[] = [ "authorize", "schedule", "collect", "result", "acknowledge" ];
export const STAGE_LABEL: Record<ExamStage, string> = {
  authorize: "autorização", schedule: "agendamento", collect: "coleta", result: "resultado", acknowledge: "ciência"
};
// Padrão da plataforma (spec §5; contrato §1).
export const DEFAULT_DEADLINES: Record<ExamStage, number> = { authorize: 15, schedule: 15, collect: 30, result: 30, acknowledge: 15 };

export const PRIORITY_LABEL: Record<ExamPriority, string> = { routine: "rotina", urgent: "urgente" };
export const ORIGIN_LABEL: Record<string, string> = { consultation: "consulta", reception_guide: "guia da recepção", pec: "PEC", lab_reception: "recepção do laboratório" };
export const SOURCE_LABEL: Record<string, string> = {
  unit: "registrado pela unidade", provider: "registrado pelo prestador", fhir: "recebido do laboratório (FHIR)",
  consultation: "registrado na consulta", lab: "laudo do laboratório municipal"
};

const EVENT_LABEL: Record<string, string> = {
  requested: "solicitado", authorized: "autorizado", denied: "negado", scheduled: "agendado", collected: "coletado",
  resulted: "resultado registrado", acknowledged: "ciência", escalated: "enviado à equipe", cancelled: "cancelado"
};

export function eventLabel(kind: string): string {
  return EVENT_LABEL[kind] ?? kind;
}

export const RELEASE_POLICIES: { value: ExamReleasePolicy; label: string; hint: string }[] = [
  { value: "after_acknowledgement", label: "Depois da ciência", hint: "o cidadão vê o laudo depois que quem pediu dá ciência (padrão)" },
  { value: "immediate", label: "Imediata", hint: "o cidadão vê o laudo assim que o resultado é registrado" },
  { value: "never_citizen", label: "Nunca no wpda", hint: "o cidadão vê \"retire o resultado na sua unidade\"" }
];

export function releasePolicyLabel(policy: string): string {
  return RELEASE_POLICIES.find((p) => p.value === policy)?.label ?? policy;
}

export const PROVIDER_KINDS: { value: ExamProviderKind; label: string }[] = [
  { value: "municipal", label: "Laboratório municipal" },
  { value: "accredited", label: "Credenciado" },
  { value: "consortium", label: "Consórcio" },
  { value: "lacen", label: "LACEN" },
  { value: "imaging", label: "Imagem" }
];

export function providerKindLabel(kind: string): string {
  return PROVIDER_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

export type EscalationReason = "critical" | "unlinked_requester" | "overdue";
export const ESCALATION_LABEL: Record<EscalationReason, string> = {
  critical: "resultado crítico", unlinked_requester: "solicitante sem vínculo", overdue: "prazo de ciência vencido"
};

// Texto de um código de motivo; código desconhecido aparece cru (C2).
export function escalationLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return (ESCALATION_LABEL as Record<string, string>)[code] ?? code;
}

// O motivo sai do próprio exame (contrato §2 não traz o motivo na lista):
// crítico vence — também quando a 1ª escalada foi por prazo e o crítico veio
// depois (A31, o evento está no detalhe); solicitante digitado é escalado já
// no resultado; o resto é prazo.
// A31: a marca "crítico" também vem de qualquer escalada por crítico no andamento.
export function criticalFromTrail(events: ExamEvent[] | null | undefined): boolean {
  return !!events?.some((e) => e.kind === "escalated" && e.reason === "critical");
}

// B63: os motivos gravados pelo api, na ordem; nada é deduzido do resultado vigente
// (um crítico retificado para normal continua "resultado crítico").
export function escalationReasonsText(o: ExamOrder): string {
  const reasons = o.escalation_reasons ?? [];
  return reasons.length > 0 ? reasons.map((r) => escalationLabel(r)).join(" · ") : "—";
}

export interface ExamRoles { professional: boolean; reception: boolean; regulator: boolean; admin: boolean; provider: boolean }

export function examRoles(user: { operator: boolean; memberships: { role: string }[] } | null): ExamRoles {
  const roles = user && !user.operator ? user.memberships.map((m) => m.role) : [];
  return {
    professional: roles.includes("health_professional"),
    reception: roles.includes("citizen_verifier"),
    regulator: roles.includes("exam_regulator"),
    admin: roles.includes("municipal_admin"),
    provider: roles.includes("exam_provider")
  };
}

export function canUseExams(user: { operator: boolean; features?: unknown } | null): boolean {
  return !!user && !user.operator && hasFeature(user, "exam_tracking");
}

export interface ExamActions {
  schedule: boolean; collect: boolean; result: boolean; cancel: boolean; acknowledge: boolean; acknowledgeNeedsReason: boolean;
}

const BEFORE_RESULT = new Set([ "awaiting_authorization", "awaiting_schedule", "scheduled", "collected" ]);

// O que a tela oferece; o api confere de novo (papel, vínculo, equipe, situação).
export function examActions(order: ExamOrder, roles: ExamRoles, userId: string | null): ExamActions {
  // C4: o administrador municipal não é da unidade (o api responde 403).
  const unit = roles.reception || roles.professional;
  const isRequester = !!userId && order.requester.user_id === userId;
  const byTeam = order.status === "resulted" && order.escalated && roles.professional && !isRequester;
  return {
    // A unidade agenda e reagenda até a coleta; reagendar mantém o prestador atual.
    schedule: unit && (order.status === "awaiting_schedule" || order.status === "scheduled"),
    collect: unit && order.status === "scheduled",
    result: unit && (order.status === "scheduled" || order.status === "collected"),
    cancel: (isRequester || roles.reception) && BEFORE_RESULT.has(order.status),
    acknowledge: order.status === "resulted" && (isRequester || byTeam),
    acknowledgeNeedsReason: byTeam
  };
}

// Portal do prestador: agenda ou reagenda o próprio exame, sem trocar o prestador.
export function providerCanSchedule(status: string): boolean {
  return status === "awaiting_schedule" || status === "scheduled";
}

export function daysLateLabel(days: number): string {
  return days === 1 ? "1 dia de atraso" : `${days} dias de atraso`;
}

export function overdueLabel(o: ExamOverdue | null): string {
  if (!o) return "no prazo";
  return `${STAGE_LABEL[o.stage] ?? o.stage} · ${daysLateLabel(o.days_late)}`;
}

export function fmtDay(iso: string | null | undefined): string {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  return m ? `${m[3]}/${m[2]}/${m[1]}` : "—";
}

export function cpfTail(last3: string): string {
  return `CPF final ${last3}`;
}

export function uploadProblem(file: { size: number; type: string } | null): string | null {
  if (!file) return "escolha um arquivo";
  if (!(EXAM_UPLOAD_TYPES as readonly string[]).includes(file.type)) return "envie PDF, JPEG ou PNG";
  if (file.size > EXAM_UPLOAD_MAX_BYTES) return "o arquivo passa de 10 MB";
  if (file.size === 0) return "o arquivo está vazio";
  return null;
}

export const REASON_MIN = 5;

export function reasonProblem(text: string): string | null {
  return text.trim().length < REASON_MIN ? `escreva o motivo (ao menos ${REASON_MIN} caracteres)` : null;
}

export type DeadlineDraft = Record<ExamStage, string>;

export function deadlineDraft(d: ExamDeadlines | null | undefined): DeadlineDraft {
  const out = {} as DeadlineDraft;
  for (const s of EXAM_STAGES) out[s] = d?.[s] == null ? "" : String(d[s]);
  return out;
}

export function deadlinesProblem(d: DeadlineDraft): string | null {
  for (const s of EXAM_STAGES) {
    const v = d[s].trim();
    if (v === "") continue;
    if (!/^\d+$/.test(v) || Number(v) < 1 || Number(v) > 365) {
      return `prazo de ${STAGE_LABEL[s]}: use dias inteiros de 1 a 365, ou deixe em branco`;
    }
  }
  return null;
}

export function deadlinesFrom(d: DeadlineDraft): ExamDeadlines {
  const out = {} as ExamDeadlines;
  for (const s of EXAM_STAGES) out[s] = d[s].trim() === "" ? null : Number(d[s].trim());
  return out;
}

export function effectiveDeadline(
  stage: ExamStage, provider: ExamDeadlines | null | undefined, catalog: ExamDeadlines | null | undefined, priority: ExamPriority = "routine"
): number {
  const base = provider?.[stage] ?? catalog?.[stage] ?? DEFAULT_DEADLINES[stage];
  return priority === "urgent" ? Math.ceil(base / 2) : base;
}

// "autorização · agendamento · coleta · resultado · ciência", em dias.
export function deadlinesSummary(d: ExamDeadlines): string {
  return EXAM_STAGES.map((s) => effectiveDeadline(s, null, d)).join(" · ");
}

export function resultFieldsProblem(fields: ExamResultField[]): string | null {
  const keys = new Set<string>();
  for (const [ i, f ] of fields.entries()) {
    const n = i + 1;
    const key = f.key.trim();
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) return `campo ${n}: a chave usa letras minúsculas, números e _ (ex.: hemoglobina)`;
    if (keys.has(key)) return `campo ${n}: a chave ${key} repete`;
    keys.add(key);
    if (!f.label.trim()) return `campo ${n}: informe o nome`;
    if (f.loinc && f.loinc.trim() && !/^\d{1,7}-\d$/.test(f.loinc.trim())) return `campo ${n}: LOINC no formato 718-7`;
  }
  return null;
}

export function sigtapProblem(code: string): string | null {
  return /^\d{10}$/.test(code.trim()) ? null : "o código SIGTAP tem 10 dígitos";
}

export function cnesProblem(value: string): string | null {
  const v = value.trim();
  return v === "" || /^\d{7}$/.test(v) ? null : "o CNES tem 7 dígitos";
}

export interface ResultDraft { uploadId: string | null; releasedOn: string; laboratoryName: string; critical: boolean; values: Record<string, string> }

export function emptyResultDraft(today: string): ResultDraft {
  return { uploadId: null, releasedOn: today, laboratoryName: "", critical: false, values: {} };
}

export function resultProblem(d: ResultDraft, today: string): string | null {
  if (!d.uploadId) return "anexe o laudo";
  if (!d.releasedOn) return "informe a data de liberação do laudo";
  if (d.releasedOn > today) return "a data de liberação não pode ser no futuro";
  if (!d.laboratoryName.trim()) return "informe o laboratório";
  return null;
}

export function resultBody(d: ResultDraft): ResultInput {
  return {
    upload_id: d.uploadId as string, released_on: d.releasedOn, laboratory_name: d.laboratoryName.trim(), critical: d.critical,
    values: Object.entries(d.values).map(([ key, value ]) => ({ key, value: value.trim() })).filter((v) => v.value !== "")
  };
}

export interface ScheduleDraft { providerId: string; at: string; place: string }

export function scheduleProblem(d: ScheduleDraft, needsProvider: boolean): string | null {
  if (needsProvider && !d.providerId) return "escolha o prestador";
  if (!d.at || !cityLocalIso(d.at)) return "informe data e hora";
  if (!d.place.trim()) return "informe o local";
  return null;
}

export function scheduleWhen(d: ScheduleDraft): ScheduleWhen {
  return { scheduled_at: cityLocalIso(d.at) as string, scheduled_place: d.place.trim() };
}

// `providerId`: o prestador já definido (autorização ou guia); senão o escolhido.
export function scheduleBody(d: ScheduleDraft, providerId?: string): ScheduleInput {
  return { provider_id: providerId ?? d.providerId, ...scheduleWhen(d) };
}

export interface GuideDraft {
  sigtapCode: string; priority: ExamPriority; cid10: string; requesterMode: "linked" | "typed";
  requesterId: string; requesterName: string; requesterCns: string; externalReference: string; guideUploadId: string | null;
}

export const EMPTY_GUIDE: GuideDraft = {
  sigtapCode: "", priority: "routine", cid10: "", requesterMode: "linked", requesterId: "", requesterName: "", requesterCns: "",
  externalReference: "", guideUploadId: null
};

const normalizeCid = (text: string) => text.trim().toUpperCase().replace(/\./g, "");

export function guideProblem(d: GuideDraft): string | null {
  if (!d.sigtapCode) return "escolha o exame";
  const cid = cid10Problem(d.cid10);
  if (cid) return cid;
  if (d.requesterMode === "linked" && !d.requesterId) return "escolha o profissional que pediu";
  if (d.requesterMode === "typed") {
    if (!d.requesterName.trim()) return "informe o nome de quem pediu";
    if (!isValidCns(d.requesterCns)) return "CNS de quem pediu inválido";
  }
  if (!d.guideUploadId) return "anexe a foto ou o PDF da guia";
  return null;
}

export function guideBody(d: GuideDraft, patientId: string, unitId: string): ReceptionOrderInput {
  const cid = normalizeCid(d.cid10);
  const ref = d.externalReference.trim();
  return {
    patient_id: patientId, unit_id: unitId, sigtap_code: d.sigtapCode, priority: d.priority,
    ...(cid ? { cid10_justification: cid } : {}),
    requester: d.requesterMode === "linked"
      ? { user_id: d.requesterId }
      : { name: d.requesterName.trim(), cns: d.requesterCns.replace(/\D/g, "") },
    ...(ref ? { external_reference: ref } : {}),
    guide_upload_id: d.guideUploadId as string
  };
}

// Um exame que muda entre duas páginas não aparece duas vezes: vale a primeira.
export function mergeById<T extends { id: string }>(pages: { orders: T[] }[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const page of pages) {
    for (const item of page.orders) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}

export async function refreshExams(client: QueryClient): Promise<void> {
  await Promise.all(MOVING_KEYS.map((key) => client.invalidateQueries({ queryKey: [ key ] })));
}

// "+" só na tela da lista (C14): conta as linhas lidas e há mais páginas. O
// Início e o menu usam a rota de contagem (A46), exata — sem "+".
export function pendingCountText(count: number, hasMore: boolean): string {
  return hasMore ? `${count}+` : String(count);
}

export function pendingNoticeText(pending: number, denied: number, hasMore = false): string {
  const parts: string[] = [];
  if (pending > 0) {
    parts.push(pending === 1 && !hasMore ? "1 resultado aguardando sua ciência" : `${pendingCountText(pending, hasMore)} resultados aguardando sua ciência`);
  }
  if (denied > 0) parts.push(denied === 1 ? "1 exame negado" : `${denied} exames negados`);
  return parts.join(" · ");
}

// C9: vencido é só 410 `link_expired`; 403 é papel ou interruptor, não link.
export function pdfLinkExpired(err: unknown): boolean {
  return isExamLinkExpired(err);
}

const ERRORS: Record<string, string> = {
  invalid_transition: "a situação do exame mudou — atualize para ver a atual",
  reason_required: "informe o motivo",
  provider_not_enabled_for_exam: "este prestador não faz este exame — escolha outro ou habilite-o no cadastro",
  result_already_registered: "o resultado deste exame já foi registrado",
  missing_role: "seu papel não permite esta ação",
  not_requester: "só quem pediu o exame pode fazer isto",
  not_in_team: "este exame é da fila de outra equipe",
  out_of_context: "esta pessoa não está em atendimento com você",
  opening_required: OPENING_ENDED,
  sigtap_not_in_catalog: "este exame não está no catálogo da cidade",
  invalid_cns: "CNS de quem pediu inválido",
  guide_missing: "anexe a foto ou o PDF da guia",
  invalid_file: "arquivo inválido — envie PDF, JPEG ou PNG de até 10 MB",
  sigtap_unknown: "código SIGTAP não encontrado na competência vigente",
  duplicate_sigtap: "este exame já está no catálogo",
  invalid_deadline: "prazo inválido — use dias inteiros de 1 a 365",
  patient_not_found: "nenhum paciente com este CPF na cidade",
  citizen_not_verified: "este CPF ainda não tem cadastro validado — faça a validação presencial no balcão antes",
  not_unit_staff: "você não atua nesta unidade",
  not_found: "exame não encontrado — atualize a lista",
  link_expired: PDF_LINK_EXPIRED,
  already_acknowledged: "este exame já teve a ciência dada — atualize para ver a atual",
  invalid_policy: "política de liberação inválida",
  invalid_result_fields: "campos de resultado inválidos — confira chave, nome e LOINC",
  invalid_active: "informe se o exame está ativo ou não",
  invalid_requires_authorization: "informe se o exame exige autorização",
  missing_pdf: "o laudo precisa ser um PDF",
  invalid_values: "valores do resultado inválidos — confira os campos do exame",
  invalid_released_on: "data de liberação do laudo inválida ou no futuro",
  invalid_laboratory: "informe o laboratório (até 120 caracteres)",
  invalid_critical: "marque o resultado como crítico ou não",
  invalid_schedule: "data, hora ou local do agendamento inválidos",
  invalid_requester: "quem pediu o exame é inválido — escolha um profissional ou informe nome e CNS",
  invalid_cid10: "CID-10 inválido, ex.: E11 ou E119",
  invalid_external_reference: "referência externa inválida",
  invalid_priority: "prioridade inválida",
  reason_too_long: "o motivo é longo demais — resuma",
  invalid_filter: "filtro inválido — limpe os filtros e tente de novo",
  invalid_cursor: "a lista mudou — atualize e tente de novo",
  filter_required: "escolha ao menos um filtro",
  invalid_month: "mês inválido",
  invalid_name: "informe o nome",
  invalid_kind: "tipo de prestador inválido",
  invalid_cnes: "o CNES tem 7 dígitos",
  invalid_address: "endereço do laboratório inválido — até 200 caracteres",
  invalid_phone: "telefone do laboratório inválido — DDD e número, 10 ou 11 dígitos",
  invalid_uses_municipal_lab: "marca do laboratório municipal inválida",
  municipal_lab_disabled: "o laboratório municipal não está ligado nesta cidade — a marca não pode ser aplicada",
  invalid_items: "exames do prestador inválidos — confira a lista",
  duplicate_name: "já existe um prestador com este nome",
  patient_mismatch: "este exame é de outra pessoa",
  identifier_conflict: "este identificador já está em uso",
  not_verified: "este CPF ainda não tem cadastro validado — faça a validação presencial no balcão antes",
  too_many_requests: "muitas tentativas seguidas — espere um minuto e tente de novo",
  invalid_gal_requisition: "número do GAL inválido — use letras, números e hífen (até 30)",
  gal_already_registered: "a requisição do GAL deste exame já foi registrada",
  provider_uses_municipal_lab: "este prestador usa o laboratório municipal — o resultado sai pela liberação do laudo"
};

// F-21.24: número da requisição no GAL do LACEN (só registro, uma vez só — B5).
export function galProblem(value: string): string | null {
  return /^[A-Za-z0-9-]{1,30}$/.test(value.trim()) ? null : ERRORS.invalid_gal_requisition;
}

export const FAKE_LAB_DISABLED = "o laboratório simulado está desligado nesta cidade";

export function examError(err: unknown): string {
  const feature = featureDisabledKey(err);
  if (feature === "fake_lab") return FAKE_LAB_DISABLED;
  if (feature !== null) return EXAMS_DISABLED;
  const code = errorCode(err);
  if (code && ERRORS[code]) return ERRORS[code];
  if (err instanceof ApiError) return `não foi possível concluir (${err.status}${code ? `: ${code}` : ""}) — tente de novo`;
  return "sem conexão com o servidor — tente de novo";
}
