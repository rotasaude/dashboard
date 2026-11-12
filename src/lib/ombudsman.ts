// Regras de tela da ouvidoria (módulo 33): portões, papéis, rótulos, cores, quais ações cabem em cada estado e papel, validações
// locais e a frase de cada recusa do api. Tudo aqui é puro: sem storage, sem console, sem rede.
// O que é do api: estados, `can` do detalhe (quem pode agora), faixas dos textos e os códigos de recusa (api-shapes §4). O que a
// tela só confere antes de enviar: as mesmas faixas, para mostrar todos os problemas de uma vez; o api continua sendo a palavra final.
// Nenhuma frase interpola nome, CPF, contato, texto da manifestação, extrato, resposta, motivo ou justificativa.
import {
  ApiError, errorCode,
  type ArchiveReason, type DeadlineColor, type IdentificationMode, type ManifestationState,
  type OmbudsmanActionName, type OmbudsmanDestination, type OmbudsmanKind, type OmbudsmanManifestation,
  type OmbudsmanOptions, type OmbudsmanPerson, type OmbudsmanSettings, type OmbudsmanStaffChannel, type Resolution
} from "./api";
import { isValidCpf } from "./attendance";
import { NOMINAL_QUERY, STATIC_QUERY } from "./careLines";
import { featureDisabledKey, featureLabel, hasFeature } from "./features";
import type { Problem, Refusal } from "./pharmacy";

export { NOMINAL_QUERY, STATIC_QUERY };

// ─── Chaves de consulta ─────────────────────────────────────────────────────
export const OMB_LIST_KEY = "ombudsmanList";
export const OMB_DETAIL_KEY = "ombudsmanDetail";
export const OMB_OPTIONS_KEY = "ombudsmanOptions";
export const OMB_INBOX_KEY = "ombudsmanInbox";
export const OMB_SETTINGS_KEY = "ombudsmanSettings";
export const OMB_SUBJECTS_KEY = "ombudsmanSubjects";
export const OMB_RESPONDERS_KEY = "ombudsmanResponders";
export const DEPARTMENTS_KEY = "departments";
export const OMB_DASHBOARD_KEY = "ombudsmanDashboard";
export const OMB_REPORT_KEY = "ombudsmanReport";

// ─── Frases fixas ───────────────────────────────────────────────────────────
export const OMBUDSMAN_DISABLED = "a ouvidoria está desligada nesta cidade";
export const OMBUDSMAN_NO_ROLE = "seu papel não permite usar a ouvidoria";
export const IDENTITY_PRESERVED = "Identidade preservada — só o ouvidor vê, com justificativa registrada.";
export const ANONYMOUS_NO_IDENTITY = "Denúncia anônima, sem dados de quem a fez.";
export const EXTRACT_NOTICE = "Não escreva o nome nem dados de quem fez a manifestação.";
export const ANONYMOUS_INTERNAL = "Denúncia anônima: a conclusão fica interna e não vai a ninguém.";
export const MANIFESTATION_CHANGED = "a manifestação mudou enquanto a tela estava aberta — os dados foram relidos; confira antes de repetir";
export const PUBLIC_REPORT_NOTICE = "Este texto será publicado no site da cidade. Não escreva nome, CPF nem detalhe que identifique alguém.";
export const NO_RECEIPT_ANONYMOUS = "A denúncia anônima não tem comprovante.";
export const PROTOCOL_QUERY_TEXT = "use o protocolo AAAA-NNNNNN ou só o ano AAAA-";
const OFFLINE = "não foi possível falar com o servidor — tente de novo";
const SESSION_EXPIRED = "sessão expirada — entre de novo";
const NOT_AVAILABLE = "esta ação não está disponível agora";

// ─── Portões e papéis ───────────────────────────────────────────────────────
type SessionLike = { operator: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;

// Sem o interruptor `ombudsman`, ou para o operador da plataforma, a tela nem lê nada.
export function canUseOmbudsman(user: SessionLike): boolean {
  return !!user && !user.operator && hasFeature(user, "ombudsman");
}

export type OmbudsmanRoles = { lead: boolean; staff: boolean; responder: boolean; admin: boolean };

// `ombudsman` (o ouvidor) implica a equipe (`ombudsman_staff`); respondente só responde.
export function ombudsmanRoles(user: SessionLike): OmbudsmanRoles {
  const roles = user?.memberships?.map((m) => m.role) ?? [];
  const lead = roles.includes("ombudsman");
  return { lead, staff: lead || roles.includes("ombudsman_staff"), responder: roles.includes("ombudsman_responder"), admin: roles.includes("municipal_admin") };
}

// ─── Rótulos. Código novo do api aparece cru. ───────────────────────────────
const pick = (map: Record<string, string>) => (code: string): string => (Object.prototype.hasOwnProperty.call(map, code) ? map[code] : code);

export const kindLabel = pick({ complaint: "Reclamação", report: "Denúncia", praise: "Elogio", suggestion: "Sugestão", request: "Solicitação" });
export const modeLabel = pick({ identified: "Identificada", preserved: "Identidade preservada", anonymous: "Anônima" });
export const channelLabel = pick({ web: "Canal do cidadão", in_person: "Presencial", phone: "Telefone", ouvidorsus: "OuvidorSUS" });
export const stateLabel = pick({
  received: "recebida", in_analysis: "em análise", forwarded: "encaminhada", awaiting_complement: "aguardando complemento",
  answered: "respondida", archived: "arquivada"
});
export const colorLabel = pick({ green: "no prazo", yellow: "perto do prazo", red: "vencida", paused: "prazo suspenso" });
export const COLOR_TONE: Record<DeadlineColor, "ok" | "warn" | "down" | "info"> = { green: "ok", yellow: "warn", red: "down", paused: "info" };
export const archiveReasonLabel = pick({
  duplicate: "Duplicidade", no_complement: "Sem complemento no prazo", lack_of_clarity: "Falta de clareza",
  lack_of_civility: "Falta de urbanidade", improper: "Manifestação imprópria", loss_of_object: "Perda de objeto",
  forwarded_elsewhere: "Encaminhada a outro órgão"
});
export const resolutionLabel = pick({ resolved: "resolvida", not_resolved: "não resolvida" });
export const forwardingStateLabel = pick({ pending: "aguardando resposta", replied: "respondido", declined: "recusado pelo destino", cancelled: "cancelado" });
export const eventKindLabel = pick({
  received: "Manifestação recebida", classified: "Classificada", forwarded: "Encaminhada", forwarding_cancelled: "Encaminhamento cancelado",
  forwarding_replied: "Destino respondeu", forwarding_declined: "Destino recusou", forwarding_extended: "Prazo do destino prorrogado",
  complement_requested: "Complemento pedido", complement_received: "Complemento recebido", extended: "Prazo prorrogado",
  interim_response: "Resposta intermediária", final_response: "Resposta conclusiva", archived: "Arquivada", reopen_requested: "Reabertura pedida",
  reopen_rejected: "Reabertura recusada", reopened: "Reaberta", resolution_changed: "Resolutividade alterada",
  identity_consent_recorded: "Consentimento de identificação registrado"
});
export const destinationLabel = (d: OmbudsmanDestination): string =>
  `${d.kind === "department" ? "Setor" : "Unidade"}: ${d.name}`;

// Motivos de arquivamento que a tela oferece: `no_complement` é só do sistema (Q36).
export const OFFERED_ARCHIVE_REASONS: ArchiveReason[] =
  [ "duplicate", "lack_of_clarity", "lack_of_civility", "improper", "loss_of_object", "forwarded_elsewhere" ];

// ─── Frases dos códigos de recusa (api-shapes §4; as marcadas "local" só nascem nas validações da tela) ───
export const OMBUDSMAN_ERRORS: Record<string, string> = {
  unauthenticated: SESSION_EXPIRED,
  json_required: "não foi possível enviar — tente de novo",
  feature_disabled: OMBUDSMAN_DISABLED,
  missing_role: OMBUDSMAN_NO_ROLE,
  not_found: "não encontrado — a lista foi atualizada",
  link_expired: "o endereço do anexo venceu — abra de novo",
  manifestation_changed: MANIFESTATION_CHANGED,
  forwarding_changed: "o encaminhamento mudou enquanto a tela estava aberta — os dados foram relidos",
  already_decided: "este pedido de reabertura já foi decidido",
  name_taken: "já existe um item com esse nome",
  already_responder: "esta pessoa já responde por este destino",
  report_published: "o relatório deste ano já foi publicado e não muda",
  already_published: "o relatório deste ano já foi publicado e não muda",
  too_many_requests: "muitas tentativas seguidas — espere um pouco",
  invalid_request: "recusado pelo servidor (invalid_request)",
  invalid_transition: "a manifestação já não está neste estado — os dados foram relidos; confira antes de repetir",
  subject_not_leaf: "escolha um subassunto — este assunto tem subdivisões",
  destination_without_responder: "este destino não tem respondente ativo — cadastre um na Configuração da ouvidoria",
  complement_not_allowed: "a denúncia anônima não recebe pedido de complemento",
  complement_already_used: "o complemento já foi pedido neste ciclo",
  already_extended: "a prorrogação já foi usada neste ciclo",
  not_allowed_anonymous: "a denúncia anônima não recebe resposta intermediária",
  forwarding_pending: "há encaminhamento pendente — cancele ou aguarde a resposta",
  no_identity: "não há dados de quem fez esta manifestação",
  too_many_attachments: "até 3 anexos",
  invalid_file: "o anexo tem de ser PDF, JPEG ou PNG, de até 10 MB",
  invalid_cpf: "CPF inválido",
  invalid_cursor: "a lista mudou — ela será lida do início",
  invalid_period: "período inválido",
  too_deep: "subassunto não pode ter subassunto",
  missing_responder_role: "esta pessoa não tem o papel de ponto de resposta",
  year_not_closed: "o relatório só se publica depois que o ano termina",
  // local
  attachment_limit: "até 3 anexos",
  attachment_type: "o anexo tem de ser PDF, JPEG ou PNG",
  attachment_too_large: "cada anexo tem até 10 MB",
  destination_inactive: "este destino foi desativado"
};

// `invalid_request` por `path` (molde do FIELD_TEXT do CAPS). Path fora da lista: "recusado pelo servidor (invalid_request)".
const TEXT_RANGE = "o texto tem de ter de 10 a 4000 caracteres";
const REPORT_TEXT = "cada texto do relatório tem até 8000 caracteres";
const DAYS_TEXT = "o prazo vai de 1 a 120 dias";
const SOURCE_NOT_FOUND = "protocolo da manifestação original não encontrado";
const FIELD_TEXT: [ RegExp, string ][] = [
  [ /^expected_state$/, "a tela está desatualizada — feche e abra de novo" ],
  [ /^subject_id$/, "escolha o assunto" ],
  [ /^kind$/, "tipo não aceito aqui (a denúncia anônima só vale para denúncia)" ],
  [ /^health_unit_id$/, "escolha uma unidade ativa (no encaminhamento, escolha só um destino: setor ou unidade)" ],
  [ /^professional_id$/, "escolha um profissional com vínculo ativo na unidade" ],
  [ /^urgent$/, "marque se é urgente ou não" ],
  [ /^department_id$/, "escolha um destino: um setor ou uma unidade" ],
  [ /^extract$/, "o extrato tem de ter de 20 a 4000 caracteres" ],
  [ /^text$/, TEXT_RANGE ],
  [ /^resolution$/, "informe se foi resolvida (só em reclamação, solicitação e denúncia)" ],
  // `reason` e `body` têm outro sentido nas rotas do respondente e do cancelamento: a frase é neutra, e cada formulário pode trocá-la (`fields`).
  [ /^reason$/, "informe o motivo (de 10 a 4000 caracteres; no arquivamento, escolha um da lista)" ],
  [ /^(duplicate_of_id|duplicate_of_protocol)$/, SOURCE_NOT_FOUND ],
  [ /^external_body_name$/, "informe o órgão para onde foi encaminhada (até 120 caracteres)" ],
  [ /^justification$/, "escreva a justificativa (de 10 a 500 caracteres)" ],
  [ /^granted$/, "informe se o cidadão consentiu" ],
  [ /^decision$/, "escolha aceitar ou recusar" ],
  [ /^channel$/, "escolha o canal: presencial, telefone ou OuvidorSUS" ],
  [ /^ouvidorsus_number$/, "informe o número do OuvidorSUS (até 40 caracteres)" ],
  [ /^identification_mode$/, "escolha como a pessoa quer ser identificada" ],
  [ /^body$/, "o texto tem de ter de 10 a 4000 caracteres (20 a 4000 na manifestação)" ],
  [ /^citizen_id$/, "este cidadão não pode ser ligado — registre nome e contato na manifestação" ],
  [ /^manifestant_name$/, "o nome tem de ter de 2 a 120 caracteres" ],
  [ /^manifestant_contact$/, "o contato tem de ter de 1 a 120 caracteres" ],
  [ /^manifestant_cpf$/, "CPF inválido" ],
  [ /^attachment_ids$/, "anexo inválido — suba o arquivo de novo" ],
  [ /^(filename|content_type|data)$/, "o anexo tem de ser PDF, JPEG ou PNG, de até 10 MB" ],
  [ /^cpf$/, "CPF inválido" ],
  [ /^name$/, "o nome tem de ter de 2 a 80 caracteres" ],
  [ /^active$/, "informe se está ativo ou não" ],
  [ /^parent_id$/, "escolha um assunto de primeiro nível" ],
  [ /^user_id$/, "escolha uma pessoa da lista" ],
  [ /^(recurring_problems|actions_taken|notes)$/, REPORT_TEXT ],
  [ /^state$/, "estado inválido" ],
  [ /^color$/, "cor de prazo inválida" ],
  [ /^q$/, PROTOCOL_QUERY_TEXT ],
  [ /^before$/, "a lista mudou — ela será lida do início" ],
  [ /^(response_days|extension_days|urgent_days|complement_days|forwarding_days|forwarding_extension_days|warning_days)$/, DAYS_TEXT ],
  [ /^anonymous_daily_cap$/, "o teto diário vai de 1 a 1000" ]
];

// Só código e path no formato do api saem do corpo; qualquer outra coisa (nome, texto, mensagem) fica fora da tela.
const CODE_FORMAT = /^[a-z0-9_]{1,64}$/;
const PATH_FORMAT = /^[a-z0-9_.[\]-]{1,64}$/;
const safeCode = (v: unknown): string => (typeof v === "string" && CODE_FORMAT.test(v) ? v : "");
const safePath = (v: unknown): string => (typeof v === "string" && PATH_FORMAT.test(v) ? v : "");
const bodyOf = (err: unknown): Record<string, unknown> | null =>
  err instanceof ApiError && err.body && typeof err.body === "object" ? (err.body as Record<string, unknown>) : null;

export type RefusalContext = { fields?: Record<string, string> };

function codeText(code: string, path: string, status: number, fields?: Record<string, string>): string {
  if (code === "invalid_request") {
    if (fields && Object.prototype.hasOwnProperty.call(fields, path)) return fields[path];
    return FIELD_TEXT.find(([ re ]) => re.test(path))?.[1] ?? OMBUDSMAN_ERRORS.invalid_request;
  }
  if (Object.prototype.hasOwnProperty.call(OMBUDSMAN_ERRORS, code)) return OMBUDSMAN_ERRORS[code];
  if (code === "" && status === 404) return OMBUDSMAN_ERRORS.not_found;
  return `recusado pelo servidor (${code || status})`;
}

// `feature_disabled` vale em 403 e em 404 (D1); outra chave de interruptor nomeia a funcionalidade.
function disabledText(err: ApiError): string | null {
  const body = bodyOf(err);
  if (body?.error !== "feature_disabled") return null;
  const key = featureDisabledKey(err) ?? (typeof body.feature === "string" ? body.feature : "");
  return key === "" || key === "ombudsman" ? OMBUDSMAN_DISABLED : `${featureLabel(key)} está desligado nesta cidade`;
}

// Todas as recusas, traduzidas: uma por `problems[]` (chave `error`, ou `code` por tolerância); sem `problems`, a do topo.
export function ombudsmanRefusals(err: unknown, ctx: RefusalContext = {}): Refusal[] {
  if (!(err instanceof ApiError)) return [ { path: "", code: "", text: OFFLINE } ];
  const disabled = disabledText(err);
  if (disabled) return [ { path: "", code: "feature_disabled", text: disabled } ];
  if (err.status === 401) return [ { path: "", code: "unauthenticated", text: SESSION_EXPIRED } ];
  const body = bodyOf(err);
  const raw = errorCode(err);
  const code = safeCode(raw);
  if (raw && !code) return [ { path: "", code: "", text: "recusado pelo servidor" } ];
  const list = Array.isArray(body?.problems) ? body.problems : [];
  const mapped = list.flatMap((item): Refusal[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const given = typeof row.error === "string" ? row.error : typeof row.code === "string" ? row.code : "";
    if (!given) return [];
    const c = safeCode(given);
    const path = safePath(row.path);
    return c ? [ { path, code: c, text: codeText(c, path, err.status, ctx.fields) } ] : [ { path, code: "", text: "recusado pelo servidor" } ];
  });
  if (mapped.length > 0) return mapped;
  const path = safePath(body?.path);
  return [ { path, code, text: codeText(code, path, err.status, ctx.fields) } ];
}

export const ombudsmanError = (err: unknown, ctx?: RefusalContext): string => ombudsmanRefusals(err, ctx)[0].text;

// A tela está velha: outro usuário mexeu (409), ou a ação já não cabe no estado (422). Quem chama relê uma vez e não reenvia.
export const isChanged = (err: unknown): boolean =>
  [ "manifestation_changed", "forwarding_changed", "invalid_transition" ].includes(errorCode(err) ?? "");

// ─── Filtro de protocolo da Caixa (Q51): só `AAAA-NNNNNN` (6 a 12 dígitos) ou o prefixo `AAAA-`; outro texto não sai da tela ───
export const isProtocolQuery = (q: string): boolean => /^\d{4}-(\d{6,12})?$/.test(q.trim());

// ─── Matriz de ações (§2) ───────────────────────────────────────────────────
const ACTION_ORDER: OmbudsmanActionName[] = [
  "classify", "forward", "request_complement", "complement", "extend", "interim_response", "final_response", "archive", "reopen",
  "change_resolution"
];
// O que APARECE em cada estado; `m.can[ação]` decide se está habilitada. Em `forwarded` a conclusiva aparece, bloqueada (F-7).
export const ACTIONS_BY_STATE: Record<ManifestationState, OmbudsmanActionName[]> = {
  received: [ "classify", "interim_response", "archive" ],
  in_analysis: [ "classify", "forward", "request_complement", "extend", "interim_response", "final_response", "archive" ],
  forwarded: [ "forward", "extend", "interim_response", "final_response" ],
  awaiting_complement: [ "complement", "extend", "interim_response", "archive" ],
  answered: [ "reopen", "change_resolution" ],
  archived: [ "reopen" ]
};
const LEAD_ONLY: OmbudsmanActionName[] = [ "extend", "archive", "reopen", "change_resolution" ];
const NOT_ANONYMOUS: OmbudsmanActionName[] = [ "request_complement", "complement", "interim_response" ];

export const needsResolution = (kind: OmbudsmanKind): boolean => kind === "complaint" || kind === "request" || kind === "report";

export function availableActions(m: OmbudsmanManifestation, roles: OmbudsmanRoles): OmbudsmanActionName[] {
  if (!roles.staff) return [];
  const anonymous = m.identification_mode === "anonymous";
  const shown = ACTIONS_BY_STATE[m.state] ?? [];
  return ACTION_ORDER.filter((a) =>
    shown.includes(a) && (roles.lead || !LEAD_ONLY.includes(a)) && !(anonymous && NOT_ANONYMOUS.includes(a))
    && (a !== "change_resolution" || needsResolution(m.kind)));
}

// Motivo de a ação estar desabilitada (`null` quando está liberada).
export function blockedReason(m: OmbudsmanManifestation, action: OmbudsmanActionName): string | null {
  if (action === "final_response" && m.pending_forwardings > 0) return OMBUDSMAN_ERRORS.forwarding_pending;
  if (action === "request_complement" && m.complement_used) return OMBUDSMAN_ERRORS.complement_already_used;
  if (action === "extend" && m.extended) return OMBUDSMAN_ERRORS.already_extended;
  return m.can[action] ? null : NOT_AVAILABLE;
}

export const canSeeIdentityButton = (m: OmbudsmanManifestation, roles: OmbudsmanRoles): boolean => roles.lead && m.can.open_identity;
export const canIssueReceipt = (m: Pick<OmbudsmanManifestation, "identification_mode">): boolean => m.identification_mode !== "anonymous";

// ─── Validações locais (os `path` são os do api; todos os problemas de uma vez) ───
// Code points depois do strip, como o api (Q8): um emoji conta 1.
const len = (v: string): number => [ ...v.trim() ].length;
const outside = (v: string, min: number, max: number): boolean => len(v) < min || len(v) > max;

export type NewDraft = {
  kind: OmbudsmanKind;
  mode: IdentificationMode;
  channel: OmbudsmanStaffChannel;
  ouvidorsusNumber: string;
  person: OmbudsmanPerson | null;
  manual: { name: string; contact: string; cpf: string };
  body: string;
  healthUnitId: string | null;
  files: File[];
};

export const ATTACHMENT_MAX = 3;
export const ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_TYPES = [ "application/pdf", "image/jpeg", "image/png" ];

// Tipo, 10 MB e até 3 (o api repete a conferência: `invalid_file`, `too_many_attachments`).
export function attachmentProblems(files: File[]): Problem[] {
  const out: Problem[] = [];
  if (files.length > ATTACHMENT_MAX) out.push({ path: "attachments", text: OMBUDSMAN_ERRORS.attachment_limit });
  for (const f of files) {
    if (f.size > ATTACHMENT_BYTES) out.push({ path: "attachments", text: OMBUDSMAN_ERRORS.attachment_too_large });
    if (!ATTACHMENT_TYPES.includes(f.type)) out.push({ path: "attachments", text: OMBUDSMAN_ERRORS.attachment_type });
  }
  return out;
}

export function newManifestationProblems(d: NewDraft): Problem[] {
  const out: Problem[] = [];
  const add = (path: string, text?: string) => out.push({ path, text: text ?? codeText("invalid_request", path, 422) });
  const m = d.manual;
  if (d.channel === "ouvidorsus" && outside(d.ouvidorsusNumber, 1, 40)) add("ouvidorsus_number");
  if (d.mode === "anonymous") {
    if (d.kind !== "report") add("kind");
    // Anônima não leva ninguém: o api recusa o primeiro que vier.
    if (d.person) add("citizen_id", "a denúncia anônima não leva dados de pessoa");
    if (len(m.name) > 0) add("manifestant_name", "a denúncia anônima não leva dados de pessoa");
    if (len(m.contact) > 0) add("manifestant_contact", "a denúncia anônima não leva dados de pessoa");
    if (len(m.cpf) > 0) add("manifestant_cpf", "a denúncia anônima não leva dados de pessoa");
  } else if (!d.person) {
    if (len(m.name) === 0) add("person", "busque a pessoa pelo CPF ou registre nome e contato");
    else if (outside(m.name, 2, 120)) add("manifestant_name");
    if (len(m.contact) > 120) add("manifestant_contact");
    if (len(m.cpf) > 0 && !isValidCpf(m.cpf)) add("manifestant_cpf");
  }
  if (outside(d.body, 20, 4000)) add("body");
  out.push(...attachmentProblems(d.files));
  return out;
}

export type ForwardDraft = { destination: { kind: "department" | "health_unit"; id: string } | null; extract: string };

export function forwardProblems(d: ForwardDraft, options: OmbudsmanOptions): Problem[] {
  const out: Problem[] = [];
  if (!d.destination) out.push({ path: "destination", text: "escolha um destino: um setor ou uma unidade" });
  else {
    const pool = d.destination.kind === "department" ? options.departments : options.health_units;
    const found = pool.find((x) => x.id === d.destination?.id);
    if (!found) out.push({ path: "destination", text: OMBUDSMAN_ERRORS.destination_inactive });
    else if (!found.has_active_responder) out.push({ path: "destination", text: OMBUDSMAN_ERRORS.destination_without_responder });
  }
  if (outside(d.extract, 20, 4000)) out.push({ path: "extract", text: codeText("invalid_request", "extract", 422) });
  return out;
}

export type TextDraft = { text: string; resolution?: Resolution | null };

// Pedido de complemento, complemento, prorrogação, intermediária, reabertura (opcional) e mudança de resolutividade: todo texto de ação é 10–4000.
export function textActionProblems(action: OmbudsmanActionName, d: TextDraft): Problem[] {
  const out: Problem[] = [];
  // Reabrir: texto opcional, como no api; se vier, 10–4000.
  if (action === "reopen" ? len(d.text) > 0 && outside(d.text, 10, 4000) : outside(d.text, 10, 4000)) out.push({ path: "text", text: TEXT_RANGE });
  if (action === "change_resolution" && !d.resolution) out.push({ path: "resolution", text: codeText("invalid_request", "resolution", 422) });
  return out;
}

export type ArchiveDraft = { reason: ArchiveReason | ""; duplicateOfId: string | null; externalBodyName: string };

export function archiveProblems(d: ArchiveDraft): Problem[] {
  if (d.reason === "" || !OFFERED_ARCHIVE_REASONS.includes(d.reason)) return [ { path: "reason", text: codeText("invalid_request", "reason", 422) } ];
  if (d.reason === "duplicate" && !d.duplicateOfId) return [ { path: "duplicate_of_id", text: "escolha a manifestação original" } ];
  if (d.reason === "forwarded_elsewhere" && outside(d.externalBodyName, 1, 120)) return [ { path: "external_body_name", text: codeText("invalid_request", "external_body_name", 422) } ];
  return [];
}

export function finalResponseProblems(d: TextDraft, kind: OmbudsmanKind): Problem[] {
  const out: Problem[] = [];
  if (outside(d.text, 10, 4000)) out.push({ path: "text", text: TEXT_RANGE });
  if (needsResolution(kind) && !d.resolution) out.push({ path: "resolution", text: codeText("invalid_request", "resolution", 422) });
  if (!needsResolution(kind) && d.resolution) out.push({ path: "resolution", text: "elogio e sugestão não têm resolutividade" });
  return out;
}

const DAY_FIELDS: (keyof OmbudsmanSettings)[] = [
  "response_days", "extension_days", "urgent_days", "complement_days", "forwarding_days", "forwarding_extension_days", "warning_days"
];
const inRange = (n: number, min: number, max: number): boolean => Number.isInteger(n) && n >= min && n <= max;

export function settingsProblems(s: OmbudsmanSettings): Problem[] {
  const out: Problem[] = DAY_FIELDS.filter((k) => !inRange(s[k], 1, 120)).map((k) => ({ path: k, text: DAYS_TEXT }));
  if (!inRange(s.anonymous_daily_cap, 1, 1000)) out.push({ path: "anonymous_daily_cap", text: codeText("invalid_request", "anonymous_daily_cap", 422) });
  return out;
}

// Nome de setor ou assunto: 2–80. `null` quando cabe.
export function nameProblem(name: string): string | null {
  return outside(name, 2, 80) ? "o nome tem de ter de 2 a 80 caracteres" : null;
}

export function reportTextProblems(r: { recurring_problems: string; actions_taken: string; notes: string }): Problem[] {
  return (Object.keys(r) as (keyof typeof r)[])
    .filter((k) => len(r[k]) > 8000)
    .map((k) => ({ path: k, text: REPORT_TEXT }));
}
