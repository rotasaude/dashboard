// Cliente HTTP do dashboard. Read API /admin/api/* (envelope { data, as_of })
// + sessão /session. credentials: "include" (cookie HttpOnly, ADR-0022).
import type { DraftCandidate, OpenDraft } from "./consultationDrafts";
import type { SmallCount } from "./types";
import { addressLine } from "./territoryAddress";
const BASE = import.meta.env.VITE_ADMIN_API_BASE || "/admin/api";
const SESSION_BASE = import.meta.env.VITE_SESSION_BASE || "/session";

export interface ScopeBlock {
  city: { slug: string; name: string; uf: string | null };
  period: { key: string; label: string; axis: string };
  tz: string;
}

export interface Envelope<T> {
  data: T & { scope?: ScopeBlock };
  as_of: string;
}

export class ApiError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

// Código de erro do corpo (`{ error: "..." }`) de uma recusa do api; undefined
// para qualquer outra falha. Os painéis do balcão decidem por ele (recarregar,
// fechar, avisar) antes de traduzir a frase.
export function errorCode(err: unknown): string | undefined {
  return err instanceof ApiError ? (err.body as { error?: string } | undefined)?.error : undefined;
}

export interface Membership {
  city_slug: string;
  city_name: string;
  city_uf: string | null;
  role: string;
}

export interface SessionUser {
  id: string;
  email_address: string;
  operator: boolean;
  memberships: Membership[];
  mfa_enrolled: boolean;
  mfa_verified_at: string | null;
  // Fuso IANA da cidade do host (api#27); ausente em api antigo.
  time_zone?: string;
  // Módulo 16 (session-v1.1.0): interruptores LIGADOS da cidade do host.
  // Ausente em api antigo e na sessão do console; leia por sessionFeatures.
  features?: string[];
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
  return (await jsonFetchWithStatus<T>(input, init)).body;
}

// Igual ao jsonFetch, mas devolve também o status (200 x 201 muda o sentido da resposta).
async function jsonFetchWithStatus<T>(input: string, init?: RequestInit): Promise<{ body: T; status: number }> {
  const res = await fetch(input, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {})
    }
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    if (text) { try { body = JSON.parse(text); } catch { /* deixa string */ } }
    throw new ApiError(res.status, body, `${res.status} on ${input}`);
  }
  if (res.status === 204) return { body: undefined as T, status: res.status };
  return { body: await res.json() as T, status: res.status };
}

export async function adminFetch<T>(
  path: string,
  params?: Record<string, string | undefined>
): Promise<Envelope<T>> {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([ k, v ]) => {
      if (v !== undefined && v !== "") url.searchParams.set(k, v);
    });
  }
  return jsonFetch<Envelope<T>>(url.toString());
}

// Lista de bairros para o seletor dos painéis (módulo 11; decisão do usuário
// 2026-09-28): GET /admin/api/neighborhoods, só leitura, para todo papel que
// lê os painéis (não é /territory, que é só do municipal_admin). O contrato
// combinado é { neighborhoods: [...] }; o envelope { data } dos outros
// painéis também é aceito, e sem a chave a lista é vazia.
export interface PanelNeighborhood { id: string; name: string; active: boolean }

export async function listPanelNeighborhoods(): Promise<PanelNeighborhood[]> {
  const body = await jsonFetch<{ neighborhoods?: PanelNeighborhood[]; data?: { neighborhoods?: PanelNeighborhood[] } }>(
    new URL(`${BASE}/neighborhoods`, window.location.origin).toString());
  return body?.data?.neighborhoods ?? body?.neighborhoods ?? [];
}

export async function login(email_address: string, password: string): Promise<SessionUser> {
  return jsonFetch<SessionUser>(SESSION_BASE, {
    method: "POST",
    body: JSON.stringify({ email_address, password })
  });
}

export async function fetchCurrentSession(): Promise<SessionUser | null> {
  try {
    return await jsonFetch<SessionUser>(SESSION_BASE);
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) return null;
    throw err;
  }
}

export async function logout(): Promise<void> {
  await jsonFetch<void>(SESSION_BASE, { method: "DELETE" });
}

const MFA_BASE = import.meta.env.VITE_MFA_BASE || "/mfa";

export interface MfaEnrollment { otpauth_uri: string; recovery_codes: string[]; }

// `body: "{}"` de propósito: jsonFetch só põe Content-Type quando há body, e a
// API recusa (415) escrita por cookie sem application/json.
export async function enrollMfa(): Promise<MfaEnrollment> {
  return jsonFetch<MfaEnrollment>(`${MFA_BASE}/enroll`, { method: "POST", body: "{}" });
}

export async function confirmMfa(code: string): Promise<void> {
  await jsonFetch<unknown>(`${MFA_BASE}/confirm`, { method: "POST", body: JSON.stringify({ code }) });
}

export async function stepUpMfa(code: string): Promise<void> {
  await jsonFetch<unknown>(`${MFA_BASE}/step_up`, { method: "POST", body: JSON.stringify({ code }) });
}

const SETUP_BASE = import.meta.env.VITE_SETUP_BASE || "/setup";

export interface MembershipRow {
  id: string;
  user: { id: string; email_address: string };
  role: string;
  granted_at: string;
  professional_status?: "missing_profile" | "missing_link" | "ok";
}

// Só memberships ATIVAS (SetupController#list_memberships): uma linha por
// papel, então a mesma pessoa aparece mais de uma vez — quem agrupa é
// src/lib/team.ts.
export async function listMemberships(): Promise<MembershipRow[]> {
  const payload = await jsonFetch<{ data: MembershipRow[] }>(`${SETUP_BASE}/memberships`);
  return payload.data;
}

export async function grantRole(userId: string, role: string): Promise<void> {
  await jsonFetch<unknown>(`${SETUP_BASE}/memberships`, {
    method: "POST", body: JSON.stringify({ user_id: userId, role })
  });
}

export async function revokeMembership(id: string): Promise<void> {
  await jsonFetch<unknown>(`${SETUP_BASE}/memberships/${encodeURIComponent(id)}/revoke`, {
    method: "POST", body: "{}"
  });
}

export interface Invitation { id: string; email: string; role: string; expires_at: string; }

// Convite de membro pela própria cidade (municipal_admin). Papel privilegiado
// exige step-up: a API responde 401 mfa_required, e quem trata é o
// SensitiveAction.
export async function inviteMember(email: string, role: string): Promise<Invitation> {
  return jsonFetch<Invitation>(`${SETUP_BASE}/invitations`, {
    method: "POST", body: JSON.stringify({ email, role })
  });
}

// Sempre exige step-up. A pessoa perde o acesso e as sessões abertas caem; a
// listagem de memberships deixa de mostrá-la (a API filtra desativados).
export async function deactivateUser(userId: string): Promise<{ id: string; deactivated_at: string }> {
  return jsonFetch<{ id: string; deactivated_at: string }>(
    `${SETUP_BASE}/users/${encodeURIComponent(userId)}/deactivate`, { method: "POST", body: "{}" }
  );
}

const PASSWORDS_BASE = import.meta.env.VITE_PASSWORDS_BASE || "/passwords";

export async function requestPasswordReset(email_address: string): Promise<void> {
  await jsonFetch<void>(PASSWORDS_BASE, { method: "POST", body: JSON.stringify({ email_address }) });
}

export async function resetPassword(token: string, password: string, password_confirmation: string): Promise<void> {
  await jsonFetch<void>(`${PASSWORDS_BASE}/${encodeURIComponent(token)}`, {
    method: "PUT", body: JSON.stringify({ password, password_confirmation })
  });
}

const AUTHORING_BASE = import.meta.env.VITE_AUTHORING_BASE || "/authoring/protocols";

// Módulo 17 (contratos §1): o gate pode aceitar com avisos (tipo de
// atendimento inexistente na cidade). Sem avisos, continua { valid: true }.
export interface GateResult { valid: boolean; errors?: string[]; warnings?: string[]; }
export interface PreviewResult { outcome?: Record<string, unknown>; valid?: boolean; errors?: string[]; }
export interface DraftResult {
  id?: string; name?: string; version?: number; status?: string;
  error?: string; message?: string;
}

export async function gateProtocol(definition: unknown): Promise<GateResult> {
  try {
    const body = await jsonFetch<{ warnings?: unknown } | null>(`${AUTHORING_BASE}/gate`, {
      method: "POST", body: JSON.stringify({ definition })
    }).catch((err: unknown) => {
      // 200 sem corpo JSON: res.json() falha, e isso não é recusa.
      if (err instanceof SyntaxError) return null;
      throw err;
    });
    const warnings = Array.isArray(body?.warnings)
      ? body.warnings.filter((w): w is string => typeof w === "string") : [];
    return warnings.length > 0 ? { valid: true, warnings } : { valid: true };
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) {
      const body = (err.body ?? {}) as GateResult;
      return { valid: false, errors: body.errors ?? [] };
    }
    throw err;
  }
}

export async function previewProtocol(
  definition: unknown,
  answers: Record<string, string>
): Promise<PreviewResult> {
  try {
    return await jsonFetch<PreviewResult>(`${AUTHORING_BASE}/preview`, {
      method: "POST", body: JSON.stringify({ definition, answers })
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 422) return (err.body ?? {}) as PreviewResult;
    throw err;
  }
}

export async function saveProtocolDraft(definition: unknown): Promise<DraftResult> {
  try {
    return await jsonFetch<DraftResult>(`${AUTHORING_BASE}/draft`, {
      method: "POST", body: JSON.stringify({ definition })
    });
  } catch (err) {
    if (err instanceof ApiError && (err.status === 422 || err.status === 403)) {
      const body = (typeof err.body === "object" && err.body) ? (err.body as DraftResult) : {};
      return { error: "forbidden", ...body };
    }
    throw err;
  }
}

export interface AuthorProtocolRow { name: string; version: string; status: string; }

export async function listAuthorProtocols(): Promise<AuthorProtocolRow[]> {
  const env = await adminFetch<{ list: Array<{ name: string; version: string; status: string }> }>("/protocols");
  return env.data.list.map(r => ({ name: r.name, version: r.version, status: r.status }));
}

export async function loadProtocolDefinition(name: string, version: string): Promise<unknown | null> {
  const url = `${AUTHORING_BASE}/definition?name=${encodeURIComponent(name)}&version=${encodeURIComponent(version)}`;
  try {
    const body = await jsonFetch<{ definition: unknown }>(url, { method: "GET" });
    return body.definition;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

// ─── Entradas na cidade (Plano 6) ────────────────────────────────────────────

export async function redeemGrant(token: string): Promise<SessionUser> {
  return jsonFetch<SessionUser>(`${SESSION_BASE}/grant`, {
    method: "POST",
    body: JSON.stringify({ token })
  });
}

export async function acceptInvitation(token: string, password: string): Promise<void> {
  await jsonFetch<{ id: string; email_address: string }>("/setup/accept_invitation", {
    method: "POST",
    body: JSON.stringify({ token, password })
  });
}

export async function startGovBr(): Promise<string> {
  const res = await jsonFetch<{ authorize_url: string }>("/auth/govbr/start", {
    method: "POST",
    body: JSON.stringify({})
  });
  return res.authorize_url;
}

// ─── Protocolo: ciclo de vida (Plano 3) ──────────────────────────────────────

const PROTOCOLS_BASE = import.meta.env.VITE_PROTOCOLS_BASE || "/protocols";

export type SignaturePurpose = "publication" | "activation";

// Escritas do ciclo de vida na API da cidade (ProtocolLifecycleController e
// PublicationsController). Tudo menos `submit` exige step-up — quem cuida
// disso é o SensitiveAction, não estas funções.
function versionPath(version: string, action: string): string {
  return `${PROTOCOLS_BASE}/${encodeURIComponent(version)}/${action}`;
}

export async function submitProtocol(name: string, version: string): Promise<void> {
  await jsonFetch<unknown>(versionPath(version, "submit"), { method: "POST", body: JSON.stringify({ name }) });
}

export async function signProtocol(name: string, version: string, purpose: SignaturePurpose): Promise<void> {
  await jsonFetch<unknown>(versionPath(version, "signatures"), {
    method: "POST", body: JSON.stringify({ name, purpose })
  });
}

export async function publishProtocolVersion(name: string, version: string): Promise<void> {
  await jsonFetch<unknown>(versionPath(version, "publish"), { method: "POST", body: JSON.stringify({ name }) });
}

export async function activateProtocol(name: string, version: string): Promise<void> {
  await jsonFetch<unknown>(versionPath(version, "activate"), { method: "POST", body: JSON.stringify({ name }) });
}

export async function retireProtocol(name: string, version: string): Promise<void> {
  await jsonFetch<unknown>(versionPath(version, "retire"), { method: "POST", body: JSON.stringify({ name }) });
}

// Reversão de emergência: a rota não leva versão — a API acha a ativa pelo nome.
//
// Devolve a versão que PASSOU A VALER, que a resposta já trazia e esta função
// descartava. Não é a versão sobre a qual se agiu: a reversão sai da ativa e
// volta para a anterior. `protocol` é opcional de propósito — uma resposta sem
// ele faz a tela dizer a frase sem número, nunca "undefined".
// `expectedVersion` é a versão que a TELA via como vigente. O servidor recusa
// com 409 se ela não for mais a vigente — outra ativação comitou entre a
// leitura e o clique. Opcional porque o rollout tem três passos: enquanto a
// ausência for aceita, o corpo sem a chave é o de hoje.
export async function revertProtocol(
  name: string, reason: string, expectedVersion?: string
): Promise<{ version: string } | null> {
  // `string | number` porque o fio manda NÚMERO (protocol_result_rendering.rb)
  // e a previsão com que a tela compara é string. Tipar só como string aqui
  // convidaria a remover o String() abaixo, e aí a comparação de divergência
  // passaria a comparar "2" com 2 e acusaria diferença onde não há.
  const body = await jsonFetch<{ protocol?: { version?: string | number } }>(`${PROTOCOLS_BASE}/revert`, {
    method: "POST",
    body: JSON.stringify({ name, reason, ...(expectedVersion == null ? {} : { expected_version: expectedVersion }) })
  });
  const version = body?.protocol?.version;
  return version == null ? null : { version: String(version) };
}

// ─── Atendimento: verificação presencial no balcão (Task 4) ─────────────────

const ATTENDANCE_BASE = import.meta.env.VITE_ATTENDANCE_BASE || "/attendance";

export interface AttendanceCitizen {
  id: string; cpf_masked: string; phone_masked: string; created_at: string;
  verification_level: "declared" | "verified";
  // Módulo 15 (contratos §4.4): o perfil declarado do par, para o atendente
  // confirmar ou corrigir. Opcional porque uma API anterior omite a chave.
  profile?: CitizenProfile | null;
  // Módulo 19 (contratos §2): se o nome completo já foi conferido e o nome de
  // exibição; nunca os três nomes. Opcional: api anterior não manda.
  names?: CitizenNames;
  // Módulo 22/24a (contrato §13 E2, §14 L26): o que o paciente já tem (nunca o
  // valor) e se o endereço vem do cadastro domiciliar. Ausentes = api antigo.
  race_color_set?: boolean; address_set?: boolean; address_from_household?: boolean;
}
// O que o atendente conferiu no documento (spec §5.4).
export interface VerifiedProfile { birth_date: string; sex: Sex; gender_identity: GenderIdentity | null }
export interface AttendanceTriage { date: string; protocol_name: string }
export interface VerificationRow {
  id: string; verified_at: string; verified_by: string; phone_masked: string; active: boolean;
  revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null;
}

export async function lookupCitizen(cpf: string, code: string): Promise<{ citizen: AttendanceCitizen; triages: AttendanceTriage[] }> {
  return jsonFetch(`${ATTENDANCE_BASE}/lookup`, { method: "POST", body: JSON.stringify({ cpf, code }) });
}

// Módulo 16 (contratos §5.4): `cadsus_confirmed` só vai quando a cidade tem a
// consulta ao CADSUS ligada (o atendente decidiu, sim ou não). Sem `extra`, o
// corpo é exatamente o de antes.
// Módulo 22 (contrato §12, D-U1): os 7 campos do paciente, opcionais e planos no corpo da validação.
export interface VerifyExtra extends PatientDemographicsInput { cadsus_confirmed?: boolean }

export async function verifyCitizen(
  cpf: string, code: string, profile: VerifiedProfile & Partial<CitizenNamesInput>, extra: VerifyExtra = {}
): Promise<void> {
  await jsonFetch<unknown>(`${ATTENDANCE_BASE}/verifications`, {
    method: "POST", body: JSON.stringify({ cpf, code, document_checked: true, ...profile, ...extra })
  });
}

// Consulta ao CADSUS do par do código (contratos §5.4: o CPF vai junto,
// porque o código só identifica o par com ele). Nunca traz nome,
// mãe ou endereço: só o CNS mascarado e se nascimento e sexo conferem.
export interface CadsusLookupResult {
  found: boolean;
  cns_masked: string | null;
  birth_date_matches: boolean | null;
  sex_matches: boolean | null;
}

export async function cadsusLookup(cpf: string, code: string): Promise<CadsusLookupResult> {
  return jsonFetch<CadsusLookupResult>(`${ATTENDANCE_BASE}/cadsus_lookup`, {
    method: "POST", body: JSON.stringify({ cpf, code })
  });
}

export async function listVerifications(cpf: string): Promise<VerificationRow[]> {
  const payload = await jsonFetch<{ verifications: VerificationRow[] }>(
    `${ATTENDANCE_BASE}/verifications/search`, { method: "POST", body: JSON.stringify({ cpf }) });
  return payload.verifications;
}

export async function revokeVerification(id: string, reason: string): Promise<void> {
  await jsonFetch<unknown>(`${ATTENDANCE_BASE}/verifications/${encodeURIComponent(id)}/revoke`, {
    method: "POST", body: JSON.stringify({ reason })
  });
}

// ─── Atendimento: exclusão do cadastro (ADR 0026) ────────────────────────────

export interface ErasureRequestResult { id: string; status: "pending" | "confirmed" | "rejected" | "retained"; created_at: string }
export interface PendingErasure { id: string; created_at: string; requested_by: string; pairs: number; phone_masked: string }

export function requestErasure(cpf: string, documentChecked: boolean): Promise<{ request: ErasureRequestResult }> {
  return jsonFetch(`${ATTENDANCE_BASE}/erasure_requests`, {
    method: "POST", body: JSON.stringify({ cpf, document_checked: documentChecked })
  });
}

export function listPendingErasures(): Promise<{ requests: PendingErasure[] }> {
  return jsonFetch(`${ATTENDANCE_BASE}/erasure_requests`);
}

export function confirmErasure(id: string): Promise<{ request: ErasureRequestResult }> {
  return jsonFetch(`${ATTENDANCE_BASE}/erasure_requests/${encodeURIComponent(id)}/confirm`, { method: "POST", body: "{}" });
}

export function rejectErasure(id: string, reason: string): Promise<{ request: ErasureRequestResult }> {
  return jsonFetch(`${ATTENDANCE_BASE}/erasure_requests/${encodeURIComponent(id)}/reject`, {
    method: "POST", body: JSON.stringify({ reason })
  });
}

// ─── Atendimento: unidades de saúde (Task 6) ─────────────────────────────────

// Endereço da unidade (módulo 11, ADR 0023; spec 2026-09-28 §4.1). Opcional em
// tudo: uma API anterior ao módulo 11 omite as chaves. Na escrita vai sempre o
// conjunto inteiro, e null apaga o campo.
export interface UnitAddress {
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_zip: string | null;
  neighborhood_id: string | null;
}

// `screening_scope` (módulo 18; contrato §5): ausente em api anterior = `walk_in`.
export interface HealthUnit extends Partial<UnitAddress> {
  id: string; name: string; kind: string; cnes?: string | null; screening_scope?: ScreeningScope;
  // Módulo 21b: a unidade coleta amostras para o laboratório municipal.
  collects_samples?: boolean;
  // Módulo 25 (D15): unidade notificadora (notificação negativa semanal).
  notifying?: boolean;
  // Módulo 31 (contrato §3, P9/P26/P27): modalidade só no CAPS; classificação 115 com 3 dígitos ou nula; telefone de
  // 10 ou 11 dígitos (com DDD) ou nulo, em qualquer tipo de unidade. Ausentes em api anterior.
  caps_modality?: CapsModality | string | null;
  service_classification?: string | null;
  phone?: string | null;
  // Módulo 32a (contrato §1, Q8): prefixo da senha (1 a 3 letras maiúsculas) e tempos de espera na TV (UPA). Ausentes em api anterior.
  ticket_prefix?: string | null;
  show_wait_times?: boolean;
}
// Campos do módulo 31 na escrita da unidade: cada chave só vai no corpo quando recebida (null apaga).
// Módulo 32a: `ticket_prefix` só como texto válido (null → 422 invalid_ticket_prefix) e `show_wait_times` (Q8, E6).
export interface UnitCapsInput {
  caps_modality?: string | null; service_classification?: string | null; phone?: string | null;
  ticket_prefix?: string; show_wait_times?: boolean;
}
const unitCapsBody = (caps?: UnitCapsInput): Record<string, string | boolean | null> =>
  Object.fromEntries(Object.entries(caps ?? {}).filter(([ , v ]) => v !== undefined)) as Record<string, string | boolean | null>;
export interface HealthUnitRow extends HealthUnit {
  active: boolean;
  // O que ainda prende a unidade (api#29): pedidos vivos e horários marcados.
  live_requests_count?: number;
  live_appointments_count?: number;
}

export interface UnitDrainResult { id: string; requests_count: number; appointments_count: number }

// Esvaziar unidade (api#29; F-09.3): move pedidos e horários para outra unidade.
export async function drainUnit(id: string, targetUnitId: string, reason: string): Promise<UnitDrainResult> {
  const payload = await jsonFetch<{ drain: UnitDrainResult }>(`${ATTENDANCE_BASE}/units/${encodeURIComponent(id)}/drain`, {
    method: "POST", body: JSON.stringify({ target_unit_id: targetUnitId, reason })
  });
  return payload.drain;
}

export async function listActiveUnits(): Promise<HealthUnit[]> {
  const payload = await jsonFetch<{ units: HealthUnit[] }>(`${ATTENDANCE_BASE}/units`);
  return payload.units;
}

export async function listAllUnits(): Promise<HealthUnitRow[]> {
  const payload = await jsonFetch<{ units: HealthUnitRow[] }>(`${ATTENDANCE_BASE}/units/all`);
  return payload.units;
}

// T47: `cnes` (7 dígitos, ou null para apagar) só vai quando recebido — o api só mexe no CNES quando a chave vem.
export async function createUnit(
  name: string, kind: string, address: UnitAddress, cnes?: string | null, caps?: UnitCapsInput
): Promise<HealthUnitRow> {
  const payload = await jsonFetch<{ unit: HealthUnitRow }>(`${ATTENDANCE_BASE}/units`, {
    method: "POST", body: JSON.stringify({ name, kind, ...address, ...(cnes !== undefined ? { cnes } : {}), ...unitCapsBody(caps) })
  });
  return payload.unit;
}

export async function updateUnit(
  id: string, name: string, kind: string, address: UnitAddress, screeningScope?: ScreeningScope, collectsSamples?: boolean,
  notifying?: boolean, cnes?: string | null, caps?: UnitCapsInput
): Promise<HealthUnitRow> {
  const body: Record<string, unknown> = { name, kind, ...address };
  if (screeningScope) body.screening_scope = screeningScope;
  if (collectsSamples !== undefined) body.collects_samples = collectsSamples;
  if (notifying !== undefined) body.notifying = notifying;
  if (cnes !== undefined) body.cnes = cnes;
  Object.assign(body, unitCapsBody(caps));
  const payload = await jsonFetch<{ unit: HealthUnitRow }>(`${ATTENDANCE_BASE}/units/${encodeURIComponent(id)}`, {
    method: "POST", body: JSON.stringify(body)
  });
  return payload.unit;
}

export async function setUnitActive(id: string, active: boolean): Promise<HealthUnitRow> {
  const action = active ? "activate" : "deactivate";
  const payload = await jsonFetch<{ unit: HealthUnitRow }>(`${ATTENDANCE_BASE}/units/${encodeURIComponent(id)}/${action}`, {
    method: "POST", body: "{}"
  });
  return payload.unit;
}

// ─── Atendimento: check-in, exceção e desfecho (Task 7) ─────────────────────

export interface CheckInCitizen {
  id: string; cpf_masked: string; phone_masked: string;
  verification_level: "declared" | "verified";
  // Módulo 19, Divergência D2: nomes e a validação ativa do par validado, para
  // a recepção completar os nomes no check-in. Opcionais: api sem a D2 não manda.
  names?: CitizenNames; verification_id?: string | null;
  // Módulo 22 (contrato §13 E3): o que já está no cadastro (nunca o valor). Ausentes = api antigo.
  race_color_set?: boolean; address_set?: boolean;
  // Módulo 24a (contrato §14 L6): endereço do cadastro domiciliar (só leitura). Ausente = api antigo.
  address_from_household?: boolean;
}
export interface CheckInTriage { id: string; date: string; protocol_name: string; priority: number }
export interface CheckInAppointment {
  // Pedido de linha de cuidado (módulo 23) não tem triagem raiz: kind "care_line", sem protocolo nem prioridade.
  // Os kinds seguem AppointmentRequest::KINDS do api; o rótulo vem de requestKindLabel, o mesmo da fila.
  // "regulated" é o pedido de agendamento da rede própria aberto pela regulação (módulo 26a).
  id: string; scheduled_at: string; kind: "return" | "referral" | "triage" | "screening" | "care_line" | "regulated"; unit_name: string;
  protocol_name: string | null; priority: number | null;
}

export interface Attendance {
  id: string; triage_id: string | null; health_unit_id: string; unit_name: string; status: string;
  checked_in_at: string; check_in_method: string; outcome: string | null;
  referral_unit_name: string | null; referral_note: string | null; closed_at: string | null;
  // Módulo 32a (contrato §6, Q7): senha do dia; null sem senha. Ausente em api anterior.
  ticket?: string | null;
}

export interface QueueRow {
  id: string; cpf_masked: string; checked_in_at: string; protocol_name: string | null; priority: number | null;
  // Módulo 32a: "walk_in" é a chegada pela recepção da urgência (UPA).
  source: "triage" | "appointment" | "walk_in"; appointment_time: string | null;
  // Módulo 32a (contrato §6, Q7): senha do dia; null sem senha. Ausente em api anterior.
  ticket?: string | null;
  called_at: string | null; called_by_name: string | null;
  // Módulo 11 (spec 2026-09-28 §4.1): unidades ativas que cobrem o bairro da
  // triagem deste atendimento (sem triagem, o bairro atual do cidadão).
  // Opcional: a API anterior ao módulo 11 não manda.
  reference_unit_ids?: string[];
  // Módulo 19, Divergência D3: nome de exibição (social, senão completo) do
  // paciente; a recepção vê só ele e a cor. Ausente em api sem a D3.
  display_name?: string | null;
  // Módulo 18 (contrato §9): cor, destino e espera da escuta; null sem escuta.
  screening?: QueueScreening | null;
  // Módulo 18 (contrato §9): true enquanto a escuta ainda não terminou.
  awaiting_screening?: boolean;
}

export interface AppointmentRequestSummary { id: string; kind: string; target_unit_name: string; status: string }

export type AttendanceOutcome = "discharged" | "referred" | "return" | "left" | "scheduled_from_screening" | "oriented";
// Desfechos que o encerramento aceita (o api recusa os dois do acolhimento) e os que a analítica conta.
export type CloseOutcome = Exclude<AttendanceOutcome, "scheduled_from_screening" | "oriented">;
export type AnalyticsOutcome = CloseOutcome;

export async function lookupCheckIn(
  cpf: string, code: string, healthUnitId: string
): Promise<{ citizen: CheckInCitizen; triage: CheckInTriage | null; appointment: CheckInAppointment | null }> {
  return jsonFetch(`${ATTENDANCE_BASE}/check_ins/lookup`, {
    method: "POST", body: JSON.stringify({ cpf, code, health_unit_id: healthUnitId })
  });
}

export async function checkIn(
  cpf: string, code: string, healthUnitId: string, documentChecked: boolean
): Promise<{ attendance: Attendance; verified: boolean; verification_id?: string | null }> {
  return jsonFetch(`${ATTENDANCE_BASE}/check_ins`, {
    method: "POST",
    body: JSON.stringify({ cpf, code, health_unit_id: healthUnitId, document_checked: documentChecked })
  });
}

export async function searchCheckIn(
  cpf: string, healthUnitId: string
): Promise<{ triages: CheckInTriage[]; appointments: CheckInAppointment[] }> {
  return jsonFetch(`${ATTENDANCE_BASE}/check_ins/search`, {
    method: "POST", body: JSON.stringify({ cpf, health_unit_id: healthUnitId })
  });
}

// §14 L26: as flags do paciente no mesmo formato do lookup (ausente = api antigo).
export interface CheckInExceptionCitizen { id: string; race_color_set?: boolean; address_set?: boolean; address_from_household?: boolean }

export async function checkInByException(
  cpf: string, target: { triageId: string } | { appointmentId: string }, healthUnitId: string, reason: string
): Promise<{ attendance: Attendance; verification_id?: string | null; citizen?: CheckInExceptionCitizen }> {
  const body: Record<string, unknown> = { cpf, health_unit_id: healthUnitId, reason };
  if ("triageId" in target) body.triage_id = target.triageId;
  else body.appointment_id = target.appointmentId;
  return jsonFetch(`${ATTENDANCE_BASE}/check_ins/exception`, { method: "POST", body: JSON.stringify(body) });
}

export async function listUnitQueue(unitId: string): Promise<{ waiting: QueueRow[]; in_care: QueueRow[] }> {
  return jsonFetch(`${ATTENDANCE_BASE}/units/${encodeURIComponent(unitId)}/queue`);
}

// Módulo 18 (contrato §9): a chamada devolve a escuta aninhada no atendimento, para o profissional.
export interface CallResult { attendance: Attendance & { screening?: Screening | null } }

// Módulo 32a (contrato §6, Q7): o local da chamada só vai no corpo quando recebido (sem local → a chamada sai sem ele).
const callLocationBody = (callLocationId?: string | null): { call_location_id?: string } =>
  (callLocationId === undefined || callLocationId === null ? {} : { call_location_id: callLocationId });

export async function callAttendance(id: string, healthUnitId: string, callLocationId?: string | null): Promise<CallResult> {
  return jsonFetch(`${ATTENDANCE_BASE}/attendances/${encodeURIComponent(id)}/call`, {
    method: "POST", body: JSON.stringify({ health_unit_id: healthUnitId, ...callLocationBody(callLocationId) })
  });
}

export async function callNext(unitId: string, callLocationId?: string | null): Promise<CallResult> {
  return jsonFetch(`${ATTENDANCE_BASE}/units/${encodeURIComponent(unitId)}/call_next`, {
    method: "POST", body: JSON.stringify(callLocationBody(callLocationId))
  });
}

export async function closeAttendance(
  id: string, outcome: CloseOutcome, referralUnitId?: string, referralNote?: string
): Promise<{ attendance: Attendance; appointmentRequest: AppointmentRequestSummary | null }> {
  const body: Record<string, unknown> = { outcome };
  if (referralUnitId) body.referral_unit_id = referralUnitId;
  if (referralNote) body.referral_note = referralNote;
  const payload = await jsonFetch<{ attendance: Attendance; appointment_request: AppointmentRequestSummary | null }>(
    `${ATTENDANCE_BASE}/attendances/${encodeURIComponent(id)}/close`, { method: "POST", body: JSON.stringify(body) }
  );
  return { attendance: payload.attendance, appointmentRequest: payload.appointment_request };
}

// ─── Atendimento: pedidos de agendamento, agenda e check-in por horário (Task 8) ─

// Pedido de agendamento (contratos §4.1, §9, §10; api Scheduling::RequestJson).
// `priority` é a prioridade do pedido (rotina/prioritária); a da triagem é
// `triage_priority`.
export interface RequestRow {
  id: string; kind: "return" | "referral" | "triage" | "screening" | "care_line" | "regulated";
  origin: "attendance" | "triage" | "care_line" | "regulation";
  origin_unit_name: string | null; created_at: string; cpf_masked: string; note: string | null;
  reopened_reason: "expired" | "no_show" | null;
  appointment_type_key: string; appointment_type_name: string; priority: SchedulingPriority; due_on: string;
  // O número de prioridade da triagem que a fila já mandava como `priority` (§9).
  triage_priority: number | null;
  overdue: boolean; reschedule_requested: boolean; reschedule_reason_code: RescheduleReasonCode | null;
  preferred_period: PreferredPeriod | null; reschedule_count: number; needs_reschedule: boolean;
  // Unidade de destino (nula na fila "sem unidade") e o horário vivo (não nulo
  // em pedido `scheduled` com needs_reschedule).
  target_unit_id: string | null;
  appointment: AppointmentView | null;
}

export async function listUnitRequests(unitId: string): Promise<RequestRow[]> {
  const payload = await jsonFetch<{ requests: RequestRow[] }>(`${ATTENDANCE_BASE}/units/${encodeURIComponent(unitId)}/requests`);
  return payload.requests;
}

// Só o detalhe traz a nota livre do cidadão (spec §8; contratos §9: o item + reschedule_note).
export interface RequestDetail extends RequestRow { reschedule_note: string | null }

export function getRequest(id: string): Promise<RequestDetail> {
  return jsonFetch(`${ATTENDANCE_BASE}/requests/${encodeURIComponent(id)}`);
}

export interface ScheduledAppointment { id: string; scheduled_at: string; status: string; confirmation_deadline_at: string | null }

export async function dismissRequest(
  id: string, reason: string, healthUnitId: string
): Promise<{ id: string; status: string }> {
  const payload = await jsonFetch<{ request: { id: string; status: string } }>(
    `${ATTENDANCE_BASE}/requests/${encodeURIComponent(id)}/dismiss`,
    { method: "POST", body: JSON.stringify({ reason, health_unit_id: healthUnitId }) }
  );
  return payload.request;
}

// ─── Profissionais (módulo 10) ───────────────────────────────────────────────

// Profissionais (módulo 10, ADR 0021; spec 2026-09-27 §4.1). Tudo sob
// /professionals — uma entrada só no proxy de dev.
const PROFESSIONALS_BASE = import.meta.env.VITE_PROFESSIONALS_BASE || "/professionals";

export interface Professional {
  id: string;
  user_id: string;
  email_address: string;
  professional_name: string;
  // Nulos juntos: os CBOs de campo da Tabela 7 não têm conselho (módulo 24a).
  council: string | null;
  council_state: string | null;
  registration_number: string | null;
  cns_masked: string;
  cns?: string;
  phone?: string | null;
  contact_email?: string | null;
}

export interface ProfessionalLink {
  id: string;
  health_unit_id: string;
  unit_name: string;
  cbo_code: string;
  cbo_title: string | null;
  started_at: string;
  started_by: string;
  ended_at: string | null;
  ended_by: string | null;
  // Módulo 17: tipo padrão do vínculo para turno sem modelo (nulo = o da base pelo CBO).
  default_appointment_type_key?: string | null;
}

export interface ProfessionalShift {
  id: string;
  professional_link_id: string;
  unit_name: string;
  starts_at: string;
  ends_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
  // Módulo 17: modelo de agenda do turno (nulo = turno inteiro como vagas do tipo padrão).
  schedule_template_id?: string | null;
}

export interface CboEntry { code: string; title: string; council: string | null }
export interface PendingProfessional { user_id: string; email_address: string; status: "missing_profile" | "missing_link" }
export interface MyProfessional { professional: Professional; links: ProfessionalLink[]; shifts: ProfessionalShift[] }

export type ProfessionalFields = Partial<Pick<Professional,
  "professional_name" | "council" | "council_state" | "registration_number" | "cns" | "phone" | "contact_email">>;

const postProfessional = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });
const professionalId = encodeURIComponent;

export async function listProfessionals(): Promise<(Professional & { links: ProfessionalLink[] })[]> {
  return (await jsonFetch<{ professionals: (Professional & { links: ProfessionalLink[] })[] }>(PROFESSIONALS_BASE)).professionals;
}

export async function listPendingProfessionals(): Promise<PendingProfessional[]> {
  return (await jsonFetch<{ users: PendingProfessional[] }>(`${PROFESSIONALS_BASE}/pending`)).users;
}

export async function getProfessional(professional: string): Promise<{ professional: Professional; links: ProfessionalLink[] }> {
  return jsonFetch(`${PROFESSIONALS_BASE}/${professionalId(professional)}`);
}

export async function createProfessional(userId: string, fields: ProfessionalFields): Promise<Professional> {
  return (await jsonFetch<{ professional: Professional }>(PROFESSIONALS_BASE, postProfessional({ user_id: userId, ...fields }))).professional;
}

export async function updateProfessional(professional: string, fields: ProfessionalFields): Promise<Professional> {
  return (await jsonFetch<{ professional: Professional }>(`${PROFESSIONALS_BASE}/${professionalId(professional)}`, postProfessional(fields))).professional;
}

// 404 no_profile vira null: "seu cadastro ainda não foi feito" é estado, não erro.
export async function getMyProfessional(): Promise<MyProfessional | null> {
  try {
    return await jsonFetch<MyProfessional>(`${PROFESSIONALS_BASE}/me`);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

export async function updateMyProfessional(fields: Pick<ProfessionalFields, "professional_name" | "phone" | "contact_email">): Promise<Professional> {
  return (await jsonFetch<{ professional: Professional }>(`${PROFESSIONALS_BASE}/me`, postProfessional(fields))).professional;
}

export async function listCbo(): Promise<CboEntry[]> {
  return (await jsonFetch<{ cbo: CboEntry[] }>(`${PROFESSIONALS_BASE}/cbo`)).cbo;
}

export async function openProfessionalLink(professional: string, healthUnitId: string, cboCode: string): Promise<ProfessionalLink> {
  return (await jsonFetch<{ link: ProfessionalLink }>(`${PROFESSIONALS_BASE}/${professionalId(professional)}/links`,
    postProfessional({ health_unit_id: healthUnitId, cbo_code: cboCode }))).link;
}

export async function endProfessionalLink(linkId: string): Promise<{ link: ProfessionalLink; cancelled_shift_ids: string[] }> {
  return jsonFetch(`${PROFESSIONALS_BASE}/links/${professionalId(linkId)}/end`, postProfessional({}));
}

export async function listProfessionalShifts(professional: string, from: string, to: string): Promise<ProfessionalShift[]> {
  const qs = new URLSearchParams({ from, to }).toString();
  return (await jsonFetch<{ shifts: ProfessionalShift[] }>(`${PROFESSIONALS_BASE}/${professionalId(professional)}/shifts?${qs}`)).shifts;
}

export async function scheduleShift(
  linkId: string, startsAt: string, endsAt: string, templateId?: string | null
): Promise<ProfessionalShift> {
  const body: Record<string, unknown> = { starts_at: startsAt, ends_at: endsAt };
  if (templateId) body.schedule_template_id = templateId;
  return (await jsonFetch<{ shift: ProfessionalShift }>(`${PROFESSIONALS_BASE}/links/${professionalId(linkId)}/shifts`,
    postProfessional(body))).shift;
}

export async function cancelShift(shiftId: string, reason: string): Promise<ProfessionalShift> {
  return (await jsonFetch<{ shift: ProfessionalShift }>(`${PROFESSIONALS_BASE}/shifts/${professionalId(shiftId)}/cancel`, postProfessional({ reason }))).shift;
}

// ─── Território (módulo 11, ADR 0023; spec 2026-09-28 §4.1) ─────────────────
// Tudo sob /territory, só municipal_admin — uma entrada no proxy de dev. As
// escritas devolvem o bairro, mas a tela relê a lista: nada aqui depende do
// corpo da resposta.
const TERRITORY_BASE = import.meta.env.VITE_TERRITORY_BASE || "/territory";

export interface NeighborhoodUnit { id: string; name: string; active: boolean }
export interface Neighborhood {
  id: string;
  name: string;
  active: boolean;
  source: "seed" | "manual";
  units: NeighborhoodUnit[];
}

function neighborhoodPath(id: string, action?: string): string {
  return `${TERRITORY_BASE}/neighborhoods/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
}

export async function listNeighborhoods(): Promise<Neighborhood[]> {
  return (await jsonFetch<{ neighborhoods: Neighborhood[] }>(`${TERRITORY_BASE}/neighborhoods`)).neighborhoods;
}

export async function createNeighborhood(name: string): Promise<void> {
  await jsonFetch<unknown>(`${TERRITORY_BASE}/neighborhoods`, { method: "POST", body: JSON.stringify({ name }) });
}

export async function renameNeighborhood(id: string, name: string): Promise<void> {
  await jsonFetch<unknown>(neighborhoodPath(id), { method: "POST", body: JSON.stringify({ name }) });
}

export async function setNeighborhoodActive(id: string, active: boolean): Promise<void> {
  await jsonFetch<unknown>(neighborhoodPath(id, active ? "activate" : "deactivate"), { method: "POST", body: "{}" });
}

export async function replaceCoverage(id: string, healthUnitIds: string[]): Promise<void> {
  await jsonFetch<unknown>(neighborhoodPath(id, "coverage"), {
    method: "POST", body: JSON.stringify({ health_unit_ids: healthUnitIds })
  });
}

// ─── Campanhas (módulo 12, ADR 0024; spec 2026-09-29 §6.1) ──────────────────
// Tudo sob /campaigns (sessão municipal, banco da cidade) — uma entrada no
// proxy de dev. Nenhuma resposta traz lista de destinatários: só contagens.
// Escrita sem corpo leva "{}" de propósito: a API recusa com 415
// (json_required) escrita por cookie sem application/json.
const CAMPAIGNS_BASE = import.meta.env.VITE_CAMPAIGNS_BASE || "/campaigns";

export type CampaignStatus = "draft" | "scheduled" | "sending" | "sent" | "cancelled" | "failed";
export type SmsStatus = "not_opted_in" | "duplicate_phone" | "pending" | "deferred" | "sent" | "failed" | "unavailable";
export type RequestKind = "return" | "referral";

export type AudienceGeo =
  | { scope: "city" }
  | { scope: "unit"; health_unit_id: string }
  | { scope: "neighborhoods"; neighborhood_ids: string[] };

export interface CriterionPeriod { from: string; to: string }

export type Criterion =
  | ({ kind: "protocol_period"; protocol_name: string } & CriterionPeriod)
  | ({ kind: "triage_tier"; tiers: string[] } & CriterionPeriod)
  | ({ kind: "triage_incomplete" } & CriterionPeriod)
  | ({ kind: "attendance_outcome"; outcomes: AttendanceOutcome[]; health_unit_id?: string } & CriterionPeriod)
  | ({ kind: "triaged_not_attended" } & CriterionPeriod)
  | ({ kind: "appointment_no_show" } & CriterionPeriod)
  | { kind: "appointment_request_open"; kinds?: RequestKind[]; target_unit_id?: string }
  // Módulo 29 (contrato §10; D12): vacina em atraso e caderneta não conferida.
  | { kind: "vaccine_overdue"; immunobiological_codes: string[]; age_min_months?: number; age_max_months?: number }
  | { kind: "vaccination_record_unchecked"; age_min_months?: number; age_max_months?: number };

export type CriterionKind = Criterion["kind"];

export interface Audience { version: 1; geo: AudienceGeo; clinical: { all: Criterion[] } }

export interface CampaignSummary {
  id: string;
  title: string;
  status: CampaignStatus;
  send_at: string | null;
  dispatched_at: string | null;
  recipients_count: number | null;
}

// null antes do envio; depois, as 7 chaves de SmsStatus sempre presentes.
export interface CampaignStats { read_count: number; sms: Record<SmsStatus, number> }

export interface Campaign extends CampaignSummary {
  body: string;
  audience: Audience;
  failure_reason: "below_minimum" | null;
  sms_enabled: boolean | null;
  phones_count: number | null;
  created_at: string;
  stats: CampaignStats | null;
  // Módulo 29 (D12; V13): número só com campanha enviada e critério vaccine_overdue.
  vaccinated_count?: number | null;
}

export interface NamedRef { id: string; name: string }
export interface CampaignOptions {
  protocols: string[];
  tiers: string[];
  outcomes: string[];
  neighborhoods: NamedRef[];
  units: NamedRef[];
  // Módulo 29 (D12; V13): só com `vaccination` ligado.
  immunobiologicals?: CodeName[];
}
export type AudiencePreview = { citizens: number; phones: number } | { below_minimum: true };
export interface SmsSetting { enabled: boolean; gateway_configured: boolean }
export interface CampaignFields { title: string; body: string; audience: Audience }

const campaignPost = (body: unknown = {}): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

function campaignPath(id: string, action?: string): string {
  return `${CAMPAIGNS_BASE}/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;
}

export async function listCampaigns(): Promise<CampaignSummary[]> {
  return (await jsonFetch<{ campaigns: CampaignSummary[] }>(CAMPAIGNS_BASE)).campaigns;
}

export async function getCampaignOptions(): Promise<CampaignOptions> {
  return jsonFetch<CampaignOptions>(`${CAMPAIGNS_BASE}/options`);
}

export async function previewAudience(audience: Audience): Promise<AudiencePreview> {
  return jsonFetch<AudiencePreview>(`${CAMPAIGNS_BASE}/preview`, campaignPost({ audience }));
}

export async function createCampaign(fields: CampaignFields): Promise<Campaign> {
  return (await jsonFetch<{ campaign: Campaign }>(CAMPAIGNS_BASE, campaignPost(fields))).campaign;
}

export async function getCampaign(id: string): Promise<Campaign> {
  return (await jsonFetch<{ campaign: Campaign }>(campaignPath(id))).campaign;
}

export async function updateCampaign(id: string, fields: Partial<CampaignFields>): Promise<Campaign> {
  return (await jsonFetch<{ campaign: Campaign }>(campaignPath(id), {
    method: "PATCH", body: JSON.stringify(fields)
  })).campaign;
}

export async function sendCampaign(id: string): Promise<Campaign> {
  return (await jsonFetch<{ campaign: Campaign }>(campaignPath(id, "send"), campaignPost())).campaign;
}

export async function scheduleCampaign(id: string, sendAt: string): Promise<Campaign> {
  return (await jsonFetch<{ campaign: Campaign }>(campaignPath(id, "schedule"), campaignPost({ send_at: sendAt }))).campaign;
}

export async function unscheduleCampaign(id: string): Promise<Campaign> {
  return (await jsonFetch<{ campaign: Campaign }>(campaignPath(id, "unschedule"), campaignPost())).campaign;
}

export async function cancelCampaign(id: string): Promise<Campaign> {
  return (await jsonFetch<{ campaign: Campaign }>(campaignPath(id, "cancel"), campaignPost())).campaign;
}

export async function getSmsSetting(): Promise<SmsSetting> {
  return jsonFetch<SmsSetting>(`${CAMPAIGNS_BASE}/sms_setting`);
}

export async function setSmsSetting(enabled: boolean): Promise<SmsSetting> {
  return jsonFetch<SmsSetting>(`${CAMPAIGNS_BASE}/sms_setting`, { method: "PUT", body: JSON.stringify({ enabled }) });
}

// ─── Analytics (módulo 14; ADR 0025; contratos mod14 §0–§1) ─────────────────
// Só leitura, sessão municipal, papéis analyst e municipal_admin. O envelope
// tem `stale` além de { data, as_of }, e `as_of` é null quando a cidade nunca
// consolidou. A supressão é da API: o cliente nunca soma nem deriva números.
export type Cell = number | { suppressed: true };
export type Rate = number | { suppressed: true } | null;
export type AnalyticsFront = "demand" | "quality" | "calibration" | "epidemiology";
export type Granularity = "week" | "month";

export interface AnalyticsFilterEcho {
  neighborhood_id: string | null;
  health_unit_id: string | null;
  protocol_name: string | null;
  protocol_version: number | null;
}

export interface AnalyticsBase {
  front: AnalyticsFront;
  granularity?: Granularity;
  from: string;
  to: string;
  filter: AnalyticsFilterEcho;
  periods: string[];
}

export interface SeriesRow { series: Cell[]; total: Cell }

// Todas as unidades da cidade, ativas e inativas, independentes do recorte:
// a fonte do seletor de unidade em demand e quality (contratos §1).
export interface AnalyticsUnit { health_unit_id: string; name: string; active: boolean }

export interface DemandData extends AnalyticsBase {
  units: AnalyticsUnit[];
  triages: { started: Cell[]; completed: Cell[]; aborted: Cell[] };
  triages_total: { started: Cell; completed: Cell; aborted: Cell };
  by_tier: Array<SeriesRow & { tier: string }>;
  by_protocol: Array<SeriesRow & { protocol_name: string }>;
  by_neighborhood: Array<{ neighborhood_id: string | null; name: string; total: Cell }>;
  attendances_by_unit: Array<SeriesRow & { health_unit_id: string; name: string }>;
  requests_opened: Array<SeriesRow & { kind: "return" | "referral" }>;
  requests_closed: Array<SeriesRow & { reason: string }>;
}

export type WaitBucket = "0-15" | "15-30" | "30-60" | "60-120" | "120+";
export type AppointmentEndStatus = "checked_in" | "no_show" | "expired" | "cancelled_by_citizen";

export interface QualityData extends AnalyticsBase {
  units: AnalyticsUnit[];
  wait: { buckets: Array<SeriesRow & { bucket: WaitBucket }>; within_30_pct: Rate[]; within_30_pct_total: Rate };
  appointments: Array<SeriesRow & { status: AppointmentEndStatus }>;
  no_show_pct: Rate[];
  no_show_pct_total: Rate;
  attendance_outcomes: Array<SeriesRow & { outcome: AnalyticsOutcome }>;
  left_pct: Rate[];
  left_pct_total: Rate;
  by_unit: Array<{
    health_unit_id: string; name: string; attendances: Cell;
    wait_within_30_pct: Rate; no_show_pct: Rate; left_pct: Rate;
  }>;
}

export type CalibrationOutcome = AnalyticsOutcome | "none";
export interface CalibrationRow {
  tier: string;
  total: Cell;
  outcomes: Record<CalibrationOutcome, Cell>;
  shares: Record<CalibrationOutcome, Rate>;
}
export interface CalibrationVersion { protocol_name: string; protocol_version: number; rows: CalibrationRow[] }
export interface CalibrationData extends AnalyticsBase { versions: CalibrationVersion[] }

export interface EpiOption extends SeriesRow { value: string; label: string }
export interface EpiQuestion {
  protocol_name: string;
  question_id: string;
  prompt: string;
  answer_type: "boolean" | "enum";
  options: EpiOption[];
}
export interface EpidemiologyData extends AnalyticsBase { questions: EpiQuestion[] }

export interface AnalyticsDataMap {
  demand: DemandData;
  quality: QualityData;
  calibration: CalibrationData;
  epidemiology: EpidemiologyData;
}

export interface AnalyticsEnvelope<F extends AnalyticsFront> {
  data: AnalyticsDataMap[F];
  as_of: string | null;
  stale: boolean;
}

// Quem chama manda só os recortes da frente (contratos §1); null = sem recorte.
export interface AnalyticsQuery {
  from: string;
  to: string;
  granularity?: Granularity;
  neighborhood_id?: string | null;
  health_unit_id?: string | null;
  protocol_name?: string | null;
  protocol_version?: number | null;
}

export async function fetchAnalytics<F extends AnalyticsFront>(
  front: F, query: AnalyticsQuery
): Promise<AnalyticsEnvelope<F>> {
  const params: Record<string, string | undefined> = {
    from: query.from,
    to: query.to,
    granularity: front === "calibration" ? undefined : query.granularity,
    neighborhood_id: query.neighborhood_id ?? undefined,
    health_unit_id: query.health_unit_id ?? undefined,
    protocol_name: query.protocol_name ?? undefined,
    // Versão sozinha é 422 invalid_protocol: só vai junto com o nome.
    protocol_version: query.protocol_name && query.protocol_version != null ? String(query.protocol_version) : undefined
  };
  // adminFetch tipa o envelope clássico ({ data, as_of: string }); este tem
  // as_of anulável e `stale`, daí o cast.
  const envelope = await adminFetch<AnalyticsDataMap[F]>(`/analytics/${front}`, params);
  return envelope as unknown as AnalyticsEnvelope<F>;
}

// ─── Catálogo de triagens (módulo 15, ADR 0027; contratos §2 e §4) ───────────
// /triage_catalog tem prefixo próprio porque /protocols/:name já captura
// qualquer segmento. Os contadores vêm `null` quando ficam entre 1 e 4
// (supressão do ADR 0025): quem desenha nunca os trata como zero.
const TRIAGE_CATALOG_BASE = import.meta.env.VITE_TRIAGE_CATALOG_BASE || "/triage_catalog";

// Árvore da linguagem de condição (ADR 0009). A tela nunca a avalia: só a
// monta, a descreve e a manda.
export type ConditionTree = Record<string, unknown>;

export type Sex = "female" | "male";
export type GenderIdentity =
  | "cis_woman" | "cis_man" | "trans_woman" | "trans_man" | "travesti" | "non_binary" | "other";
export interface CitizenProfile {
  birth_date: string;
  sex: Sex;
  gender_identity: GenderIdentity | null;
  profile_source: "declared" | "verified";
}

export interface TriageOfferCounters {
  offered: number | null; started: number | null; completed: number | null; from_suggestion: number | null;
}
export interface TriageOffer {
  protocol_name: string;
  title: string;
  active_version: number;
  eligibility: ConditionTree | null;
  retake_after_days: number | null;
  // false = sem linha em triage_offers: enabled/position/restriction/período vêm null.
  configured: boolean;
  enabled: boolean | null;
  position: number | null;
  restriction: ConditionTree | null;
  // Só chega pela sugestão: fora de "Disponíveis" no wpda. Ausente em api anterior.
  suggestion_only?: boolean | null;
  available_from: string | null;
  available_until: string | null;
  counters: TriageOfferCounters;
}
export interface TriageOfferFields {
  enabled: boolean;
  suggestion_only: boolean;
  position: number;
  restriction: ConditionTree | null;
  available_from: string | null;
  available_until: string | null;
}

export async function listTriageCatalog(): Promise<TriageOffer[]> {
  return (await jsonFetch<{ offers: TriageOffer[] }>(TRIAGE_CATALOG_BASE)).offers;
}

// Só municipal_admin, com step-up: quem trata 401 mfa_required é o SensitiveAction.
export async function updateTriageOffer(protocolName: string, fields: TriageOfferFields): Promise<TriageOffer> {
  const body = await jsonFetch<{ offer: TriageOffer }>(`${TRIAGE_CATALOG_BASE}/${encodeURIComponent(protocolName)}`, {
    method: "PUT", body: JSON.stringify(fields)
  });
  return body.offer;
}

export interface SimulateProfile { age: number; sex: Sex; neighborhood_id: string | null }
export interface SimulateOutcome { tier?: string; score?: number; priority?: number }
export interface SimulateOfferInput {
  definition: unknown;
  profile: SimulateProfile;
  answers?: Record<string, string>;
  outcome?: SimulateOutcome;
}
export interface SimulateOfferResult {
  eligible: boolean;
  // Só para conferência; a frase da tela é a do construtor (contratos §4.3).
  eligibility_text: string | null;
  // title: como o cidadão vê o protocolo sugerido; ausente em api anterior a ele.
  suggestions: Array<{ protocol: string; title?: string; matches: boolean }>;
  errors: string[];
  // Gate warnings, non-blocking, e.g. suggestion to a protocol that doesn't exist in the city
  warnings: string[];
}

// Não grava nada. Definição que falha no gate responde 200 com
// `eligible: false`, `suggestions: []` e os erros (contratos §4.3), nunca 422.
export async function simulateOffer(input: SimulateOfferInput): Promise<SimulateOfferResult> {
  return jsonFetch<SimulateOfferResult>(`${AUTHORING_BASE}/simulate_offer`, {
    method: "POST", body: JSON.stringify(input)
  });
}

// ─── Módulo 16: modo de prontuário e exportação (ADR 0028; contratos §5) ─────
// Rotas da cidade, sessão municipal. Nenhuma devolve segredo: a senha da
// credencial só vai (PUT) e nunca volta. CPF e CNS chegam mascarados da API e
// são mostrados como vieram.
const INTEGRATIONS_BASE = import.meta.env.VITE_INTEGRATIONS_BASE || "/integrations";
const CNES_BASE = import.meta.env.VITE_CNES_BASE || "/cnes";
const PRODUCTION_BASE = import.meta.env.VITE_PRODUCTION_BASE || "/production";

export type RecordMode = "off" | "integrated" | "record";
// Módulo 29 (D1; V1): a credencial rnds é um certificado A1, não usuário e senha.
export type CredentialKind = "ledi" | "cadsus" | "rnds";
export type CredentialCheckStatus = "ok" | "unauthorized" | "unreachable" | "error";

export interface IntegrationCredential {
  kind: CredentialKind;
  set: boolean;
  set_at: string | null;
  set_by: string | null;
  last_check_at: string | null;
  last_check_status: CredentialCheckStatus | null;
  last_check_message: string | null;
}
export interface CityFeatureState { key: string; enabled: boolean; usable: boolean; missing: string[] }
export interface Integrations {
  record_mode: RecordMode;
  pec_url_set: boolean;
  ibge_code_set: boolean;
  credentials: IntegrationCredential[];
  features: CityFeatureState[];
}

export async function getIntegrations(): Promise<Integrations> {
  return jsonFetch<Integrations>(INTEGRATIONS_BASE);
}

// Escrita só. A senha vai como digitada (sem trim): uma senha do PEC com
// espaço nas pontas é outra senha.
export async function setIntegrationCredential(
  kind: CredentialKind, username: string, password: string
): Promise<IntegrationCredential> {
  return jsonFetch<IntegrationCredential>(`${INTEGRATIONS_BASE}/credentials/${encodeURIComponent(kind)}`, {
    method: "PUT", body: JSON.stringify({ username, password })
  });
}

export async function checkIntegrationCredential(kind: CredentialKind): Promise<IntegrationCredential> {
  return jsonFetch<IntegrationCredential>(`${INTEGRATIONS_BASE}/credentials/${encodeURIComponent(kind)}/check`, {
    method: "POST", body: "{}"
  });
}

export type CnesProposalKind = "unit" | "team" | "member";
export type CnesProposalAction = "link" | "create" | "end";
// Um lado da proposta (contratos §5.2): cada chave
// só vem quando se aplica ao tipo; CPF e CNS sempre mascarados.
export interface CnesSide {
  name?: string | null;
  cnes?: string | null;
  ine?: string | null;
  cbo?: string | null;
  cpf_masked?: string | null;
  cns_masked?: string | null;
}
export interface CnesProposal {
  id: string;
  kind: CnesProposalKind;
  action: CnesProposalAction;
  local: CnesSide | null;
  cnes: CnesSide;
  confidence: "exact" | "probable";
}
export interface CnesDivergence {
  kind: string;
  subject: { type: string; id: string; label: string };
  detail: string | null;
}
export interface CnesOverview {
  snapshot: { competence: string; imported_at: string } | null;
  proposals: CnesProposal[];
  divergences: CnesDivergence[];
}
export interface CnesApplyResult { applied: number; skipped: { id: string; reason: string }[] }

export async function getCnes(): Promise<CnesOverview> {
  return jsonFetch<CnesOverview>(CNES_BASE);
}

export async function applyCnesProposals(proposalIds: string[]): Promise<CnesApplyResult> {
  return jsonFetch<CnesApplyResult>(`${CNES_BASE}/apply`, {
    method: "POST", body: JSON.stringify({ proposal_ids: proposalIds })
  });
}

export type CompetenceAlert = "none" | "attention" | "critical";
// `correction_pending` (módulo 19, contratos §6): correção de ficha já aceita,
// guardada e não enviada até o reenvio depois do aceite ser confirmado (api#41).
export type FichaStatus = "pending" | "sending" | "accepted" | "rejected" | "failed" | "correction_pending";
export interface LediErrorCode { field: string; code: string }
export interface LediRejection extends LediErrorCode { count: number }
export interface LediFicha {
  id: string;
  ficha_type: string;
  status: FichaStatus;
  attempts: number;
  // Módulo 18 (ADR 0030; contratos §6): só códigos, nunca o texto do PEC.
  last_error_codes: LediErrorCode[];
  // Ficha recusada reenviada é regenerada: a nova aponta para a antiga (contratos §9).
  replaces_outbox_id: string | null;
  created_at: string;
  accepted_at: string | null;
}
export interface Production {
  competence: string;
  deadline_on: string;
  business_days_left: number;
  alert: CompetenceAlert;
  // `sending` pode faltar na resposta e `pending` não o soma (contratos §5.3).
  counts: { accepted: number; rejected: number; pending: number; failed: number; sending?: number };
  rejections: LediRejection[];
  fichas: LediFicha[];
  // Total de fichas da competência, para a paginação (contratos §5.3).
  fichas_total: number;
}
// Página fixa da API (contratos §5.3).
export const FICHAS_PER_PAGE = 50;

// `competence` null = a corrente, decidida pela API no fuso da cidade.
export async function getProduction(competence: string | null, page: number): Promise<Production> {
  const params = new URLSearchParams();
  if (competence) params.set("competence", competence);
  if (page > 1) params.set("page", String(page));
  const qs = params.toString();
  return jsonFetch<Production>(qs ? `${PRODUCTION_BASE}?${qs}` : PRODUCTION_BASE);
}

export async function resendFicha(id: string): Promise<LediFicha> {
  return jsonFetch<LediFicha>(`${PRODUCTION_BASE}/fichas/${encodeURIComponent(id)}/resend`, {
    method: "POST", body: "{}"
  });
}

// ─── Agenda (módulo 17, ADR 0029; contratos 2026-10-05 §2–§4) ───────────────
// Rotas NOVAS devolvem o objeto puro na escrita (contratos, cabeçalho); as que
// já existiam mantêm o envelope de hoje ({ shift }, { appointment }, { requests }).
// POST e segmento de URL reusam postProfessional/professionalId (mesma forma
// para /professionals e /attendance).

export type AppointmentTypeOrigin = "platform" | "city";
export interface AppointmentType {
  key: string; name: string; duration_minutes: number; cbo_prefixes: string[]; active: boolean; origin: AppointmentTypeOrigin;
}
export interface AppointmentTypeFields { name?: string; duration_minutes?: number; cbo_prefixes?: string[]; active?: boolean }
export interface NewAppointmentType { key: string; name: string; duration_minutes: number; cbo_prefixes: string[] }

export type BlockKind = "walk_in" | "bookable" | "blocked";
// `appointment_type_name` só vem nas respostas (§9: faixas `bookable` da agenda
// e da Minha agenda); nunca é enviado de volta.
export interface ScheduleBlock {
  starts: string; ends: string; kind: BlockKind; appointment_type_key?: string; slot_minutes?: number | null;
  appointment_type_name?: string;
}
export interface ScheduleTemplate { id: string; name: string; fit_in_limit: number; blocks: ScheduleBlock[]; active: boolean }
export interface ScheduleTemplateFields { name?: string; fit_in_limit?: number; blocks?: ScheduleBlock[]; active?: boolean }
export interface NewScheduleTemplate { name: string; fit_in_limit: number; blocks: ScheduleBlock[] }
export interface TemplatePreviewInput {
  blocks: ScheduleBlock[]; fit_in_limit: number; sample: { starts_at: string; ends_at: string; cbo_code: string };
}
export interface TemplatePreview {
  slots: { starts_at: string; ends_at: string; appointment_type_key: string }[];
  blocks: ScheduleBlock[];
}

export type SchedulingPriority = "routine" | "priority";
export type PreferredPeriod = "morning" | "afternoon" | "any";
export type RescheduleReasonCode = "work" | "health" | "transport" | "other";
export type BookingKind = "slot" | "fit_in" | "legacy";

// Horário (contratos §4.4), a mesma forma na agenda, na fila e na Minha agenda.
// Em `legacy`, fim, tipo, profissional e turno vêm nulos.
export interface AppointmentView {
  id: string; status: string; booking_kind: BookingKind; scheduled_at: string; ends_at: string | null;
  appointment_type_key: string | null; appointment_type_name: string | null;
  professional: { id: string; name: string } | null; shift_id: string | null; fit_in: boolean;
  fit_in_reason?: string; outside_template: boolean; shift_cancelled: boolean;
  citizen: { id: string; cpf_masked: string; name?: string };
}

export interface AgendaShift {
  shift_id: string; starts_at: string; ends_at: string; blocks: ScheduleBlock[];
  fit_in_count: number; fit_in_limit: number;
  // Turno cancelado continua na agenda (spec §4.3; contratos §9).
  cancelled_at: string | null;
}
export interface AgendaProfessional { id: string; name: string; shifts: AgendaShift[]; appointments: AppointmentView[] }
export interface UnitAgenda { date: string; professionals: AgendaProfessional[]; unassigned: AppointmentView[] }

export interface AvailabilitySlot {
  professional_id: string; professional_name: string; shift_id: string; starts_at: string; ends_at: string;
}
export interface Availability { slots: AvailabilitySlot[]; legacy_days: string[] }

export type BookingInput =
  | { kind: "slot"; professional_id: string; starts_at: string; appointment_type_key: string }
  | { kind: "fit_in"; professional_id: string; shift_id: string; starts_at: string; appointment_type_key: string; reason: string }
  | { kind: "legacy"; scheduled_at: string; allow_overlap?: boolean };

export interface MyAgendaShift {
  shift_id: string; unit: { id: string; name: string }; starts_at: string; ends_at: string; cancelled_at: string | null;
  blocks: ScheduleBlock[]; appointments: AppointmentView[];
}
export interface MyAgendaDay { date: string; shifts: MyAgendaShift[] }
export interface MyAgenda { days: MyAgendaDay[] }

export async function listAppointmentTypes(): Promise<AppointmentType[]> {
  return (await jsonFetch<{ types: AppointmentType[] }>(`${PROFESSIONALS_BASE}/appointment_types`)).types;
}

export function createAppointmentType(input: NewAppointmentType): Promise<AppointmentType> {
  return jsonFetch(`${PROFESSIONALS_BASE}/appointment_types`, postProfessional(input));
}

export function updateAppointmentType(key: string, fields: AppointmentTypeFields): Promise<AppointmentType> {
  return jsonFetch(`${PROFESSIONALS_BASE}/appointment_types/${professionalId(key)}`, postProfessional(fields));
}

export async function listScheduleTemplates(): Promise<ScheduleTemplate[]> {
  return (await jsonFetch<{ templates: ScheduleTemplate[] }>(`${PROFESSIONALS_BASE}/schedule_templates`)).templates;
}

export function createScheduleTemplate(input: NewScheduleTemplate): Promise<ScheduleTemplate> {
  return jsonFetch(`${PROFESSIONALS_BASE}/schedule_templates`, postProfessional(input));
}

export function updateScheduleTemplate(id: string, fields: ScheduleTemplateFields): Promise<ScheduleTemplate> {
  return jsonFetch(`${PROFESSIONALS_BASE}/schedule_templates/${professionalId(id)}`, postProfessional(fields));
}

export function previewScheduleTemplate(input: TemplatePreviewInput): Promise<TemplatePreview> {
  return jsonFetch(`${PROFESSIONALS_BASE}/schedule_templates/preview`, postProfessional(input));
}

export async function setShiftTemplate(shiftId: string, templateId: string | null): Promise<void> {
  await jsonFetch<unknown>(`${PROFESSIONALS_BASE}/shifts/${professionalId(shiftId)}/template`,
    postProfessional({ schedule_template_id: templateId }));
}

export async function setLinkDefaultType(linkId: string, key: string | null): Promise<void> {
  await jsonFetch<unknown>(`${PROFESSIONALS_BASE}/links/${professionalId(linkId)}/default_type`,
    postProfessional({ appointment_type_key: key }));
}

export function getMyAgenda(from: string, to: string): Promise<MyAgenda> {
  return jsonFetch(`${PROFESSIONALS_BASE}/me/agenda?${new URLSearchParams({ from, to }).toString()}`);
}

export async function listUnassignedRequests(): Promise<RequestRow[]> {
  return (await jsonFetch<{ requests: RequestRow[] }>(`${ATTENDANCE_BASE}/requests/unassigned`)).requests;
}

export function assignRequestUnit(id: string, unitId: string): Promise<RequestRow> {
  return jsonFetch(`${ATTENDANCE_BASE}/requests/${professionalId(id)}/assign_unit`, postProfessional({ unit_id: unitId }));
}

export function getUnitAvailability(unitId: string, type: string, from: string, to: string): Promise<Availability> {
  const qs = new URLSearchParams({ type, from, to }).toString();
  return jsonFetch(`${ATTENDANCE_BASE}/units/${professionalId(unitId)}/availability?${qs}`);
}

// A unidade vai em toda forma: o api confere `wrong_unit` como hoje.
export async function bookAppointment(requestId: string, unitId: string, input: BookingInput): Promise<ScheduledAppointment> {
  const payload = await jsonFetch<{ appointment: ScheduledAppointment }>(
    `${ATTENDANCE_BASE}/requests/${professionalId(requestId)}/appointments`, postProfessional({ ...input, health_unit_id: unitId })
  );
  return payload.appointment;
}

export function getUnitAgenda(unitId: string, date: string): Promise<UnitAgenda> {
  return jsonFetch(`${ATTENDANCE_BASE}/units/${professionalId(unitId)}/agenda?date=${professionalId(date)}`);
}

// ─── Acolhimento (módulo 18, ADR 0030; contratos 2026-10-07 §2–§6, §9) ───────
// Texto livre (queixa, justificativa, orientação) só no corpo de POST, nunca
// em URL. A recepção não chama nada daqui: ela só lê o bloco `screening` da fila.

export type ScreeningColor = "red" | "yellow" | "green" | "blue";
export type ScreeningDestination = "same_day" | "schedule" | "oriented" | "referred";
export type ScreeningStatus = "in_progress" | "completed" | "abandoned";
export type ScreeningScope = "walk_in" | "all";
export type GlucoseMoment = "fasting" | "postprandial" | "random";

export interface VitalSigns {
  systolic?: number; diastolic?: number; heart_rate?: number; respiratory_rate?: number; temperature_c?: number;
  spo2?: number; capillary_glucose?: number; glucose_moment?: GlucoseMoment; weight_kg?: number; height_cm?: number;
  pain_score?: number;
  // Só nas respostas (calculado pela API).
  bmi?: number;
}
export interface Ciap2Ref { code: string; label: string }
export interface MatchedRule { index: number; text: string }

export interface ScreeningRevision {
  id: string; created_at: string; by: { id: string; name: string };
  ciap2: Ciap2Ref; complaint_note?: string | null; vitals: VitalSigns; alerts: string[];
  suggested_color: ScreeningColor | null; final_color: ScreeningColor; color_change_reason?: string | null;
  matched_rules: MatchedRule[];
}
export interface Screening {
  id: string; attendance_id: string; status: ScreeningStatus; started_at: string; completed_at: string | null;
  destination: ScreeningDestination | null; orientation_note?: string | null; appointment_request_id?: string | null;
  current_revision: ScreeningRevision | null; revisions_count: number;
  // Só em GET /attendance/screenings/:id.
  revisions?: ScreeningRevision[];
}
export interface ScreeningQueueItem {
  attendance_id: string; citizen: { id: string; cpf_masked: string }; checked_in_at: string; triage_priority: number | null;
  screening: { id: string; status: ScreeningStatus; started_by_name: string } | null;
}
// Bloco da fila do profissional (contrato §9). Com `id`, "Ver escuta" e
// "Reavaliar" sabem qual escuta abrir.
export interface QueueScreening { id: string; color: ScreeningColor; destination: ScreeningDestination; waited_minutes: number }

export interface ScreeningSuggestion { suggested_color: ScreeningColor | null; matched_rules: MatchedRule[]; alerts: string[]; bmi: number | null }
// `attendance_id` no lugar de `citizen_id` (contrato §9); sem queixa escolhida, `ciap2_code` fica de fora.
export interface ScreeningSuggestInput { ciap2_code?: string; vitals: VitalSigns; attendance_id: string }

export interface ScreeningRevisionInput {
  ciap2_code: string; complaint_note?: string; vitals: VitalSigns; final_color: ScreeningColor; color_change_reason?: string;
}
export interface ScreeningScheduleInput { appointment_type_key: string; priority: SchedulingPriority; due_in_days: number }
export interface ScreeningReferralInput { referral_unit_id?: string; referral_note?: string }
export interface ScreeningCompleteInput extends ScreeningRevisionInput {
  destination: ScreeningDestination; orientation_note?: string; schedule?: ScreeningScheduleInput; referral?: ScreeningReferralInput;
}

export interface SimulateScreeningInput {
  definition: unknown; ciap2_code: string | null; vitals: VitalSigns; profile: { age: number; sex: Sex };
}
// Sem `alerts` nem `bmi`: o simulador só avalia as regras do rascunho (contrato §9).
export interface SimulateScreeningResult {
  suggested_color: ScreeningColor | null; matched_rules: MatchedRule[]; errors: string[]; warnings: string[];
}

export interface GenerationFailure {
  id: string; source_type: string; source_id: string; attendance_id: string | null; reason_codes: string[];
  created_at: string; resolved_at: string | null;
}

const screeningPath = (id: string, action?: string) =>
  `${ATTENDANCE_BASE}/screenings/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;

export async function listScreeningQueue(unitId: string): Promise<ScreeningQueueItem[]> {
  const payload = await jsonFetch<{ items: ScreeningQueueItem[] }>(`${ATTENDANCE_BASE}/units/${encodeURIComponent(unitId)}/screening_queue`);
  return payload.items;
}

export function startScreening(attendanceId: string): Promise<Screening> {
  return jsonFetch(`${ATTENDANCE_BASE}/attendances/${encodeURIComponent(attendanceId)}/screening`, postProfessional({}));
}

export function abandonScreening(id: string): Promise<Screening> {
  return jsonFetch(screeningPath(id, "abandon"), postProfessional({}));
}

// Não grava nada.
export function suggestScreening(input: ScreeningSuggestInput): Promise<ScreeningSuggestion> {
  return jsonFetch(`${ATTENDANCE_BASE}/screenings/suggest`, postProfessional(input));
}

export function completeScreening(id: string, input: ScreeningCompleteInput): Promise<Screening> {
  return jsonFetch(screeningPath(id, "complete"), postProfessional(input));
}

export function reassessScreening(id: string, input: ScreeningRevisionInput): Promise<Screening> {
  return jsonFetch(screeningPath(id, "reassess"), postProfessional(input));
}

// Abrir a escuta gera a trilha de leitura (`screening.viewed`) no api.
export function getScreening(id: string): Promise<Screening> {
  return jsonFetch(screeningPath(id));
}

// Contrato §9: busca de CIAP-2 por nome ou código, no corpo (o termo pode
// descrever a queixa) e na terminologia ativa.
export async function searchCiap2(q: string): Promise<Ciap2Ref[]> {
  const payload = await jsonFetch<{ items: Ciap2Ref[] }>(`${ATTENDANCE_BASE}/ciap2/search`, postProfessional({ q }));
  return payload.items;
}

// Contrato §9: simulador do editor com a definição do rascunho. Como o
// simulate_offer, definição que falha no gate responde 200 com `errors`.
export function simulateScreening(input: SimulateScreeningInput): Promise<SimulateScreeningResult> {
  return jsonFetch(`${AUTHORING_BASE}/simulate_screening`, postProfessional(input));
}

export async function listGenerationFailures(): Promise<GenerationFailure[]> {
  const payload = await jsonFetch<{ items: GenerationFailure[] }>(`${PRODUCTION_BASE}/generation_failures?resolved=false`);
  return payload.items;
}

// Step-up: quem trata 401 mfa_required é o SensitiveAction.
export function retryGenerationFailure(id: string): Promise<GenerationFailure> {
  return jsonFetch(`${PRODUCTION_BASE}/generation_failures/${encodeURIComponent(id)}/retry`, postProfessional({}));
}

// ─── Prontuário da APS (módulo 19a, ADR 0031; contratos do módulo 19) ──────
// Texto clínico (S, O, A, P, adendo, motivo, nota da abertura) e nomes só em
// corpo de POST/PATCH, nunca em URL: as rotas levam só ids, e o CPF da
// abertura vai no corpo. A recepção não chama nada daqui.

const CLINICAL_RECORD_BASE = import.meta.env.VITE_CLINICAL_RECORD_BASE || "/clinical_record";

export type Terminology = "ciap2" | "cid10";
export type ProblemStatus = "active" | "resolved";
export type OnsetPrecision = "day" | "month" | "year";
export type ProblemAction = "evaluate" | "add" | "resolve" | "correct_onset";
export type RecordAccess = "in_context" | "justified";
export type OpeningReason = "case_review" | "active_search" | "continuity_of_care" | "other";
// Os desfechos do formulário (o api recusa os do acolhimento no close; "left" é da recepção).
export type CareOutcome = Exclude<AttendanceOutcome, "left" | "scheduled_from_screening" | "oriented">;

export interface CodedOption { code: string; label: string }
export interface CitizenNames { full_name_set: boolean; display_name: string | null }
export interface CitizenNamesInput { full_name: string; social_name?: string; mother_name?: string }

export interface PatientProblem {
  id: string; terminology: Terminology; code: string; label: string; status: ProblemStatus;
  // O api omite os opcionais quando nulos: chave ausente = null.
  onset_on?: string | null; onset_precision?: OnsetPrecision | null; resolved_on?: string | null;
}
export interface EvaluatedProblem {
  problem_id: string | null; terminology: Terminology; code: string; label: string; action: ProblemAction;
  onset_on?: string | null; onset_precision?: OnsetPrecision | null;
}
// Módulo 21a (Divergência D10): prioridade do pedido; ausente = rotina.
// `id` só vem na leitura de item de consulta finalizada; nunca é enviado de volta.
export interface ExamRequest { id?: string; sigtap_code: string; label: string; cid10_justification?: string | null; priority?: ExamPriority }
// Divergência D4: `evaluated_problems` são eventos novos (mesma forma da
// consulta); `conducts` e `exam_requests` são as listas finais.
export interface AddendumChanges {
  evaluated_problems?: EvaluatedProblem[]; conducts?: string[]; exam_requests?: ExamRequest[];
  // Módulo 28 (O14): o adendo odontológico leva achados e cancelamentos de item do plano.
  // Na leitura, o api devolve só as partes que o adendo mudou: as duas chaves podem faltar.
  dental?: { findings?: DentalFinding[]; plan_changes?: { cancel: PlanCancel[] } };
}
export interface Addendum {
  id: string; author_name: string; created_at: string; reason: string; text: string; changes: AddendumChanges | null;
  // Módulo 19b (contrato 2026-10-08 §2): calculado pelo api; ausente em api sem o 19b.
  signature?: SignatureBlock;
  // Módulo 26a (contrato §13 G4): pedidos de regulação que não seguiram junto com o adendo.
  regulation_not_sent?: RegulationNotSent[];
}

// Módulo 26a (contrato §13 G4): um pedido de regulação do rascunho que não foi enviado ao finalizar.
export interface RegulationNotSent { index: number; id: string; error: string; path?: string }

export interface Consultation {
  id: string; attendance_id: string; patient_id: string; status: "draft" | "finalized";
  author: { id: string; name: string }; cbo_code: string;
  subjective: string | null; objective: string | null; assessment: string | null; plan: string | null;
  vitals: VitalSigns; care_type: string | null;
  evaluated_problems: EvaluatedProblem[]; conducts: string[]; exam_requests: ExamRequest[];
  started_at: string; finalized_at: string | null; addenda: Addendum[];
  // Módulo 19b (contrato 2026-10-08 §2): só na finalizada; o rascunho não tem.
  signature?: SignatureBlock;
  // Módulo 26a (contrato §13 G4): pedidos de regulação que não seguiram junto com a finalização.
  regulation_not_sent?: RegulationNotSent[];
  // Módulo 28 (contrato §2/§4): ausente = consulta comum (`general`).
  kind?: ConsultationKind; baseline?: boolean; dental?: DentalBlock | null;
}
export interface ConsultationSummary {
  id: string; finalized_at: string; author_name: string; cbo_label: string; care_type_label: string;
  problems: EvaluatedProblem[]; addenda_count: number;
}
// Módulo 24a (L8; api `Patients::IdentifierJson`): paciente sem CPF vem com
// `cpf_masked: null`, `has_cpf: false` e o CNS mascarado — a tela usa `patientDocument`.
export interface RecordPatient {
  id: string; display_name: string; full_name: string; social_name: string | null; age: number; sex: Sex; cpf_masked: string | null;
  has_cpf?: boolean; cns_masked?: string | null;
}
export interface ClinicalRecord {
  patient: RecordPatient; access: RecordAccess; problems: PatientProblem[];
  today_screening: Screening | null; consultations: ConsultationSummary[];
}
export interface ConsultationOptions {
  care_types: CodedOption[]; conducts: CodedOption[]; cid10_allowed_for_cbo: boolean;
  // Módulo 28 (O4, O20): `kinds` ausente = ["general"]; o bloco `dental` é o vocabulário fixo da FAO (sem dado pessoal).
  kinds?: ConsultationKind[]; dental_role?: DentalRole | null; dental?: DentalVocabulary;
}
// Corpo do autosave (Divergência D5: todos os campos editáveis a cada PATCH).
export interface ConsultationDraftInput {
  subjective: string; objective: string; assessment: string; plan: string; vitals: VitalSigns;
  // Módulo 28 (Ruling 5, O25): ausente na odontológica (o tipo vai em `dental.care_type`); sempre presente na comum.
  care_type?: string | null;
  evaluated_problems: EvaluatedProblem[]; conducts: string[]; exam_requests: ExamRequest[];
  // Módulo 28 (contrato §2): só na consulta odontológica.
  dental?: DentalFields;
}
// O mesmo corpo do POST /attendance/attendances/:id/close.
export interface OutcomeBody { outcome: CareOutcome; referral_unit_id?: string; referral_note?: string }
export interface AddendumInput { reason: string; text: string; changes?: AddendumChanges }
export interface OpeningInput { cpf: string; reason_code: OpeningReason; reason_note?: string }
// Módulo 20 (Divergência D1): no modo integrated a abertura vale para a pessoa
// (pares validados do CPF) e pode não ter paciente do 19a.
export interface Opening { opening_id: string; patient_id: string | null; expires_at: string }
export type OpeningKind = "justified_opening" | "administrative_read";
export interface OpeningRow {
  kind: OpeningKind; id: string; user_name: string; cpf_masked: string | null; reason_code: OpeningReason | null;
  consultation_id: string | null; created_at: string; expires_at: string | null;
  // Módulo 24a (L8): a leitura administrativa pode ser de paciente sem CPF.
  has_cpf?: boolean; cns_masked?: string | null;
}
export interface ConsultationListItem {
  id: string; finalized_at: string; patient: { id: string; display_name: string };
  care_type: string | null; care_type_label: string | null; health_unit: { id: string; name: string };
}
export interface ConsultationPeriod { from?: string; to?: string }
export interface OpeningsQuery { from: string; to: string; userId?: string }

const attendancePath = (id: string, action: string) => `${ATTENDANCE_BASE}/attendances/${encodeURIComponent(id)}/${action}`;
const consultationPath = (id: string, action?: string) =>
  `${ATTENDANCE_BASE}/consultations/${encodeURIComponent(id)}${action ? `/${action}` : ""}`;

// Ler gera a trilha `clinical_record.viewed` no api.
export function getAttendanceRecord(attendanceId: string): Promise<ClinicalRecord> {
  return jsonFetch(attendancePath(attendanceId, "record"));
}

export function getConsultationOptions(): Promise<ConsultationOptions> {
  return jsonFetch(`${ATTENDANCE_BASE}/consultation_options`);
}

export function startConsultation(attendanceId: string, input?: { kind: ConsultationKind; baseline?: boolean }): Promise<Consultation> {
  return jsonFetch(attendancePath(attendanceId, "consultation"), postProfessional(input ?? {}));
}

export function saveConsultationDraft(id: string, input: ConsultationDraftInput): Promise<Consultation> {
  return jsonFetch(consultationPath(id), { method: "PATCH", body: JSON.stringify(input) });
}

// Módulo 32a (Q10, D5): a consulta de urgência finaliza com `{}` (sem desfecho do 13; o desfecho é da urgência).
export function finalizeConsultation(id: string, outcome: OutcomeBody | null): Promise<Consultation> {
  return jsonFetch(consultationPath(id, "finalize"), postProfessional(outcome === null ? {} : { outcome }));
}

export function getConsultation(id: string): Promise<Consultation> {
  return jsonFetch(consultationPath(id));
}

// dashboard#12: a lista de problemas do paciente para o adendo da própria consulta
// (só a autora; o api grava a trilha author).
export async function getConsultationProblems(id: string): Promise<PatientProblem[]> {
  const body = await jsonFetch<{ problems: PatientProblem[] }>(consultationPath(id, "problems"));
  return body.problems;
}

function periodQuery(q: ConsultationPeriod): string {
  const params = new URLSearchParams();
  if (q.from) params.set("from", q.from);
  if (q.to) params.set("to", q.to);
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

// Só datas na URL; a autora lê as próprias finalizadas (sem trilha).
export async function listMyConsultations(q: ConsultationPeriod): Promise<ConsultationListItem[]> {
  const payload = await jsonFetch<{ consultations: ConsultationListItem[] }>(`${ATTENDANCE_BASE}/consultations/mine${periodQuery(q)}`);
  return payload.consultations;
}

// Municipal_admin, com step-up (quem trata 401 mfa_required é o SensitiveAction).
export function listProfessionalConsultations(userId: string, q: ConsultationPeriod):
  Promise<{ professional: { id: string; name: string }; consultations: ConsultationListItem[] }> {
  return jsonFetch(`${CLINICAL_RECORD_BASE}/professionals/${encodeURIComponent(userId)}/consultations${periodQuery(q)}`);
}

// Leitura administrativa (só leitura, com step-up); fica no relatório de aberturas.
export function getAdministrativeConsultation(id: string): Promise<Consultation> {
  return jsonFetch(`${CLINICAL_RECORD_BASE}/consultations/${encodeURIComponent(id)}`);
}

export function addAddendum(id: string, input: AddendumInput): Promise<Addendum> {
  // O api ignora `opening_id`; o cliente nunca o envia, nem se vier de um chamador sem tipo.
  const { reason, text, changes } = input;
  return jsonFetch(consultationPath(id, "addenda"), postProfessional({ reason, text, ...(changes ? { changes } : {}) }));
}

// O PDF é gerado na hora (não gravado). Lido com fetch, e não por navegação,
// para a tela mostrar o 409 (`patient_name_missing`, `not_finalized`) em vez
// de uma página de erro na janela nova.
export async function fetchConsultationPdf(id: string): Promise<Blob> {
  const url = consultationPath(id, "print");
  const res = await fetch(url, { credentials: "include", headers: { Accept: "application/pdf" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    if (text) { try { body = JSON.parse(text); } catch { /* deixa string */ } }
    throw new ApiError(res.status, body, `${res.status} on ${url}`);
  }
  return res.blob();
}

// A rota de CIAP-2 do módulo 18, ampliada para CID-10 (contratos §5).
export async function searchTerminology(q: string, terminology: Terminology): Promise<CodedOption[]> {
  const payload = await jsonFetch<{ items: CodedOption[] }>(`${ATTENDANCE_BASE}/ciap2/search`, postProfessional({ q, terminology }));
  return payload.items;
}

export async function searchSigtap(q: string): Promise<CodedOption[]> {
  const payload = await jsonFetch<{ items: CodedOption[] }>(`${ATTENDANCE_BASE}/sigtap/search`, postProfessional({ q }));
  return payload.items;
}

// Step-up: quem trata 401 mfa_required é o SensitiveAction.
export function openClinicalRecord(input: OpeningInput): Promise<Opening> {
  return jsonFetch(`${CLINICAL_RECORD_BASE}/openings`, postProfessional(input));
}

export function getJustifiedRecord(patientId: string): Promise<ClinicalRecord> {
  return jsonFetch(`${CLINICAL_RECORD_BASE}/patients/${encodeURIComponent(patientId)}`);
}

// Só datas e o id do profissional na URL; o relatório já vem com CPF mascarado.
export async function listOpenings(q: OpeningsQuery): Promise<OpeningRow[]> {
  const params = new URLSearchParams({ from: q.from, to: q.to });
  if (q.userId) params.set("user_id", q.userId);
  const payload = await jsonFetch<{ items: OpeningRow[] }>(`${CLINICAL_RECORD_BASE}/openings?${params.toString()}`);
  return payload.items;
}

// `:id` é a validação ativa do par (Divergência D2).
export async function completeCitizenNames(verificationId: string, names: CitizenNamesInput): Promise<void> {
  await jsonFetch<unknown>(`${ATTENDANCE_BASE}/verifications/${encodeURIComponent(verificationId)}/names`, postProfessional(names));
}

// ─── Assinatura digital (módulo 19b, ADR 0032; contrato 2026-10-08 §1–§7) ───
// As rotas levam só ids; `state`, `code`, motivo e `return_to` vão no corpo.
// O token do prestador e o code_verifier nunca passam pelo navegador: o api
// guarda os dois; o dashboard só segue o authorize_url e devolve state+code.

const SIGNATURE_BASE = import.meta.env.VITE_SIGNATURE_BASE || "/signature";

// "simulated" é o PSC falso de dev/staging (interruptor signature_psc_mock).
export type SignatureProvider = "vidaas" | "birdid" | "safeid" | "neoid" | "remoteid" | "simulated";
export type SignatureMode = "digital" | "manual" | "pending";
export type SignatureRequestStatus = "pending" | "signed" | "failed" | "returned_to_paper";
export type SignatureVerification = "valid" | "invalid" | "indeterminate";
export type SignatureReason =
  | "no_session" | "session_expired" | "provider_unavailable" | "provider_rejected" | "signer_unavailable"
  | "verification_failed" | "certificate_expired" | "certificate_revoked" | "certificate_cpf_mismatch"
  | "feature_disabled" | "user_request" | "document_cancelled";
export type SignatureDocumentType = "consultation" | "consultation_addendum" | "clinical_document" | "lab_report";
export type CertificateStatus = "active" | "replaced" | "unlinked" | "revoked" | "expired";
export type SignatureFileKind = "pdf" | "package";

export interface SignatureBlock {
  mode: SignatureMode; request_id?: string; signature_id?: string; signed_at?: string; signer_name?: string;
  verification?: SignatureVerification; reason_code?: SignatureReason; simulated?: boolean;
}
export interface SignerCertificate {
  id: string; provider: SignatureProvider; issuer: string; serial_number: string; not_after: string;
  status: CertificateStatus; expires_in_days: number;
}
export interface CertificateDiscovery {
  providers: { provider: SignatureProvider; found: boolean }[]; unavailable: SignatureProvider[];
}
export interface AuthorizeRedirect { authorize_url: string }
export interface SignatureSessionState { active: boolean; expires_at?: string; provider?: SignatureProvider }
export interface BatchResult { signed: number; failed: { request_id: string; reason_code: SignatureReason }[] }
// `return_to`: Divergência D2 (o api devolve o caminho que guardou com o state).
export type OAuthCallbackResult =
  | { purpose: "link"; result: SignerCertificate; return_to?: string }
  | { purpose: "session"; result: { expires_at: string }; return_to?: string }
  | { purpose: "batch"; result: BatchResult; return_to?: string };
export interface SignatureRequest {
  id: string; document_type: SignatureDocumentType; document_id: string; consultation_id: string | null;
  patient_display_name: string | null; finalized_at: string | null; status: SignatureRequestStatus;
  reason_code?: SignatureReason | null; attempts: number;
}
export interface SignatureDetail {
  id: string; document_type: SignatureDocumentType; document_id: string; signed_at: string; signer_name: string;
  signer_cpf_masked: string; policy: string; provider: SignatureProvider | string; simulated: boolean;
  verification: SignatureVerification; verification_reasons: string[];
  verified_at: string; content: Record<string, unknown>;
}
// O api omite not_after/expires_in_days/oldest_pending_at quando são nulos.
export interface OverviewProfessional {
  user_id: string; name: string; certificate_status: "active" | "none" | "expiring";
  not_after?: string | null; expires_in_days?: number | null; pending_count: number; oldest_pending_at?: string | null;
}
export interface OverviewSignatureRow {
  signature_id: string; document_type: SignatureDocumentType; signer_name: string;
  verification: SignatureVerification; verified_at: string; simulated?: boolean;
}
export interface SignatureOverview {
  professionals: OverviewProfessional[];
  documents_by_mode: Record<SignatureMode, number>;
  invalid_or_indeterminate: OverviewSignatureRow[];
}

const signaturePath = (...parts: string[]) => [ SIGNATURE_BASE, ...parts.map(encodeURIComponent) ].join("/");

export async function getCurrentCertificate(): Promise<SignerCertificate | null> {
  try {
    return await jsonFetch<SignerCertificate>(signaturePath("certificates", "current"));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && errorCode(err) === "certificate_not_linked") return null;
    throw err;
  }
}

export function discoverCertificates(): Promise<CertificateDiscovery> {
  return jsonFetch(signaturePath("certificates", "discover"), postProfessional({}));
}

// Step-up: quem trata 401 mfa_required é o SensitiveAction.
export function linkCertificate(provider: SignatureProvider, returnTo: string): Promise<AuthorizeRedirect> {
  return jsonFetch(signaturePath("certificates", "link"), postProfessional({ provider, return_to: returnTo }));
}

export async function unlinkCertificate(): Promise<void> {
  await jsonFetch<void>(signaturePath("certificates", "current"), { ...postProfessional({}), method: "DELETE" });
}

export function openSignatureSession(returnTo: string): Promise<AuthorizeRedirect> {
  return jsonFetch(signaturePath("sessions"), postProfessional({ return_to: returnTo }));
}

export function getSignatureSession(): Promise<SignatureSessionState> {
  return jsonFetch(signaturePath("sessions", "current"));
}

export async function closeSignatureSession(): Promise<void> {
  await jsonFetch<void>(signaturePath("sessions", "current"), { ...postProfessional({}), method: "DELETE" });
}

// Ruling R11 (contrato §13): a recusa do prestador também vai ao api, como
// `{ state, error }` — ele consome o state e responde 403 authorization_denied
// com o return_to no corpo. state/code/error só no corpo, nunca na URL.
export function completeSignatureOAuth(state: string, answer: string | { error: string }): Promise<OAuthCallbackResult> {
  const body = typeof answer === "string" ? { state, code: answer } : { state, error: answer.error };
  return jsonFetch(signaturePath("oauth", "callback"), postProfessional(body));
}

export async function listPendingSignatures(): Promise<SignatureRequest[]> {
  const payload = await jsonFetch<{ items: SignatureRequest[] }>(`${signaturePath("requests")}?status=pending`);
  return payload.items;
}

export function returnToPaper(id: string, reason: string): Promise<SignatureRequest> {
  return jsonFetch(signaturePath("requests", id, "return_to_paper"), postProfessional({ reason }));
}

export function startSignatureBatch(returnTo: string, requestIds?: string[]): Promise<AuthorizeRedirect & { count: number }> {
  const body = requestIds ? { request_ids: requestIds, return_to: returnTo } : { return_to: returnTo };
  return jsonFetch(signaturePath("batches"), postProfessional(body));
}

// Ler gera a trilha `clinical_record.viewed` no api.
export function getSignature(id: string): Promise<SignatureDetail> {
  return jsonFetch(signaturePath("signatures", id));
}

// Content-Type JSON e corpo `{}` são obrigatórios: sem eles o api responde 415.
export function verifySignature(id: string): Promise<SignatureDetail> {
  return jsonFetch(signaturePath("signatures", id, "verify"), postProfessional({}));
}

export interface SignatureFile { blob: Blob; filename: string | null }

// Nome sugerido pelo api (Content-Disposition), aceito só se for seguro
// (sem dado pessoal nem separadores); senão null e a tela usa um nome por id.
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;
function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*\s*=\s*(?:UTF-8|utf-8)?'[^']*'([^;]+)/.exec(header);
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;\s]+))/.exec(header);
  let raw = star ? star[1].trim() : plain ? (plain[1] ?? plain[2]) : null;
  if (raw === null) return null;
  if (star) { try { raw = decodeURIComponent(raw); } catch { return null; } }
  return SAFE_FILENAME.test(raw) ? raw : null;
}

// PDF e pacote lidos com fetch (e não por navegação) para a tela mostrar a
// recusa (403 out_of_context/opening_required) em vez de uma página de erro.
async function binaryFetch(url: string, accept: string): Promise<SignatureFile> {
  const res = await fetch(url, { credentials: "include", headers: { Accept: accept } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    if (text) { try { body = JSON.parse(text); } catch { /* deixa string */ } }
    throw new ApiError(res.status, body, `${res.status} on ${url}`);
  }
  return { blob: await res.blob(), filename: filenameFromDisposition(res.headers.get("Content-Disposition")) };
}

export function fetchSignatureFile(id: string, kind: SignatureFileKind): Promise<SignatureFile> {
  return binaryFetch(signaturePath("signatures", id, kind), kind === "pdf" ? "application/pdf" : "application/zip");
}

export function getSignatureOverview(q: { from: string; to: string }): Promise<SignatureOverview> {
  const params = new URLSearchParams({ from: q.from, to: q.to });
  return jsonFetch(`${signaturePath("admin", "overview")}?${params.toString()}`);
}

// ─── Documentos clínicos (módulo 19c, ADR 0033; contrato 2026-10-09 §1–§7) ───
// CID, medicamentos, posologia, motivo e nomes só no corpo de POST/PUT, nunca
// em URL: as rotas levam só ids. Toda escrita por cookie leva JSON, inclusive
// o DELETE (corpo `{}`). A recepção só chama a declaração. As formas de
// entrada (`*Input`) são as da Divergência D1: o api deriva o resto
// (descrição impressa, item do catálogo, antimicrobiano, vias, validade, CNPJ,
// protocolo, rótulo do CID, nome da unidade e os exames da consulta).

const CLINICAL_DOCUMENTS_BASE = import.meta.env.VITE_CLINICAL_DOCUMENTS_BASE || "/clinical_documents";

export type DocumentKind = "sick_note" | "attendance_declaration" | "prescription" | "exam_requisition";
export type IssueMode = "digital" | "paper";
export type DocumentStatus = "issued" | "cancelled";
export type SickNoteType = "leave" | "companion";
export type CompanionReason = "clt_473_x" | "clt_473_xi" | "clt_473_xii" | "other";
export type DeclarationPeriod = "morning" | "afternoon" | "full_day";
export type MedicationRoute =
  | "oral" | "sublingual" | "topical" | "ophthalmic" | "otic" | "nasal" | "inhalation" | "vaginal" | "rectal"
  | "intramuscular" | "intravenous" | "subcutaneous" | "other";
export type MedicationStatus = "active" | "suspended";
export type MedicationOrigin = "prescription" | "external";

export interface CatalogItemRef {
  id: string; catmat_code: number; label: string; active_ingredient: string; strength: string; dosage_form: string | null;
  // Módulo 19d: lista da Portaria 344 e marca de anticonvulsivante (busca, REMUME, protocolo; não nos itens de documento).
  controlled_list?: ControlledList | string | null; anticonvulsant?: boolean;
}
export interface SickNoteContent {
  type: SickNoteType; days?: number; start_on?: string; companion_name?: string; companion_kinship?: string;
  companion_reason?: CompanionReason; cid10?: { code: string; label: string }; cid_authorized: boolean; note?: string | null;
}
export interface DeclarationContent {
  date: string; arrived_at?: string; left_at?: string; period?: DeclarationPeriod; unit_name: string;
  companion_name?: string; issuer_registration?: string;
}
export interface PrescriptionItem {
  position: number; catalog_item?: CatalogItemRef; free_text?: string; printed_description: string; quantity: number;
  quantity_unit: string; route: MedicationRoute; dosage_instructions: string; duration_days?: number; continuous: boolean;
  antimicrobial: boolean; reason_problem_id?: string;
}
export interface PrescriptionContent {
  items: PrescriptionItem[];
  nursing_protocol?: { id: string; title: string; number: string; year: number; version_id: string };
  city_cnpj?: string; antimicrobial: boolean; copies: 1 | 2; valid_until?: string;
  catalog_release?: string | null;
  // Módulo 19d (contrato §2): calculados pelo api; `sncr` só no modo digital.
  category?: PrescriptionCategory; sncr?: SncrNumberRef | null;
  patient_identification?: PatientIdentification | null; prescriber_contact?: PrescriberContact | null;
}
export interface ExamRequisitionContent {
  exams: { sigtap_code: string; label: string; competence: string; cid10_justification?: string }[]; note?: string | null;
}
export type DocumentContent = SickNoteContent | DeclarationContent | PrescriptionContent | ExamRequisitionContent
  | NotificationRecordContent;

// Item da renovação: o api monta com `.compact`; só position, printed_description,
// continuous e antimicrobial são garantidos, o resto é omitido (não vem null).
export interface RenewalItem {
  position: number; printed_description: string; continuous: true; antimicrobial: boolean;
  catalog_item?: CatalogItemRef; free_text?: string; quantity?: number; quantity_unit?: string; route?: MedicationRoute;
  dosage_instructions?: string; duration_days?: number; reason_problem_id?: string;
}

export interface DocumentAuthor { id: string; name: string; council: string | null; cbo_code: string | null }
export interface ClinicalDocument {
  id: string; kind: RecordedDocumentKind; status: DocumentStatus; issue_mode: IssueMode; issued_at: string;
  cancelled_at: string | null; cancel_reason: string | null; author: DocumentAuthor;
  patient: { id: string; display_name: string } | null; consultation_id: string | null; attendance_id: string;
  // Nulos no registro da Notificação de papel (contrato do 19d §3).
  short_code: string | null; verification_url: string | null; replaces_document_id: string | null;
  content: DocumentContent; signature: SignatureBlock | null;
  // Módulo 19d: por que saiu em papel (null no digital e no que voltou ao papel).
  paper_reason?: PaperReason | string | null;
}

export interface SickNoteInput {
  type: SickNoteType; days?: number; start_on?: string; companion_name?: string; companion_kinship?: string;
  companion_reason?: CompanionReason; cid10?: { code: string }; cid_authorized: boolean; note?: string;
}
export interface DeclarationInput {
  period?: DeclarationPeriod; arrived_at?: string; left_at?: string; companion_name?: string; issuer_registration?: string;
}
export interface PrescriptionItemInput {
  catalog_item?: { id: string }; free_text?: string; quantity: number; quantity_unit: string; route: MedicationRoute;
  dosage_instructions: string; duration_days?: number; continuous: boolean; reason_problem_id?: string;
}
export interface PrescriptionInput {
  items: PrescriptionItemInput[]; nursing_protocol?: { version_id: string };
  // Módulo 19d: só na receita de controle especial (sem CPF; o api usa o do cadastro).
  patient_identification?: PatientIdentificationInput;
}
export interface ExamRequisitionInput { note?: string }
export type DocumentInput =
  | { kind: "sick_note"; content: SickNoteInput }
  | { kind: "attendance_declaration"; content: DeclarationInput }
  | { kind: "prescription"; content: PrescriptionInput }
  | { kind: "exam_requisition"; content: ExamRequisitionInput };

export interface PatientMedication {
  id: string; catalog_item?: CatalogItemRef | null; free_text?: string | null; label: string; dosage_summary: string | null;
  continuous: boolean; status: MedicationStatus; origin: MedicationOrigin; started_on?: string | null; updated_at: string;
  // Módulo 27a (D23): última retirada na farmácia, só leitura.
  last_dispensed_on?: string | null;
}
export type MedicationChange =
  | { action: "add_external"; catalog_item_id?: string; free_text?: string; dosage_summary?: string; continuous: boolean }
  | { action: "suspend" | "reactivate"; medication_id: string };
export interface MedicationSearchItem extends CatalogItemRef { antimicrobial: boolean; controlled: boolean; in_network: boolean }

export interface CityDocumentsProfile { name: string; cnpj: string | null }
export interface RemumeEntry { catalog_item: CatalogItem; unit_ids: string[] }
export interface MaxDose { quantity: number; unit: string }
// Item do catálogo completo (api 248ecbf): leva as marcas, sem `in_network`.
export type CatalogItem = CatalogItemRef & { antimicrobial: boolean; controlled: boolean };
export interface ProtocolItem { catalog_item: CatalogItem; max_dose?: MaxDose | null }
export interface NursingProtocolVersion { id: string; version: number; valid_from: string; valid_until: string | null; items: ProtocolItem[] }
export interface NursingProtocol { id: string; title: string; number: string; year: number; current_version: NursingProtocolVersion | null }
export interface ProtocolVersionInput { valid_from: string; valid_until?: string; items: { catalog_item_id: string; max_dose?: MaxDose }[] }
export interface NursingProtocolInput extends ProtocolVersionInput { title: string; number: string; year: number }

const attendanceDocPath = (...parts: string[]) => [ ATTENDANCE_BASE, ...parts.map(encodeURIComponent) ].join("/");
const cityDocPath = (...parts: string[]) => [ CLINICAL_DOCUMENTS_BASE, ...parts.map(encodeURIComponent) ].join("/");

// Ler gera a trilha no api (regras de leitura do 19a).
export async function listConsultationDocuments(consultationId: string): Promise<ClinicalDocument[]> {
  return (await jsonFetch<{ items: ClinicalDocument[] }>(attendanceDocPath("consultations", consultationId, "documents"))).items;
}

// Estado da lista para o polling (A46): sem conteúdo e sem trilha de leitura.
export interface DocumentStatusRow { id: string; status: DocumentStatus; signature_mode: string | null }
export async function listConsultationDocumentStatus(consultationId: string): Promise<DocumentStatusRow[]> {
  return (await jsonFetch<{ items: DocumentStatusRow[] }>(attendanceDocPath("consultations", consultationId, "documents", "status"))).items;
}

export function issueDocument(consultationId: string, input: DocumentInput, replacesDocumentId?: string): Promise<ClinicalDocument> {
  return jsonFetch(attendanceDocPath("consultations", consultationId, "documents"), postProfessional({
    kind: input.kind, content: input.content, ...(replacesDocumentId ? { replaces_document_id: replacesDocumentId } : {})
  }));
}

// api#59: a declaração é da unidade escolhida no seletor (health_unit_id).
export function issueAttendanceDeclaration(attendanceId: string, content: DeclarationInput, healthUnitId: string): Promise<ClinicalDocument> {
  return jsonFetch(attendanceDocPath("attendances", attendanceId, "declarations"), postProfessional({ content, health_unit_id: healthUnitId }));
}

// api#59: só metadados (sem conteúdo); o api grava a leitura (declaration_list).
export interface DeclarationRow {
  id: string; status: DocumentStatus; issued_at: string; cancelled_at: string | null; short_code: string | null;
  attendance_id: string; author: { id: string; name: string }; patient: { display_name: string | null } | null;
}

const unitQuery = (healthUnitId?: string) => (healthUnitId ? `?${new URLSearchParams({ health_unit_id: healthUnitId })}` : "");

export async function listAttendanceDeclarations(attendanceId: string, healthUnitId: string): Promise<DeclarationRow[]> {
  return (await jsonFetch<{ items: DeclarationRow[] }>(attendanceDocPath("attendances", attendanceId, "declarations") + unitQuery(healthUnitId))).items;
}

export async function listUnitDeclarations(healthUnitId: string, date: string): Promise<DeclarationRow[]> {
  const query = new URLSearchParams({ health_unit_id: healthUnitId, date });
  return (await jsonFetch<{ items: DeclarationRow[] }>(`${attendanceDocPath("declarations")}?${query}`)).items;
}

export function getClinicalDocument(id: string): Promise<ClinicalDocument> {
  return jsonFetch(attendanceDocPath("documents", id));
}

// PDF lido com fetch (e não por navegação) para a tela mostrar a recusa.
// A recepção imprime declarações da unidade dela (api#59): manda a unidade.
export function fetchDocumentPdf(id: string, healthUnitId?: string): Promise<SignatureFile> {
  return binaryFetch(attendanceDocPath("documents", id, "print") + unitQuery(healthUnitId), "application/pdf");
}

// Step-up: quem trata 401 mfa_required é o SensitiveAction.
export function cancelDocument(id: string, reason: string, healthUnitId?: string): Promise<ClinicalDocument> {
  return jsonFetch(attendanceDocPath("documents", id, "cancel"),
    postProfessional({ reason, ...(healthUnitId ? { health_unit_id: healthUnitId } : {}) }));
}

export async function listPatientMedications(patientId: string): Promise<PatientMedication[]> {
  return (await jsonFetch<{ items: PatientMedication[] }>(attendanceDocPath("patients", patientId, "medications"))).items;
}

export function changeMedication(consultationId: string, change: MedicationChange): Promise<PatientMedication> {
  return jsonFetch(attendanceDocPath("consultations", consultationId, "medications"), postProfessional(change));
}

export async function getPrescriptionRenewal(consultationId: string): Promise<RenewalItem[]> {
  return (await jsonFetch<{ items: RenewalItem[] }>(attendanceDocPath("consultations", consultationId, "renewal"))).items;
}

export async function searchMedications(q: string, unitId?: string): Promise<MedicationSearchItem[]> {
  const body = unitId ? { q, unit_id: unitId } : { q };
  return (await jsonFetch<{ items: MedicationSearchItem[] }>(attendanceDocPath("medications", "search"), postProfessional(body))).items;
}

export function getCityDocumentsProfile(): Promise<CityDocumentsProfile> {
  return jsonFetch(cityDocPath("city_profile"));
}

export function setCityCnpj(cnpj: string): Promise<CityDocumentsProfile> {
  return jsonFetch(cityDocPath("city_profile"), { method: "PUT", body: JSON.stringify({ cnpj }) });
}

export async function listRemume(): Promise<RemumeEntry[]> {
  return (await jsonFetch<{ items: RemumeEntry[] }>(cityDocPath("remume"))).items;
}

export function addRemumeItem(catalogItemId: string, unitIds?: string[]): Promise<RemumeEntry> {
  const body = unitIds && unitIds.length > 0 ? { catalog_item_id: catalogItemId, unit_ids: unitIds } : { catalog_item_id: catalogItemId };
  return jsonFetch(cityDocPath("remume"), postProfessional(body));
}

export async function removeRemumeItem(catalogItemId: string): Promise<void> {
  await jsonFetch<void>(cityDocPath("remume", catalogItemId), { ...postProfessional({}), method: "DELETE" });
}

export async function listNursingProtocols(): Promise<NursingProtocol[]> {
  return (await jsonFetch<{ items: NursingProtocol[] }>(cityDocPath("nursing_protocols"))).items;
}

export function createNursingProtocol(input: NursingProtocolInput): Promise<NursingProtocol> {
  return jsonFetch(cityDocPath("nursing_protocols"), postProfessional(input));
}

export function addNursingProtocolVersion(id: string, input: ProtocolVersionInput): Promise<NursingProtocol> {
  return jsonFetch(cityDocPath("nursing_protocols", id, "versions"), postProfessional(input));
}

// api#61: o histórico, da mais nova para a mais antiga, com a situação de hoje.
export type ProtocolVersionSituation = "vigente" | "agendada" | "encerrada";
export interface NursingProtocolVersionRow extends NursingProtocolVersion { situation: ProtocolVersionSituation }

export async function listNursingProtocolVersions(id: string): Promise<NursingProtocolVersionRow[]> {
  return (await jsonFetch<{ items: NursingProtocolVersionRow[] }>(cityDocPath("nursing_protocols", id, "versions"))).items;
}

// ─── Receita de controlado e SNCR (módulo 19d, ADR 0034; contrato 2026-10-10 §1–§7) ───
// CPF, endereço, telefone, número SNCR, `state` e `session_id` só no corpo de
// POST/PUT, nunca em URL: as rotas levam só ids. O token do SNCR nunca passa
// pelo navegador: o serviço de login da Anvisa faz o gov.br e devolve um
// `session_id` de uso único, que o api troca pelo token. Toda escrita leva JSON
// (o jsonFetch põe o Content-Type quando há corpo).

const SNCR_BASE = import.meta.env.VITE_SNCR_BASE || "/sncr";

export type PrescriptionCategory = "common" | "special_control" | "antimicrobial";
export type SncrKind = "rce" | "ret";
export type ControlledList = "A1" | "A2" | "A3" | "B1" | "B2" | "C1" | "C2" | "C3" | "C4" | "C5";
export type NotificationType = "A" | "B" | "B2";
export type PaperReason =
  "no_certificate" | "signature_unavailable" | "no_sncr_number" | "nurse_antimicrobial" | "feature_disabled" | "free_text_items";
export type RecordedDocumentKind = DocumentKind | "controlled_notification_record";

export interface SncrAddress {
  street: string; number: string; complement?: string | null; district: string; city: string; uf: string; zip: string;
}
export interface SncrNumberRef { kind: SncrKind; number: string; simulated: boolean }
// O CPF vem do cadastro (mascarado ou nulo se o cadastro não tem CPF válido).
export interface PatientIdentification { cpf: string | null; address: SncrAddress }
// A entrada não leva o CPF: o api usa o do cadastro.
export interface PatientIdentificationInput { address: SncrAddress }
export interface PrescriberContact { address: SncrAddress; phone: string }
// Sem perfil de profissional → 404; com perfil e sem endereço → `{ address: null, phone }` (phone também pode ser null).
export interface ProfessionalContact { address: SncrAddress | null; phone: string | null }

export interface NotificationRecordInput {
  notification_type: NotificationType; paper_number: string; numbering_uf: string;
  item: {
    catalog_item: { id: string }; quantity: number; quantity_unit: string; route: MedicationRoute;
    dosage_instructions: string; duration_days: number;
  };
}
// Item do registro como o api devolve: sem position, continuous e antimicrobial; catalog_item sem marcas.
export interface NotificationRecordItem {
  catalog_item: CatalogItemRef; printed_description: string; quantity: number; quantity_unit: string; route: MedicationRoute;
  dosage_instructions: string; duration_days: number;
}
export interface NotificationRecordContent {
  notification_type: NotificationType; paper_number: string; numbering_uf: string; item: NotificationRecordItem;
}

export interface SncrStockKind { free: number; used: number; voided: number; requests_this_month: number }
export interface SncrStock { rce: SncrStockKind; ret: SncrStockKind; low_threshold: number; simulated: boolean }
// O `state` volta na resposta: a volta da Anvisa não o traz.
export interface SncrAuthorizeRedirect { authorize_url: string; state: string }
export interface SncrCallbackResult { kind: SncrKind; received: number; batch_id: string; return_to?: string }
export interface SncrOverviewProfessional {
  user_id: string; name: string; rce_free: number; ret_free: number; low: boolean; last_request_at: string | null;
}
export interface SncrOverview { professionals: SncrOverviewProfessional[]; simulated: boolean }

const sncrPath = (...parts: string[]) => [ SNCR_BASE, ...parts.map(encodeURIComponent) ].join("/");
const CONTACT_PATH = `${ATTENDANCE_BASE}/professional_profile/contact`;

export function getSncrStock(): Promise<SncrStock> {
  return jsonFetch(sncrPath("stock"));
}

// Vai ao login da Anvisa (gov.br do próprio prescritor); o api guarda o state.
export function requestSncrNumbers(kind: SncrKind, returnTo: string): Promise<SncrAuthorizeRedirect> {
  return jsonFetch(sncrPath("requests"), postProfessional({ kind, return_to: returnTo }));
}

// `answer` é o `session_id` da volta. A recusa também vai ao api, como `{ state, error }`.
export function completeSncrOAuth(state: string, answer: string | { error: string }): Promise<SncrCallbackResult> {
  const body = typeof answer === "string" ? { state, session_id: answer } : { state, error: answer.error };
  return jsonFetch(sncrPath("oauth", "callback"), postProfessional(body));
}

export function getSncrOverview(): Promise<SncrOverview> {
  return jsonFetch(sncrPath("admin", "overview"));
}

export function getProfessionalContact(): Promise<ProfessionalContact> {
  return jsonFetch(CONTACT_PATH);
}

export function saveProfessionalContact(contact: { address: SncrAddress; phone: string }): Promise<ProfessionalContact> {
  return jsonFetch(CONTACT_PATH, { method: "PUT", body: JSON.stringify(contact) });
}

export function recordNotification(consultationId: string, content: NotificationRecordInput): Promise<ClinicalDocument> {
  return jsonFetch(attendanceDocPath("consultations", consultationId, "documents"),
    postProfessional({ kind: "controlled_notification_record", content }));
}

// "Reaproveitar o último": a identificação da última receita do paciente, pela
// consulta (autora). Nenhuma anterior = 200 com null; o 404 é "consulta não
// encontrada" e, como o 403, sobe para a tela tratar.
export async function getLastPatientIdentification(consultationId: string): Promise<PatientIdentification | null> {
  return (await jsonFetch<{ patient_identification: PatientIdentification | null }>(
    attendanceDocPath("consultations", consultationId, "patient_identification"))).patient_identification;
}

// ─── Linha do tempo do paciente (módulo 20, ADR 0035; contrato 2026-10-11 §1–§3) ───
// Só ids, tipos, datas e o cursor na URL — nunca CPF, nome ou texto. Ler gera
// a trilha `clinical_record.viewed` com access "timeline" no api; quem lê e o
// que entra na pessoa é do api (ClinicalRecord::Access generalizado).

export type TimelineKind =
  | "triage" | "attendance" | "screening" | "appointment" | "consultation"
  | "clinical_document" | "controlled_notification" | "campaign" | "exam" | "procedure"
  // Módulo 27a (D22): retirada na farmácia (o api manda detail_ref nulo e status "dispensed").
  | "dispensation"
  // Módulo 29 (D11; V10): dose de vacina, com detail_ref { type: "immunization", id }.
  | "vaccination"
  // Módulo 30 (D12): viagem e TFD, detail_ref nulo.
  | "transport"
  // Módulo 31 (D18; P18, P46, P51): marcador "Acompanhamento no CAPS", sem nome do CAPS, unit e detail_ref nulos.
  | "psychosocial_link"
  // Módulo 32a (§10, Q27): passagem pela UPA; detail_ref { type: "consultation", id } da consulta finalizada, ou nulo.
  | "urgency";

export interface TimelineDetailRef { type: string; id: string }
export interface TimelineEntry {
  id: string; kind: TimelineKind | string; occurred_at: string;
  unit: { id: string; name: string } | null;
  professional: { name: string; cbo_code: string | null } | null;
  // title e summary em português, prontos; status é o código da origem
  // (finalized, issued, confirmed…), traduzido na tela (Divergência D3).
  title: string; summary: string | null; status: string | null;
  // Rótulo pronto do api, se vier (usado só para situação sem tradução aqui).
  status_label?: string | null;
  // Divergência D2: nulo (ou tipo sem tela) = a entrada não abre detalhe.
  detail_ref: TimelineDetailRef | null;
  // Módulo 32b: só nas entradas "urgency" (inteiro; nulo sem observação). O summary já traz "observação N h".
  observation_hours?: number | null;
}
export interface TimelinePerson { display_name: string; partial: boolean; patient_id: string | null }
export interface TimelinePage { person: TimelinePerson; entries: TimelineEntry[]; next_before: string | null }
// Em contexto (atendimento), pela abertura justificada ou pelo paciente.
export type TimelineSubject = { attendanceId: string } | { patientId: string } | { openingId: string };
// `kinds` vazio = todos; datas AAAA-MM-DD ou "".
export interface TimelineFilters { kinds: TimelineKind[]; from: string; to: string }
export const TIMELINE_PAGE_SIZE = 50;

export function getTimeline(subject: TimelineSubject, filters: TimelineFilters, before: string | null): Promise<TimelinePage> {
  const params = new URLSearchParams();
  if ("attendanceId" in subject) params.set("attendance_id", subject.attendanceId);
  else if ("patientId" in subject) params.set("patient_id", subject.patientId);
  else params.set("opening_id", subject.openingId);
  for (const kind of filters.kinds) params.append("kinds[]", kind);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (before) params.set("before", before);
  params.set("limit", String(TIMELINE_PAGE_SIZE));
  return jsonFetch(`${ATTENDANCE_BASE}/timeline?${params.toString()}`);
}

// ─── Rascunhos de consulta abertos (fix51, api#51) ───────────────────────────
// Só municipal_admin. Listagem e candidatos não têm conteúdo clínico (sem
// step-up); descartar e designar exigem (quem trata 401 mfa_required é o
// SensitiveAction). Motivo e user_id vão no corpo, nunca na URL.
export async function listOpenDrafts(): Promise<OpenDraft[]> {
  return (await jsonFetch<{ drafts: OpenDraft[] }>(`${CLINICAL_RECORD_BASE}/consultation_drafts`)).drafts;
}

export async function listDraftCandidates(id: string): Promise<DraftCandidate[]> {
  return (await jsonFetch<{ candidates: DraftCandidate[] }>(
    `${CLINICAL_RECORD_BASE}/consultation_drafts/${encodeURIComponent(id)}/candidates`)).candidates;
}

export function discardDraft(id: string, reason: string): Promise<{ consultation_id: string; status: "discarded" }> {
  return jsonFetch(`${CLINICAL_RECORD_BASE}/consultation_drafts/${encodeURIComponent(id)}/discard`,
    { method: "POST", body: JSON.stringify({ reason }) });
}

export function reassignDraft(id: string, userId: string, reason: string):
  Promise<{ consultation_id: string; author: { user_id: string; name: string } }> {
  return jsonFetch(`${CLINICAL_RECORD_BASE}/consultation_drafts/${encodeURIComponent(id)}/reassign`,
    { method: "POST", body: JSON.stringify({ user_id: userId, reason }) });
}

// ─── Exames (módulo 21a, ADR 0036; contrato 2026-10-13 §1–§10) ───────────────
// Na URL só ids, códigos SIGTAP, situações, etapas, mês e o cursor — CPF,
// nome, motivo e valores de resultado vão no corpo. Arquivo (guia, laudo)
// sobe em JSON com base64 e SEM o nome do arquivo (Divergência D1). Ler um
// exame grava a trilha no api; quem lê o quê é do api (regras do 19a e o
// isolamento do prestador).

const EXAMS_BASE = import.meta.env.VITE_EXAMS_BASE || "/exams";

export type ExamPriority = "routine" | "urgent";
export type ExamOrigin = "consultation" | "reception_guide" | "pec";
export type ExamStatus =
  | "awaiting_authorization" | "denied" | "awaiting_schedule" | "scheduled" | "collected" | "resulted" | "acknowledged" | "cancelled";
export type ExamStage = "authorize" | "schedule" | "collect" | "result" | "acknowledge";
export type ExamEventKind =
  | "requested" | "authorized" | "denied" | "scheduled" | "collected" | "resulted" | "acknowledged" | "escalated" | "cancelled";
export type ExamReleasePolicy = "immediate" | "after_acknowledgement" | "never_citizen";
export type ExamProviderKind = "municipal" | "accredited" | "consortium" | "lacen" | "imaging";
export type ExamDeadlines = Record<ExamStage, number | null>;

export interface ExamResultField { key: string; label: string; unit: string | null; loinc: string | null }
export interface ExamResultValue { key: string | null; label: string; value: string; unit: string | null; loinc: string | null }
// Visão clínica (quem pediu, leitura do 19a, equipe) traz tudo; a visão
// administrativa (unidade, regulador — plano do api, Desvio 10) só traz id,
// origem, fonte, data e laboratório: valores, crítico e laudo ausentes.
export interface ExamResult {
  id: string; origin: "order" | "external"; source: "unit" | "provider" | "fhir" | "consultation" | "lab";
  released_on: string; laboratory_name: string; critical?: boolean; values?: ExamResultValue[];
  // Módulo 21b (contrato §9): o resultado que este substitui (retificação) e, nos substituídos,
  // quando deixaram de valer. Só na visão clínica.
  replaces_result_id?: string | null; superseded_at?: string | null;
  // Curta e assinada (5 min); o download grava trilha.
  pdf_url?: string; acknowledged_at?: string | null;
}
// Divergência D8: o resultado externo listado traz o exame.
export interface ExternalExamResult extends ExamResult { sigtap_code: string; label: string }
// A16/A28: o job de atraso/crítico grava ator `system` sem nome. `reason` de
// `escalated` é um código (overdue | critical | unlinked_requester), só na
// visão clínica; negar/cancelar levam o motivo nas duas visões.
export interface ExamEvent {
  kind: ExamEventKind | string; occurred_at: string;
  actor: { type: "user" | "provider" | "system"; name: string | null }; reason: string | null;
}
export interface ExamOverdue { stage: ExamStage; due_on: string; days_late: number }
export interface ExamOrder {
  id: string; short_code: string; patient: { id: string; display_name: string };
  sigtap_code: string; sigtap_competence: string; label: string; priority: ExamPriority;
  cid10_justification: string | null; origin: ExamOrigin | string;
  requester: { user_id: string | null; name: string; cns: string | null };
  unit: { id: string; name: string }; provider: { id: string; name: string } | null;
  scheduled_at: string | null; scheduled_place: string | null; external_reference: string | null;
  status: ExamStatus | string; status_changed_at: string; overdue: ExamOverdue | null; escalated: boolean;
  // B63: motivos gravados (A31), só na visão clínica; null na administrativa.
  escalation_reasons?: string[] | null;
  result: ExamResult | null;
  // Presentes em toda lista e detalhe. Na visão administrativa (guia, resultado,
  // regulação, fila da unidade) `cid10_justification` e `requester.cns` vêm null.
  consultation_id: string | null;
  // Pedido da consulta que originou a ordem; null na guia da recepção e no PEC.
  consultation_exam_request_id: string | null;
  // URL curta e assinada da guia (/exams/files/<token>); null sem guia.
  guide_url?: string | null;
  // Só no GET /exams/orders/:id (e nas respostas de ação que devolvem o detalhe).
  events?: ExamEvent[]; result_fields?: ExamResultField[];
  // Módulo 21b (Divergência D16): laudos substituídos por retificação, do mais novo para o mais antigo; só na visão clínica.
  superseded_results?: ExamResult[];
  // F-21.24 (Divergência D17): número da requisição no GAL; null sem registro.
  gal_requisition?: string | null;
}
export interface ExamOrderPage { orders: ExamOrder[]; next_before: string | null }
export interface ExamOrderQuery {
  patientId?: string; unitId?: string; consultationId?: string; statuses?: ExamStatus[];
  overdue?: boolean; stage?: ExamStage | ""; providerId?: string; sigtapCode?: string; before?: string | null;
}
export const EXAM_PAGE_SIZE = 50;

// Módulo 24a (L8): `has_cpf` e o CNS mascarado (`Patients::IdentifierJson`).
export interface ExamPatient { id: string; display_name: string; cpf_masked: string | null; has_cpf?: boolean; cns_masked?: string | null }
export interface ExamCatalogEntry { sigtap_code: string; label: string; result_fields: ExamResultField[] }
export interface ExamProviderRef { id: string; name: string }
export interface ExamRequester { user_id: string; name: string }

// Divergência D16: a guia é da unidade escolhida (`unit_id`).
export interface ReceptionOrderInput {
  patient_id: string; unit_id: string; sigtap_code: string; priority: ExamPriority; cid10_justification?: string;
  requester: { user_id: string } | { name: string; cns: string }; external_reference?: string; guide_upload_id: string;
}
export interface ScheduleWhen { scheduled_at: string; scheduled_place: string }
export interface ScheduleInput extends ScheduleWhen { provider_id: string }
export interface ResultInput {
  upload_id: string; released_on: string; laboratory_name: string; critical: boolean; values: { key: string; value: string }[];
}
export interface ExternalResultInput {
  patient_id: string; sigtap_code: string; released_on: string; laboratory_name: string; upload_id: string;
  values: { key: string; value: string }[]; consultation_id?: string;
}
// `orders` é paginado (50); `denied` são as negadas dos últimos 30 dias (até 50).
// `denied_reason` (A47) só vem nas negadas; null sem motivo registrado.
export type DeniedExamOrder = ExamOrder & { denied_reason?: string | null };
export interface PendingAcknowledgements { orders: ExamOrder[]; denied: DeniedExamOrder[]; next_before: string | null }
// A46: só contagens (sem dado clínico e sem trilha de leitura). `pending` é exato;
// `has_more` = a lista passa de uma página (50); `denied` é limitado a 50.
export interface PendingAcknowledgementCount { pending: number; has_more: boolean; denied: number }

export interface ExamCatalogItem {
  id: string; sigtap_code: string; label: string; requires_authorization: boolean; release_policy: ExamReleasePolicy;
  deadlines: ExamDeadlines; result_fields: ExamResultField[]; active: boolean;
}
export type ExamCatalogItemInput = Omit<ExamCatalogItem, "id" | "label">;
export interface ExamProviderItem { catalog_item_id: string; deadlines: ExamDeadlines }
export interface ExamProvider {
  id: string; name: string; cnes: string | null; kind: ExamProviderKind; active: boolean;
  items: (ExamProviderItem & { sigtap_code: string })[];
  // O token nunca volta: só se existe um ativo e quando foi gerado.
  has_fhir_token: boolean; fhir_token_rotated_at: string | null;
  // Laboratório simulado (fora de produção).
  simulated: boolean;
  users: { user_id: string; email: string }[];
  // Módulo 21b: o laboratório usa o fluxo analítico do Rota Saúde (resultado pela liberação, nunca pelo portal
  // nem pelo FHIR) e se tem token de middleware. B31: endereço e telefone (obrigatórios com uses_municipal_lab).
  uses_municipal_lab?: boolean; has_middleware_token?: boolean; address?: string | null; phone?: string | null;
}
// Corpo de POST/PATCH: `simulated`, token e usuários não se escrevem aqui.
export type ExamProviderInput = Pick<ExamProvider, "name" | "cnes" | "kind" | "active"> & {
  items: ExamProviderItem[]; uses_municipal_lab?: boolean; address?: string | null; phone?: string | null;
};
export interface ExamReportRow {
  provider: ExamProviderRef; authorized: number; collected: number; resulted_on_time: number; resulted_late: number; pending: number;
}
export interface ProviderOrder {
  id: string; short_code: string; patient: { name: string; birth_date: string; cpf_last3: string };
  sigtap_code: string; label: string; priority: ExamPriority; status: ExamStatus | string;
  scheduled_at: string | null; scheduled_place: string | null; overdue: ExamOverdue | null;
  // Divergência D6.
  result_fields?: ExamResultField[];
}
// `overdue_count` vem no corpo (A20; o cabeçalho X-Overdue-Count repete).
export interface ProviderOrderPage { orders: ProviderOrder[]; next_before: string | null; overdue_count: number }
export interface ProviderOrderQuery { statuses?: ExamStatus[]; overdue?: boolean; before?: string | null }

export const EXAM_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;
export const EXAM_UPLOAD_TYPES = [ "application/pdf", "image/jpeg", "image/png" ] as const;

const examPath = (...parts: string[]) => [ EXAMS_BASE, ...parts.map(encodeURIComponent) ].join("/");
const withQuery = (path: string, params: URLSearchParams) => (params.toString() ? `${path}?${params.toString()}` : path);

function orderParams(q: ExamOrderQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.patientId) p.set("patient_id", q.patientId);
  if (q.unitId) p.set("unit_id", q.unitId);
  if (q.consultationId) p.set("consultation_id", q.consultationId);
  for (const s of q.statuses ?? []) p.append("status[]", s);
  if (q.overdue) p.set("overdue", "true");
  if (q.stage) p.set("stage", q.stage);
  if (q.providerId) p.set("provider_id", q.providerId);
  if (q.sigtapCode) p.set("sigtap_code", q.sigtapCode);
  if (q.before) p.set("before", q.before);
  p.set("limit", String(EXAM_PAGE_SIZE));
  return p;
}

export function listExamOrders(q: ExamOrderQuery): Promise<ExamOrderPage> {
  return jsonFetch(withQuery(examPath("orders"), orderParams(q)));
}

export function getExamOrder(id: string): Promise<ExamOrder> {
  return jsonFetch(examPath("orders", id));
}

export async function lookupExamPatient(cpf: string): Promise<ExamPatient> {
  return (await jsonFetch<{ patient: ExamPatient }>(examPath("patient_lookup"), postProfessional({ cpf }))).patient;
}

export async function listExamCatalog(): Promise<ExamCatalogEntry[]> {
  return (await jsonFetch<{ items: ExamCatalogEntry[] }>(examPath("catalog"))).items;
}

export async function listEnabledProviders(sigtapCode?: string): Promise<ExamProviderRef[]> {
  const p = new URLSearchParams();
  if (sigtapCode) p.set("sigtap_code", sigtapCode);
  return (await jsonFetch<{ providers: ExamProviderRef[] }>(withQuery(examPath("providers"), p))).providers;
}

export async function listExamRequesters(unitId: string): Promise<ExamRequester[]> {
  const p = new URLSearchParams({ unit_id: unitId });
  return (await jsonFetch<{ requesters: ExamRequester[] }>(withQuery(examPath("requesters"), p))).requesters;
}

export function createReceptionOrder(input: ReceptionOrderInput): Promise<ExamOrder> {
  return jsonFetch(examPath("orders"), postProfessional(input));
}

function readBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result);
      resolve(text.slice(text.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error ?? new Error("read_failed"));
    reader.readAsDataURL(file);
  });
}

// Só o tipo e o conteúdo: o nome do arquivo pode trazer o nome do paciente.
export async function uploadExamFile(file: File): Promise<string> {
  const data = await readBase64(file);
  return (await jsonFetch<{ upload_id: string }>(examPath("uploads"), postProfessional({ content_type: file.type, data }))).upload_id;
}

export async function scheduleExam(id: string, input: ScheduleInput): Promise<void> {
  await jsonFetch<unknown>(examPath("orders", id, "schedule"), postProfessional(input));
}

export async function collectExam(id: string): Promise<void> {
  await jsonFetch<unknown>(examPath("orders", id, "collect"), postProfessional({}));
}

export async function cancelExam(id: string, reason: string): Promise<void> {
  await jsonFetch<unknown>(examPath("orders", id, "cancel"), postProfessional({ reason }));
}

export async function registerExamResult(id: string, input: ResultInput): Promise<void> {
  await jsonFetch<unknown>(examPath("orders", id, "result"), postProfessional(input));
}

export async function acknowledgeExam(id: string, reason?: string): Promise<void> {
  await jsonFetch<unknown>(examPath("orders", id, "acknowledge"), postProfessional(reason ? { reason } : {}));
}

export async function listPendingAcknowledgements(before: string | null = null): Promise<PendingAcknowledgements> {
  const p = new URLSearchParams();
  if (before) p.set("before", before);
  p.set("limit", String(EXAM_PAGE_SIZE));
  const body = await jsonFetch<{ orders: ExamOrder[]; denied?: DeniedExamOrder[]; next_before?: string | null }>(
    withQuery(examPath("acknowledgements", "pending"), p));
  return { orders: body.orders, denied: body.denied ?? [], next_before: body.next_before ?? null };
}

export async function countPendingAcknowledgements(): Promise<PendingAcknowledgementCount> {
  const body = await jsonFetch<Partial<PendingAcknowledgementCount>>(examPath("acknowledgements", "pending", "count"));
  return { pending: body.pending ?? 0, has_more: !!body.has_more, denied: body.denied ?? 0 };
}

// 403 `not_in_team` = o profissional não está em equipe de referência ativa.
export function listTeamAcknowledgements(before: string | null = null): Promise<ExamOrderPage> {
  const p = new URLSearchParams();
  if (before) p.set("before", before);
  p.set("limit", String(EXAM_PAGE_SIZE));
  return jsonFetch(withQuery(examPath("acknowledgements", "team"), p));
}

export function recordExternalResult(input: ExternalResultInput): Promise<ExamResult> {
  return jsonFetch(examPath("external_results"), postProfessional(input));
}

export async function listExternalResults(patientId: string): Promise<ExternalExamResult[]> {
  const p = new URLSearchParams({ patient_id: patientId });
  return (await jsonFetch<{ results: ExternalExamResult[] }>(withQuery(examPath("external_results"), p))).results;
}

export function listRegulationQueue(before: string | null): Promise<ExamOrderPage> {
  const p = new URLSearchParams();
  if (before) p.set("before", before);
  p.set("limit", String(EXAM_PAGE_SIZE));
  return jsonFetch(withQuery(examPath("regulation", "queue"), p));
}

export async function authorizeExam(id: string, providerId: string): Promise<void> {
  await jsonFetch<unknown>(examPath("orders", id, "authorize"), postProfessional({ provider_id: providerId }));
}

export async function denyExam(id: string, reason: string): Promise<void> {
  await jsonFetch<unknown>(examPath("orders", id, "deny"), postProfessional({ reason }));
}

// Admin municipal; toda escrita com step-up (quem trata 401 mfa_required é o SensitiveAction).
export async function listCatalogItems(): Promise<ExamCatalogItem[]> {
  return (await jsonFetch<{ items: ExamCatalogItem[] }>(examPath("admin", "catalog_items"))).items;
}

export function createCatalogItem(input: ExamCatalogItemInput): Promise<ExamCatalogItem> {
  return jsonFetch(examPath("admin", "catalog_items"), postProfessional(input));
}

// C17: o código SIGTAP é a identidade do item; o PATCH nunca o manda.
export function updateCatalogItem(id: string, input: ExamCatalogItemInput): Promise<ExamCatalogItem> {
  const { sigtap_code: _identity, ...rest } = input;
  return jsonFetch(examPath("admin", "catalog_items", id), { method: "PATCH", body: JSON.stringify(rest) });
}

export async function listExamProviders(): Promise<ExamProvider[]> {
  return (await jsonFetch<{ providers: ExamProvider[] }>(examPath("admin", "providers"))).providers;
}

export function createExamProvider(input: ExamProviderInput): Promise<ExamProvider> {
  return jsonFetch(examPath("admin", "providers"), postProfessional(input));
}

export function updateExamProvider(id: string, input: ExamProviderInput): Promise<ExamProvider> {
  return jsonFetch(examPath("admin", "providers", id), { method: "PATCH", body: JSON.stringify(input) });
}

// Mostrado uma vez: quem chama guarda só no estado do componente.
export async function rotateFhirToken(id: string): Promise<string> {
  return (await jsonFetch<{ token: string }>(examPath("admin", "providers", id, "fhir_token"), postProfessional({}))).token;
}

export async function revokeFhirToken(id: string): Promise<void> {
  await jsonFetch<unknown>(examPath("admin", "providers", id, "fhir_token"), { method: "DELETE", body: "{}" });
}

export function inviteProviderUser(id: string, email: string): Promise<Invitation> {
  return jsonFetch(examPath("admin", "providers", id, "users"), postProfessional({ email }));
}

function reportParams(month: string, providerId: string | null): URLSearchParams {
  const p = new URLSearchParams({ month });
  if (providerId) p.set("provider_id", providerId);
  return p;
}

export async function getExamReport(month: string, providerId: string | null): Promise<ExamReportRow[]> {
  return (await jsonFetch<{ rows: ExamReportRow[] }>(withQuery(examPath("admin", "report"), reportParams(month, providerId)))).rows;
}

export function fetchExamReportCsv(month: string, providerId: string | null, detail: boolean): Promise<SignatureFile> {
  const p = reportParams(month, providerId);
  if (detail) p.set("detail", "true");
  return binaryFetch(withQuery(examPath("admin", "report.csv"), p), "text/csv");
}

// Portal do prestador (contrato §6): guia de outro prestador = 404 not_found.
export async function listProviderOrders(q: ProviderOrderQuery): Promise<ProviderOrderPage> {
  const p = new URLSearchParams();
  for (const s of q.statuses ?? []) p.append("status[]", s);
  if (q.overdue) p.set("overdue", "true");
  if (q.before) p.set("before", q.before);
  p.set("limit", String(EXAM_PAGE_SIZE));
  const body = await jsonFetch<{ orders: ProviderOrder[]; next_before: string | null; overdue_count?: unknown }>(
    withQuery(examPath("provider", "orders"), p));
  const count = Number(body.overdue_count ?? 0);
  return { orders: body.orders, next_before: body.next_before, overdue_count: Number.isFinite(count) ? count : 0 };
}

// Divergência D9: o prestador é o do usuário; o corpo não leva provider_id.
export async function providerSchedule(id: string, input: ScheduleWhen): Promise<void> {
  await jsonFetch<unknown>(examPath("provider", "orders", id, "schedule"), postProfessional(input));
}

export async function providerCollect(id: string): Promise<void> {
  await jsonFetch<unknown>(examPath("provider", "orders", id, "collect"), postProfessional({}));
}

export async function providerResult(id: string, input: ResultInput): Promise<void> {
  await jsonFetch<unknown>(examPath("provider", "orders", id, "result"), postProfessional(input));
}

// O `pdf_url` vem pronto do api (curto e assinado); lido com fetch para a
// tela mostrar a recusa (link vencido) em vez de uma janela em branco.
export function fetchExamPdf(pdfUrl: string): Promise<SignatureFile> {
  return binaryFetch(pdfUrl, "application/pdf");
}

// C9: link vencido é 410 `link_expired`; 404 é não achado (token de outro
// usuário ou forjado) e 403 é só `feature_disabled` — nenhum dos dois é "vencido".
export function isExamLinkExpired(err: unknown): boolean {
  return err instanceof ApiError && err.status === 410 && errorCode(err) === "link_expired";
}

// ─── Laboratório municipal (módulo 21b; contrato 2026-10-15) ────────────────
// Fluxo analítico sobre o 21a: requisição, amostra, remessa, mapa, digitação,
// liberação e laudo. Na URL só ids, situações, setor, bancada, datas, mês,
// número da requisição, código de barras e o cursor; o resto vai no corpo.
const LAB_BASE = import.meta.env.VITE_LAB_BASE || "/lab";

export type BiologicalSex = "male" | "female";
export type LabCollectionPlace = "ubs" | "lab";
export type LabRequisitionStatus = "open" | "in_analysis" | "typed" | "released" | "delivered";
export type LabSampleStatus = "awaiting" | "in_transit" | "received" | "rejected" | "accepted_with_restriction" | "not_received";
export type LabShipmentStatus = "open" | "sent" | "received";
export type LabReportStatus = "pending_signature" | "released" | "rectified" | "withdrawn";
export type LabFlag = "normal" | "low" | "high" | "critical_low" | "critical_high";
export type LabSignatureKind = "icp" | "advanced";
export type LabItemStatus = "pending" | "typed" | "released" | "cancelled";
export type LabValueType = "numeric" | "text" | "choice";
export type LabReceiveDecision = "accept" | "reject" | "accept_with_restriction";
export type CriticalChannel = "telefone" | "presencial" | "sistema";
export const LAB_PAGE_SIZE = 50;

export interface LabProviderRef { id: string; name: string }
// Divergência D1 (21b) + C1 (21c): `technical_lead_of` = laboratórios em que a sessão é RT ou substituto ativo.
export interface LabContext { labs: LabProviderRef[]; releaser_of: string[]; council: string | null; technical_lead_of?: string[] }

export interface LabPatient { id: string; display_name: string; birth_date: string; biological_sex: BiologicalSex | string }
export interface LabItem {
  id: string; exam_order_id: string; sigtap_code: string; label: string; version: number;
  sample_id: string | null; status: LabItemStatus | string;
}
export interface LabSample {
  id: string; barcode: string; material: string; container: string; status: LabSampleStatus | string;
  collected_at: string | null; collected_by: string | null; received_at: string | null;
  rejection_reason: string | null; restriction_note: string | null; recollection_of_id: string | null; shipment_id: string | null;
}
export interface LabReportSummary {
  id: string; version: number; partial: boolean; status: LabReportStatus | string; signature_kind: LabSignatureKind | string;
  released_at: string | null; released_by: string | null; short_code: string | null; pdf_url: string | null;
  replaces_report_id: string | null;
  // Exames da requisição cobertos por este laudo (I2; o api acrescenta o campo).
  item_ids: string[];
}
export interface LabRequisition {
  id: string; number: string; patient: LabPatient; origin_unit: { id: string; name: string };
  collection_place: LabCollectionPlace | string; urgent: boolean; status: LabRequisitionStatus | string;
  expected_delivery_on: string | null; items: LabItem[]; samples: LabSample[]; reports: LabReportSummary[];
  delivered_to: string | null; delivered_at: string | null;
}
export type LabRequisitionRow = Omit<LabRequisition, "items" | "samples">;
export interface LabRequisitionPage { requisitions: LabRequisitionRow[]; next_before: string | null }
export interface LabRequisitionQuery {
  statuses?: LabRequisitionStatus[]; providerId?: string; originUnitId?: string; number?: string; barcode?: string; before?: string | null;
}
// Divergência D2: forma do candidato (exame do 21a sem item de requisição).
export interface LabCandidateOrder {
  id: string; short_code: string; sigtap_code: string; label: string; priority: ExamPriority; status: string; requester_name: string;
}
// Divergência D3 (21b) + C5 (21c): exames ativos do laboratório; `id` e `analytes` para CIQ, CEQ e lote em uso.
export interface LabExamRef { sigtap_code: string; name: string; material: string; delivery_days: number; id?: string; analytes?: { key: string; name: string }[] }
export interface LabPaperOrder { sigtap_code: string; requester: { user_id: string } | { name: string; cns: string } }
export interface LabRequisitionInput {
  patient_id: string; provider_id: string; origin_unit_id: string; collection_place: LabCollectionPlace;
  biological_sex: BiologicalSex; mother_name: string; urgent: boolean; clinical_info?: string;
  exam_order_ids: string[]; paper_orders?: LabPaperOrder[];
}
// Divergência D4: forma da remessa e da amostra dentro dela.
export interface LabShipmentSample { id: string; barcode: string; material: string; status: LabSampleStatus | string; requisition_number: string }
export interface LabShipment {
  id: string; origin_unit: { id: string; name: string }; provider: LabProviderRef; status: LabShipmentStatus | string;
  temperature_celsius: number | null; sent_at: string | null; sent_by: string | null; received_at: string | null;
  received_by: string | null; samples: LabShipmentSample[];
}
export interface LabShipmentInput { origin_unit_id: string; provider_id: string; barcodes: string[]; temperature_celsius: number }
// Divergência D5: recoletas e não recebidas da UBS.
export interface LabPendingSample extends LabSample { requisition: { id: string; number: string; patient_display_name: string } }
export interface LabUnitPending { recollections: LabPendingSample[]; not_received: LabPendingSample[] }
export interface LabReceiveInput { barcode: string; decision: LabReceiveDecision; reason_id?: string; restriction_note?: string }
// Divergência D6: o recebimento devolve a amostra e, na rejeição, a recoleta.
export interface LabReceiveResult { sample: LabSample & { requisition_number: string }; recollection: LabSample | null }

// `notified` só em linha crítica (Divergência D9); `value` só para quem é do laboratório.
export interface LabResultRow {
  id: string; item_id: string; analyte_key: string; name: string; value: string; unit: string | null; flag: LabFlag | string;
  source: "typed" | "hl7" | string; entered_at: string; entered_by: string | null; chosen: boolean;
  // B30: o valor que vale é a linha com effective true (calculado no api); `chosen` fica como história.
  effective: boolean; notified?: boolean;
  // 21c (contrato §7): lote de reagente em uso na gravação; null = "sem rastreio"; ausente = api antigo ou quem não é do laboratório.
  reagent_lot?: ReagentLotRef | null;
}
export interface LabReference { low: number | null; high: number | null; text: string | null }
// Divergência D7: componente para digitar, com a faixa já escolhida pelo api
// (sexo e idade na data da coleta) e os limites da versão.
export interface LabAnalyteEntry {
  key: string; name: string; unit: string | null; value_type: LabValueType | string; choices: string[] | null; decimals: number;
  reference: LabReference | null; entry_min: number | null; entry_max: number | null;
  critical_low: number | null; critical_high: number | null; formula: string | null;
}
export interface LabEntryItem {
  item_id: string; requisition_id: string; requisition_number: string; barcode: string;
  patient: { display_name: string; birth_date: string; biological_sex: string };
  sigtap_code: string; label: string; version: number; status: LabItemStatus | string; sample_status: LabSampleStatus | string;
  restriction_note: string | null; analytes: LabAnalyteEntry[]; results: LabResultRow[];
}
// Divergência D8: forma do mapa de trabalho.
export interface LabWorklistItem {
  item_id: string; requisition_id: string; requisition_number: string; barcode: string; patient_display_name: string;
  sigtap_code: string; label: string; urgent: boolean; received_at: string | null; status: LabItemStatus | string;
}
export interface LabWorklistGroup { sector: string; bench: string | null; items: LabWorklistItem[] }
export interface LabWorklistQuery { providerId: string; sector?: string; bench?: string; urgent?: boolean; date?: string; pending?: boolean }
// Divergência D9: forma da fila de liberação.
export interface LabReleaseItem extends LabItem { restriction_note: string | null; results: LabResultRow[] }
export interface LabReleaseRequisition {
  id: string; number: string; patient: LabPatient; urgent: boolean; items: LabReleaseItem[]; reports: LabReportSummary[];
}
// Divergência D10: forma da lista de críticos sem aviso (sem valor).
export interface LabCriticalRow {
  result_id: string; requisition_id: string; requisition_number: string; patient_display_name: string;
  analyte_name: string; flag: LabFlag | string; released_at: string | null;
}
export interface LabCriticalInput {
  result_id: string; notified_person: string; notified_role: string; channel: CriticalChannel; notified_at: string;
}
export interface LabReleaseInput { item_ids: string[]; signature: LabSignatureKind; totp?: string }
export interface LabRectifyInput {
  item_ids: string[]; reason: string; contacts: { person: string; channel: CriticalChannel; at: string }[];
  signature: LabSignatureKind; totp?: string;
}

// Admin do laboratório (contrato §3).
export interface LabReferenceRange {
  sex: "male" | "female" | "any"; age_min_days: number; age_max_days: number; // B3: 0..43800 (43800 = sem limite)
  low: number | null; high: number | null; text: string | null;
}
export interface LabAnalyteTemplate {
  key: string; name: string; loinc: string | null; unit: string | null; value_type: LabValueType;
  choices?: string[] | null; decimals: number; reference_ranges: LabReferenceRange[];
}
// Divergência D12: forma do catálogo-base, do exame adotado e da versão.
export interface LabTemplate {
  id: string; sigtap_code: string; name: string; sector: string; material: string; container: string;
  suggested_method: string | null; preparation: string | null; analytes: LabAnalyteTemplate[];
}
export interface LabAnalyteVersion extends Omit<LabAnalyteTemplate, "choices"> {
  // O api devolve [] nos componentes que não são de escolha.
  choices: string[];
  entry_min: number | null; entry_max: number | null; critical_low: number | null; critical_high: number | null; formula: string | null;
}
export interface LabExamVersion {
  id: string; version: number; method: string; material: string; container: string; instrument_test_code: string | null;
  // 21c (contrato §2): aparelho em que o exame roda (opcional); aparelho inativo → invalid_version (C-E43).
  lab_instrument_id?: string | null;
  analytes: LabAnalyteVersion[]; created_by: string | null; created_at: string;
}
export interface LabExam {
  id: string; provider_id: string; template_id: string; sigtap_code: string; name: string; sector: string; bench: string | null;
  delivery_days: number; active: boolean; current_version: LabExamVersion | null;
  versions?: { id: string; version: number; created_at: string; created_by: string | null }[];
}
export interface LabExamAdoptInput { provider_id: string; template_id: string; sector: string; bench: string | null; delivery_days: number }
export interface LabExamSettingsInput { sector: string; bench: string | null; delivery_days: number; active: boolean }
export type LabVersionInput = Omit<LabExamVersion, "id" | "version" | "created_by" | "created_at">;
export interface LabRejectionReason { id: string; provider_id: string; name: string; active: boolean }
export interface LabRejectionReasonInput { provider_id: string; name: string; active: boolean }
export interface LabReleaser {
  id: string; user_id: string; name: string; email: string; provider_id: string;
  council: string | null; council_uf: string | null; council_number: string | null; technical_lead: boolean; technical_deputy: boolean;
}
export interface LabReleaserInput { user_id: string; provider_id: string; technical_lead: boolean; technical_deputy: boolean }

// Relatórios (contrato §6; Divergência D13).
export interface LabReportQuery { providerId: string | null; month: string }
export type LabReportKind = "production" | "rejections" | "turnaround";
export interface LabProductionRow {
  origin_unit: { id: string; name: string }; sigtap_code: string; exam_name: string; sector: string;
  releaser: { id: string; name: string } | null; quantity: number; sigtap_value_cents: number;
}
export interface LabProductionReport { rows: LabProductionRow[]; total_quantity: number; total_value_cents: number }
export interface LabRejectionRow { reason: { id: string; name: string }; origin_unit: { id: string; name: string }; count: number }
export interface LabTurnaroundRow { sigtap_code: string; exam_name: string; on_time: number; late: number; pending: number }

const labPath = (...parts: string[]) => [ LAB_BASE, ...parts.map(encodeURIComponent) ].join("/");
const labQuery = (path: string, params: URLSearchParams) => (params.toString() ? `${path}?${params.toString()}` : path);
const labPost = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export function getLabContext(): Promise<LabContext> {
  return jsonFetch(labPath("context"));
}

export function listLabRequisitions(q: LabRequisitionQuery): Promise<LabRequisitionPage> {
  const p = new URLSearchParams();
  for (const s of q.statuses ?? []) p.append("status[]", s);
  if (q.providerId) p.set("provider_id", q.providerId);
  if (q.originUnitId) p.set("origin_unit_id", q.originUnitId);
  if (q.number) p.set("number", q.number);
  if (q.barcode) p.set("barcode", q.barcode);
  if (q.before) p.set("before", q.before);
  p.set("limit", String(LAB_PAGE_SIZE));
  return jsonFetch(labQuery(labPath("requisitions"), p));
}

export function getLabRequisition(id: string): Promise<LabRequisition> {
  return jsonFetch(labPath("requisitions", id));
}

export async function listLabCandidates(patientId: string, providerId: string): Promise<LabCandidateOrder[]> {
  const p = new URLSearchParams({ patient_id: patientId, provider_id: providerId });
  return (await jsonFetch<{ orders: LabCandidateOrder[] }>(labQuery(labPath("candidate_orders"), p))).orders;
}

export async function listLabExams(providerId: string): Promise<LabExamRef[]> {
  const p = new URLSearchParams({ provider_id: providerId });
  return (await jsonFetch<{ exams: LabExamRef[] }>(labQuery(labPath("exams"), p))).exams;
}

export function createLabRequisition(input: LabRequisitionInput): Promise<LabRequisition> {
  return jsonFetch(labPath("requisitions"), labPost(input));
}

export function fetchLabReceipt(id: string): Promise<SignatureFile> {
  return binaryFetch(labPath("requisitions", id, "receipt.pdf"), "application/pdf");
}

export function fetchLabLabels(id: string, sampleIds: string[]): Promise<SignatureFile> {
  const p = new URLSearchParams();
  for (const s of sampleIds) p.append("sample_ids[]", s);
  return binaryFetch(labQuery(labPath("requisitions", id, "labels.pdf"), p), "application/pdf");
}

export function collectSample(id: string): Promise<LabSample> {
  return jsonFetch(labPath("samples", id, "collect"), labPost({}));
}

export function collectSampleByBarcode(barcode: string): Promise<LabSample & { requisition_number?: string }> {
  return jsonFetch(labPath("samples", "collect"), labPost({ barcode }));
}

export function createShipment(input: LabShipmentInput): Promise<LabShipment> {
  return jsonFetch(labPath("shipments"), labPost(input));
}

export function sendShipment(id: string): Promise<LabShipment> {
  return jsonFetch(labPath("shipments", id, "send"), labPost({}));
}

export function receiveShipment(id: string, barcodes: string[]): Promise<LabShipment> {
  return jsonFetch(labPath("shipments", id, "receive"), labPost({ barcodes }));
}

export async function listShipments(q: { providerId?: string; originUnitId?: string; statuses: LabShipmentStatus[] }): Promise<LabShipment[]> {
  const p = new URLSearchParams();
  if (q.providerId) p.set("provider_id", q.providerId);
  if (q.originUnitId) p.set("origin_unit_id", q.originUnitId);
  for (const s of q.statuses) p.append("status[]", s);
  return (await jsonFetch<{ shipments: LabShipment[] }>(labQuery(labPath("shipments"), p))).shipments;
}

export function receiveSample(input: LabReceiveInput): Promise<LabReceiveResult> {
  return jsonFetch(labPath("samples", "receive"), labPost(input));
}

export async function listUnitPending(originUnitId: string): Promise<LabUnitPending> {
  const p = new URLSearchParams({ origin_unit_id: originUnitId });
  const body = await jsonFetch<Partial<LabUnitPending>>(labQuery(labPath("recollections"), p));
  return { recollections: body.recollections ?? [], not_received: body.not_received ?? [] };
}

export function deliverRequisition(id: string, deliveredTo: string): Promise<LabRequisition> {
  return jsonFetch(labPath("requisitions", id, "deliver"), labPost({ delivered_to: deliveredTo }));
}

function worklistParams(q: LabWorklistQuery): URLSearchParams {
  const p = new URLSearchParams({ provider_id: q.providerId });
  if (q.sector) p.set("sector", q.sector);
  if (q.bench) p.set("bench", q.bench);
  if (q.urgent) p.set("urgent", "true");
  if (q.date) p.set("date", q.date);
  if (q.pending) p.set("pending", "true");
  return p;
}

export async function listWorklist(q: LabWorklistQuery): Promise<LabWorklistGroup[]> {
  return (await jsonFetch<{ groups: LabWorklistGroup[] }>(labQuery(labPath("worklists"), worklistParams(q)))).groups;
}

export function fetchWorklistPdf(q: LabWorklistQuery): Promise<SignatureFile> {
  return binaryFetch(labQuery(labPath("worklists.pdf"), worklistParams(q)), "application/pdf");
}

// B5/B16: pela etiqueta o `sigtap_code` é obrigatório (uma etiqueta serve a vários exames da amostra).
export async function getLabEntry(by: { itemId: string } | { barcode: string; sigtapCode: string }): Promise<LabEntryItem[]> {
  const p = "itemId" in by
    ? new URLSearchParams({ item_id: by.itemId })
    : new URLSearchParams({ barcode: by.barcode, sigtap_code: by.sigtapCode });
  return (await jsonFetch<{ items: LabEntryItem[] }>(labQuery(labPath("entry"), p))).items;
}

// B39: a leitura da etiqueta sem `sigtap_code` devolve só a lista de exames da amostra.
export interface LabEntryListItem { item_id: string; sigtap_code: string; name: string; status: LabItemStatus | string }
export async function listLabEntryItems(barcode: string): Promise<LabEntryListItem[]> {
  return (await jsonFetch<{ items: LabEntryListItem[] }>(labQuery(labPath("entry"), new URLSearchParams({ barcode })))).items;
}

export async function enterLabResults(input: { item_id: string; values: { analyte_key: string; value: string }[] }): Promise<LabResultRow[]> {
  return (await jsonFetch<{ results: LabResultRow[] }>(labPath("results"), labPost(input))).results;
}

export function chooseLabResult(id: string): Promise<LabResultRow> {
  return jsonFetch(labPath("results", id, "choose"), labPost({}));
}

export async function listReleases(providerId: string): Promise<LabReleaseRequisition[]> {
  const p = new URLSearchParams({ provider_id: providerId });
  return (await jsonFetch<{ requisitions: LabReleaseRequisition[] }>(labQuery(labPath("releases"), p))).requisitions;
}

// Divergência D9: a mesma forma para uma requisição só, em qualquer situação
// (conferência e retificação de laudo já liberado).
export function getReleaseRequisition(id: string): Promise<LabReleaseRequisition> {
  return jsonFetch(labPath("releases", id));
}

// B52: mais antigos primeiro, sem corte de dias; cursor opaco `after` (invalid_cursor → 422).
export interface LabCriticalPage { criticals: LabCriticalRow[]; next_after: string | null }

export async function listUnnotifiedCriticals(q: { after?: string | null; limit?: number } = {}): Promise<LabCriticalPage> {
  const p = new URLSearchParams();
  if (q.after) p.set("after", q.after);
  if (q.limit) p.set("limit", String(q.limit));
  const body = await jsonFetch<{ criticals?: LabCriticalRow[]; next_after?: string | null }>(labQuery(labPath("criticals", "unnotified"), p));
  return { criticals: body.criticals ?? [], next_after: body.next_after ?? null };
}

// Divergência D11: só a contagem, sem dado clínico e sem trilha.
export async function countUnnotifiedCriticals(): Promise<number> {
  const body = await jsonFetch<{ count?: unknown }>(labPath("criticals", "unnotified", "count"));
  const n = Number(body.count ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export async function recordCriticalNotice(input: LabCriticalInput): Promise<void> {
  await jsonFetch<unknown>(labPath("criticals"), labPost(input));
}

export function releaseRequisition(id: string, input: LabReleaseInput): Promise<LabReportSummary> {
  return jsonFetch(labPath("requisitions", id, "release"), labPost(input));
}

export function rectifyLabReport(id: string, input: LabRectifyInput): Promise<LabReportSummary> {
  return jsonFetch(labPath("reports", id, "rectify"), labPost(input));
}

// Admin (`/lab/admin`, municipal_admin; escrita com step-up pelo SensitiveAction).
export async function listLabTemplates(): Promise<LabTemplate[]> {
  return (await jsonFetch<{ templates: LabTemplate[] }>(labPath("admin", "templates"))).templates;
}

export async function listLabAdminExams(providerId: string): Promise<LabExam[]> {
  const p = new URLSearchParams({ provider_id: providerId });
  return (await jsonFetch<{ exams: LabExam[] }>(labQuery(labPath("admin", "exams"), p))).exams;
}

export function getLabAdminExam(id: string): Promise<LabExam> {
  return jsonFetch(labPath("admin", "exams", id));
}

export function adoptLabExam(input: LabExamAdoptInput): Promise<LabExam> {
  return jsonFetch(labPath("admin", "exams"), labPost(input));
}

export function updateLabExam(id: string, input: LabExamSettingsInput): Promise<LabExam> {
  return jsonFetch(labPath("admin", "exams", id), { method: "PATCH", body: JSON.stringify(input) });
}

export function createLabExamVersion(id: string, input: LabVersionInput): Promise<LabExamVersion> {
  return jsonFetch(labPath("admin", "exams", id, "versions"), labPost(input));
}

export async function listRejectionReasons(providerId: string): Promise<LabRejectionReason[]> {
  const p = new URLSearchParams({ provider_id: providerId });
  return (await jsonFetch<{ reasons: LabRejectionReason[] }>(labQuery(labPath("admin", "rejection_reasons"), p))).reasons;
}

// Divergência D14: o recebimento lê os motivos ativos fora do admin.
export async function listActiveRejectionReasons(providerId: string): Promise<LabRejectionReason[]> {
  const p = new URLSearchParams({ provider_id: providerId });
  return (await jsonFetch<{ reasons: LabRejectionReason[] }>(labQuery(labPath("rejection_reasons"), p))).reasons;
}

export function createRejectionReason(input: LabRejectionReasonInput): Promise<LabRejectionReason> {
  return jsonFetch(labPath("admin", "rejection_reasons"), labPost(input));
}

export function updateRejectionReason(id: string, input: { name: string; active: boolean }): Promise<LabRejectionReason> {
  return jsonFetch(labPath("admin", "rejection_reasons", id), { method: "PATCH", body: JSON.stringify(input) });
}

export async function listLabReleasers(): Promise<LabReleaser[]> {
  return (await jsonFetch<{ releasers: LabReleaser[] }>(labPath("admin", "releasers"))).releasers;
}

export function addLabReleaser(input: LabReleaserInput): Promise<LabReleaser> {
  return jsonFetch(labPath("admin", "releasers"), labPost(input));
}

export async function removeLabReleaser(id: string): Promise<void> {
  await jsonFetch<unknown>(labPath("admin", "releasers", id), { method: "DELETE", body: "{}" });
}

// Mostrado uma vez: quem chama guarda só no estado do componente.
export async function rotateMiddlewareToken(providerId: string): Promise<string> {
  return (await jsonFetch<{ token: string }>(labPath("admin", "providers", providerId, "middleware_token"), labPost({}))).token;
}

export async function revokeMiddlewareToken(providerId: string): Promise<void> {
  await jsonFetch<unknown>(labPath("admin", "providers", providerId, "middleware_token"), { method: "DELETE", body: "{}" });
}

function labReportParams(q: LabReportQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.providerId) p.set("provider_id", q.providerId);
  p.set("month", q.month);
  return p;
}

export function getLabProduction(q: LabReportQuery): Promise<LabProductionReport> {
  return jsonFetch(labQuery(labPath("reports", "production"), labReportParams(q)));
}

export async function getLabRejections(q: LabReportQuery): Promise<LabRejectionRow[]> {
  return (await jsonFetch<{ rows: LabRejectionRow[] }>(labQuery(labPath("reports", "rejections"), labReportParams(q)))).rows;
}

export async function getLabTurnaround(q: LabReportQuery): Promise<LabTurnaroundRow[]> {
  return (await jsonFetch<{ rows: LabTurnaroundRow[] }>(labQuery(labPath("reports", "turnaround"), labReportParams(q)))).rows;
}

export function fetchLabReportCsv(kind: LabReportKind, q: LabReportQuery): Promise<SignatureFile> {
  return binaryFetch(labQuery(labPath("reports", `${kind}.csv`), labReportParams(q)), "text/csv");
}

// F-21.24 (Divergência D17): número da requisição no GAL do LACEN.
export async function setGalRequisition(orderId: string, value: string): Promise<void> {
  await jsonFetch<unknown>(examPath("orders", orderId, "gal_requisition"), postProfessional({ gal_requisition: value }));
}

// ─── Qualidade e insumos do laboratório (módulo 21c; contrato 2026-10-18) ───
// CIQ, CEQ e estoque sobre o 21b. Na URL só ids, situação, nível, chave do
// analito, datas, mês e ano; valor, média, dp, justificativa, motivo, ação,
// código de barras do nível e quantidade vão no corpo. Decimais trafegam como
// string com ponto, sem zero à direita (C-E9: "98", "2.5"); `z_score` e
// `deviation_pct` são número. As formas seguem o api (apps/api feat/mod-21c-lab-qc).
export type QcRunStatus = "open" | "approved" | "warning" | "rejected";
export type QcTargetSource = "package_insert" | "laboratory";
export type QcRule = "1_2s" | "1_3s" | "2_2s" | "R_4s" | "4_1s" | "10x";
export const QC_RULES: QcRule[] = [ "1_2s", "1_3s", "2_2s", "R_4s", "4_1s", "10x" ];
export type QcOutcome = "ok" | "warning" | "reject";
export type QcReviewDecision = "pending" | "kept" | "rectify";
export type EqaAdequacy = "adequate" | "inadequate";
export type SupplyKind = "reagent" | "calibrator" | "control" | "consumable";
export type SupplyOrigin = "purchase" | "donation" | "loan";
export type SupplyMovementKind = "receipt" | "opening" | "loss" | "expiry" | "adjustment";
export type QcLotStatus = "in_use" | "closed";
export interface ReagentLotRef { id: string; lot_number: string }

// Aparelho (admin_json.rb#instrument): fabricante, modelo e série vazios saem null.
export interface LabInstrument {
  id: string; provider_id: string; name: string; manufacturer: string | null; model: string | null; serial_number: string | null;
  sector: string; hl7_equipment_id: string | null; active: boolean;
}
export type LabInstrumentInput = Omit<LabInstrument, "id">;

export interface QcAnalyteRef { lab_exam_id: string; analyte_key: string }
// `has_lots`: com lote, os níveis não mudam e nenhum analito sai (save_material.rb).
export interface QcMaterial {
  id: string; provider_id: string; name: string; manufacturer: string | null; levels: string[]; analytes: QcAnalyteRef[]; active: boolean;
  has_lots: boolean;
}
export type QcMaterialInput = Omit<QcMaterial, "id" | "has_lots">;
// Divergência C3: forma do lote de controle.
export interface QcLot {
  id: string; material_id: string; material_name: string; lot_number: string; expires_on: string; level_barcodes: Record<string, string>;
  status: QcLotStatus | string; opened_on: string; closed_on: string | null; expired: boolean;
}
export interface QcLotInput { material_id: string; lot_number: string; expires_on: string; level_barcodes: Record<string, string> }
export interface QcTargetKey { lot_id: string; level: string; analyte_key: string; instrument_id: string }
export interface QcTarget extends QcTargetKey {
  id: string; version: number; source: QcTargetSource | string; mean: string; sd: string; based_on_runs: number | null; reason: string | null;
  accepted_by: string | null; accepted_at: string;
}
// Divergência C3: vigentes e histórico do lote.
export interface QcTargetSet { current: QcTarget[]; history: QcTarget[] }
// Divergência C6: `reason` quando já existe referência vigente para a chave.
export interface QcTargetInput extends QcTargetKey { mean: string; sd: string; reason?: string }
export interface QcSuggestion extends QcTargetKey {
  mean: string; sd: string; runs: number; current_version: number; current_source: QcTargetSource | string;
}
export interface QcValue {
  id: string; run_id: string; lot_id: string; level: string; analyte_key: string; value: string; z_score: number; rules_fired: string[];
  outcome: QcOutcome | string; source: "typed" | "hl7" | string; target_version: number; reagent_lot_id: string | null;
  // Divergência C10: o número do lote, como no resultado do paciente.
  reagent_lot: ReagentLotRef | null; entered_at: string; entered_by: string | null;
}
export interface QcRun {
  id: string; instrument_id: string; sector: string; status: QcRunStatus | string; started_at: string; evaluated_at: string | null;
  values: QcValue[];
}
export interface QcBlock {
  id: string; instrument_id: string; analyte_key: string; opened_at: string; opened_by_run_id: string;
  corrective_action: string | null; corrective_action_at: string | null; closed_at: string | null; closed_by_run_id: string | null;
}
export interface QcValueInput { run_id: string | null; instrument_id: string; lot_id: string; level: string; analyte_key: string; value: string }
// C-E3: `notice` quando a corrida aprovou mas o bloqueio segue sem ação corretiva.
export interface QcValueResult { value: QcValue; run: QcRun; block: QcBlock | null; notice?: "corrective_action_required" }
export interface QcChartPoint { at: string; value: string; z_score: number; outcome: QcOutcome | string; rules_fired: string[]; target_version: number }
export interface QcChart { target: { mean: string; sd: string; version: number; source: QcTargetSource | string } | null; points: QcChartPoint[] }
// C-E5: from/to opcionais (padrão 31 dias; no máximo 366).
export interface QcChartQuery extends QcTargetKey { from?: string; to?: string }
// Divergência C16: forma da leitura das regras (ausente = padrão, tudo ligado).
export interface QcRuleSet {
  instrument_id: string; analyte_key: string; rules: Record<QcRule, boolean>; is_default: boolean;
  justification: string | null; changed_by: string | null; changed_at: string | null;
}
export interface QcRuleInput { instrument_id: string; analyte_key: string; rules: Record<QcRule, boolean>; justification: string }
// Divergência C3: item da lista de revisão (sem paciente). `report_id` só na resposta da decisão `rectify`.
export interface QcReview {
  id: string; block_id: string; item_id: string; requisition_id: string; requisition_number: string; sigtap_code: string; exam_label: string;
  analyte_key: string; instrument_id: string; released_at: string | null; decision: QcReviewDecision | string;
  decided_by: string | null; decided_at: string | null; note: string | null; report_id?: string | null;
}
// Divergência C7: exceções concedidas.
export interface QcException {
  id: string; block_id: string; item_id: string; requisition_id: string; requisition_number: string; sigtap_code: string; exam_label: string;
  analyte_key: string; instrument_id: string; justification: string; granted_by: string | null; granted_at: string;
}
// Contrato §3 + Divergência C9: um item POR BLOQUEIO (release_check.rb) — o mesmo item_id
// pode repetir com outro block_id; a exceção é do par bloqueio × item.
export interface QcBlockedItem { item_id: string; block_id: string; analyte_key: string; instrument_id: string; instrument_name: string }
// Corpo do 409 da liberação e da retificação (C-E19).
export interface QcBlockedBody { error: "qc_blocked"; items: QcBlockedItem[] }

export interface EqaItem {
  analyte_key: string; lab_exam_id: string; submitted: string; target: string; acceptable_low: string | null; acceptable_high: string | null;
  adequacy: EqaAdequacy | string; action: string | null;
}
// C-E24: a rodada não tem relatório anual (é registro próprio, EqaAnnualReport).
export interface EqaRound {
  id: string; provider_id: string; program: string; round_code: string; round_date: string; items: EqaItem[];
  recorded_by: string | null; recorded_at: string;
}
export type EqaRoundInput = Omit<EqaRound, "id" | "recorded_by" | "recorded_at">;
// Divergência C3: resumo anual por analito.
export interface EqaSummaryRow { analyte_key: string; lab_exam_id: string; rounds: number; adequate: number; inadequate: number }
// C-E24: por programa, se o ano tem relatório anual.
export interface EqaProgramSummary { program: string; annual_report: boolean; annual_report_id: string | null }
export interface EqaSummary { year: number; rows: EqaSummaryRow[]; programs: EqaProgramSummary[] }
// C-E24/C-E25: relatório anual por laboratório, programa e ano.
export interface EqaAnnualReport {
  id: string; provider_id: string; program: string; year: number; url: string; recorded_by: string | null; recorded_at: string;
}
export interface EqaAnnualReportInput { provider_id: string; program: string; year: number; upload_id: string }

export interface LabSupply {
  id: string; provider_id: string; name: string; kind: SupplyKind | string; unit: string; tests_per_package: number | null;
  minimum_stock: number; expiry_alert_days: number; lab_exam_ids: string[]; active: boolean;
  // Divergência C3: saldo somado dos lotes. C-E28: `below_minimum` conta só os lotes não vencidos.
  balance: number; below_minimum: boolean;
}
export type LabSupplyInput = Omit<LabSupply, "id" | "balance" | "below_minimum">;
export interface LabSupplyLot {
  id: string; supply_id: string; supply_name: string; lot_number: string; expires_on: string; supplier: string;
  origin: SupplyOrigin | string; balance: number; expired: boolean; in_use: { instrument_id: string; lab_exam_id: string }[];
}
export interface LabSupplyLotInput {
  supply_id: string; lot_number: string; expires_on: string; supplier: string; origin: SupplyOrigin; quantity: number; document?: string;
}
// `balance` (saldo do lote depois do movimento) só na resposta do POST.
export interface LabSupplyMovement {
  id: string; lot_id: string; kind: SupplyMovementKind | string; quantity: number; reason: string | null; document: string | null;
  recorded_by: string | null; recorded_at: string; balance?: number;
}
// A abertura não exige motivo (record_movement.rb): mande `reason` só quando houver.
export interface LabSupplyMovementInput { lot_id: string; kind: Exclude<SupplyMovementKind, "receipt">; quantity: number; reason?: string }
export interface LabSupplyInUse {
  id: string; lot_id: string; lot_number: string; supply_name: string; instrument_id: string; lab_exam_id: string; exam_name: string;
  started_at: string; ended_at: string | null;
}
export interface LabSupplyInUseInput { lot_id: string; instrument_id: string; lab_exam_id: string }
// alerts.rb: o lote vencendo é a forma do lote + `lot_id`; o item abaixo do mínimo é a
// forma do item + `supply_id`, com `balance` = saldo dos lotes não vencidos.
export interface LabExpiringLot extends LabSupplyLot { lot_id: string }
export interface LabLowSupply extends LabSupply { supply_id: string }
export interface LabInventoryAlerts { expiring: LabExpiringLot[]; below_minimum: LabLowSupply[]; untraced_results: number }
// C-E37: cada lista vem cortada em 5000; `*_truncated` avisa o corte.
export interface LabLotTrace {
  lot_id: string; lot_number: string;
  results: { requisition_number: string; sigtap_code: string; entered_at: string }[]; results_truncated: boolean;
  qc_values: { run_id: string; analyte_key: string; entered_at: string }[]; qc_values_truncated: boolean;
}
// C-E33: uma linha `total` por item e as sub-linhas por aparelho (`no_instrument` = "sem aparelho");
// nas sub-linhas `tests_opened`/`deviation_pct` são null; na total, null = sem abertura no mês.
export type LabConsumptionLine = "total" | "instrument" | "no_instrument";
export interface LabConsumptionRow {
  line: LabConsumptionLine | string; supply_id: string; name: string; instrument_id: string | null; tests_performed: number;
  tests_opened: number | null; deviation_pct: number | null;
}
export interface LabConsumptionQuery { providerId: string; month: string }

const labPut = (body: unknown): RequestInit => ({ method: "PUT", body: JSON.stringify(body) });
const labPatch = (body: unknown): RequestInit => ({ method: "PATCH", body: JSON.stringify(body) });
const byProvider = (providerId: string, extra: Record<string, string> = {}) => new URLSearchParams({ provider_id: providerId, ...extra });

// Aparelhos (contrato §2; Divergências C2 e C13).
export async function listLabInstruments(providerId: string): Promise<LabInstrument[]> {
  return (await jsonFetch<{ instruments: LabInstrument[] }>(labQuery(labPath("instruments"), byProvider(providerId)))).instruments;
}
export async function listAdminInstruments(providerId: string): Promise<LabInstrument[]> {
  return (await jsonFetch<{ instruments: LabInstrument[] }>(labQuery(labPath("admin", "instruments"), byProvider(providerId)))).instruments;
}
export function createInstrument(input: LabInstrumentInput): Promise<LabInstrument> {
  return jsonFetch(labPath("admin", "instruments"), labPost(input));
}
export function updateInstrument(id: string, input: LabInstrumentInput): Promise<LabInstrument> {
  return jsonFetch(labPath("admin", "instruments", id), labPatch(input));
}

// CIQ (contrato §3).
export async function listQcMaterials(providerId: string): Promise<QcMaterial[]> {
  return (await jsonFetch<{ materials: QcMaterial[] }>(labQuery(labPath("qc", "materials"), byProvider(providerId)))).materials;
}
export function createQcMaterial(input: QcMaterialInput): Promise<QcMaterial> {
  return jsonFetch(labPath("qc", "materials"), labPost(input));
}
export function updateQcMaterial(id: string, input: QcMaterialInput): Promise<QcMaterial> {
  return jsonFetch(labPath("qc", "materials", id), labPatch(input));
}
export async function listQcLots(q: { providerId: string; status?: QcLotStatus }): Promise<QcLot[]> {
  const p = byProvider(q.providerId);
  if (q.status) p.set("status", q.status);
  return (await jsonFetch<{ lots: QcLot[] }>(labQuery(labPath("qc", "lots"), p))).lots;
}
export function createQcLot(input: QcLotInput): Promise<QcLot> {
  return jsonFetch(labPath("qc", "lots"), labPost(input));
}
export function closeQcLot(id: string): Promise<QcLot> {
  return jsonFetch(labPath("qc", "lots", id, "close"), labPost({}));
}
export async function getQcTargets(lotId: string): Promise<QcTargetSet> {
  const body = await jsonFetch<Partial<QcTargetSet>>(labQuery(labPath("qc", "targets"), new URLSearchParams({ lot_id: lotId })));
  return { current: body.current ?? [], history: body.history ?? [] };
}
export function createQcTarget(input: QcTargetInput): Promise<QcTarget> {
  return jsonFetch(labPath("qc", "targets"), labPost(input));
}
export async function listQcSuggestions(providerId: string): Promise<QcSuggestion[]> {
  return (await jsonFetch<{ suggestions: QcSuggestion[] }>(labQuery(labPath("qc", "targets", "suggestions"), byProvider(providerId)))).suggestions;
}
export function acceptQcSuggestion(input: QcTargetKey & { reason: string }): Promise<QcTarget> {
  return jsonFetch(labPath("qc", "targets", "suggestions", "accept"), labPost(input));
}
export async function listQcRuns(instrumentId: string, date: string): Promise<QcRun[]> {
  const p = new URLSearchParams({ instrument_id: instrumentId, date });
  return (await jsonFetch<{ runs: QcRun[] }>(labQuery(labPath("qc", "runs"), p))).runs;
}
export function openQcRun(instrumentId: string): Promise<QcRun> {
  return jsonFetch(labPath("qc", "runs"), labPost({ instrument_id: instrumentId }));
}
// 409 invalid_transition quando `run_id` é de corrida reprovada (C-E18): zere o runId.
export function recordQcValue(input: QcValueInput): Promise<QcValueResult> {
  return jsonFetch(labPath("qc", "values"), labPost(input));
}
// Até 200 pontos; sem trilha (contrato §3). Sem from/to, o api usa os últimos 31 dias.
export function getQcChart(q: QcChartQuery): Promise<QcChart> {
  const p = new URLSearchParams({ lot_id: q.lot_id, level: q.level, analyte_key: q.analyte_key, instrument_id: q.instrument_id });
  if (q.from) p.set("from", q.from);
  if (q.to) p.set("to", q.to);
  return jsonFetch(labQuery(labPath("qc", "chart"), p));
}
export function getQcRules(instrumentId: string, analyteKey: string): Promise<QcRuleSet> {
  return jsonFetch(labQuery(labPath("qc", "rules"), new URLSearchParams({ instrument_id: instrumentId, analyte_key: analyteKey })));
}
export function saveQcRules(input: QcRuleInput): Promise<QcRuleSet> {
  return jsonFetch(labPath("qc", "rules"), labPut(input));
}
export async function listQcBlocks(status: "active" | "closed", providerId: string): Promise<QcBlock[]> {
  return (await jsonFetch<{ blocks: QcBlock[] }>(labQuery(labPath("qc", "blocks"), byProvider(providerId, { status })))).blocks;
}
// Só a contagem, sem dado de corrida e sem trilha (Divergência C11). Única rota do CIQ relida sozinha.
export async function countActiveQcBlocks(): Promise<number> {
  const body = await jsonFetch<{ count?: unknown }>(labPath("qc", "blocks", "active", "count"));
  const n = typeof body?.count === "number" ? body.count : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}
export function recordCorrectiveAction(blockId: string, text: string): Promise<QcBlock> {
  return jsonFetch(labPath("qc", "blocks", blockId, "corrective_action"), labPost({ text }));
}
export function grantQcException(input: { block_id: string; item_id: string; justification: string }): Promise<QcException> {
  return jsonFetch(labPath("qc", "exceptions"), labPost(input));
}
export async function listQcExceptions(providerId: string, month: string): Promise<QcException[]> {
  return (await jsonFetch<{ exceptions: QcException[] }>(labQuery(labPath("qc", "exceptions"), byProvider(providerId, { month })))).exceptions;
}
export async function listQcReviews(providerId: string, status: "pending" | "decided" = "pending"): Promise<QcReview[]> {
  return (await jsonFetch<{ reviews: QcReview[] }>(labQuery(labPath("qc", "reviews"), byProvider(providerId, { status })))).reviews;
}
export function decideQcReview(id: string, input: { decision: "kept" | "rectify"; note?: string }): Promise<QcReview> {
  return jsonFetch(labPath("qc", "reviews", id), labPost(input));
}

// CEQ (contrato §4; Divergências C3 e C12; C-E24/C-E25: o relatório anual é registro próprio).
export async function listEqaRounds(providerId: string, year: string): Promise<EqaRound[]> {
  return (await jsonFetch<{ rounds: EqaRound[] }>(labQuery(labPath("eqa", "rounds"), byProvider(providerId, { year })))).rounds;
}
export function createEqaRound(input: EqaRoundInput): Promise<EqaRound> {
  return jsonFetch(labPath("eqa", "rounds"), labPost(input));
}
// Só o tipo e o conteúdo: o nome do arquivo pode trazer nome de pessoa.
export async function uploadEqaReport(file: File): Promise<string> {
  const data = await readBase64(file);
  return (await jsonFetch<{ upload_id: string }>(labPath("eqa", "uploads"), labPost({ content_type: file.type, data }))).upload_id;
}
export async function listEqaAnnualReports(providerId: string, year: string): Promise<EqaAnnualReport[]> {
  return (await jsonFetch<{ annual_reports: EqaAnnualReport[] }>(labQuery(labPath("eqa", "annual_reports"), byProvider(providerId, { year })))).annual_reports;
}
// `year` é número no corpo (422 invalid_year com string); repetido → 409 already_recorded.
export function createEqaAnnualReport(input: EqaAnnualReportInput): Promise<EqaAnnualReport> {
  return jsonFetch(labPath("eqa", "annual_reports"), labPost(input));
}
export function fetchEqaAnnualReport(id: string): Promise<SignatureFile> {
  return binaryFetch(labPath("eqa", "annual_reports", id, "pdf"), "application/pdf");
}
export async function getEqaSummary(providerId: string, year: string): Promise<EqaSummary> {
  const body = await jsonFetch<Partial<EqaSummary>>(labQuery(labPath("eqa", "summary"), byProvider(providerId, { year })));
  return { year: Number(body.year ?? year), rows: body.rows ?? [], programs: body.programs ?? [] };
}

// Estoque (contrato §5; Divergências C2, C3, C8 e C15).
export async function listSupplies(providerId: string): Promise<LabSupply[]> {
  return (await jsonFetch<{ supplies: LabSupply[] }>(labQuery(labPath("inventory", "supplies"), byProvider(providerId)))).supplies;
}
export function createSupply(input: LabSupplyInput): Promise<LabSupply> {
  return jsonFetch(labPath("inventory", "supplies"), labPost(input));
}
export function updateSupply(id: string, input: LabSupplyInput): Promise<LabSupply> {
  return jsonFetch(labPath("inventory", "supplies", id), labPatch(input));
}
// Padrão: só lotes com saldo. `withBalance: false` traz os esgotados (o rastreio precisa deles).
export async function listSupplyLots(q: { supplyId?: string; providerId?: string; withBalance?: boolean }): Promise<LabSupplyLot[]> {
  const p = new URLSearchParams();
  if (q.supplyId) p.set("supply_id", q.supplyId);
  if (q.providerId) p.set("provider_id", q.providerId);
  if (q.withBalance !== false) p.set("with_balance", "true");
  return (await jsonFetch<{ lots: LabSupplyLot[] }>(labQuery(labPath("inventory", "lots"), p))).lots;
}
export function receiveSupplyLot(input: LabSupplyLotInput): Promise<LabSupplyLot> {
  return jsonFetch(labPath("inventory", "lots"), labPost(input));
}
export async function listSupplyMovements(lotId: string): Promise<LabSupplyMovement[]> {
  return (await jsonFetch<{ movements: LabSupplyMovement[] }>(labQuery(labPath("inventory", "movements"), new URLSearchParams({ lot_id: lotId })))).movements;
}
export function recordSupplyMovement(input: LabSupplyMovementInput): Promise<LabSupplyMovement> {
  return jsonFetch(labPath("inventory", "movements"), labPost(input));
}
export async function listInUse(instrumentId: string): Promise<LabSupplyInUse[]> {
  return (await jsonFetch<{ in_use: LabSupplyInUse[] }>(labQuery(labPath("inventory", "in_use"), new URLSearchParams({ instrument_id: instrumentId })))).in_use;
}
// O mesmo lote já em uso no par aparelho × exame: 200 com o registro atual, nada encerrado (C-E6).
// 201 = criou (e encerrou o anterior, se havia); 200 = já era o corrente (in_use_controller.rb).
export async function setInUse(input: LabSupplyInUseInput): Promise<{ in_use: LabSupplyInUse; created: boolean }> {
  const { body, status } = await jsonFetchWithStatus<LabSupplyInUse>(labPath("inventory", "in_use"), labPost(input));
  return { in_use: body, created: status === 201 };
}
// Sem trilha (contrato §5): pode ser relido periodicamente.
export async function getInventoryAlerts(providerId: string): Promise<LabInventoryAlerts> {
  const body = await jsonFetch<Partial<LabInventoryAlerts>>(labQuery(labPath("inventory", "alerts"), byProvider(providerId)));
  return { expiring: body.expiring ?? [], below_minimum: body.below_minimum ?? [], untraced_results: Number(body.untraced_results ?? 0) || 0 };
}
// Grava trilha de leitura: só no clique.
export async function traceSupplyLot(lotId: string): Promise<LabLotTrace> {
  const body = await jsonFetch<Partial<LabLotTrace>>(labPath("inventory", "lots", lotId, "trace"));
  return {
    lot_id: body.lot_id ?? lotId, lot_number: body.lot_number ?? "",
    results: body.results ?? [], results_truncated: body.results_truncated === true,
    qc_values: body.qc_values ?? [], qc_values_truncated: body.qc_values_truncated === true
  };
}
export function fetchSupplyLotTraceCsv(lotId: string): Promise<SignatureFile> {
  return binaryFetch(labPath("inventory", "lots", lotId, "trace.csv"), "text/csv");
}
export async function getConsumption(q: LabConsumptionQuery): Promise<LabConsumptionRow[]> {
  return (await jsonFetch<{ rows: LabConsumptionRow[] }>(labQuery(labPath("inventory", "consumption"), byProvider(q.providerId, { month: q.month })))).rows;
}
export function fetchConsumptionCsv(q: LabConsumptionQuery): Promise<SignatureFile> {
  return binaryFetch(labQuery(labPath("inventory", "consumption.csv"), byProvider(q.providerId, { month: q.month })), "text/csv");
}

// ─── Faturamento de procedimentos (módulo 22, ADR 0039; contrato 2026-10-21) ───
// Na URL só ids, tipo do estabelecimento, códigos (SIGTAP, motivo), competência
// AAAAMM, o termo da busca SIGTAP e o cursor — nunca CPF, CNS, nome, motivo de
// cancelamento ou de reabertura, nem CNPJ. CPF da busca e textos vão no corpo.
// A crítica, o instrumento, as pendências e o arquivo são do api.

const BILLING_BASE = import.meta.env.VITE_BILLING_BASE || "/billing";
const billingPath = (...parts: string[]) => [ BILLING_BASE, ...parts.map(encodeURIComponent) ].join("/");
const billingPost = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

// Módulo 30: "tfd" (ajuda de custo; source_ref { type: "tfd_allowance", id }).
// Módulo 32a: "urgency" (source_ref { type: "urgency_encounter", id }).
export type ProcedureSource = "attendance" | "consultation" | "lab_report" | "manual" | "tfd" | "urgency";
export type BillingInstrument = "bpa_i" | "bpa_c" | "not_bpa";
export type ProcedureCharacter = "elective" | "urgent";
export type ProcedureStatus = "recorded" | "cancelled";
export type BillingPeriodStatus = "open" | "closed";
export type EstablishmentType = "health_unit" | "lab_provider";
export type PendingFix = "professional" | "patient" | "establishment" | "procedure";

export interface BillingEstablishment { type: EstablishmentType; id: string; cnes: string | null; name: string }

export interface PerformedProcedure {
  id: string;
  // Módulo 24a (L8): o api manda `has_cpf` e o CNS mascarado, sem `cpf_masked`.
  patient: { id: string; display_name: string | null; has_cpf?: boolean; cns_masked?: string | null };
  establishment: BillingEstablishment;
  professional: { user_id: string; name: string; cbo_code: string | null };
  performed_on: string; sigtap_code: string; label: string; sigtap_competence: string;
  quantity: number; cid10: string | null; character: ProcedureCharacter | string;
  source: ProcedureSource | string; source_ref: { type: string; id: string } | null;
  instrument: BillingInstrument | string; billable: boolean; blocking_reasons: string[];
  status: ProcedureStatus | string; cancel_reason: string | null;
  billing_competence: string | null; sigtap_fallback: boolean;
  // Divergência B7: apresentação em atraso (entrou na competência aberta seguinte). Ausente = false.
  late?: boolean;
}
export interface ProcedurePage { procedures: PerformedProcedure[]; next_before: string | null }

// Divergências B1 (patient_id opcional com atendimento ou consulta) e B5
// (professional_user_id e cbo_code só no lançamento manual do faturista).
export interface ProcedureInput {
  patient_id?: string; establishment: { type: EstablishmentType; id: string };
  performed_on: string; sigtap_code: string; quantity: number; cid10?: string; character?: ProcedureCharacter;
  attendance_id?: string; consultation_id?: string; professional_user_id?: string; cbo_code?: string;
}
// Divergência B2: `attendanceId` lista os procedimentos do atendimento.
export interface ProcedureQuery {
  establishmentType?: EstablishmentType; establishmentId?: string; competence?: string; billable?: boolean;
  reason?: string; patientId?: string; attendanceId?: string; before?: string | null;
}
export interface SigtapProcedure {
  code: string; name: string; instruments: string[]; requires_cid: boolean;
  sex: string | null; age_min_months: number | null; age_max_months: number | null;
}
// Divergência B3.
// Módulo 24a (L8): `has_cpf` e o CNS mascarado (`Patients::IdentifierJson`).
export interface BillingPatient { id: string; display_name: string | null; cpf_masked: string | null; has_cpf?: boolean; cns_masked?: string | null }
// Divergência B5.
export interface BillingProfessional { user_id: string; name: string; cbo_codes: string[] }
export interface BillingSummary { bpa_i_lines: number; bpa_c_lines: number; not_billable: Record<string, number>; pending: number }
// `version` = versão do último arquivo gerado; 0 antes do primeiro fechamento (Divergência B11).
export interface BillingPeriod {
  id: string; establishment: BillingEstablishment; competence: string; status: BillingPeriodStatus | string; version: number;
  closed_at: string | null; closed_by: string | null; reopened_reason: string | null; summary: BillingSummary;
}
// Divergência B6: o que a tela mostra de cada pendência (opcional em api sem a B6).
export interface PendingItem {
  // Módulo 32a (Q12): a pendência do paciente provisório da UPA vem sem linha (`procedure_id: null`), com o encontro.
  procedure_id: string | null; urgency_encounter_id?: string; reasons: string[]; fix: PendingFix | string;
  performed_on?: string; sigtap_code?: string; label?: string; late?: boolean;
  // Módulo 24a: L8 (`has_cpf`, CNS mascarado) e L6 (`address_from_household`: endereço do cadastro domiciliar).
  // Módulo 31 (B7): a produção do CAPS chega com `patient: null` e `fix: "patient"` (sem nome na tela).
  patient?: { id: string; display_name: string | null; has_cpf?: boolean; cns_masked?: string | null; address_from_household?: boolean } | null;
  professional?: { user_id: string; name: string };
}
export interface BillingExport {
  id: string; version: number; sha256: string; lines_bpa_i: number; lines_bpa_c: number; generated_at: string; generated_by: string;
}
// Divergência B10: `origin_acronym` (sigla do órgão de origem, cbc-sgl do layout).
export interface BillingSettings {
  origin_name: string | null; origin_acronym: string | null; origin_cnpj: string | null;
  destination_body: string | null; management: "M" | "E" | null;
}
export interface BillingSettingsInput {
  origin_name: string; origin_acronym: string; origin_cnpj: string; destination_body: string; management: "M" | "E";
}

export const BILLING_PAGE_SIZE = 50;

function procedureParams(q: ProcedureQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.establishmentType && q.establishmentId) {
    p.set("establishment_type", q.establishmentType);
    p.set("establishment_id", q.establishmentId);
  }
  if (q.competence) p.set("competence", q.competence);
  if (q.billable !== undefined) p.set("billable", String(q.billable));
  if (q.reason) p.set("reason", q.reason);
  if (q.patientId) p.set("patient_id", q.patientId);
  if (q.attendanceId) p.set("attendance_id", q.attendanceId);
  if (q.before) p.set("before", q.before);
  p.set("limit", String(BILLING_PAGE_SIZE));
  return p;
}

export async function searchBillingSigtap(q: string, competence: string): Promise<SigtapProcedure[]> {
  const body = await jsonFetch<{ procedures?: SigtapProcedure[] }>(withQuery(billingPath("sigtap", "search"), new URLSearchParams({ q, competence })));
  return body.procedures ?? [];
}

// Sempre grava (201); a crítica vem nos campos do procedimento.
export function recordProcedure(input: ProcedureInput): Promise<PerformedProcedure> {
  return jsonFetch(billingPath("procedures"), billingPost(input));
}

// A lista traz paciente: o api grava trilha (`billing_procedures.listed`, E19). Nunca
// é relida sozinha (sem polling, sem releitura ao focar ou reconectar): só ao abrir,
// filtrar ou depois de uma ação.
export async function listProcedures(q: ProcedureQuery): Promise<ProcedurePage> {
  const body = await jsonFetch<Partial<ProcedurePage>>(withQuery(billingPath("procedures"), procedureParams(q)));
  return { procedures: body.procedures ?? [], next_before: body.next_before ?? null };
}

export function cancelProcedure(id: string, reason: string): Promise<PerformedProcedure> {
  return jsonFetch(billingPath("procedures", id, "cancel"), billingPost({ reason }));
}

export async function lookupBillingPatient(cpf: string): Promise<BillingPatient> {
  return (await jsonFetch<{ patient: BillingPatient }>(billingPath("patient_lookup"), billingPost({ cpf }))).patient;
}

export async function listBillingEstablishments(): Promise<BillingEstablishment[]> {
  return (await jsonFetch<{ establishments?: BillingEstablishment[] }>(billingPath("establishments"))).establishments ?? [];
}

export async function listBillingProfessionals(est: { type: EstablishmentType; id: string }): Promise<BillingProfessional[]> {
  const p = new URLSearchParams({ establishment_type: est.type, establishment_id: est.id });
  return (await jsonFetch<{ professionals?: BillingProfessional[] }>(withQuery(billingPath("professionals"), p))).professionals ?? [];
}

// E18: `status: "open"` lista as abertas (de todas as competências, ou só da `competence`).
export async function listBillingPeriods(competence: string | null, status?: "open"): Promise<BillingPeriod[]> {
  const p = new URLSearchParams();
  if (competence) p.set("competence", competence);
  if (status) p.set("status", status);
  return (await jsonFetch<{ periods?: BillingPeriod[] }>(withQuery(billingPath("periods"), p))).periods ?? [];
}

// Grava trilha (contém paciente): só no clique.
export async function getPeriodPending(id: string): Promise<PendingItem[]> {
  return (await jsonFetch<{ items?: PendingItem[] }>(billingPath("periods", id, "pending"))).items ?? [];
}

// Step-up: quem trata 401 mfa_required é o SensitiveAction.
export async function closeBillingPeriod(id: string): Promise<void> {
  await jsonFetch<unknown>(billingPath("periods", id, "close"), billingPost({}));
}

export async function reopenBillingPeriod(id: string, reason: string): Promise<void> {
  await jsonFetch<unknown>(billingPath("periods", id, "reopen"), billingPost({ reason }));
}

export async function listPeriodExports(id: string): Promise<BillingExport[]> {
  return (await jsonFetch<{ exports?: BillingExport[] }>(billingPath("periods", id, "exports"))).exports ?? [];
}

// Só billing_clerk; cada download vira `billing_export.downloaded` na trilha.
export function fetchBillingExportFile(id: string): Promise<SignatureFile> {
  return binaryFetch(billingPath("exports", id, "file"), "text/plain");
}

export async function getBillingSettings(): Promise<BillingSettings> {
  const b = await jsonFetch<Partial<BillingSettings>>(billingPath("settings"));
  return {
    origin_name: b.origin_name ?? null, origin_acronym: b.origin_acronym ?? null, origin_cnpj: b.origin_cnpj ?? null,
    destination_body: b.destination_body ?? null, management: b.management === "M" || b.management === "E" ? b.management : null
  };
}

// Step-up (contrato §6): quem trata 401 mfa_required é o SensitiveAction.
export function saveBillingSettings(input: BillingSettingsInput): Promise<BillingSettings> {
  return jsonFetch(billingPath("settings"), { method: "PUT", body: JSON.stringify(input) });
}

// ─── Dados do paciente para o BPA-I (módulo 22; contrato §12, D-U1) ─────────
// Raça/cor (01–05, sem 99), etnia (4 dígitos, só com 05) e endereço; só o
// enviado muda. Tudo no corpo; na URL só o id. A recepção grava pela validação
// do par; o faturista, pela pendência. O api nunca devolve o endereço.
export interface PatientDemographicsInput {
  race_color?: string; ethnicity?: string;
  address_zip?: string; address_street?: string; address_number?: string; address_complement?: string; address_district?: string;
}
// Módulo 24a (L6): `address_from_household` — o endereço vem do cadastro domiciliar (422 se enviado).
export interface DemographicsSaved { race_color_set: boolean; address_set: boolean; address_from_household?: boolean }
// Resposta do PATCH do faturamento (Billing::PatientsController): o paciente (sem o dado) e as flags.
export interface BillingDemographicsSaved extends DemographicsSaved {
  patient: { id: string; display_name: string | null; has_cpf?: boolean; cns_masked?: string | null };
}

export async function updatePatientDemographics(patientId: string, input: PatientDemographicsInput): Promise<BillingDemographicsSaved> {
  return jsonFetch<BillingDemographicsSaved>(billingPath("patients", patientId, "demographics"), { method: "PATCH", body: JSON.stringify(input) });
}

// No check-in: a rota de nomes do 19 aceita só os campos do paciente (sem nomes).
export async function saveVerificationDemographics(verificationId: string, input: PatientDemographicsInput): Promise<DemographicsSaved> {
  const body = await jsonFetch<Partial<DemographicsSaved>>(`${ATTENDANCE_BASE}/verifications/${encodeURIComponent(verificationId)}/names`, {
    method: "POST", body: JSON.stringify(input)
  });
  return { race_color_set: body.race_color_set === true, address_set: body.address_set === true,
    address_from_household: body.address_from_household === true };
}

// ─── Linhas de cuidado (módulo 23, ADR 0040; contrato 2026-10-22) ───
// Na URL só ids (equipe, linha, inscrição, sugestão), o filtro de situação,
// o indicador e o cursor — nunca CPF, nome, nota de contato ou motivo. CPF da
// busca e textos vão no corpo. Elegibilidade, situação de cada boa prática,
// pior situação, quem confirma e a prévia são do api. Escritas e detalhe devolvem
// o objeto PURO (sem envelope); só as listas vêm em envelope.

const CARE_BASE = import.meta.env.VITE_CARE_LINES_BASE || "/care_lines";
const carePath = (...parts: string[]) => [ CARE_BASE, ...parts.map(encodeURIComponent) ].join("/");
const carePost = (body: unknown): RequestInit => ({ method: "POST", body: JSON.stringify(body) });

export type CareStatus = "ok" | "due_soon" | "overdue" | "untracked" | "unchecked";
export type CareSchedule = "proportional" | "end_of_window";
export type CareAnchor = "enrollment" | "birth" | "lmp" | "rolling";
export type SuggestionReason = "problem" | "age_sex" | "declared" | "resolved_problem";
export type EndReason = "discharge" | "death" | "moved" | "pregnancy_ended" | "other";
export type ContactChannel = "phone" | "home_visit" | "wpda_message" | "in_person";
export type ContactOutcome = "reached" | "no_answer" | "scheduled" | "refused";
export type DeclaredCondition = "diabetes" | "hypertension" | "pregnancy" | "mental_health" | "none";
export type CareIndicator = "C2" | "C3" | "C4" | "C5" | "C6" | "C7";

// Elegibilidade (L2 do plano do api): códigos casados por prefixo, CID sem
// ponto; idade em dias ou anos; tudo opcional (`problems` pode faltar ou ter só uma terminologia).
export interface CareEligibility {
  problems?: { ciap2?: string[]; cid10?: string[] };
  exclude_problems?: { ciap2?: string[]; cid10?: string[] };
  age_min_days?: number | null; age_max_days?: number | null; age_min_years?: number | null; age_max_years?: number | null;
  sex?: "female" | "male" | null; gender_identities_included?: string[]; gender_identities_excluded?: string[];
  declared?: string[]; requires_anchor?: "lmp" | null;
}
// Boa prática (contrato §2 com L1): `points` no catálogo-base; os campos
// avançados (all_of, code_filter, applies_to) só vêm das linhas do catálogo.
export interface CarePractice {
  key: string; label: string; citizen_label?: string | null; source: string; window_start_days?: number | null; window_days: number;
  min_count: number; schedule: CareSchedule | string; anchor: CareAnchor | string; cbo_filter: string[] | null; points?: number | null;
  code_filter?: { ciap2?: string[]; cid10?: string[] } | null; applies_to?: { age_min_years?: number; age_max_years?: number; sex?: string } | null;
  all_of?: { source: string; window_days?: number }[][] | null;
}
export interface CareLineTemplate {
  key: string; name: string; indicator: CareIndicator | string; version: number; declared_condition?: DeclaredCondition | null;
  eligibility: CareEligibility; practices: CarePractice[];
}
// T5: `latest_template_version` oferece "Adotar versão N"; nulo na linha própria.
export interface CareLine {
  id: string; name: string; source: "template" | "custom" | string; template_key: string | null; template_version: number | null;
  indicator: string | null; eligibility: CareEligibility; practices: CarePractice[];
  declared_condition: DeclaredCondition | string | null; active: boolean; latest_template_version: number | null;
}
export interface CareLineInput {
  name: string; eligibility: CareEligibility; practices: CarePractice[]; declared_condition?: DeclaredCondition | null;
}
export type CareLinePatch = Partial<CareLineInput> & { active?: boolean; template_version?: number; declared_condition?: DeclaredCondition | null };
// `GET /care_lines/teams` (L10). `can_confirm` por equipe (D2/T2): médico ou
// enfermeiro com vínculo na unidade dela. Profissional sem vínculo: 403 missing_role.
// `panel` (P22): a equipe abre o painel nominal (mesma regra de escopo dele); a prévia usa todas. Ausente = api antigo.
export interface CareTeam { id: string; ine: string; name: string; unit: { id: string; name: string }; can_confirm: boolean; panel?: boolean }
// `GET /care_lines/lines` (L10): `requires_anchor` "lmp" = a linha pede a DUM.
// Dentro de inscrição e sugestão (P3) a referência traz só { id, name, requires_anchor }.
export interface CareLineRef { id: string; name: string; indicator?: string | null; requires_anchor: "lmp" | string | null }
// O contexto do painel: as duas listas de apoio, lidas juntas.
export interface CareContext { teams: CareTeam[]; lines: CareLineRef[] }
// Módulo 24a (L8): o api manda `has_cpf` e o CNS mascarado, sem `cpf_masked`.
export interface CarePerson {
  patient_id: string | null; citizen_id: string | null; display_name: string | null; age: number | null;
  has_cpf?: boolean; cns_masked?: string | null;
}
export interface CarePracticeStatus {
  key: string; label: string; status: CareStatus | string; done_at: string | null; due_on: string | null;
  count: number | null; expected: number | null;
}
// L12: o histórico de contatos só no detalhe; `last_contact` nunca traz a nota.
export interface CareContact {
  id?: string; channel: ContactChannel | string; outcome: ContactOutcome | string; note: string | null;
  recorded_by: { id: string; name: string | null }; recorded_at: string;
}
export interface CareEnrollment {
  id: string; person: CarePerson; care_line: CareLineRef; team: { id: string; ine: string; name: string };
  anchor_date: string | null; status: "active" | "ended" | string; enrolled_at: string; worst_status: CareStatus | string | null;
  ended_reason: EndReason | string | null; ended_at: string | null;
  practices: CarePracticeStatus[]; last_contact: { channel: string; outcome: string; at: string } | null; contacts?: CareContact[];
}
export interface CareEnrollmentPage { enrollments: CareEnrollment[]; next_before: string | null }
export interface EnrollmentQuery { teamId: string; careLineId?: string; status: "overdue" | "due_soon" | "all"; before?: string | null }
// L5/P3: a sugestão nasce numa equipe (`team_id`); `enrollment_id` só na de encerramento.
export interface CareSuggestion {
  id: string; person: CarePerson; care_line: CareLineRef; reason: SuggestionReason | string; created_at: string;
  team_id: string | null; enrollment_id: string | null;
}
export interface CareSuggestionPage { suggestions: CareSuggestion[]; next_before: string | null }
export interface SuggestionQuery { teamId: string; careLineId?: string; before?: string | null }
// L8/P17: `score` e `weight` em texto com uma casa e ponto (a tela mostra vírgula);
// `score`/`concept` nulos = "sem dados". A prática sem ninguém no denominador
// (`no_eligible`) vem em `practices` com weight "0.0", achieved 0 e denominator 0.
export type CareConcept = "optimal" | "good" | "sufficient" | "regular";
export interface CarePreviewPractice {
  key: string; label: string; tracked: boolean; points: number | null; weight: string; achieved: number; denominator: number;
}
export interface CarePreview {
  indicator: string; team: { id: string; ine?: string; name?: string }; template_version: number | null; denominator: number;
  score: string | null; max_score: number; concept: CareConcept | string | null;
  practices: CarePreviewPractice[];
  // `excluded`: famílias de fonte sem dado no sistema (acs_visit, vaccine…);
  // `excluded_practices`: por prática, o motivo de ficar fora da conta.
  excluded: string[]; excluded_practices: { key: string; reason: "untracked" | "no_eligible" | string }[]; estimate: true;
}
// T3/P1: `POST /care_lines/person_lookup` { cpf }. Erros: 422 invalid_cpf, 409
// citizen_not_verified (par só declarado), 404 person_not_found, 403 missing_role,
// 429 too_many_requests. `verified` é sempre true (o ramo falso virou o 409).
export interface CarePersonLookup {
  patient_id: string | null; citizen_id: string; display_name: string | null; cpf_masked: string; verified: true;
}
// T4/P16: o pedido de agendamento (módulo 17) que o atalho abre (201 criado, 200
// reaproveitado). O api tira a `note` do item (`.except(:note)`: a chave não vem). `can_book`: quem pode marcar pelo BookPanel; sem
// ele o pedido só aguarda a recepção. Erros: 409 already_scheduled /
// invalid_transition / citizen_not_verified, 422 invalid_unit, 404 outra equipe.
export interface CareAppointmentTarget { request: Omit<RequestRow, "note">; unit: HealthUnit; can_book: boolean }

export const CARE_PAGE_SIZE = 50;

// As duas listas de apoio (L10), sem trilha: equipes que a pessoa vê e linhas ativas.
export async function getCareContext(): Promise<CareContext> {
  const [ teams, lines ] = await Promise.all([
    jsonFetch<{ teams?: CareTeam[] }>(carePath("teams")), jsonFetch<{ lines?: CareLineRef[] }>(carePath("lines"))
  ]);
  return { teams: teams.teams ?? [], lines: lines.lines ?? [] };
}

export async function listCareTemplates(): Promise<CareLineTemplate[]> {
  return (await jsonFetch<{ templates?: CareLineTemplate[] }>(carePath("admin", "templates"))).templates ?? [];
}

export async function listCityCareLines(): Promise<CareLine[]> {
  return (await jsonFetch<{ lines?: CareLine[] }>(carePath("admin", "lines"))).lines ?? [];
}

// Step-up (contrato §3): quem trata 401 mfa_required é o SensitiveAction.
export async function adoptCareLine(templateKey: string, version: number): Promise<CareLine> {
  return jsonFetch<CareLine>(carePath("admin", "lines"), carePost({ template_key: templateKey, template_version: version }));
}

export async function createCustomCareLine(input: CareLineInput): Promise<CareLine> {
  return jsonFetch<CareLine>(carePath("admin", "lines"), carePost(input));
}

export async function updateCareLine(id: string, patch: CareLinePatch): Promise<CareLine> {
  return jsonFetch<CareLine>(carePath("admin", "lines", id), { method: "PATCH", body: JSON.stringify(patch) });
}

function teamParams(teamId: string, careLineId?: string): URLSearchParams {
  const p = new URLSearchParams({ team_id: teamId });
  if (careLineId) p.set("care_line_id", careLineId);
  return p;
}

// Nominal: o api grava trilha a cada leitura; nunca é relida sozinha.
export async function listCareSuggestions(q: SuggestionQuery): Promise<CareSuggestionPage> {
  const p = teamParams(q.teamId, q.careLineId);
  if (q.before) p.set("before", q.before);
  p.set("limit", String(CARE_PAGE_SIZE));
  const b = await jsonFetch<Partial<CareSuggestionPage>>(withQuery(carePath("suggestions"), p));
  return { suggestions: b.suggestions ?? [], next_before: b.next_before ?? null };
}

// Sugestão de encerramento (L5): `{}` encerra com discharge.
export async function acceptCareSuggestion(id: string, body: { team_id?: string; anchor_date?: string }): Promise<void> {
  await jsonFetch<unknown>(carePath("suggestions", id, "accept"), carePost(body));
}

export async function dismissCareSuggestion(id: string, reason: string): Promise<void> {
  await jsonFetch<unknown>(carePath("suggestions", id, "dismiss"), carePost({ reason }));
}

export async function enrollCare(body: {
  patient_id?: string; citizen_id?: string; care_line_id: string; team_id: string; anchor_date?: string;
}): Promise<CareEnrollment> {
  return jsonFetch<CareEnrollment>(carePath("enrollments"), carePost(body));
}

// Nota vazia não vai.
export async function endCareEnrollment(id: string, reason: EndReason, note: string): Promise<void> {
  const text = note.trim();
  await jsonFetch<unknown>(carePath("enrollments", id, "end"), carePost(text ? { reason, note: text } : { reason }));
}

export async function listCareEnrollments(q: EnrollmentQuery): Promise<CareEnrollmentPage> {
  const p = teamParams(q.teamId, q.careLineId);
  p.set("status", q.status);
  if (q.before) p.set("before", q.before);
  p.set("limit", String(CARE_PAGE_SIZE));
  const b = await jsonFetch<Partial<CareEnrollmentPage>>(withQuery(carePath("enrollments"), p));
  return { enrollments: b.enrollments ?? [], next_before: b.next_before ?? null };
}

export async function getCareEnrollment(id: string): Promise<CareEnrollment> {
  return jsonFetch<CareEnrollment>(carePath("enrollments", id));
}

export async function recordCareContact(id: string, body: { channel: ContactChannel; outcome: ContactOutcome; note: string }): Promise<void> {
  const note = body.note.trim();
  await jsonFetch<unknown>(carePath("enrollments", id, "contacts"),
    carePost(note ? { channel: body.channel, outcome: body.outcome, note } : { channel: body.channel, outcome: body.outcome }));
}

// Contadores (contrato §5): sem trilha; podem reler a cada minuto.
export async function countCareSuggestions(teamId: string): Promise<number> {
  return (await jsonFetch<{ count?: number }>(withQuery(carePath("suggestions", "count"), teamParams(teamId)))).count ?? 0;
}

export async function countOverdueEnrollments(teamId: string): Promise<number> {
  return (await jsonFetch<{ count?: number }>(withQuery(carePath("enrollments", "overdue", "count"), teamParams(teamId)))).count ?? 0;
}

// Agregado, sem nome (contrato §6). `estimate` é sempre true para a tela.
export async function getCarePreview(teamId: string, indicator: CareIndicator): Promise<CarePreview> {
  const b = await jsonFetch<Partial<CarePreview>>(withQuery(carePath("preview"), new URLSearchParams({ team_id: teamId, indicator })));
  return {
    indicator: b.indicator ?? indicator, team: b.team ?? { id: teamId }, template_version: b.template_version ?? null,
    denominator: b.denominator ?? 0, score: b.score ?? null, max_score: b.max_score ?? 100, concept: b.concept ?? null,
    practices: b.practices ?? [], excluded: b.excluded ?? [], excluded_practices: b.excluded_practices ?? [], estimate: true
  };
}

export async function lookupCarePerson(cpf: string): Promise<CarePersonLookup> {
  return (await jsonFetch<{ person: CarePersonLookup }>(carePath("person_lookup"), carePost({ cpf }))).person;
}

export function openCareAppointment(enrollmentId: string): Promise<CareAppointmentTarget> {
  return jsonFetch(carePath("enrollments", enrollmentId, "appointment_request"), carePost({}));
}

// ─── Cadastro territorial (módulo 24a, ADR 0042; contrato 2026-10-23) ───
// Formas do api REAL (§14 L1–L25, §15). Na URL só ids (equipe, microárea,
// domicílio, família, cadastro, paciente), o filtro de situação, o cursor e o
// limite — nunca CPF, CNS, nome, nascimento, mãe, endereço, moradia, condições
// de saúde ou recusa: CPF da busca, nome dos duplicados e as fichas vão no
// corpo. Listas vêm em envelope (ausente = vazio); escritas e detalhe devolvem
// o objeto PURO, inclusive a pessoa do CPF (L3, sem envelope). Mesmo prefixo
// do módulo 11 (TERRITORY_BASE, já no proxy de dev).

const territoryPath = (...parts: string[]) => [ TERRITORY_BASE, ...parts.map(encodeURIComponent) ].join("/");
const territoryWrite = (method: "POST" | "PATCH", body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const TERRITORY_PAGE_SIZE = 50;

// Situação do cadastro (Validity, nesta ordem): exited → refused →
// missing_identifier (sem CPF e sem CNS: a ficha não nasce, L19) → expired
// (24 meses ou mais) → due_soon (até 60 dias) → valid; missing = sem cadastro.
export type RegistryStatus = "valid" | "due_soon" | "expired" | "missing" | "missing_identifier" | "refused" | "exited";
// Os filtros da lista de validade (exited nunca é população).
export type RegistryListStatus = Exclude<RegistryStatus, "exited">;
export type ExitReason = "moved" | "death";
export type PatientSex = "male" | "female";

// Seção da ficha (§15): chave do dicionário em snake_case → código (inteiro),
// lista de códigos, booleano, texto/dígitos/data, contagem ou objeto
// (instituicao_permanencia). Código desconhecido aparece cru, nunca some.
export type CodedValue = number | number[] | boolean | string | null | CodedSection;
export type CodedSection = { [key: string]: CodedValue };

// O nome da equipe pode faltar no CNES (coluna aceita nulo): a tela usa teamName.
export interface TerritoryTeamRef { id: string; ine: string; name: string | null }
export interface MicroArea {
  id: string; team: TerritoryTeamRef; code: string; name: string;
  acs: { professional_id: string; name: string } | null; active: boolean;
}
// Código de 2 dígitos, nome 1–60; acs_professional_id null tira o ACS.
export interface MicroAreaInput { team_id: string; code: string; name: string; acs_professional_id?: string | null }
export interface MicroAreaPatch { name?: string; acs_professional_id?: string | null; active?: boolean }
// L2: equipes 70/76 ativas da cidade e os ACS (CBO 515105) ativos DA EQUIPE.
export interface TerritoryAdminTeam extends TerritoryTeamRef {
  kind: string; unit: { id: string; name: string };
  acs_candidates: { professional_id: string; name: string; has_cns: boolean }[];
}
// L2: equipes do vínculo do profissional, com as microáreas ATIVAS e se ele
// grava as duas fichas nelas (o ACS só na dele).
export interface TerritoryTeam extends TerritoryTeamRef {
  unit: { id: string; name: string };
  // L27: lê a validade da equipe toda (sem microárea) — a mesma regra do registry_status.
  reads_whole_team: boolean;
  micro_areas: (MicroArea & { can_register: boolean })[];
}
export interface TerritoryContext { teams: TerritoryTeam[] }

// Endereço (TerritoryRegistry::Address): exatamente estas chaves. street_type
// é o código DNE em texto ("081" = Rua) e o nome não o repete; number nulo com
// no_number; sem neighborhood_id utilizável, district (texto) é obrigatório.
export interface HouseholdAddress {
  zip: string; street_type: string; street: string; number: string | null; no_number: boolean; complement: string | null;
  neighborhood_id: string | null; district: string | null; reference: string | null;
}
// Domicílio recusado sem endereço: o api devolve `{}`.
export type NoAddress = { [K in keyof HouseholdAddress]?: never };
export interface Family {
  // Paciente nascido de par validado sem nome tem display_name nulo.
  id: string; responsible: { patient_id: string; display_name: string | null };
  // Renda: código do domínio renda_familiar em texto ("3"); living_since "AAAA-MM".
  income_band: string | null; members_count: number | null; living_since: string | null; moved_out: boolean;
  // L29: família ATIVA cujo responsável saiu (óbito, ou mudança deste
  // domicílio sem outro cadastro ativo aqui); em mudança é sempre false.
  responsible_exited: boolean;
}
export interface Household {
  id: string; micro_area: { id: string; code: string }; address: HouseholdAddress | NoAddress;
  // tipoDeImovel em texto ("1" = Domicílio … "99").
  property_type: string;
  // Só no detalhe (a lista não traz).
  living_conditions?: CodedSection;
  contact_phone: string | null; refused: boolean; status: "active" | "inactive"; version: number;
  registered_at: string; registered_by: { name: string | null }; families: Family[];
}
// Endereço obrigatório sem recusa; `status` só no PATCH (inativo só sem família ativa).
export interface HouseholdInput {
  micro_area_id: string; address?: HouseholdAddress | null; property_type: string; living_conditions?: CodedSection | null;
  contact_phone: string | null; refused: boolean; status?: "active" | "inactive";
}
export interface HouseholdQuery { microAreaId: string; before?: string | null }
// next_before: cursor opaco do api; repasse como veio.
export interface HouseholdPage { households: Household[]; next_before: string | null }
// O responsável só na criação (nunca muda); a família nasce morando e a
// mudança (moved_out: true) é definitiva.
export interface FamilyInput {
  responsible?: { patient_id: string }; income_band: string | null; members_count: number | null; living_since: string | null;
  moved_out?: boolean;
}

export interface DuplicateQuery { full_name: string; birth_date: string; mother_name?: string | null }
// L29: registration_id = o cadastro ATIVO do paciente, só quando o usuário o
// lê (fora do alcance, saído ou sem cadastro: null).
export interface DuplicateCandidate { patient_id: string; display_name: string; birth_date: string; has_cpf: boolean; registration_id: string | null }
// L3: a pessoa pelo CPF — paciente (com o cadastro ativo, se houver) ou par
// validado sem paciente. Ninguém → 404 person_not_found; par só declarado →
// 409 citizen_not_verified.
export interface TerritoryPerson { patient_id: string | null; citizen_id: string | null; display_name: string | null; registration_id: string | null }

// Identidade digitada de paciente EXISTENTE (`patient`, L4): só sem par
// validado; com par, valor diferente → 422 identity_locked.
export interface PatientIdentity {
  full_name?: string; social_name?: string | null; birth_date?: string; sex?: PatientSex; mother_name?: string | null;
}
// Paciente novo (Patients::CreateTyped): só textos; CPF ou justificativa
// (código "2".."13"), nunca os dois; CNS opcional. Raça/cor NÃO vai aqui.
export interface NewPatient {
  full_name: string; social_name?: string | null; birth_date: string; sex: PatientSex; mother_name?: string | null;
  cpf?: string | null; no_cpf_reason?: string | null; cns?: string | null;
}
// Raça/cor e etnia no código do paciente (BPA: "01".."05"; etnia só com "05").
export interface PatientDemographics { race_color: string | null; ethnicity: string | null }
// Nome, nascimento e sexo podem faltar: o Patients::Resolve cria o paciente
// pelo CPF e copia do par validado só o que houver (validação sem perfil).
export interface RegistrationPatient {
  id: string; display_name: string | null; full_name: string | null; mother_name: string | null; birth_date: string | null;
  sex: PatientSex | null;
  has_cpf: boolean; no_cpf_reason: string | null; cns_masked: string | null;
  // Par validado: nome, nascimento, sexo e mãe só leitura.
  identity_locked: boolean;
}
export interface RegistrationExit { reason: ExitReason; on: string; death_on: string | null; death_certificate: string | null }
export interface Registration {
  id: string; patient: RegistrationPatient; patient_demographics: PatientDemographics;
  household_id: string | null; family_id: string | null; is_responsible: boolean;
  team: TerritoryTeamRef; micro_area: { id: string; code: string } | null;
  identification: CodedSection; sociodemographic: CodedSection; health_conditions: CodedSection; street_situation: CodedSection | null;
  refused: boolean; exit: RegistrationExit | null; status: RegistryStatus; version: number;
  registered_at: string; registered_by: { name: string | null };
  identity_changed_at: string | null;
  // L24: identidade atualizada no posto depois da última gravação — revisar e salvar.
  identity_review_pending: boolean;
}
// Corpo comum do POST e do PATCH. Paciente existente: `patient` (identidade
// digitada), `cpf` (quem não tinha) e `cns` na raiz. Lugar: household_id
// (+ family_id; is_responsible bate com o responsável) ou, fora de área,
// team_id. Com recusa, as seções não vão.
export interface RegistrationBody {
  patient?: PatientIdentity; cpf?: string | null; cns?: string | null; patient_demographics?: Partial<PatientDemographics>;
  household_id?: string | null; family_id?: string | null; team_id?: string | null; is_responsible?: boolean;
  identification?: CodedSection; sociodemographic?: CodedSection; health_conditions?: CodedSection;
  street_situation?: CodedSection | null; refused?: boolean;
}
// POST: a pessoa é uma das três; com new_patient, `patient`/`cpf`/`cns` não vão.
// L28: `duplicates_reviewed: true` só quando a pessoa passou pela busca de
// duplicados e confirmou que é outra; sem ele, nome e nascimento de um
// paciente existente → 409 duplicate_suspected.
export type RegistrationInput = (
  { patient_id: string } | { citizen_id: string }
  | { new_patient: NewPatient; duplicates_reviewed?: boolean; patient?: never; cpf?: never; cns?: never }
) & RegistrationBody;
// PATCH: a pessoa é a do cadastro (patient_id, se vier, tem de ser o mesmo).
export type RegistrationUpdate = RegistrationBody & { patient_id?: string };
export type RegistrationQuery = { patientId: string } | { householdId: string };
// death_on obrigatório com óbito e proibido com mudança; DO (9 dígitos) opcional, só no óbito.
export type ExitInput =
  | { reason: "moved"; on: string }
  | { reason: "death"; on: string; death_on: string; death_certificate?: string | null };

export interface PersonRow {
  patient_id: string | null; citizen_id: string | null; display_name: string | null; age: number | null; micro_area_code: string | null;
  status: RegistryListStatus; registered_at: string | null; registration_id: string | null; identity_review_pending: boolean;
}
// Com microárea, a população é só quem tem cadastro nela (missing vem vazio);
// o ACS só lê a própria microárea.
export interface RegistryStatusQuery { teamId: string; microAreaId?: string | null; status?: RegistryListStatus | null; before?: string | null }
// next_before: person_ref ("patient:<uuid>" | "citizen:<uuid>").
export interface RegistryStatusPage { people: PersonRow[]; next_before: string | null }
// refused fica fora das contagens.
export interface RegistryCounts { valid: number; due_soon: number; expired: number; missing: number; missing_identifier: number }

// ── Microáreas (municipal_admin; escrita com step-up, contrato §3) ──
export async function listTerritoryAdminTeams(): Promise<TerritoryAdminTeam[]> {
  return (await jsonFetch<{ teams?: TerritoryAdminTeam[] }>(territoryPath("admin", "teams"))).teams ?? [];
}

export async function listMicroAreas(teamId: string): Promise<MicroArea[]> {
  const url = withQuery(territoryPath("admin", "micro_areas"), new URLSearchParams({ team_id: teamId }));
  return (await jsonFetch<{ micro_areas?: MicroArea[] }>(url)).micro_areas ?? [];
}

export function createMicroArea(input: MicroAreaInput): Promise<MicroArea> {
  return jsonFetch<MicroArea>(territoryPath("admin", "micro_areas"), territoryWrite("POST", input));
}

export function updateMicroArea(id: string, patch: MicroAreaPatch): Promise<MicroArea> {
  return jsonFetch<MicroArea>(territoryPath("admin", "micro_areas", id), territoryWrite("PATCH", patch));
}

// ── Contexto do profissional (L2; sem trilha) ──
export async function getTerritoryContext(): Promise<TerritoryContext> {
  return { teams: (await jsonFetch<Partial<TerritoryContext>>(territoryPath("teams"))).teams ?? [] };
}

// ── Domicílios e famílias (contrato §4; leitura nominal com trilha) ──
export async function listHouseholds(q: HouseholdQuery): Promise<HouseholdPage> {
  const p = new URLSearchParams({ micro_area_id: q.microAreaId });
  if (q.before) p.set("before", q.before);
  p.set("limit", String(TERRITORY_PAGE_SIZE));
  const b = await jsonFetch<Partial<HouseholdPage>>(withQuery(territoryPath("households"), p));
  return { households: b.households ?? [], next_before: b.next_before ?? null };
}

export function getHousehold(id: string): Promise<Household> {
  return jsonFetch<Household>(territoryPath("households", id));
}

export function createHousehold(input: HouseholdInput): Promise<Household> {
  return jsonFetch<Household>(territoryPath("households"), territoryWrite("POST", input));
}

// `version`: a versão esperada do domicílio (outra → 409 stale_version).
export function updateHousehold(id: string, input: HouseholdInput, version: number): Promise<Household> {
  return jsonFetch<Household>(territoryPath("households", id), territoryWrite("PATCH", { ...input, version }));
}

// A família grava a versão seguinte do DOMICÍLIO: `version` é a dele, e a
// resposta é o domicílio inteiro.
export function addFamily(householdId: string, input: FamilyInput & { responsible: { patient_id: string } }, version: number): Promise<Household> {
  return jsonFetch<Household>(territoryPath("households", householdId, "families"), territoryWrite("POST", { ...input, version }));
}

export function updateFamily(id: string, input: FamilyInput, version: number): Promise<Household> {
  return jsonFetch<Household>(territoryPath("families", id), territoryWrite("PATCH", { ...input, version }));
}

// L29: troca o responsável que saiu. `familyId` é o da família ANTIGA e
// `version` a do DOMICÍLIO; nasce uma família nova (a antiga fica em mudança)
// e a resposta (201) é o domicílio inteiro.
export function replaceResponsible(familyId: string, patientId: string, version: number): Promise<Household> {
  return jsonFetch<Household>(territoryPath("families", familyId, "replace_responsible"),
    territoryWrite("POST", { responsible: { patient_id: patientId }, version }));
}

// ── Pessoa (contrato §5, L3): tudo no corpo; 30 por minuto (429) ──
export async function findDuplicates(q: DuplicateQuery): Promise<DuplicateCandidate[]> {
  return (await jsonFetch<{ candidates?: DuplicateCandidate[] }>(territoryPath("patients", "duplicates"), territoryWrite("POST", q)))
    .candidates ?? [];
}

export function lookupTerritoryPerson(cpf: string): Promise<TerritoryPerson> {
  return jsonFetch<TerritoryPerson>(territoryPath("person_lookup"), territoryWrite("POST", { cpf }));
}

// ── Cadastro individual (contrato §5; leitura nominal com trilha) ──
export function createRegistration(input: RegistrationInput): Promise<Registration> {
  return jsonFetch<Registration>(territoryPath("registrations"), territoryWrite("POST", input));
}

export function updateRegistration(id: string, input: RegistrationUpdate, version: number): Promise<Registration> {
  return jsonFetch<Registration>(territoryPath("registrations", id), territoryWrite("PATCH", { ...input, version }));
}

// Sem `version`: saída concorrente → 409 stale_version; já saiu ou recusado → 422 invalid_transition.
export function exitRegistration(id: string, input: ExitInput): Promise<Registration> {
  return jsonFetch<Registration>(territoryPath("registrations", id, "exit"), territoryWrite("POST", input));
}

export function getRegistration(id: string): Promise<Registration> {
  return jsonFetch<Registration>(territoryPath("registrations", id));
}

// Por domicílio: só os ativos legíveis; por paciente: [] sem cadastro legível.
export async function listRegistrations(q: RegistrationQuery): Promise<Registration[]> {
  const p = "patientId" in q ? new URLSearchParams({ patient_id: q.patientId }) : new URLSearchParams({ household_id: q.householdId });
  return (await jsonFetch<{ registrations?: Registration[] }>(withQuery(territoryPath("registrations"), p))).registrations ?? [];
}

// ── Validade (contrato §6, L12/L19) ──
// Nominal (grava trilha por pessoa): nunca relida sozinha.
export async function listRegistryStatus(q: RegistryStatusQuery): Promise<RegistryStatusPage> {
  const p = new URLSearchParams({ team_id: q.teamId });
  if (q.microAreaId) p.set("micro_area_id", q.microAreaId);
  if (q.status) p.set("status", q.status);
  if (q.before) p.set("before", q.before);
  p.set("limit", String(TERRITORY_PAGE_SIZE));
  const b = await jsonFetch<Partial<RegistryStatusPage>>(withQuery(territoryPath("registry_status"), p));
  return { people: b.people ?? [], next_before: b.next_before ?? null };
}

// Sem trilha: pode reler a cada minuto.
export async function countRegistryStatus(teamId: string, microAreaId?: string | null): Promise<RegistryCounts> {
  const p = new URLSearchParams({ team_id: teamId });
  if (microAreaId) p.set("micro_area_id", microAreaId);
  const b = await jsonFetch<Partial<RegistryCounts>>(withQuery(territoryPath("registry_status", "count"), p));
  return { valid: b.valid ?? 0, due_soon: b.due_soon ?? 0, expired: b.expired ?? 0, missing: b.missing ?? 0,
    missing_identifier: b.missing_identifier ?? 0 };
}

// ─── Vigilância epidemiológica (módulo 25, ADR 0043; contrato 2026-10-27 §2–§8, §14, §15) ───
// Formas do api REAL (K5, K15). Na URL só ids, o código da doença, a situação,
// as semanas, o cursor e o limite — nunca CPF, CNS, nome, nascimento, mãe, ficha,
// motivo, classificação ou número oficial: a pessoa, a ficha e o andamento vão no
// corpo. Listas vêm em envelope (ausente = vazio); escritas e detalhe devolvem o
// objeto PURO. Filtro vazio ou nulo nunca vai na URL (o api recusa `disease=`).

const SURVEILLANCE_BASE = import.meta.env.VITE_SURVEILLANCE_BASE || "/surveillance";
const survPath = (...parts: string[]) => [ SURVEILLANCE_BASE, ...parts.map(encodeURIComponent) ].join("/");
const survWrite = (method: "POST" | "PATCH", body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const SURVEILLANCE_PAGE_SIZE = 50;

export type DiseaseDeadline = "immediate" | "weekly";
export type NotificationOrigin = "consultation" | "manual" | "safety_net";
export type NotificationStatus = "possible" | "notified" | "investigating" | "closed" | "entered" | "dismissed";
export type NotificationClassification = "confirmed" | "discarded" | "inconclusive";
export interface NotifiableDisease {
  code: string; name: string; deadline: DiseaseDeadline | string; cid10: string[]; ciap2: string[]; repeat_after_days: number;
  sinan_form: string | null; local: boolean; list_version: number | null;
  // K13c: a nota explica a doença sem CID (só notificação manual). `id` e `active` são da local (nulos na nacional).
  notes: string | null; id: string | null; active: boolean | null;
}
// D4: a doença local tem id e pode ser desativada (some das sugestões; o que foi notificado fica).
export interface LocalDisease extends NotifiableDisease { id: string; active: boolean }
export interface LocalDiseaseInput {
  code?: string; name: string; deadline: DiseaseDeadline; cid10: string[]; ciap2: string[]; repeat_after_days: number; active?: boolean;
}
export interface NotificationSuggestion { disease: NotifiableDisease; matched_code: string }
// §14 (A1): o api só aceita texto (outro tipo → 422 invalid_form); null limpa o campo. Chaves em sinan-form.yml.
export type NotificationForm = Record<string, string | null>;
export interface NotificationEvent { status: NotificationStatus | string; at: string; by: { name: string } | null; reason: string | null }
export interface NotificationPatient { id: string; display_name: string | null; has_cpf: boolean; cns_masked: string | null }
export interface SurveillanceNotification {
  id: string; patient: NotificationPatient; disease: { code: string; name: string; deadline: DiseaseDeadline | string };
  origin: NotificationOrigin | string; status: NotificationStatus | string; classification: NotificationClassification | string | null;
  suspected_on: string; symptoms_on: string | null; unit: { id: string; cnes: string | null; name: string }; notifier: { name: string } | null;
  // K5: prazo da doença no momento da notificação; datas de cada passo (nulas até acontecer).
  deadline: DiseaseDeadline | string; due_at: string; overdue: boolean; official_number: string | null;
  resident_elsewhere: boolean; residence_ibge: string | null; neighborhood: { id: string | null; name: string } | null;
  consultation_id: string | null; closed_at: string | null; entered_at: string | null; dismissed_at: string | null; version: number;
  // Só no detalhe (a lista não traz).
  form?: NotificationForm; events?: NotificationEvent[];
}
export interface NotificationQuery {
  status?: NotificationStatus | null; disease?: string | null; overdue?: boolean; unitId?: string | null;
  // K7: encerradas sem número oficial (o api força status=closed).
  withoutOfficialNumber?: boolean; before?: string | null;
}
export interface NotificationPage { notifications: SurveillanceNotification[]; next_before: string | null }
export interface NotificationCounts {
  possible: number; notified: number; investigating: number; overdue: number; immediate_open: number; without_official_number: number;
}
export interface ConsultationNotificationInput { consultation_id: string; disease_code: string; symptoms_on?: string | null }
export type ManualNotificationInput = (
  { patient_id: string } | { citizen_id: string } | { new_patient: NewPatient; duplicates_reviewed?: boolean }
) & {
  disease_code: string; suspected_on: string; symptoms_on?: string | null; unit_id: string;
  resident_elsewhere?: boolean; residence_ibge?: string | null;
};
export interface TransitionInput {
  to: NotificationStatus; classification?: NotificationClassification; official_number?: string; reason?: string; version: number;
}
export type WeeklyNegativeStatus = "with_cases" | "negative" | "pending";
export interface WeeklyNegatives { week: string; units: { unit: { id: string; cnes: string | null; name: string }; status: WeeklyNegativeStatus | string }[] }
// D2: unidades ativas para a vigilância (a rota do atendimento não é do papel surveillance).
export interface SurveillanceUnit { id: string; cnes: string | null; name: string; kind: string; notifying: boolean }
export interface PanelQuery { fromWeek: string; toWeek: string; disease?: string | null }
export interface SurveillancePanel {
  weeks: string[]; rows: { neighborhood: { id: string | null; name: string }; counts: (number | null)[]; signal: boolean[] }[]; suppressed: boolean;
}
// A busca por CPF da vigilância: a forma do 24a mais `has_cpf` e `cns_masked` (L8); sem cadastro territorial.
export interface SurveillancePerson extends TerritoryPerson { has_cpf: boolean; cns_masked: string | null }

// ── Lista de doenças e consulta ──
export async function listSurveillanceDiseases(): Promise<NotifiableDisease[]> {
  return (await jsonFetch<{ diseases?: NotifiableDisease[] }>(survPath("diseases"))).diseases ?? [];
}

// D1: sugestão na consulta (autora; sem trilha). O prefixo é o do atendimento.
export async function getNotificationSuggestions(consultationId: string): Promise<NotificationSuggestion[]> {
  return (await jsonFetch<{ suggestions?: NotificationSuggestion[] }>(consultationPath(consultationId, "notification_suggestions")))
    .suggestions ?? [];
}

export function createConsultationNotification(input: ConsultationNotificationInput): Promise<SurveillanceNotification> {
  return jsonFetch<SurveillanceNotification>(survPath("notifications"), survWrite("POST", input));
}

export function createManualNotification(input: ManualNotificationInput): Promise<SurveillanceNotification> {
  return jsonFetch<SurveillanceNotification>(survPath("notifications"), survWrite("POST", input));
}

// ── Fila, detalhe e ficha ──
// Só o que veio, na ordem do contrato; vazio e nulo ficam de fora.
function notificationParams(q: NotificationQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.status) p.set("status", q.status);
  if (q.disease) p.set("disease", q.disease);
  if (q.overdue === true) p.set("overdue", "true");
  if (q.unitId) p.set("unit_id", q.unitId);
  if (q.withoutOfficialNumber === true) p.set("without_official_number", "true");
  if (q.before) p.set("before", q.before);
  p.set("limit", String(SURVEILLANCE_PAGE_SIZE));
  return p;
}

// Nominal (uma trilha por consulta): nunca relida sozinha.
export async function listNotifications(q: NotificationQuery): Promise<NotificationPage> {
  const b = await jsonFetch<Partial<NotificationPage>>(withQuery(survPath("notifications"), notificationParams(q)));
  return { notifications: b.notifications ?? [], next_before: b.next_before ?? null };
}

export function getNotification(id: string): Promise<SurveillanceNotification> {
  return jsonFetch<SurveillanceNotification>(survPath("notifications", id));
}

// Sem trilha: pode reler a cada minuto.
export async function countNotifications(): Promise<NotificationCounts> {
  const b = await jsonFetch<Partial<NotificationCounts>>(survPath("notifications", "count"));
  return { possible: b.possible ?? 0, notified: b.notified ?? 0, investigating: b.investigating ?? 0, overdue: b.overdue ?? 0,
    immediate_open: b.immediate_open ?? 0, without_official_number: b.without_official_number ?? 0 };
}

// A ficha inteira e a versão lida, só do corpo.
export function updateNotificationForm(id: string, form: NotificationForm, version: number): Promise<SurveillanceNotification> {
  return jsonFetch<SurveillanceNotification>(survPath("notifications", id), survWrite("PATCH", { form, version }));
}

export function transitionNotification(id: string, input: TransitionInput): Promise<SurveillanceNotification> {
  return jsonFetch<SurveillanceNotification>(survPath("notifications", id, "transition"), survWrite("POST", input));
}

export function dismissNotification(id: string, reason: string, version: number): Promise<SurveillanceNotification> {
  return jsonFetch<SurveillanceNotification>(survPath("notifications", id, "dismiss"), survWrite("POST", { reason, version }));
}

// ── Notificação manual: unidades e pessoa (D2, D3) ──
export async function listSurveillanceUnits(): Promise<SurveillanceUnit[]> {
  return (await jsonFetch<{ units?: SurveillanceUnit[] }>(survPath("units"))).units ?? [];
}

// A vigilância não abre cadastro territorial: registration_id sempre nulo (o PersonStart nunca oferece "Já tem cadastro").
export async function lookupSurveillancePerson(cpf: string): Promise<SurveillancePerson> {
  const b = await jsonFetch<Omit<SurveillancePerson, "registration_id">>(survPath("person_lookup"), survWrite("POST", { cpf }));
  return { ...b, registration_id: null };
}

export async function findSurveillanceDuplicates(q: DuplicateQuery): Promise<DuplicateCandidate[]> {
  const b = await jsonFetch<{ candidates?: Omit<DuplicateCandidate, "registration_id">[] }>(
    survPath("patients", "duplicates"), survWrite("POST", q));
  return (b.candidates ?? []).map((c) => ({ ...c, registration_id: null }));
}

// ── Negativa semanal, saídas e painel ──
export function listWeeklyNegatives(week: string): Promise<WeeklyNegatives> {
  return jsonFetch<WeeklyNegatives>(withQuery(survPath("weekly_negatives"), new URLSearchParams({ week })));
}

export async function recordWeeklyNegative(unitId: string, week: string): Promise<void> {
  await jsonFetch<unknown>(survPath("weekly_negatives"), survWrite("POST", { unit_id: unitId, week }));
}

// Trilha por pessoa; o nome do arquivo vem do api (notificacao-<id>.pdf), sem dado pessoal.
export function fetchNotificationPdf(id: string): Promise<SignatureFile> {
  return binaryFetch(survPath("notifications", id, "form.pdf"), "application/pdf");
}

export function fetchWeekCsv(week: string): Promise<SignatureFile> {
  return binaryFetch(withQuery(survPath("exports", "week.csv"), new URLSearchParams({ week })), "text/csv");
}

// Agregado sem nome de pessoa e sem trilha. Doença vazia ou nula = todas (o api recusa `disease=`).
export function getSurveillancePanel(q: PanelQuery): Promise<SurveillancePanel> {
  const p = new URLSearchParams({ from_week: q.fromWeek, to_week: q.toWeek });
  if (q.disease) p.set("disease", q.disease);
  return jsonFetch<SurveillancePanel>(withQuery(survPath("panel"), p));
}

// ── Doenças locais (surveillance; escrita com step-up) ──
export async function listLocalDiseases(): Promise<LocalDisease[]> {
  return (await jsonFetch<{ diseases?: LocalDisease[] }>(survPath("admin", "local_diseases"))).diseases ?? [];
}

export function createLocalDisease(input: LocalDiseaseInput): Promise<LocalDisease> {
  return jsonFetch<LocalDisease>(survPath("admin", "local_diseases"), survWrite("POST", input));
}

// PATCH parcial: só as chaves presentes mudam (desativar manda só `active`).
export function updateLocalDisease(id: string, input: Partial<LocalDiseaseInput>): Promise<LocalDisease> {
  return jsonFetch<LocalDisease>(survPath("admin", "local_diseases", id), survWrite("PATCH", input));
}

// ─── Regulação municipal (módulo 26a, ADR 0044; contrato 2026-10-28 §2–§8, §13) ───
// Na URL só ids, tipo e código do alvo, cor, situação, mês, cursor e limite — nunca
// CPF, CNS, nome, CID-10, CIAP-2, justificativa, motivo, local ou número externo:
// tudo isso, e a versão esperada, vai no corpo. Listas vêm em envelope (ausente =
// vazio); escritas e detalhe devolvem o objeto PURO. Filtro vazio ou nulo nunca vai na URL.

const REGULATION_BASE = import.meta.env.VITE_REGULATION_BASE || "/regulation";
const regPath = (...parts: string[]) => [ REGULATION_BASE, ...parts.map(encodeURIComponent) ].join("/");
// Sempre com corpo (`{}` no DELETE do rascunho): o jsonFetch só põe o Content-Type quando há corpo.
const regWrite = (method: "POST" | "PATCH" | "DELETE", body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const REGULATION_PAGE_SIZE = 50;

export type RegulationType = "specialty" | "procedure";
export type RiskColor = "red" | "yellow" | "green" | "blue";
export type RegulationStatus =
  | "draft" | "pending" | "returned" | "denied" | "authorized" | "scheduled" | "completed" | "missed" | "cancelled" | "closed" | "external";
export type ProviderKind = "own" | "contracted" | "consortium" | "ppi";
export type ExternalSystem = "sisreg" | "care" | "cross" | "other";

export interface RegulationTarget { type: RegulationType; code: string; name: string; group?: string | null; nurse_allowed?: boolean }
export interface RegulationEvent { status: RegulationStatus | string; at: string; by: { name: string } | null; reason: string | null }
export interface RegulationPatient { id: string; display_name: string | null; has_cpf: boolean; cns_masked: string | null }
export interface RegulationRequest {
  id: string; patient: RegulationPatient; type: RegulationType | string; target: { code: string; name: string };
  cid10: string | null; ciap2: string | null; justification: string; suggested_color: RiskColor | string;
  // A cor CONFIRMADA pelo regulador: nula até ele confirmar. A que ordena a fila é a efetiva (`effectiveColor`).
  color: RiskColor | string | null;
  color_reason: string | null; status: RegulationStatus | string;
  // Nulos no rascunho.
  requested_at: string | null; due_on: string | null; overdue: boolean;
  requester: { name: string; cbo: string; unit: { id: string; name: string } }; consultation_id: string;
  authorization: {
    offer_id: string; provider: { id: string; name: string; kind: ProviderKind | string }; month: string;
    skip_reason: string | null; at: string; by: { name: string };
  } | null;
  appointment_request_id: string | null; schedule: { at: string; place: string; notes: string | null; care_provider?: { id: string; name: string } | null } | null;
  outcome: "completed" | "missed" | string | null; misses: number; external: { system: ExternalSystem | string; number: string } | null;
  state_regulated: boolean; version: number; events?: RegulationEvent[];
}
export interface RegulationRequestInput {
  type: RegulationType; target_code: string; cid10?: string | null; ciap2?: string | null; justification: string;
  suggested_color: RiskColor; state_regulated?: boolean;
}
export interface RegulationQuery {
  status?: string | null; overdue?: boolean; type?: RegulationType | null; targetCode?: string | null; color?: RiskColor | null; before?: string | null;
}
export interface RegulationPage { requests: RegulationRequest[]; next_before: string | null }
export interface RegulationCounts { pending: number; overdue: number; returned: number; authorized: number; external: number }
export interface AuthorizeInput { offer_id: string; color?: RiskColor; color_reason?: string; skip_reason?: string; version: number }
export interface ComplementInput { justification: string; cid10?: string | null; ciap2?: string | null; suggested_color?: RiskColor; version: number }
// Nome próprio: `ScheduleInput` já é o agendamento de exame (21a).
// Módulo 30 (D13): `care_provider_id` opcional; reagendar sem ele limpa o prestador — reenvie o atual.
export interface RegulationScheduleInput { at: string; place: string; notes?: string | null; care_provider_id?: string | null; version: number }
export interface CareProvider {
  id: string; name: string; cnes: string | null; kind: ProviderKind | string; health_unit: { id: string; name: string } | null; active: boolean;
  // Módulo 30 (D13): município do prestador (7 dígitos), que liga o agendamento ao destino do transporte; nulo para `own`.
  ibge_code: string | null;
}
export interface CareProviderInput { name: string; cnes?: string; kind: ProviderKind; health_unit_id?: string | null; active: boolean; ibge_code?: string | null }
export interface CareOffer {
  id: string; provider: { id: string; name: string; kind: ProviderKind | string };
  target: RegulationTarget; month: string; quantity: number; used: number; available: number;
}
export interface CareOfferInput { provider_id: string; target_type: RegulationType; target_code: string; month: string; quantity: number }
export interface RiskDeadlines { red: number; yellow: number; green: number; blue: number }
export interface NurseItem { target_type: RegulationType; target_code: string; name: string }

// Busca de alvo (R2): especialidade ou procedimento regulável; o termo vai na URL, que não guarda dado de pessoa.
export async function searchRegulationTargets(q: string, type: RegulationType): Promise<RegulationTarget[]> {
  const p = new URLSearchParams({ type, q, limit: "20" });
  return (await jsonFetch<{ targets?: RegulationTarget[] }>(withQuery(regPath("targets"), p))).targets ?? [];
}

// ── Pedidos da consulta (rascunho editável só até finalizar) ──
export async function listConsultationRegulationRequests(consultationId: string): Promise<RegulationRequest[]> {
  return (await jsonFetch<{ requests?: RegulationRequest[] }>(consultationPath(consultationId, "regulation_requests"))).requests ?? [];
}

export function createRegulationRequest(consultationId: string, input: RegulationRequestInput): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(consultationPath(consultationId, "regulation_requests"), regWrite("POST", input));
}

export function updateRegulationRequest(consultationId: string, id: string, input: RegulationRequestInput): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(
    consultationPath(consultationId, `regulation_requests/${encodeURIComponent(id)}`), regWrite("PATCH", input));
}

export async function deleteRegulationRequest(consultationId: string, id: string): Promise<void> {
  await jsonFetch<void>(consultationPath(consultationId, `regulation_requests/${encodeURIComponent(id)}`), regWrite("DELETE", {}));
}

export function fetchRegulationGuide(id: string): Promise<SignatureFile> {
  return binaryFetch(regPath("requests", id, "guide.pdf"), "application/pdf");
}

// ── Fila e decisões do regulador ──
function regulationParams(q: RegulationQuery): URLSearchParams {
  const p = new URLSearchParams();
  if (q.status) p.set("status", q.status);
  if (typeof q.overdue === "boolean") p.set("overdue", q.overdue ? "true" : "false");
  if (q.type) p.set("type", q.type);
  if (q.targetCode) p.set("target_code", q.targetCode);
  if (q.color) p.set("color", q.color);
  if (q.before) p.set("before", q.before);
  p.set("limit", String(REGULATION_PAGE_SIZE));
  return p;
}

export async function listRegulationRequests(q: RegulationQuery): Promise<RegulationPage> {
  const b = await jsonFetch<{ requests?: RegulationRequest[]; next_before?: string | null }>(
    withQuery(regPath("requests"), regulationParams(q)));
  return { requests: b.requests ?? [], next_before: b.next_before ?? null };
}

export function getRegulationRequest(id: string): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(regPath("requests", id));
}

export async function countRegulationRequests(): Promise<RegulationCounts> {
  const b = await jsonFetch<Partial<RegulationCounts>>(regPath("requests", "count"));
  return { pending: b.pending ?? 0, overdue: b.overdue ?? 0, returned: b.returned ?? 0, authorized: b.authorized ?? 0, external: b.external ?? 0 };
}

export function authorizeRegulationRequest(id: string, input: AuthorizeInput): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(regPath("requests", id, "authorize"), regWrite("POST", input));
}

export function returnRegulationRequest(id: string, reason: string, version: number): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(regPath("requests", id, "return"), regWrite("POST", { reason, version }));
}

export function denyRegulationRequest(id: string, reason: string, version: number): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(regPath("requests", id, "deny"), regWrite("POST", { reason, version }));
}

export function cancelRegulationRequest(id: string, reason: string, version: number): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(regPath("requests", id, "cancel"), regWrite("POST", { reason, version }));
}

// ── Solicitante: devolvidos da unidade e complemento ──
// Paginado por cursor opaco (`before`), como a fila: só ids na URL; `next_before` nulo = última página.
export async function listReturnedRequests(unitId: string, before?: string | null): Promise<RegulationPage> {
  const p = new URLSearchParams({ unit_id: unitId });
  if (before) p.set("before", before);
  p.set("limit", String(REGULATION_PAGE_SIZE));
  const b = await jsonFetch<{ requests?: RegulationRequest[]; next_before?: string | null }>(withQuery(regPath("returned"), p));
  return { requests: b.requests ?? [], next_before: b.next_before ?? null };
}

export function complementRegulationRequest(id: string, input: ComplementInput): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(regPath("requests", id, "complement"), regWrite("POST", input));
}

// ── Rede externa: agendamento, desfecho e número do sistema do estado ──
export function scheduleRegulationRequest(id: string, input: RegulationScheduleInput): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(regPath("requests", id, "schedule"), regWrite("POST", input));
}

export function recordRegulationOutcome(id: string, result: "completed" | "missed", version: number): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(regPath("requests", id, "outcome"), regWrite("POST", { result, version }));
}

export function setRegulationExternal(id: string, system: ExternalSystem, number: string, version: number): Promise<RegulationRequest> {
  return jsonFetch<RegulationRequest>(regPath("requests", id, "external"), regWrite("POST", { system, number, version }));
}

// CSV livre para digitar no sistema do estado. Situação vazia ou nula = sem filtro.
export function fetchStateExportCsv(status?: string | null): Promise<SignatureFile> {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  return binaryFetch(withQuery(regPath("exports", "state.csv"), p), "text/csv");
}

// ── Administração (municipal_admin): prestadores, ofertas, prazos e lista do enfermeiro ──
export async function listCareProviders(): Promise<CareProvider[]> {
  return (await jsonFetch<{ providers?: CareProvider[] }>(regPath("admin", "providers"))).providers ?? [];
}

export function createCareProvider(input: CareProviderInput): Promise<CareProvider> {
  return jsonFetch<CareProvider>(regPath("admin", "providers"), regWrite("POST", input));
}

export function updateCareProvider(id: string, input: CareProviderInput): Promise<CareProvider> {
  return jsonFetch<CareProvider>(regPath("admin", "providers", id), regWrite("PATCH", input));
}

export async function listCareOffers(q: { month?: string | null; targetCode?: string | null }): Promise<CareOffer[]> {
  const p = new URLSearchParams();
  if (q.month) p.set("month", q.month);
  if (q.targetCode) p.set("target_code", q.targetCode);
  return (await jsonFetch<{ offers?: CareOffer[] }>(withQuery(regPath("admin", "offers"), p))).offers ?? [];
}

export function createCareOffer(input: CareOfferInput): Promise<CareOffer> {
  return jsonFetch<CareOffer>(regPath("admin", "offers"), regWrite("POST", input));
}

export function updateCareOffer(id: string, quantity: number): Promise<CareOffer> {
  return jsonFetch<CareOffer>(regPath("admin", "offers", id), regWrite("PATCH", { quantity }));
}

export function getRiskDeadlines(): Promise<RiskDeadlines> {
  return jsonFetch<RiskDeadlines>(regPath("admin", "deadlines"));
}

export function updateRiskDeadlines(d: RiskDeadlines): Promise<RiskDeadlines> {
  return jsonFetch<RiskDeadlines>(regPath("admin", "deadlines"), regWrite("PATCH", d));
}

export async function listNurseItems(): Promise<NurseItem[]> {
  return (await jsonFetch<{ items?: NurseItem[] }>(regPath("admin", "nurse_items"))).items ?? [];
}

export function addNurseItem(input: { target_type: RegulationType; target_code: string }): Promise<NurseItem> {
  return jsonFetch<NurseItem>(regPath("admin", "nurse_items"), regWrite("POST", input));
}

export async function removeNurseItem(item: { target_type: RegulationType; target_code: string }): Promise<void> {
  await jsonFetch<void>(regPath("admin", "nurse_items"), regWrite("DELETE", item));
}

// ─── Farmácia e almoxarifado (módulo 27a, ADR 0045; contrato 2026-10-29 §2–§9, §13 H1–H12) ───
// Na URL só ids, situação, filtros booleanos, nome do medicamento na busca da posição, cursor e limite —
// nunca CPF, CNS, nome, código da receita, conteúdo da receita, profissional, posologia, motivo ou número
// de notificação: tudo isso vai no corpo. A busca da receita, da pessoa e dos duplicados é POST (grava
// trilha no api). Listas vêm em envelope (ausente = vazio); escritas e detalhes devolvem o objeto PURO
// (H12); o DELETE de equipe devolve 204. Quantidades: string com ponto no api ("12.5"); a vírgula é da tela.

const PHARMACY_BASE = import.meta.env.VITE_PHARMACY_BASE || "/pharmacy";
const phPath = (...parts: string[]) => [ PHARMACY_BASE, ...parts.map(encodeURIComponent) ].join("/");
// Sempre com corpo (`{}` na aprovação): o jsonFetch só põe o Content-Type quando há corpo.
const phWrite = (method: "POST" | "PATCH" | "PUT" | "DELETE", body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const PHARMACY_PAGE_SIZE = 50;

export type PharmacyRole = "pharmacist" | "pharmacy_assistant" | "stock_keeper";
export type StockLocationKind = "central" | "unit";
export type StockMovementKind =
  | "opening" | "receipt" | "donation" | "transfer_out" | "transfer_in" | "dispensing" | "loss" | "expiry" | "adjustment" | "return"
  // Módulo 29 (V4): abertura de frasco, dose de unidose e a devolução por cancelamento.
  | "vial_opening" | "immunization" | "immunization_reversal";
export type TransferStatus = "sent" | "received" | "received_with_difference";
export type AdjustmentStatus = "applied" | "pending" | "approved" | "rejected";
export type AdjustmentKind = "adjustment" | "loss" | "expiry";
export type PrescriptionKind = "digital" | "external";

// H1: `unit` é a unidade da CONCENTRAÇÃO (mg); `dispensing_unit` é a que se conta no balcão (cápsula).
// Módulo 29 (D5; V4): imunobiológico vem com catalog_item_id e catmat_code nulos, immunobiological_code, item_kind e unidade "dose".
export interface StockItem {
  catalog_item_id: string | null; catmat_code: number | null; name: string; unit: string; dispensing_unit: string;
  controlled: boolean; controlled_list: string | null;
  immunobiological_code?: string | null; item_kind?: "medication" | "immunobiological";
}
// Módulo 29 (V19): lote de vacina leva `manufacturer_key` (chave do catálogo); o api não manda código RNDS no lote
// (o plano dizia `manufacturer_code`), e `manufacturer` é o NOME. Lote de medicamento não traz a chave.
export interface StockLot {
  id: string; item: StockItem; lot_number: string; expires_on: string; manufacturer: string | null;
  manufacturer_key?: string | null;
}
export interface LocationRef { id: string; name: string; kind: StockLocationKind | string }

// D1: os locais da pessoa com o papel dela em cada um. O almoxarife do central vê todos; os alheios vêm com `roles: []`.
export interface PharmacyLocation extends LocationRef { health_unit: { id: string; name: string } | null; active: boolean; roles: string[] }
export interface LocationStaff { user_id: string; name: string | null; role: PharmacyRole | string }
export interface AdminLocation extends LocationRef { health_unit: { id: string; name: string } | null; active: boolean; staff: LocationStaff[] }
export interface AdminLocationInput { kind: StockLocationKind; health_unit_id?: string | null; name: string; active: boolean }
export interface PharmacySettings {
  common_validity_days: number; continuous_validity_days: number; continuous_interval_days: number;
  expiry_alert_days: number; adjustment_approval_percent: number;
}
// O api sempre manda `item` na saída (GET e PUT); na entrada só vão `catalog_item_id` e `minimum`. O GET omite o mínimo zero.
export interface StockMinimum { catalog_item_id: string; minimum: string; item: StockItem }

// `lots[]` só traz lote com saldo > 0 ou em trânsito > 0 (FEFO). Por lote: `expired` = validade < hoje; `expiring_soon` = não vencido e
// dentro do alerta de validade da cidade. Na POSIÇÃO, `expiring_soon` inclui os já vencidos (é a lista "vencendo e vencidos").
// Módulo 29 (D5; V4): `blocked` = excursão de temperatura aberta para o lote naquele local (só em posição de vacina).
export interface LotBalance { lot: StockLot; balance: string; in_transit: string; expiring_soon: boolean; expired: boolean; blocked?: boolean }
export interface StockPosition {
  location: LocationRef; item: StockItem; lots: LotBalance[]; balance: string; minimum: string | null;
  below_minimum: boolean; expiring_soon: boolean;
}
export interface PositionQuery {
  locationId?: string | null; q?: string | null; catalogItemId?: string | null; expiring?: boolean; belowMinimum?: boolean; before?: string | null;
}
// next_before: cursor opaco do api; repasse como veio.
export interface PositionPage { positions: StockPosition[]; next_before: string | null }
export interface StockMovement {
  id: string; kind: StockMovementKind | string; quantity: string;
  document: { type: string; id: string | null; number: string | null } | null;
  reason?: string | null; by: { name: string | null } | null; at: string;
}
export interface MovementPage { movements: StockMovement[]; next_before: string | null }

export interface PackageInput { units_per_package: number; packages: number }
export interface ReceiptItemInput {
  catalog_item_id: string; lot_number: string; expires_on: string; manufacturer?: string; quantity: string; package?: PackageInput;
}
export interface ReceiptInput {
  location_id: string; document: { kind: "invoice" | "donation"; number: string; supplier: string }; items: ReceiptItemInput[];
}
// D8: inventário de abertura — sem documento; uma vez por local e item.
// Nome com prefixo: `OpeningInput` já é a abertura justificada do prontuário (módulo 19).
export interface PharmacyOpeningInput { location_id: string; items: ReceiptItemInput[] }
export interface StockReceipt {
  id: string; kind: "invoice" | "donation" | "opening" | string; location: LocationRef; items: { lot: StockLot; quantity: string }[]; at: string;
}

// H2/H12: item da transferência com `quantity_sent`, `quantity_received` e `difference` (= enviado − recebido, nunca negativa; nula até
// o recebimento); sem sent_by/received_by. `reason` (texto livre da diferença) só vem no detalhe e na resposta do recebimento, e só para
// quem recebe no destino; a lista nunca o traz.
export interface TransferItem {
  lot: StockLot; quantity_sent: string; quantity_received: string | null; difference: string | null; reason?: string | null;
}
export interface StockTransfer {
  id: string; from: LocationRef; to: LocationRef; status: TransferStatus | string; sent_at: string; received_at: string | null; items: TransferItem[];
}
// Módulo 29 (V4): `from_location_id` opcional; ausente = o central de medicamentos (a rede de frio informa a origem).
export interface TransferInput { to_location_id: string; from_location_id?: string; items: { lot_id: string; quantity: string }[] }
export interface ReceiveInput { items: { lot_id: string; quantity_received: string; reason?: string }[] }
export interface TransferQuery { locationId: string; status?: string | null; before?: string | null }
export interface TransferPage { transfers: StockTransfer[]; next_before: string | null }

// H12: `reason` vem na lista; `same_user` compara requested_by.user_id.
export interface StockAdjustment {
  id: string; location: LocationRef; lot: StockLot; kind: AdjustmentKind | string; status: AdjustmentStatus | string;
  quantity: string; counted_quantity: string | null; balance_at_request: string; reason: string;
  // `name` é o do perfil profissional: o almoxarife não tem perfil e vem com `name: null` (a tela mostra "—").
  requested_by: { user_id: string; name: string | null }; decided_by: { user_id: string; name: string | null } | null;
  decision_reason: string | null; created_at: string;
  // Módulo 29 (V4): só em lote de vacina (motivo do SIES); nulo fora de perda e vencimento.
  loss_code?: string | null;
}
export interface AdjustmentInput {
  location_id: string; lot_id: string; kind: AdjustmentKind; counted_quantity?: string; quantity?: string; reason: string;
  loss_code?: string;
}
export interface AdjustmentPage { adjustments: StockAdjustment[]; next_before: string | null }

export interface PharmacyPatient { id: string; display_name: string | null; has_cpf: boolean; cns_masked: string | null }
export interface PrescriptionItemView {
  id: string; catalog_item_id: string | null; free_text: string | null; printed_description: string; quantity: string; quantity_unit: string;
  dosage_instructions: string; continuous: boolean; controlled: boolean;
  // H12: calculado pelo api (antimicrobiano do catálogo, controlado ou controle especial).
  retention_required: boolean;
  // `dispensed_total` é LÍQUIDO (dispensado − devolvido): devolver libera nova retirada; linha devolvida por inteiro não conta em
  // `last_dispensed_on` nem em `completed`.
  dispensed_total: string; last_dispensed_on: string | null; next_allowed_on: string | null; completed: boolean;
  // P4/H3: validade por item (sempre presentes) e o item do catálogo (nulo no texto livre), com a unidade de dispensação.
  item: StockItem | null; valid_until: string; expired: boolean;
}
export interface PrescriptionView {
  // `short_code` já vem com hífen ("ABCDE-23456"); `valid_until` é o maior dos itens e `expired` só quando TODOS venceram;
  // `prescriber.name` é nulo na receita digital de autor sem perfil profissional.
  kind: PrescriptionKind | string; id: string; short_code: string | null; issued_on: string; valid_until: string;
  expired: boolean; cancelled: boolean; prescriber: { name: string | null; council: string | null }; patient: PharmacyPatient;
  items: PrescriptionItemView[];
}
export type PrescriptionLookupInput = { location_id: string; short_code: string } | { location_id: string; patient_id: string };
export interface PrescriberInput { name: string; council: string; council_state: string; council_number: string }
export interface ExternalItemInput {
  catalog_item_id: string; quantity: string; quantity_unit: string; dosage_instructions: string; continuous: boolean;
}
// D4: paciente existente ou novo (forma do 24a); notificação só nas listas A e B. `location_id` é obrigatório no corpo (a farmácia da unidade
// que registra; sem ele o api recusa com 422 `location_id`).
export type ExternalPrescriptionInput =
  ({ patient_id: string } | { new_patient: NewPatient; duplicates_reviewed?: boolean })
  & { location_id: string; prescriber: PrescriberInput; issued_on: string; notification_number?: string; items: ExternalItemInput[] };

// D11: `complete` marca o item como dispensado por completo.
export interface DispensationItemInput {
  prescription_item_id: string; catalog_item_id?: string; lot_id: string; quantity: string; complete?: boolean;
}
// A tela manda `retention: {}`: o número retido é o do documento (D14).
export interface DispensationInput {
  location_id: string; prescription: { kind: PrescriptionKind; id: string }; items: DispensationItemInput[];
  retention?: { notification_number?: string };
}
// D12 e H12: item com id (alvo da devolução), item e lote embutidos e `returned_total`.
export interface DispensedItem {
  id: string; prescription_item_id: string | null; catalog_item_id: string; item: StockItem;
  lot_id: string; lot: { id: string; lot_number: string; expires_on: string };
  quantity: string; returned_total: string; mapped_from_free_text: boolean;
}
export interface Dispensation {
  id: string; location: LocationRef; prescription: { kind: PrescriptionKind | string; id: string }; patient: PharmacyPatient;
  by: { name: string | null; role: string }; at: string; items: DispensedItem[]; retention: { notification_number: string | null } | null;
}
export interface DispensationPage { dispensations: Dispensation[]; next_before: string | null }
// Devolução (H12): volta ao mesmo lote; a resposta é a dispensação inteira, atualizada.
export interface ReturnInput { location_id: string; dispensation_item_id: string; quantity: string; reason: string }

// D15: contagens do local (as listas da tela vêm da posição). `in_transit` conta TRANSFERÊNCIAS enviadas para o local (não quantidade);
// `expiring` não inclui os vencidos (têm contagem própria).
export interface PharmacyAlerts { expiring: number; expired: number; below_minimum: number; in_transit: number; pending_adjustments: number;
  // Módulo 32b: faltas abertas da baixa de estoque da UPA (6ª chave).
  urgency_shortfalls?: number }
// P3: o api cria o paciente do par validado; a farmácia não tem cadastro territorial.
export interface PharmacyPerson extends TerritoryPerson { has_cpf: boolean; cns_masked: string | null }

// Só os filtros que vieram, nesta ordem; booleano vira "true"/"false"; limite sempre.
function phParams(entries: [ string, string | boolean | null | undefined ][], before?: string | null): URLSearchParams {
  const p = new URLSearchParams();
  for (const [ key, value ] of entries) {
    if (typeof value === "boolean") p.set(key, String(value));
    else if (value) p.set(key, value);
  }
  if (before) p.set("before", before);
  p.set("limit", String(PHARMACY_PAGE_SIZE));
  return p;
}

// ── Locais, equipe, parâmetros e mínimos ──
export async function listMyPharmacyLocations(): Promise<PharmacyLocation[]> {
  return (await jsonFetch<{ locations?: PharmacyLocation[] }>(phPath("locations"))).locations ?? [];
}

export async function listAdminLocations(): Promise<AdminLocation[]> {
  return (await jsonFetch<{ locations?: AdminLocation[] }>(phPath("admin", "locations"))).locations ?? [];
}

export function createAdminLocation(input: AdminLocationInput): Promise<AdminLocation> {
  return jsonFetch<AdminLocation>(phPath("admin", "locations"), phWrite("POST", input));
}

export function updateAdminLocation(id: string, input: AdminLocationInput): Promise<AdminLocation> {
  return jsonFetch<AdminLocation>(phPath("admin", "locations", id), phWrite("PATCH", input));
}

export function addLocationStaff(locationId: string, userId: string, role: PharmacyRole): Promise<AdminLocation> {
  return jsonFetch<AdminLocation>(phPath("admin", "locations", locationId, "staff"), phWrite("POST", { user_id: userId, role }));
}

export async function removeLocationStaff(locationId: string, userId: string, role: string): Promise<void> {
  await jsonFetch<void>(phPath("admin", "locations", locationId, "staff"), phWrite("DELETE", { user_id: userId, role }));
}

export function getPharmacySettings(): Promise<PharmacySettings> {
  return jsonFetch<PharmacySettings>(phPath("admin", "settings"));
}

export function updatePharmacySettings(s: PharmacySettings): Promise<PharmacySettings> {
  return jsonFetch<PharmacySettings>(phPath("admin", "settings"), phWrite("PATCH", s));
}

export async function getMinimums(locationId: string): Promise<StockMinimum[]> {
  return (await jsonFetch<{ minimums?: StockMinimum[] }>(phPath("locations", locationId, "minimums"))).minimums ?? [];
}

export async function putMinimums(locationId: string, rows: { catalog_item_id: string; minimum: string }[]): Promise<StockMinimum[]> {
  const b = await jsonFetch<{ minimums?: StockMinimum[] }>(phPath("locations", locationId, "minimums"), phWrite("PUT", { minimums: rows }));
  return b.minimums ?? [];
}

// ── Catálogo, entradas e abertura ──
export async function searchPharmacyItems(q: string): Promise<StockItem[]> {
  return (await jsonFetch<{ items?: StockItem[] }>(phPath("items", "search"), phWrite("POST", { q }))).items ?? [];
}

export function recordReceipt(input: ReceiptInput): Promise<StockReceipt> {
  return jsonFetch<StockReceipt>(phPath("receipts"), phWrite("POST", input));
}

export function recordOpening(input: PharmacyOpeningInput): Promise<StockReceipt> {
  return jsonFetch<StockReceipt>(phPath("openings"), phWrite("POST", input));
}

// ── Posição e extrato ──
export async function listPositions(q: PositionQuery): Promise<PositionPage> {
  const p = phParams([
    [ "location_id", q.locationId ], [ "q", q.q ], [ "catalog_item_id", q.catalogItemId ],
    [ "expiring", q.expiring ], [ "below_minimum", q.belowMinimum ]
  ], q.before);
  const b = await jsonFetch<{ positions?: StockPosition[]; next_before?: string | null }>(withQuery(phPath("positions"), p));
  return { positions: b.positions ?? [], next_before: b.next_before ?? null };
}

export async function listLotMovements(lotId: string, locationId: string, before: string | null): Promise<MovementPage> {
  const b = await jsonFetch<{ movements?: StockMovement[]; next_before?: string | null }>(
    withQuery(phPath("lots", lotId, "movements"), phParams([ [ "location_id", locationId ] ], before)));
  return { movements: b.movements ?? [], next_before: b.next_before ?? null };
}

// ── Transferências ──
export function sendTransfer(input: TransferInput): Promise<StockTransfer> {
  return jsonFetch<StockTransfer>(phPath("transfers"), phWrite("POST", input));
}

export function receiveTransfer(id: string, input: ReceiveInput): Promise<StockTransfer> {
  return jsonFetch<StockTransfer>(phPath("transfers", id, "receive"), phWrite("POST", input));
}

export async function listTransfers(q: TransferQuery): Promise<TransferPage> {
  const b = await jsonFetch<{ transfers?: StockTransfer[]; next_before?: string | null }>(
    withQuery(phPath("transfers"), phParams([ [ "location_id", q.locationId ], [ "status", q.status ] ], q.before)));
  return { transfers: b.transfers ?? [], next_before: b.next_before ?? null };
}

// ── Ajustes, perdas e vencimentos ──
export function recordAdjustment(input: AdjustmentInput): Promise<StockAdjustment> {
  return jsonFetch<StockAdjustment>(phPath("adjustments"), phWrite("POST", input));
}

export function approveAdjustment(id: string): Promise<StockAdjustment> {
  return jsonFetch<StockAdjustment>(phPath("adjustments", id, "approve"), phWrite("POST", {}));
}

export function rejectAdjustment(id: string, reason: string): Promise<StockAdjustment> {
  return jsonFetch<StockAdjustment>(phPath("adjustments", id, "reject"), phWrite("POST", { reason }));
}

// ── Faltas da baixa de estoque da UPA (módulo 32b; pharmacy) ──
// `location_id` opcional (sem ele, só o almoxarife do central, que vê todas); ordem sempre da mais nova para a mais antiga.
export async function listUrgencyShortfalls(
  q: { locationId?: string | null; state: ShortfallState; before?: string | null }
): Promise<UrgencyShortfallPage> {
  const b = await jsonFetch<{ items?: UrgencyShortfall[]; next_before?: string | null }>(
    withQuery(phPath("urgency_shortfalls"), phParams([ [ "location_id", q.locationId ], [ "state", q.state ] ], q.before)));
  return { items: b.items ?? [], next_before: b.next_before ?? null };
}
export async function reconcileUrgencyShortfall(id: string, note: string): Promise<UrgencyShortfall> {
  return (await jsonFetch<{ shortfall: UrgencyShortfall }>(phPath("urgency_shortfalls", id, "reconcile"), phWrite("POST", { note }))).shortfall;
}

export async function listAdjustments(q: { locationId: string; status?: string | null; before?: string | null }): Promise<AdjustmentPage> {
  const b = await jsonFetch<{ adjustments?: StockAdjustment[]; next_before?: string | null }>(
    withQuery(phPath("adjustments"), phParams([ [ "location_id", q.locationId ], [ "status", q.status ] ], q.before)));
  return { adjustments: b.adjustments ?? [], next_before: b.next_before ?? null };
}

// ── Receita e dispensação ──
// Busca pelo código ou pelo paciente: POST no clique, tudo no corpo (nunca reação ao que se digita).
export async function lookupPrescriptions(input: PrescriptionLookupInput): Promise<PrescriptionView[]> {
  return (await jsonFetch<{ prescriptions?: PrescriptionView[] }>(phPath("prescriptions", "lookup"), phWrite("POST", input))).prescriptions ?? [];
}

export function createExternalPrescription(input: ExternalPrescriptionInput): Promise<PrescriptionView> {
  return jsonFetch<PrescriptionView>(phPath("external_prescriptions"), phWrite("POST", input));
}

export function recordDispensation(input: DispensationInput): Promise<Dispensation> {
  return jsonFetch<Dispensation>(phPath("dispensations"), phWrite("POST", input));
}

export function recordReturn(input: ReturnInput): Promise<Dispensation> {
  return jsonFetch<Dispensation>(phPath("returns"), phWrite("POST", input));
}

export async function listDispensations(patientId: string, before: string | null): Promise<DispensationPage> {
  const b = await jsonFetch<{ dispensations?: Dispensation[]; next_before?: string | null }>(
    withQuery(phPath("dispensations"), phParams([ [ "patient_id", patientId ] ], before)));
  return { dispensations: b.dispensations ?? [], next_before: b.next_before ?? null };
}

// ── Alertas, pessoa e duplicados ──
export async function getPharmacyAlerts(locationId: string): Promise<PharmacyAlerts> {
  const b = await jsonFetch<Partial<PharmacyAlerts>>(withQuery(phPath("alerts"), new URLSearchParams({ location_id: locationId })));
  return {
    expiring: b.expiring ?? 0, expired: b.expired ?? 0, below_minimum: b.below_minimum ?? 0,
    in_transit: b.in_transit ?? 0, pending_adjustments: b.pending_adjustments ?? 0,
    // Módulo 32b: só quando o api a manda (o api do 27a não tem a chave e a linha não aparece).
    ...(typeof b.urgency_shortfalls === "number" ? { urgency_shortfalls: b.urgency_shortfalls } : {})
  };
}

// A farmácia não abre cadastro territorial: citizen_id e registration_id sempre nulos.
export async function lookupPharmacyPerson(cpf: string): Promise<PharmacyPerson> {
  const b = await jsonFetch<Omit<PharmacyPerson, "citizen_id" | "registration_id">>(phPath("person_lookup"), phWrite("POST", { cpf }));
  return { ...b, citizen_id: null, registration_id: null };
}

export async function findPharmacyDuplicates(q: DuplicateQuery): Promise<DuplicateCandidate[]> {
  const b = await jsonFetch<{ candidates?: Omit<DuplicateCandidate, "registration_id">[] }>(
    phPath("patients", "duplicates"), phWrite("POST", q));
  return (b.candidates ?? []).map((c) => ({ ...c, registration_id: null }));
}

// ─── Saúde bucal (módulo 28; ADR 0046; contrato §3–§10, §16) ───
// Módulo 32a (Q10): "urgency" na UPA com urgency_care (só 225*).
export type ConsultationKind = "general" | "dental" | "urgency";
export type DentalRole = "dentist" | "auxiliary";
export type ToothFace = "M" | "D" | "O" | "V" | "L";
export type DentalLocationKind = "tooth" | "face" | "sextant" | "arch" | "mouth";
export type Sextant = "S1" | "S2" | "S3" | "S4" | "S5" | "S6";
export type Arch = "upper" | "lower";
export type Dentition = "permanent" | "deciduous" | "mixed";
export type DentalPlanStatus = "open" | "completed" | "cancelled";
export type DentalPlanItemStatus = "planned" | "done" | "cancelled";
export type ProsthesisStage = "impression" | "sent" | "received" | "installed" | "cancelled";
export type CeoType = "I" | "II" | "III";
export type CeoSpecialty = "endodontics" | "periodontics" | "oral_surgery" | "stomatology" | "special_needs" | "prosthesis";
export type PerioSite = "MV" | "V" | "DV" | "ML" | "L" | "DL";
export type DentalPart = "crown" | "root";

// O4: vocabulário da FAO que o api manda em consultation_options; o dashboard nunca traduz código por conta própria.
export interface DentalVocabulary {
  care_types: CodedOption[]; consultation_types: CodedOption[]; surveillance: CodedOption[]; supplies: CodedOption[]; outcomes: CodedOption[];
  situations: { crown: CodedOption[]; root: CodedOption[]; arch: CodedOption[]; face: CodedOption[] };
}

export interface DentalLocation { kind: DentalLocationKind; tooth: string | null; face: ToothFace | null; sextant: Sextant | null; arch: Arch | null }
export interface DentalUnitRef { id: string; name: string; kind: string }

export interface OdontogramTooth {
  tooth: string; situation: string | null; root: string | null; faces: Partial<Record<ToothFace, string | null>>;
  last_event_at: string | null; notes_count: number;
}
export interface Odontogram {
  patient: { id: string; display_name: string | null; has_cpf: boolean; cns_masked: string | null };
  dentition: Dentition; teeth: OdontogramTooth[]; open_plans: { id: string; health_unit: DentalUnitRef }[];
}
export interface ChartEvent {
  id: string; tooth: string; part: DentalPart; face: ToothFace | null; situation: string | null;
  procedure: { sigtap: string; name: string } | null; consultation_id: string; addendum_id: string | null;
  by: { name: string; cbo: string }; at: string;
}
export interface ChartEventPage { events: ChartEvent[]; next_before: string | null }

export interface DentalPlanItem {
  id: string; sigtap: string; name: string | null; location: DentalLocation; status: DentalPlanItemStatus | string;
  done_in_consultation_id: string | null; cancel_reason: string | null;
}
export interface DentalPlan {
  id: string; health_unit: DentalUnitRef; status: DentalPlanStatus | string; opened_in_consultation_id: string;
  closed_in_consultation_id: string | null; items: DentalPlanItem[];
}

// `name` só na leitura e no estado da tela (o api ignora na escrita — O14).
export interface DentalProcedureLine {
  id?: string; sigtap: string; name?: string; location: DentalLocation; quantity: number; plan_item_id: string | null;
  prosthesis_order_id?: string | null;
}
// O3: achado de coroa, raiz ou arcada (`tooth: null` + `arch` = prótese total).
export interface DentalFinding { tooth: string | null; face: ToothFace | null; part: DentalPart; arch?: Arch; situation: string }
export interface PlanAdd { sigtap: string; name?: string; location: DentalLocation }
export interface PlanCancel { item_id: string; reason: string }
// O6: `cancel_plan` cancela o plano inteiro dentro da consulta.
export interface DentalPlanChanges { add: PlanAdd[]; cancel: PlanCancel[]; cancel_plan?: { reason: string } }
// `code: null` = sextante excluído "X" (O14, O23).
export interface PeriodontalScreening { sextants: { sextant: Sextant; code: number | null; star: boolean }[] }
export interface PeriodontalSiteValue { site: PerioSite; probing_depth_mm: number | null; recession_mm: number | null; bleeding: boolean }
export interface PeriodontalTooth { tooth: string; mobility: number | null; furcation: number | null; sites: PeriodontalSiteValue[] }
export interface PeriodontalChart { teeth: PeriodontalTooth[] }
export interface EndodonticEntry { tooth: string; canals: number; status: "in_progress" | "completed" }

// = <dental_fields>; códigos da FAO como string (O25).
export interface DentalFields {
  care_type: string | null; dental_consultation_type: string | null; oral_health_surveillance: string[]; supplies: string[];
  dental_outcomes: string[]; pregnant: boolean | null; special_needs: boolean; procedures: DentalProcedureLine[];
  findings: DentalFinding[]; plan_changes: DentalPlanChanges; periodontal_screening: PeriodontalScreening | null;
  periodontal_chart: PeriodontalChart | null; endodontics: EndodonticEntry[];
}
export interface DentalBlock extends DentalFields { suggest_completed?: boolean }

export interface DentalProcedureRef {
  sigtap: string; name: string; locations: DentalLocationKind[]; max_quantity: number; auxiliary_allowed: boolean; prosthesis: boolean;
}
export interface EndodonticTreatment {
  tooth: string; canals: number; status: string; sessions: { consultation_id: string; at: string; by: { name: string } | null }[];
}

export interface ProsthesisOrder {
  id: string; patient: { id: string; display_name: string | null }; health_unit: { id: string; name: string }; sigtap: string; name: string | null;
  laboratory: { care_provider_id: string | null; name: string }; stage: ProsthesisStage | string;
  // O27: `created_at` e `stages[].reason` opcionais.
  stages: { stage: string; at: string; by: { name: string } | null; reason?: string | null }[];
  installed_in_consultation_id: string | null; created_at?: string;
}
export interface ProsthesisOrderInput {
  patient_id: string; consultation_id: string; sigtap: string; laboratory: { care_provider_id: string } | { name: string };
}
export interface ProsthesisQuery { healthUnitId?: string | null; patientId?: string | null; stage?: string | null; before?: string | null }
export interface ProsthesisPage { orders: ProsthesisOrder[]; next_before: string | null }
export interface DentalLaboratory { id: string; name: string }

export interface CeoProfile { health_unit: { id: string; name: string }; ceo_type: CeoType | null; specialties: CeoSpecialty[] }
export interface AuxiliaryProcedure { sigtap: string; name: string | null }
// O24: `value` é string percentual com ponto ("62.00"); a vírgula só aparece na tela.
export interface CeoGoalRow {
  key: string; goal: number; done: number; composition: { rule: string; ok: boolean; value: string } | null; met: boolean;
}
export interface CeoGoals {
  ceo_type: CeoType | string; specialties: CeoGoalRow[]; misses_last_12: Record<string, { consecutive: number; total: number }>;
  suspension_risk: boolean; history?: { month: string; specialties: { key: string; done: number; met: boolean }[] }[];
}
export interface DentalTeam { id: string; name: string; ine: string | null; health_unit: { id: string; name: string } }
// O15: `denominator: null` quando a eSB não tem equipe associada.
export interface DentalIndicators {
  b1: { numerator: number; denominator: number | null }; b2: { numerator: number; denominator: number | null };
}

export const DENTAL_PAGE_SIZE = 50;

const DENTAL_BASE = import.meta.env.VITE_DENTAL_BASE || "/dental";
const dentalPath = (...parts: string[]) => [ DENTAL_BASE, ...parts.map(encodeURIComponent) ].join("/");
// Parâmetro nulo ou vazio não entra na URL.
const dentalParams = (pairs: [ string, string | null | undefined ][]) => {
  const params = new URLSearchParams();
  for (const [ key, value ] of pairs) if (value) params.set(key, value);
  return params;
};

// Leituras nominais (geram trilha no api); ids na URL, nada clínico (O13).
export function getDentalChart(patientId: string): Promise<Odontogram> {
  return jsonFetch(dentalPath("patients", patientId, "dental_chart"));
}

export async function listChartEvents(patientId: string, q: { before?: string | null }): Promise<ChartEventPage> {
  const b = await jsonFetch<{ events?: ChartEvent[]; next_before?: string | null }>(withQuery(
    dentalPath("patients", patientId, "dental_chart", "events"),
    dentalParams([ [ "before", q.before ], [ "limit", String(DENTAL_PAGE_SIZE) ] ])));
  return { events: b.events ?? [], next_before: b.next_before ?? null };
}

export async function listDentalPlans(patientId: string, q: { healthUnitId?: string | null; status?: string | null }): Promise<DentalPlan[]> {
  const b = await jsonFetch<{ plans?: DentalPlan[] }>(withQuery(
    dentalPath("patients", patientId, "dental_plans"), dentalParams([ [ "health_unit_id", q.healthUnitId ], [ "status", q.status ] ])));
  return b.plans ?? [];
}

export async function listEndodonticTreatments(patientId: string): Promise<EndodonticTreatment[]> {
  const b = await jsonFetch<{ treatments?: EndodonticTreatment[] }>(dentalPath("patients", patientId, "endodontic_treatments"));
  return b.treatments ?? [];
}

// A busca vai no corpo: o termo pode ser clínico.
export async function searchDentalProcedures(q: string): Promise<DentalProcedureRef[]> {
  const b = await jsonFetch<{ procedures?: DentalProcedureRef[] }>(dentalPath("procedures", "search"), postProfessional({ q }));
  return b.procedures ?? [];
}

export function createProsthesisOrder(input: ProsthesisOrderInput): Promise<ProsthesisOrder> {
  return jsonFetch(dentalPath("prosthesis_orders"), postProfessional(input));
}

export function changeProsthesisStage(id: string, input: { stage: "sent" | "received" | "cancelled"; reason?: string }): Promise<ProsthesisOrder> {
  return jsonFetch(dentalPath("prosthesis_orders", id, "stages"), postProfessional(input));
}

export async function listProsthesisOrders(q: ProsthesisQuery): Promise<ProsthesisPage> {
  const b = await jsonFetch<{ orders?: ProsthesisOrder[]; next_before?: string | null }>(withQuery(
    dentalPath("prosthesis_orders"),
    dentalParams([ [ "health_unit_id", q.healthUnitId ], [ "patient_id", q.patientId ], [ "stage", q.stage ], [ "before", q.before ],
      [ "limit", String(DENTAL_PAGE_SIZE) ] ])));
  return { orders: b.orders ?? [], next_before: b.next_before ?? null };
}

export async function listDentalLaboratories(): Promise<DentalLaboratory[]> {
  return (await jsonFetch<{ laboratories?: DentalLaboratory[] }>(dentalPath("laboratories"))).laboratories ?? [];
}

// Administração e painéis.
export async function listCeoProfiles(): Promise<CeoProfile[]> {
  return (await jsonFetch<{ profiles?: CeoProfile[] }>(dentalPath("admin", "ceo_profiles"))).profiles ?? [];
}

export function putCeoProfile(unitId: string, input: { ceo_type: CeoType; specialties: CeoSpecialty[] }): Promise<CeoProfile> {
  return jsonFetch(dentalPath("admin", "ceo_profiles", unitId), { method: "PUT", body: JSON.stringify(input) });
}

export async function getAuxiliaryProcedures(): Promise<AuxiliaryProcedure[]> {
  return (await jsonFetch<{ procedures?: AuxiliaryProcedure[] }>(dentalPath("admin", "auxiliary_procedures"))).procedures ?? [];
}

export async function putAuxiliaryProcedures(sigtaps: string[]): Promise<AuxiliaryProcedure[]> {
  const b = await jsonFetch<{ procedures?: AuxiliaryProcedure[] }>(dentalPath("admin", "auxiliary_procedures"),
    { method: "PUT", body: JSON.stringify({ procedures: sigtaps.map((sigtap) => ({ sigtap })) }) });
  return b.procedures ?? [];
}

export function getCeoGoals(unitId: string, month: string): Promise<CeoGoals> {
  return jsonFetch(withQuery(dentalPath("ceo_goals"), dentalParams([ [ "health_unit_id", unitId ], [ "month", month ] ])));
}

export async function listDentalTeams(): Promise<DentalTeam[]> {
  return (await jsonFetch<{ teams?: DentalTeam[] }>(dentalPath("teams"))).teams ?? [];
}

export function getDentalIndicators(teamId: string, period: string): Promise<DentalIndicators> {
  return jsonFetch(withQuery(dentalPath("indicators"), dentalParams([ [ "team_id", teamId ], [ "period", period ] ])));
}

// ─── Sala de vacina (módulo 29; ADR 0047; contrato 2026-11-02 §2–§11, §15 V1–V25) ───
// Na URL só ids (sala, local, unidade), status, mês e cursor. CPF, nome, vacina, dose, lote, motivo, senha e certificado vão no
// corpo; a busca, a caderneta e a dose são POST (gravam trilha no api). Formas conferidas contra o api (apps/api, módulo 29):
// onde o plano do dashboard diz outra coisa, vale o api (fabricante por `key`, V19; busca na rota da sala, V3/V21; pendências com
// `counts`; painel com `suppressed`; excursão com `pending_adjustment_id`). Toda escrita leva corpo (`{}` quando não há campo).

const VACCINATION_BASE = import.meta.env.VITE_VACCINATION_BASE || "/vaccination";
const vacPath = (...parts: string[]) => [ VACCINATION_BASE, ...parts.map(encodeURIComponent) ].join("/");
const vacWrite = (method: "POST" | "PATCH" | "PUT" | "DELETE", body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });

export const VACCINATION_PAGE_SIZE = 50;

export type VaccineLocationKind = "vaccine_room" | "cold_chain_central";
export type VaccineStaffRole = "vaccinator" | "room_lead";
export type RndsStatus = "not_sent" | "pending" | "sending" | "accepted" | "rejected" | "failed" | "blocked";
export type RndsBlockReason = "professional_cns_not_in_cnes" | "patient_identity_unverified" | "patient_without_cns_or_cpf";
export type RecordCheckMode = "transcribed" | "confirmed_complete" | "born_after_go_live";
export type CardItemStatus = "due" | "overdue" | "upcoming" | "complete" | "not_applicable" | "unchecked";
export type VialStatus = "open" | "expired" | "closed_out";
export type ColdChainEquipmentKind = "refrigerator" | "chamber" | "freezer";

export interface CodeName { code: string; name: string }
// Imunobiológico vindo de dose, caderneta, pendência ou resumo: o nome pode ser nulo se o código não está no catálogo (mostrar o código cru).
export interface ImmunobiologicalRef { code: string; name: string | null }

// V19: fabricante por `key` (estável, obrigatória); `code` (RNDS) pode ser nulo. O select usa a key.
export interface ImmunobiologicalManufacturer { key: string; code: string | null; name: string; validity_after_opening_hours: number | null }
export interface Immunobiological {
  code: string; name: string; multidose: boolean; doses_per_vial: number; default_route: string | null; default_site: string | null;
  manufacturers: ImmunobiologicalManufacturer[];
}
export interface VaccinationTerminologies {
  dose: CodeName[]; strategy: CodeName[]; route: CodeName[]; site: CodeName[]; care_group: CodeName[]; maternal_condition: CodeName[];
}
// V28: `physical_loss_reasons` = motivos de perda física do SIES (config/vaccination/physical_loss_reasons.yml), exigidos em `loss_code`.
export interface VaccinationCatalog {
  calendar_version: string; immunobiologicals: Immunobiological[]; terminologies: VaccinationTerminologies; physical_loss_reasons: CodeName[];
}

// D2: `id` é o do local de estoque; `room_id` é o da sala (nulo na rede de frio). `roles` ⊂ vaccinator, room_lead, stock_keeper.
export interface VaccineLocation extends PharmacyLocation { room_id: string | null }

export interface ImmunizationRnds {
  status: RndsStatus | string; sent_at: string | null; accepted_at: string | null; block_reason: RndsBlockReason | string | null; error: string | null;
}
// <immunization> (§2; V6 can_cancel; V10). Lote da transcrição: texto livre, sem id nem validade; fabricante só com nome e `code` nulo.
export interface Immunization {
  id: string; immunobiological: ImmunobiologicalRef; dose: { code: string; name: string | null };
  strategy: string; care_group: string; route: string; site: string; maternal_condition: string | null; applied_at: string;
  lot: { id: string | null; number: string | null; manufacturer: { code: string | null; name: string | null }; expires_on: string | null };
  transcription: boolean; room: { id: string; name: string; health_unit: { id: string; name: string } } | null;
  by: { name: string | null; cbo: string | null }; campaign_id: string | null; status: "active" | "cancelled" | string;
  cancel_reason: string | null; replaces_id: string | null; replaced_by_id: string | null; can_cancel?: boolean; rnds: ImmunizationRnds;
}

export interface CardPatient {
  id: string; display_name: string | null; birth_date: string; sex: string; has_cpf: boolean; cns_masked: string | null;
}
export interface CardCheck { mode: RecordCheckMode | string; at: string; by_name: string | null }
export interface CardItem {
  immunobiological: ImmunobiologicalRef; dose: { code: string; name: string | null }; status: CardItemStatus | string; due_on: string | null;
  applied: { id: string; applied_at: string; transcription: boolean } | null;
}
export interface VaccinationCard {
  patient: CardPatient; checked: CardCheck | null; calendar_version: string; items: CardItem[]; immunizations: Immunization[];
}

// V3: o api aceita `patient_id` OU `new_patient` (com `duplicates_reviewed?`); `citizen_id` (D3) não existe: a busca por CPF
// já devolve `patient_id` (cria o paciente do par validado).
export type CardRequest = { patient_id: string } | { new_patient: NewPatient; duplicates_reviewed?: boolean };
export interface ImmunizationInput {
  patient_id: string; immunobiological_code: string; dose_code: string; strategy: string; care_group: string; route: string; site: string;
  maternal_condition?: string; applied_at: string; lot_id: string; vial_id?: string; campaign_id?: string; override_reason?: string;
}
export interface TranscriptionItemInput {
  immunobiological_code: string; dose_code: string; applied_on: string; lot_number?: string; manufacturer_name?: string; place?: string;
}
export interface TranscriptionInput { patient_id: string; items: TranscriptionItemInput[]; close_check: boolean }
// V6: `patient_id` na substituta é opcional (o api aceita, mas só o da própria dose); problemas dela vêm com path `replacement.<campo>`.
// A substituta de uma dose transcrita vai como item de transcrição (Vaccination::CancelImmunization#transcribed).
export interface CancelInput {
  reason: string; replacement?: (Omit<ImmunizationInput, "patient_id"> & { patient_id?: string }) | TranscriptionItemInput;
}

export interface RndsPendingItem { immunization_id: string; patient_id: string; immunobiological: ImmunobiologicalRef; applied_at: string; rnds: ImmunizationRnds }
// V8/V23: `counts` ao lado de `items`; `late` inclui `sending`. Cursor opaco: repasse como veio.
export interface RndsPendingCounts { blocked: number; rejected: number; failed: number; late: number }
export interface RndsPendingPage { items: RndsPendingItem[]; counts: RndsPendingCounts; next_before: string | null }

export interface Vial {
  id: string; lot: { id: string; number: string; immunobiological_code: string }; opened_at: string; expires_at: string;
  doses_per_vial: number; doses_used: number; doses_left: number; status: VialStatus | string;
}

// D8 + V25: doses inteiras; closing = opening + received + transferred_in − transferred_out − vial_doses − unit_doses + adjustment − Σ physical_loss.
// `physical_loss` por código do SIES (mais `unspecified` e `transfer_difference`); `adjustment` vem com sinal.
export interface MonthlySummaryRow {
  immunobiological: ImmunobiologicalRef; lot: { id: string; number: string; expires_on: string };
  opening_balance: number; received: number; transferred_in: number; transferred_out: number; vials_opened: number; doses_applied: number;
  technical_loss: number; physical_loss: Record<string, number>; closing_balance: number;
  vial_doses: number; unit_doses: number; adjustment: number;
}
export interface MonthlySummary { month: string; location: LocationRef; rows: MonthlySummaryRow[] }

export interface ColdChainEquipment {
  id: string; location_id: string; name: string; kind: ColdChainEquipmentKind | string; min_c: number; max_c: number; active: boolean;
}
export type EquipmentInput = Omit<ColdChainEquipment, "id">;
export interface ReadingInput { read_at: string; current_c: number; min_c: number; max_c: number }
export interface ColdChainReading extends ReadingInput { id: string; out_of_range: boolean; by: { name: string | null } | null }
export interface ReadingResult { reading: ColdChainReading; excursion_id: string | null; blocked_lots: number }
// V24: `pending_adjustment_id` = o descarte desse lote espera aprovação ("aguardando aprovação do descarte"); `balance` é texto ("20.00").
export interface ExcursionLot {
  lot_id: string; number: string; immunobiological: ImmunobiologicalRef; balance: string; pending_adjustment_id: string | null;
}
export interface ColdChainExcursion { id: string; equipment_id: string; reading: ColdChainReading; lots: ExcursionLot[]; opened_at: string }
export interface ColdChainStatus {
  equipments: (ColdChainEquipment & { last_reading: ColdChainReading | null; readings_today: number })[];
  open_excursions: ColdChainExcursion[];
}
export interface ExcursionDecisionLine { lot_id: string; decision: "use" | "discard"; reason: string }
export interface ExcursionDecisionResult { excursion_id: string; adjustments: StockAdjustment[] }

export interface VaccineRoomStaff { user_id: string; name: string | null; role: VaccineStaffRole | string; cbo: string | null }
export interface VaccineRoom {
  id: string; name: string; active: boolean; health_unit: { id: string; name: string }; stock_location_id: string; staff: VaccineRoomStaff[];
}
export interface VaccineRoomInput { health_unit_id: string; name: string; active: boolean }
export interface VaccineRoomsAdmin { rooms: VaccineRoom[]; cold_chain_central: AdminLocation | null }
export interface VaccinationSettings { go_live_on: string | null }

// V19/V4: fabricante pela `key` do catálogo e `package` obrigatório (doses por frasco × frascos); `quantity` em doses, texto.
export interface VaccineReceiptItemInput {
  immunobiological_code: string; manufacturer_key: string; lot_number: string; expires_on: string; quantity: string; package: PackageInput;
}
export interface VaccineReceiptInput {
  location_id: string; document: { kind: "invoice" | "donation"; number: string; supplier: string }; items: VaccineReceiptItemInput[];
}
export interface VaccineOpeningInput { location_id: string; items: VaccineReceiptItemInput[] }

// D13 + supressão (Admin::SmallCount): contagem de 1 a 4 vira null, com `suppressed: true` no topo (mostrar "menos de 5"; nunca somar null).
export interface VaccinationDashboard {
  month: string; suppressed: boolean;
  doses_by_immunobiological: { immunobiological: ImmunobiologicalRef; room: { id: string; name: string }; count: number | null }[];
  c2_coverage_by_team: { team: { id: string; name: string }; eligible: number | null; complete: number | null }[];
  rnds: { pending: number; blocked: number; rejected: number; late: number };
  losses: { technical: number; physical: number };
  unchecked_cards: number;
}

// ── Locais, catálogo e pessoa ──
export async function listMyVaccineLocations(): Promise<VaccineLocation[]> {
  return (await jsonFetch<{ locations?: VaccineLocation[] }>(vacPath("my_locations"))).locations ?? [];
}

export function getVaccinationCatalog(): Promise<VaccinationCatalog> {
  return jsonFetch<VaccinationCatalog>(vacPath("catalog"));
}

// V3: a busca é da sala (autoriza pela equipe dela) e devolve o paciente (cria o do par validado). Ninguém → 404 person_not_found;
// par só declarado → 409 citizen_not_verified.
export async function lookupVaccinationPerson(roomId: string, cpf: string): Promise<PharmacyPerson> {
  const b = await jsonFetch<Omit<PharmacyPerson, "citizen_id" | "registration_id">>(
    vacPath("rooms", roomId, "person_lookup"), vacWrite("POST", { cpf }));
  return { ...b, citizen_id: null, registration_id: null };
}

// V21: duplicados do recém-nascido, também na rota da sala (máximo 10 candidatos).
export async function findVaccinationDuplicates(roomId: string, q: DuplicateQuery): Promise<DuplicateCandidate[]> {
  const b = await jsonFetch<{ candidates?: Omit<DuplicateCandidate, "registration_id">[] }>(
    vacPath("rooms", roomId, "patients", "duplicates"), vacWrite("POST", q));
  return (b.candidates ?? []).map((c) => ({ ...c, registration_id: null }));
}

// ── Caderneta, dose, transcrição e cancelamento ──
export function getVaccinationCard(roomId: string, req: CardRequest): Promise<VaccinationCard> {
  return jsonFetch<VaccinationCard>(vacPath("rooms", roomId, "card"), vacWrite("POST", req));
}

export function confirmCardComplete(roomId: string, patientId: string): Promise<VaccinationCard> {
  return jsonFetch<VaccinationCard>(vacPath("rooms", roomId, "checks"), vacWrite("POST", { patient_id: patientId, mode: "confirmed_complete" }));
}

export function recordImmunization(roomId: string, input: ImmunizationInput): Promise<Immunization> {
  return jsonFetch<Immunization>(vacPath("rooms", roomId, "immunizations"), vacWrite("POST", input));
}

export function recordTranscriptions(roomId: string, input: TranscriptionInput): Promise<{ immunizations: Immunization[]; card: VaccinationCard }> {
  return jsonFetch(vacPath("rooms", roomId, "transcriptions"), vacWrite("POST", input));
}

export function cancelImmunization(id: string, input: CancelInput): Promise<{ cancelled: Immunization; replacement: Immunization | null }> {
  return jsonFetch(vacPath("immunizations", id, "cancel"), vacWrite("POST", input));
}

// D11/V10: leitura nominal da dose (trilha no api).
export function getImmunization(id: string): Promise<Immunization> {
  return jsonFetch<Immunization>(vacPath("immunizations", id));
}

export async function listRndsPending(roomId: string, before: string | null): Promise<RndsPendingPage> {
  const p = new URLSearchParams();
  if (before) p.set("before", before);
  p.set("limit", String(VACCINATION_PAGE_SIZE));
  const b = await jsonFetch<Partial<RndsPendingPage>>(withQuery(vacPath("rooms", roomId, "pending"), p));
  return {
    items: b.items ?? [],
    counts: { blocked: b.counts?.blocked ?? 0, rejected: b.counts?.rejected ?? 0, failed: b.counts?.failed ?? 0, late: b.counts?.late ?? 0 },
    next_before: b.next_before ?? null
  };
}

// ── Frascos e resumo mensal ──
export function openVial(roomId: string, lotId: string): Promise<Vial> {
  return jsonFetch<Vial>(vacPath("rooms", roomId, "vials"), vacWrite("POST", { lot_id: lotId }));
}

export async function listVials(roomId: string, status: VialStatus | null): Promise<Vial[]> {
  const p = new URLSearchParams();
  if (status) p.set("status", status);
  return (await jsonFetch<{ vials?: Vial[] }>(withQuery(vacPath("rooms", roomId, "vials"), p))).vials ?? [];
}

export function closeOutVial(id: string, reason: string): Promise<Vial> {
  return jsonFetch<Vial>(vacPath("vials", id, "close_out"), vacWrite("POST", { reason }));
}

export function getMonthlySummary(scope: { roomId: string } | { central: true }, month: string): Promise<MonthlySummary> {
  const path = "roomId" in scope ? vacPath("rooms", scope.roomId, "monthly_summary") : vacPath("cold_chain_central", "monthly_summary");
  return jsonFetch<MonthlySummary>(withQuery(path, new URLSearchParams({ month })));
}

// ── Cadeia de frio ──
export async function listEquipments(locationId: string): Promise<ColdChainEquipment[]> {
  const p = new URLSearchParams({ location_id: locationId });
  return (await jsonFetch<{ equipments?: ColdChainEquipment[] }>(withQuery(vacPath("cold_chain", "equipments"), p))).equipments ?? [];
}

export function createEquipment(input: EquipmentInput): Promise<ColdChainEquipment> {
  return jsonFetch<ColdChainEquipment>(vacPath("cold_chain", "equipments"), vacWrite("POST", input));
}

export function updateEquipment(id: string, input: EquipmentInput): Promise<ColdChainEquipment> {
  return jsonFetch<ColdChainEquipment>(vacPath("cold_chain", "equipments", id), vacWrite("PATCH", input));
}

export function recordReading(equipmentId: string, input: ReadingInput): Promise<ReadingResult> {
  return jsonFetch<ReadingResult>(vacPath("cold_chain", "equipments", equipmentId, "readings"), vacWrite("POST", input));
}

export function decideExcursion(id: string, lots: ExcursionDecisionLine[]): Promise<ExcursionDecisionResult> {
  return jsonFetch<ExcursionDecisionResult>(vacPath("cold_chain", "excursions", id, "decide"), vacWrite("POST", { lots }));
}

export async function getColdChainStatus(locationId: string): Promise<ColdChainStatus> {
  const b = await jsonFetch<Partial<ColdChainStatus>>(withQuery(vacPath("cold_chain", "status"), new URLSearchParams({ location_id: locationId })));
  return { equipments: b.equipments ?? [], open_excursions: b.open_excursions ?? [] };
}

// ── ESAVI e painel ──
// V12: dose já notificada → 200 com `existing: true` (a tela abre a mesma notificação); primeira vez → 201.
export function notifyEsavi(immunizationId: string): Promise<{ notification_id: string; existing?: boolean }> {
  return jsonFetch(vacPath("immunizations", immunizationId, "esavi"), vacWrite("POST", {}));
}

export function getVaccinationDashboard(q: { month: string; healthUnitId?: string | null }): Promise<VaccinationDashboard> {
  const p = new URLSearchParams({ month: q.month });
  if (q.healthUnitId) p.set("health_unit_id", q.healthUnitId);
  return jsonFetch<VaccinationDashboard>(withQuery(vacPath("dashboard"), p));
}

// ── Administração (municipal_admin; escrita com step-up) ──
export async function listVaccineRooms(): Promise<VaccineRoomsAdmin> {
  const b = await jsonFetch<Partial<VaccineRoomsAdmin>>(vacPath("admin", "rooms"));
  return { rooms: b.rooms ?? [], cold_chain_central: b.cold_chain_central ?? null };
}

export function createVaccineRoom(input: VaccineRoomInput): Promise<VaccineRoom> {
  return jsonFetch<VaccineRoom>(vacPath("admin", "rooms"), vacWrite("POST", input));
}

export function updateVaccineRoom(id: string, input: VaccineRoomInput): Promise<VaccineRoom> {
  return jsonFetch<VaccineRoom>(vacPath("admin", "rooms", id), vacWrite("PATCH", input));
}

export function addRoomStaff(roomId: string, userId: string, role: VaccineStaffRole): Promise<VaccineRoom> {
  return jsonFetch<VaccineRoom>(vacPath("admin", "rooms", roomId, "staff"), vacWrite("POST", { user_id: userId, role }));
}

export async function removeRoomStaff(roomId: string, userId: string, role: string): Promise<void> {
  await jsonFetch<void>(vacPath("admin", "rooms", roomId, "staff"), vacWrite("DELETE", { user_id: userId, role }));
}

// O api exige `name` (3 a 120; único); o plano mandava corpo vazio. Uma só rede de frio por cidade (409 already_exists).
export function createColdChainCentral(name: string): Promise<AdminLocation> {
  return jsonFetch<AdminLocation>(vacPath("admin", "cold_chain_central"), vacWrite("POST", { name }));
}

export function getVaccinationSettings(): Promise<VaccinationSettings> {
  return jsonFetch<VaccinationSettings>(vacPath("admin", "settings"));
}

export function updateVaccinationSettings(s: VaccinationSettings): Promise<VaccinationSettings> {
  return jsonFetch<VaccinationSettings>(vacPath("admin", "settings"), vacWrite("PATCH", s));
}

// D1/V1: certificado A1 em base64, senha e CNES só no corpo; nada volta. O nome do arquivo não sai da tela.
export async function setRndsCredential(file: Blob, password: string, requesterCnes: string): Promise<IntegrationCredential> {
  const pfx_base64 = await readBase64(file);
  return jsonFetch<IntegrationCredential>(`${INTEGRATIONS_BASE}/credentials/rnds`, {
    method: "PUT", body: JSON.stringify({ pfx_base64, pfx_password: password, requester_cnes: requesterCnes })
  });
}

// ── Entrada e inventário inicial de imunobiológico (rotas do 27a; D6, V4, V19) ──
export function recordVaccineReceipt(input: VaccineReceiptInput): Promise<StockReceipt> {
  return jsonFetch<StockReceipt>(phPath("receipts"), phWrite("POST", input));
}

export function recordVaccineOpening(input: VaccineOpeningInput): Promise<StockReceipt> {
  return jsonFetch<StockReceipt>(phPath("openings"), phWrite("POST", input));
}

// ─── Transporte sanitário e TFD (módulo 30; ADR 0048; contrato 2026-11-03 §2–§9) ───
// Na URL só ids, data, mês, período, situação e cursor; CPF, CNH, nome, documento do acompanhante, CID, justificativa e arquivo
// vão no corpo. Formas conferidas contra o api (api-surface do módulo 30): onde o plano diz outra coisa, vale o api (retirar
// passageiro devolve a viagem; duplicados em `{ candidates }`; meus pedidos sem cursor; ajuda em `{ items, total_cents }`;
// atendimentos marcados com `health_unit_id`; motorista com `active`; série com `return_time`/`boarding_label`; trecho com
// `companion`/`outbound_leg_id`/`voided`; painel com `month` e `occupancy_pct` número ou nulo). O api recusa chave desconhecida:
// mande só as chaves de cada rota. Toda escrita leva corpo (`{}` quando não há campo), inclusive o DELETE.

const TRANSPORT_BASE = import.meta.env.VITE_TRANSPORT_BASE || "/transport";
const TFD_BASE = import.meta.env.VITE_TFD_BASE || "/tfd";
const trPath = (...parts: string[]) => [ TRANSPORT_BASE, ...parts.map(encodeURIComponent) ].join("/");
const tfdPath = (...parts: string[]) => [ TFD_BASE, ...parts.map(encodeURIComponent) ].join("/");
const trWrite = (method: "POST" | "PATCH" | "DELETE", body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });

export type VehicleKind = "van" | "minibus" | "bus" | "car" | "ambulance_a";
export type LicenseCategory = "B" | "C" | "D" | "E";
export type LicenseStatus = "valid" | "expiring" | "expired";
export type TripStatus = "planned" | "confirmed" | "in_progress" | "done" | "cancelled";
export type TripStopKind = "boarding" | "destination";
export type PassengerOrigin = "regulation" | "appointment" | "tfd" | "series" | "exception";
export type ExceptionReason = "follow_up_return" | "legacy_patient" | "scheduling_pending" | "other";
// Nome próprio: `Attendance` já é o atendimento do balcão.
export type TripAttendance = "pending" | "boarded" | "no_show";
export type PendingReason = "no_seat" | "no_wheelchair_spot" | "refused";
export type SeriesStatus = "active" | "suspended" | "ended";
export type TfdStatus = "draft" | "submitted" | "returned" | "authorized" | "denied" | "scheduled" | "travelling" | "completed" | "cancelled";
export type TfdDecision = "authorize" | "return" | "deny";
export type TfdLegMode = "fleet" | "bus_ticket" | "air" | "river";
export type TfdLegDirection = "outbound" | "return";
export type TfdAllowanceKind = "meal_overnight" | "meal_day" | "ground_km" | "air_miles" | "river_miles";
export type TfdPaymentMethod = "cash" | "transfer" | "pix" | "check";
// D7: o api aceita observação (≤ 120) em qualquer tipo; em branco vira nulo.
export type ExpenseKind = "toll" | "parking" | "meal" | "other";
// Painel: 1 a 4 chegam como "lt5" (0 fica 0).
export type TransportCount = number | "lt5";

// ── Frota (só transport_dispatcher) ──
export interface TransportVehicle {
  id: string; plate: string; renavam: string; model: string; kind: VehicleKind | string; renem_code: string | null;
  seats: number; wheelchair_spots: number; cnes: string | null; active: boolean;
}
export type VehicleInput = Omit<TransportVehicle, "id">;
// `license_status` é calculado para HOJE (expiring = vence em até 30 dias); a data da viagem é conferida no confirm.
export interface TransportDriver {
  id: string; user: { id: string; name: string }; license_category: LicenseCategory | string; license_expires_on: string;
  license_status: LicenseStatus | string; license_number_last4: string; active: boolean;
}
// No PATCH: `license_number` ausente = mantém; `user_id` não muda (por isso o tipo da edição não o tem).
export interface DriverInput {
  user_id: string; license_number?: string; license_category: LicenseCategory; license_expires_on: string; active?: boolean;
}
export type DriverUpdate = Partial<Omit<DriverInput, "user_id">>;
// D2: usuários com papel `driver` ainda sem cadastro de motorista.
export interface DriverCandidate { user_id: string; name: string }
export interface TransportDestination { id: string; ibge_code: string; name: string; distance_km: number; metropolitan: boolean; active: boolean }
export type DestinationInput = Omit<TransportDestination, "id">;

// ── Viagens ──
// A visão do motorista (`/transport/my_trips`) não traz `has_cpf` nem `cns_masked`.
export interface TripPatient { id: string; display_name: string | null; has_cpf?: boolean; cns_masked?: string | null; phone_masked: string | null }
export interface TripCompanion { name: string; document_last4: string | null }
export interface TripPassenger {
  id: string; patient: TripPatient; stop_id: string;
  // D16: nome do destino cadastrado.
  destination: { destination_id: string; name: string; provider_name: string | null; address: string | null };
  appointment_at: string | null; takes_seat: boolean; wheelchair: boolean; companion: TripCompanion | null;
  origin: PassengerOrigin | string; exception_reason: ExceptionReason | string | null;
  attendance: TripAttendance | string; companion_attendance: TripAttendance | string | null;
}
export interface TripStop { id: string; position: number; kind: TripStopKind | string; destination_id: string | null; label: string }
// D3: `id` mantém a parada existente; embarque sem `destination_id`; rótulo de destino em branco vira o nome do destino.
export interface TripStopInput { id?: string; position: number; kind: TripStopKind; destination_id?: string | null; label: string }
export interface TripFuel { liters: number; amount_cents: number; station: string }
export interface TripExpense { kind: ExpenseKind | string; amount_cents: number; note: string | null }
export interface TripLog {
  odometer_start: number; odometer_end: number; fuel: TripFuel[]; expenses: TripExpense[]; closed_at: string; closed_by_name: string;
}
export interface Trip {
  id: string; date: string; departure_at: string; return_at: string;
  vehicle: { id: string; plate: string; model: string; kind: VehicleKind | string; seats: number; wheelchair_spots: number } | null;
  // Sem CNH: quem escala confere pela lista de motoristas.
  driver: { id: string; name: string } | null; status: TripStatus | string; stops: TripStop[];
  // Só os ativos (não retirados), na ordem de inclusão. `seats_used` conta acompanhantes.
  passengers: TripPassenger[];
  occupancy: { seats_used: number; seats: number | null; wheelchair_used: number; wheelchair_spots: number | null };
  series_id: string | null; log: TripLog | null;
}
// `date` é o dia local de `departure_at` (o api confere). No PATCH: ausente = mantém; `null` = tira veículo/motorista.
export interface TripInput {
  date: string; departure_at: string; return_at: string; vehicle_id?: string | null; driver_id?: string | null; stops: TripStopInput[];
}
export interface CompanionInput { name: string; document?: string | null; reason?: string | null }
// Texto opcional vazio é recusado: omita ou mande null. `origin_id` só fora de `exception`; motivo e nota só em `exception`.
export interface PassengerInput {
  patient_id: string; origin?: PassengerOrigin; origin_id?: string | null; exception_reason?: ExceptionReason | null;
  exception_note?: string | null; stop_id: string; destination_id: string; provider_name?: string | null; address?: string | null;
  appointment_at?: string | null; takes_seat: boolean; wheelchair: boolean; companion?: CompanionInput | null;
}
// D4: sugestão de atendimento marcado no dia (regulação, TFD e, com `health_unit_id`, agenda do 17). Série não entra.
export interface ScheduledCareItem {
  patient: { id: string; display_name: string | null; has_cpf: boolean; cns_masked: string | null; phone_masked: string | null };
  origin: PassengerOrigin | string; origin_id: string; appointment_at: string;
  destination: { destination_id: string | null; provider_name: string | null; address: string | null };
}

// ── Séries, pendências e faltas ──
// D5: `status` é o de HOJE; suspensão futura vem `active` com `suspended_from` preenchido.
export interface TransportSeries {
  id: string; patient: { id: string; display_name: string | null }; destination: { id: string; name: string }; provider_name: string | null;
  weekdays: number[]; appointment_time: string; departure_time: string; return_time: string; boarding_label: string;
  starts_on: string; ends_on: string | null; wheelchair: boolean; companion: TripCompanion | null;
  status: SeriesStatus | string; suspended_from: string | null;
}
export interface SeriesInput {
  patient_id: string; destination_id: string; provider_name?: string | null; weekdays: number[]; appointment_time: string;
  departure_time: string; return_time: string; boarding_label: string; starts_on: string; ends_on?: string | null;
  wheelchair?: boolean; companion?: CompanionInput | null;
}
// O paciente da série não muda.
export type SeriesUpdate = Partial<Omit<SeriesInput, "patient_id">>;
// Nome próprio: `PendingItem` já é a pendência do faturamento (22).
export interface TransportPendingItem { series_id: string; date: string; reason: PendingReason | string }
// D6.
export interface NoShowRow { patient: { id: string; display_name: string | null }; count: number; dates: string[] }

// ── Motorista ──
export interface AttendanceItem { passenger_id: string; attendance: TripAttendance; companion_attendance?: TripAttendance }
export interface FuelInput { liters: number; amount_cents: number; station: string }
export interface ExpenseInput { kind: ExpenseKind; amount_cents: number; note?: string | null }
export interface TripCloseInput { odometer_start: number; odometer_end: number; fuel?: FuelInput[]; expenses?: ExpenseInput[] }
// D7: correção da central (step-up), só `boarded`/`no_show`, em viagem `done`.
export interface AttendanceCorrectionInput { items: AttendanceItem[]; reason: string }

// ── Regras da cidade e painel ──
// D17: sem `person` (dois códigos por tipo); `name` é "" quando o SIGTAP do dia não traz o código.
export interface AllowanceCode { code: string; name: string; kind: TfdAllowanceKind | string }
export interface TransportSettings {
  tfd_min_distance_km: number; companion_rule: { max_age_child: number; min_age_elderly: number };
  tfd_billing_health_unit_id: string | null; allowance_complements: Record<string, number>; allowance_codes: AllowanceCode[];
}
// PATCH aceita qualquer subconjunto; `allowance_complements` substitui o mapa inteiro (mande o mapa todo).
export type TransportSettingsInput = Partial<Omit<TransportSettings, "allowance_codes">>;
// `occupancy_pct` nunca é "lt5" (nulo sem viagem feita); `tfd_by_status` só traz situação com processo (chave ausente = 0).
export interface TransportDashboard {
  month: string; trips: TransportCount; occupancy_pct: number | null; no_shows: TransportCount; km: number; fuel_cents: number;
  tfd_by_status: Partial<Record<TfdStatus, TransportCount>>; tfd_paid_cents: number; exceptions: TransportCount;
}

// ── TFD ──
export interface TfdReport {
  sigtap_code: string | null; sigtap_name: string | null; cid10: string | null; justification: string | null;
  companion_indicated: boolean; companion_reason: string | null; transport_mode: TfdLegMode | string;
}
export type TfdReportInput = Omit<TfdReport, "sigtap_name">;
export interface TfdLeg {
  id: string; direction: TfdLegDirection | string; mode: TfdLegMode | string; date: string; distance_km: number;
  trip_passenger_id: string | null; ticket: { amount_cents: number; carrier: string } | null;
  // D10: acompanhante só em passagem; `voided` = anulado (fora das pendências, do par e da ajuda).
  companion: boolean; outbound_leg_id: string | null; done: boolean; voided: boolean;
}
// Frota: `trip_passenger_id`, sem `ticket` nem `companion`. Passagem: `ticket`, sem `trip_passenger_id`.
export interface TfdLegInput {
  direction: TfdLegDirection; mode: TfdLegMode; date: string; trip_passenger_id?: string;
  ticket?: { amount_cents: number; carrier: string }; companion?: boolean;
}
export interface TfdAllowance {
  id: string; person: "patient" | "companion" | string; kind: TfdAllowanceKind | string; sigtap_code: string; quantity: number;
  table_cents: number; complement_cents: number; total_cents: number;
}
export interface TfdPayment {
  id: string; paid_on: string; amount_cents: number; method: TfdPaymentMethod | string; receipt_number: string; by_name: string;
}
export interface TfdPaymentInput { paid_on: string; amount_cents: number; method: TfdPaymentMethod; receipt_number: string }
export interface TfdEvent { kind: string; at: string; by_name: string | null; reason: string | null }
export interface TfdCase {
  id: string; patient: { id: string; display_name: string | null; birth_date: string | null; has_cpf: boolean; cns_masked: string | null };
  status: TfdStatus | string; version: number; submitted_at: string | null; requested_by: { name: string; cbo: string };
  consultation_id: string | null; regulation_request_id: string | null; report: TfdReport; destination: TransportDestination;
  provider: { id: string; name: string } | null; appointment_at: string | null; inpatient: { from: string; to: string | null }[];
  legs: TfdLeg[]; allowances: TfdAllowance[]; payments: TfdPayment[];
  accountability: { closed_at: string; document: { id: string; filename: string } } | null;
  events: TfdEvent[];
  // D10: passageiros `origin: "tfd"` ativos deste processo.
  trip_passengers: { id: string; date: string; departure_at: string; attendance: TripAttendance | string; companion_attendance: TripAttendance | string | null }[];
}
export interface TfdCaseRow {
  id: string; patient: { display_name: string | null }; destination: { name: string }; status: TfdStatus | string; submitted_at: string | null;
}
// PATCH é substituição inteira: sem `provider_id`, o prestador some (inclusive o posto pela comissão) — reenvie.
export interface TfdCaseInput {
  patient_id: string; consultation_id?: string | null; regulation_request_id?: string | null; report: TfdReportInput;
  destination_id: string; provider_id?: string | null;
}
// D8.
export interface TfdOptions {
  destinations: TransportDestination[]; providers: { id: string; name: string; ibge_code: string | null }[]; min_distance_km: number;
}
export interface TfdPrefill { patient_id: string; cid10: string | null; sigtap_code: string | null }

const activeQuery = (q?: { active?: boolean }) => new URLSearchParams(q?.active ? { active: "true" } : {});

// ── Frota ──
export async function listVehicles(q?: { active?: boolean }): Promise<TransportVehicle[]> {
  return (await jsonFetch<{ items?: TransportVehicle[] }>(withQuery(trPath("vehicles"), activeQuery(q)))).items ?? [];
}
export function createVehicle(i: VehicleInput): Promise<TransportVehicle> {
  return jsonFetch<TransportVehicle>(trPath("vehicles"), trWrite("POST", i));
}
export function updateVehicle(id: string, i: Partial<VehicleInput>): Promise<TransportVehicle> {
  return jsonFetch<TransportVehicle>(trPath("vehicles", id), trWrite("PATCH", i));
}
export async function listDrivers(q?: { active?: boolean }): Promise<TransportDriver[]> {
  return (await jsonFetch<{ items?: TransportDriver[] }>(withQuery(trPath("drivers"), activeQuery(q)))).items ?? [];
}
export async function listDriverCandidates(): Promise<DriverCandidate[]> {
  return (await jsonFetch<{ items?: DriverCandidate[] }>(trPath("driver_candidates"))).items ?? [];
}
export function createDriver(i: DriverInput): Promise<TransportDriver> {
  return jsonFetch<TransportDriver>(trPath("drivers"), trWrite("POST", i));
}
export function updateDriver(id: string, i: DriverUpdate): Promise<TransportDriver> {
  return jsonFetch<TransportDriver>(trPath("drivers", id), trWrite("PATCH", i));
}
export async function listDestinations(q?: { active?: boolean }): Promise<TransportDestination[]> {
  return (await jsonFetch<{ items?: TransportDestination[] }>(withQuery(trPath("destinations"), activeQuery(q)))).items ?? [];
}
export function createDestination(i: DestinationInput): Promise<TransportDestination> {
  return jsonFetch<TransportDestination>(trPath("destinations"), trWrite("POST", i));
}
export function updateDestination(id: string, i: Partial<DestinationInput>): Promise<TransportDestination> {
  return jsonFetch<TransportDestination>(trPath("destinations", id), trWrite("PATCH", i));
}

// ── Viagens e passageiros ──
export async function listTrips(q: { date: string; vehicleId?: string | null }): Promise<Trip[]> {
  const p = new URLSearchParams({ date: q.date });
  if (q.vehicleId) p.set("vehicle_id", q.vehicleId);
  return (await jsonFetch<{ items?: Trip[] }>(withQuery(trPath("trips"), p))).items ?? [];
}
export function createTrip(i: TripInput): Promise<Trip> {
  return jsonFetch<Trip>(trPath("trips"), trWrite("POST", i));
}
export function updateTrip(id: string, i: Partial<TripInput>): Promise<Trip> {
  return jsonFetch<Trip>(trPath("trips", id), trWrite("PATCH", i));
}
export function confirmTrip(id: string): Promise<Trip> {
  return jsonFetch<Trip>(trPath("trips", id, "confirm"), trWrite("POST"));
}
export function cancelTrip(id: string, reason: string): Promise<Trip> {
  return jsonFetch<Trip>(trPath("trips", id, "cancel"), trWrite("POST", { reason }));
}
// T46: unidades ativas que a central pode escolher para ver a agenda do 17 (papel transport_dispatcher), em ordem de nome.
export interface TransportHealthUnit { id: string; name: string }
export async function listTransportHealthUnits(): Promise<TransportHealthUnit[]> {
  return (await jsonFetch<{ units?: TransportHealthUnit[] }>(trPath("health_units"))).units ?? [];
}
// D4: tudo no corpo (o api recusa query). Sem `healthUnitId` não vem a agenda do 17; com `destinationId` ela sai.
export async function findScheduledCare(q: { date: string; destinationId?: string | null; healthUnitId?: string | null }): Promise<ScheduledCareItem[]> {
  const body: Record<string, string> = { date: q.date };
  if (q.destinationId) body.destination_id = q.destinationId;
  if (q.healthUnitId) body.health_unit_id = q.healthUnitId;
  return (await jsonFetch<{ items?: ScheduledCareItem[] }>(trPath("scheduled_care"), trWrite("POST", body))).items ?? [];
}
export function addPassenger(tripId: string, i: PassengerInput): Promise<TripPassenger> {
  return jsonFetch<TripPassenger>(trPath("trips", tripId, "passengers"), trWrite("POST", i));
}
// O api devolve a viagem inteira (200), não 204.
export function removePassenger(tripId: string, passengerId: string, reason: string): Promise<Trip> {
  return jsonFetch<Trip>(trPath("trips", tripId, "passengers", passengerId), trWrite("DELETE", { reason }));
}
// Lista impressa por fetch (e não por navegação) para a tela mostrar a recusa.
export function fetchTripManifest(tripId: string): Promise<{ blob: Blob; filename: string | null }> {
  return binaryFetch(trPath("trips", tripId, "manifest.pdf"), "application/pdf");
}
export function correctAttendance(tripId: string, i: AttendanceCorrectionInput): Promise<Trip> {
  return jsonFetch<Trip>(trPath("trips", tripId, "attendance_correction"), trWrite("POST", i));
}

// D1: a central busca por CPF (POST; o api materializa o paciente do par validado) e nunca cria paciente.
export async function lookupTransportPerson(cpf: string): Promise<PharmacyPerson> {
  const b = await jsonFetch<Omit<PharmacyPerson, "citizen_id" | "registration_id">>(trPath("person_lookup"), trWrite("POST", { cpf }));
  return { ...b, citizen_id: null, registration_id: null };
}
export async function findTransportDuplicates(q: DuplicateQuery): Promise<DuplicateCandidate[]> {
  const b = await jsonFetch<{ candidates?: Omit<DuplicateCandidate, "registration_id">[] }>(trPath("patients", "duplicates"), trWrite("POST", q));
  return (b.candidates ?? []).map((c) => ({ ...c, registration_id: null }));
}

// ── Séries, pendências e faltas ──
export async function listSeries(): Promise<TransportSeries[]> {
  return (await jsonFetch<{ items?: TransportSeries[] }>(trPath("series"))).items ?? [];
}
export function createSeries(i: SeriesInput): Promise<TransportSeries> {
  return jsonFetch<TransportSeries>(trPath("series"), trWrite("POST", i));
}
export function updateSeries(id: string, i: SeriesUpdate): Promise<TransportSeries> {
  return jsonFetch<TransportSeries>(trPath("series", id), trWrite("PATCH", i));
}
// Irreversível: para retomar, crie uma série nova.
export function suspendSeries(id: string, i: { from_on: string; reason: string }): Promise<TransportSeries> {
  return jsonFetch<TransportSeries>(trPath("series", id, "suspend"), trWrite("POST", i));
}
export async function listTransportPending(): Promise<TransportPendingItem[]> {
  return (await jsonFetch<{ items?: TransportPendingItem[] }>(trPath("pending"))).items ?? [];
}
export async function listNoShows(q: { from: string; to: string }): Promise<NoShowRow[]> {
  return (await jsonFetch<{ items?: NoShowRow[] }>(withQuery(trPath("no_shows"), new URLSearchParams({ from: q.from, to: q.to })))).items ?? [];
}

// ── Motorista (papel `driver` com cadastro ativo) ──
export async function listMyTrips(date?: string | null): Promise<Trip[]> {
  const p = new URLSearchParams(date ? { date } : {});
  return (await jsonFetch<{ items?: Trip[] }>(withQuery(trPath("my_trips"), p))).items ?? [];
}
export function startMyTrip(id: string): Promise<Trip> {
  return jsonFetch<Trip>(trPath("my_trips", id, "start"), trWrite("POST"));
}
export function recordAttendance(id: string, items: AttendanceItem[]): Promise<Trip> {
  return jsonFetch<Trip>(trPath("my_trips", id, "attendance"), trWrite("POST", { items }));
}
export function closeMyTrip(id: string, i: TripCloseInput): Promise<Trip> {
  return jsonFetch<Trip>(trPath("my_trips", id, "close"), trWrite("POST", i));
}

// ── Regras da cidade (municipal_admin; PATCH com step-up) e painel ──
export function getTransportSettings(): Promise<TransportSettings> {
  return jsonFetch<TransportSettings>(trPath("admin", "settings"));
}
export function updateTransportSettings(i: TransportSettingsInput): Promise<TransportSettings> {
  return jsonFetch<TransportSettings>(trPath("admin", "settings"), trWrite("PATCH", i));
}
export function getTransportDashboard(month?: string | null): Promise<TransportDashboard> {
  return jsonFetch<TransportDashboard>(withQuery(trPath("dashboard"), new URLSearchParams(month ? { month } : {})));
}

// ── TFD (D12: toda escrita devolve o processo inteiro) ──
export function getTfdOptions(): Promise<TfdOptions> {
  return jsonFetch<TfdOptions>(tfdPath("options"));
}
export function getTfdPrefill(consultationId: string): Promise<TfdPrefill> {
  return jsonFetch<TfdPrefill>(withQuery(tfdPath("prefill"), new URLSearchParams({ consultation_id: consultationId })));
}
export function createTfdCase(i: TfdCaseInput): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases"), trWrite("POST", i));
}
export function updateTfdCase(id: string, i: TfdCaseInput): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases", id), trWrite("PATCH", i));
}
export function submitTfdCase(id: string): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases", id, "submit"), trWrite("POST"));
}
// D14: ordem crescente; `before` é o cursor devolvido em `next_before` ("os itens depois deste").
export async function listTfdCases(q: { status?: string | null; before?: string | null }): Promise<{ items: TfdCaseRow[]; next_before: string | null }> {
  const p = new URLSearchParams();
  if (q.status) p.set("status", q.status);
  if (q.before) p.set("before", q.before);
  const b = await jsonFetch<{ items?: TfdCaseRow[]; next_before?: string | null }>(withQuery(tfdPath("cases"), p));
  return { items: b.items ?? [], next_before: b.next_before ?? null };
}
// D9: pedidos do próprio médico, com rascunhos, sem cursor (máximo 100).
export async function listMyTfdCases(): Promise<TfdCaseRow[]> {
  return (await jsonFetch<{ items?: TfdCaseRow[] }>(tfdPath("my_cases"))).items ?? [];
}
// Leitura nominal com trilha: POST, só no clique.
export function readTfdCase(id: string): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases", id, "read"), trWrite("POST"));
}
export function decideTfdCase(id: string, i: { decision: TfdDecision; reason: string }): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases", id, "decide"), trWrite("POST", i));
}
// `provider_id` ausente mantém o prestador do laudo.
export function setTfdAppointment(id: string, i: { appointment_at: string; provider_id?: string | null }): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases", id, "appointment"), trWrite("POST", i));
}
export function setTfdInpatient(id: string, i: { from: string; to?: string | null }): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases", id, "inpatient"), trWrite("POST", i));
}
export function cancelTfdCase(id: string, reason: string): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases", id, "cancel"), trWrite("POST", { reason }));
}
export function addTfdLeg(caseId: string, i: TfdLegInput): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases", caseId, "legs"), trWrite("POST", i));
}
export function markTfdLegDone(legId: string): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("legs", legId, "done"), trWrite("POST"));
}
export function recordTfdPayment(caseId: string, i: TfdPaymentInput): Promise<TfdCase> {
  return jsonFetch<TfdCase>(tfdPath("cases", caseId, "payments"), trWrite("POST", i));
}
// D11: só o tipo e o conteúdo em base64 — o nome do arquivo pode trazer o nome do paciente (o api gera um).
export async function uploadTfdAccountability(caseId: string, file: File): Promise<TfdCase> {
  const data = await readBase64(file);
  return jsonFetch<TfdCase>(tfdPath("cases", caseId, "accountability"), trWrite("POST", { content_type: file.type, data }));
}
// Endereço curto (5 min, preso ao usuário) para abrir o comprovante.
export async function getTfdAccountabilityUrl(caseId: string): Promise<string> {
  return (await jsonFetch<{ url: string }>(tfdPath("cases", caseId, "accountability", "url"), trWrite("POST"))).url;
}
// O arquivo do endereço curto (GET /tfd/files/<token>, trilha no api); 410 `link_expired` depois de 5 min. O nome do arquivo
// que vier no Content-Disposition não é usado pela tela.
// O api devolve o caminho sob `/tfd`: com VITE_TFD_BASE prefixado (proxy), o arquivo vai pela mesma base das outras chamadas do TFD.
export function fetchTfdAccountabilityFile(url: string): Promise<SignatureFile> {
  return binaryFetch(url.replace(/^\/tfd(?=\/)/, TFD_BASE), "application/pdf,image/jpeg,image/png");
}

// ─── Atenção psicossocial (módulo 31; ADR 0049; contrato 2026-11-04 §2–§11) ───
// Na URL só ids, unidade, situação, data, mês e cursor; CPF, CNS, nome, CID, substância, motivo, evolução, PTS e texto
// compartilhado vão no corpo (busca de pessoa e duplicados por POST, P30). Lista nunca traz texto clínico; o detalhe grava a
// trilha no api. Formas do api real (api-truth.md, ruling R1), não as do plano: listas em `{ items }` (paginadas com
// `next_before` na fila, nas ações, no matriciamento e na linha do tempo); unidade com `night_capable`; `options` com `team`,
// `instrument_codes`, `max_quantity` e `requires_authorization` (R2); `today.groups` com `sigtap_code` e `action_id` (R3);
// matrícula com `cid_main` sem ponto e sem rótulo; pendências do mês como códigos; vínculo sem o nome do CAPS (P46). O api
// recusa chave desconhecida e texto opcional vazio (`notes: ""` → 422): campo opcional vazio não vai. Toda escrita leva corpo.

const PSY_BASE = import.meta.env.VITE_PSYCHOSOCIAL_BASE || "/psychosocial";
const psyPath = (...parts: string[]) => [ PSY_BASE, ...parts.map(encodeURIComponent) ].join("/");
const psyWrite = (method: "POST" | "PATCH", body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });
// Query só com os valores preenchidos, na ordem dada.
const psyQuery = (params: Record<string, string | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));
// Tira as chaves opcionais vazias (undefined, null, "" ou só espaços) do corpo; o texto que vai, vai aparado.
function psyCompact<T extends object>(body: T, keys: (keyof T)[]): T {
  const out = { ...body };
  for (const key of keys) {
    const v = out[key] as unknown;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed === "") delete out[key];
      else (out as Record<keyof T, unknown>)[key] = trimmed;
    } else if (v === undefined || v === null) delete out[key];
  }
  return out;
}

export type CapsModality = "caps_i" | "caps_ii" | "caps_iii" | "caps_i_child" | "caps_ad" | "caps_ad_iii" | "caps_ad_iv";
export type PsyInstrument = "raas_psi" | "bpa_c" | "bpa_i";
export type CareIntensity = "intensive" | "semi_intensive" | "non_intensive";
export type ReceptionOutcome = "enrolled" | "referred_elsewhere" | "no_follow_up";
export type ReferralPriority = "routine" | "priority";
export type ReferralStatus = "pending" | "received";
export type PsyGroupKind = "group" | "workshop" | "assembly";
export type PsyPlace = "caps" | "territory";
export type MonthStatus = "open" | "closed" | "exported";
export type PsyEnrollmentStatus = "open" | "closed";
export type PsyActionOrigin = "manual" | "reception" | "night_stay" | "matrix_support";
// Regra do limite de noites (`night_limit_reached`): total no AD III/IV; seguidas ou intercaladas no CAPS III.
export type NightLimitRule = "total" | "consecutive" | "alternate";
// Painel: 1 a 4 chegam como "lt5" (0 fica 0).
export type PsyCount = number | "lt5";
export interface PsyPage<T> { items: T[]; next_before: string | null }
export type PsyTimelinePage = PsyPage<TimelineEntry>;

// ── Formas comuns ──
// `name` é o nome de exibição; nunca CPF.
export interface PsyPatientRef { patient_id: string; name: string; cns_masked: string | null }
// `cbo_code` é o do vínculo no CAPS; null para quem não tem vínculo (ex.: faturista).
export interface PsyPro { user_id: string; name: string; cbo_code: string | null }
// `name` da SIGTAP da competência ("" sem release).
export interface PsySigtap { code: string; name: string; instrument: PsyInstrument | string }
export interface PsyUnit { id: string; name: string; caps_modality: CapsModality | string; night_capable: boolean }
export interface PsyBed { id: string; health_unit_id: string; label: string; active: boolean }
export interface PsyCode { code: string; label: string }
// `instrument_codes` cru da SIGTAP ("09" RAAS-PSI, "02" BPA-I, "01" BPA-C); o instrumento da ação é decidido pelo api (P3).
export interface PsyProcedure {
  code: string; name: string; instrument_codes: string[]; family_care: boolean; collective: boolean;
  max_quantity: number | null; requires_authorization: boolean;
}
export interface PsyHealthTeam { id: string; name: string; ine: string | null; health_unit: { id: string; name: string } }
// Só a equipe lotada lê (P35).
export interface PsyOptions {
  origins: PsyCode[]; destinations: PsyCode[]; substances: PsyCode[];
  intensities: (CareIntensity | string)[]; places: (PsyPlace | string)[]; group_kinds: (PsyGroupKind | string)[];
  reception_outcomes: (ReceptionOutcome | string)[]; referral_priorities: (ReferralPriority | string)[];
  night_sigtap_code: string; competence: string; procedures: PsyProcedure[]; team: PsyPro[]; health_teams: PsyHealthTeam[];
  // Prazo do PTS do CAPS (dias): a revisão sugerida e o prazo do primeiro PTS. Pode faltar num api antigo (a tela usa a reserva).
  care_plan_review_days: number;
}
// eSF tipo 70; eSF sem CNES → `esf_covered: true, esf_cnes: null` (P38).
export interface PsyPrefill {
  esf_covered: boolean; esf_cnes: string | null; usf: { id: string; name: string } | null; team: { id: string; name: string } | null;
}

// ── Encaminhamento, acolhimento e matrícula ──
export interface PsyReferralInput { patient_id: string; health_unit_id: string; reason: string; priority: ReferralPriority }
export interface PsyReferralCreated {
  id: string; health_unit_id: string; priority: ReferralPriority | string; status: ReferralStatus | string; created_at: string;
}
// Sem `reason` na lista.
export interface PsyReferralRow {
  id: string; patient: PsyPatientRef; priority: ReferralPriority | string; status: ReferralStatus | string;
  from_unit: { id: string; name: string }; created_at: string;
}
export interface PsyReferral extends PsyReferralRow { reason: string; received_at: string | null; referred_by: { user_id: string; name: string } }
// `cid_main` com ou sem ponto; `substances` códigos "01"…"06", "99" (nenhuma) sozinho; `esf_cnes` só com cobertura.
export interface PsyEnrollmentFields {
  started_on: string; origin: string; cid_main: string; cid_secondary?: string[]; substances: string[];
  esf_covered: boolean; esf_cnes?: string | null; reference_user_id: string;
}
export interface PsyEnrollmentInput extends PsyEnrollmentFields { health_unit_id: string; patient_id: string }
export interface PsyReceptionInput {
  health_unit_id: string; patient_id: string; referral_id?: string | null; at: string; sigtap_code: string; notes?: string | null;
  outcome: ReceptionOutcome; enrollment?: PsyEnrollmentFields;
}
export interface PsyReceptionResult { reception_id: string; enrollment_id: string | null }
export interface PsyEnrollmentRow {
  id: string; patient: PsyPatientRef; started_on: string; reference: PsyPro; next_visit_at: string | null;
  status: PsyEnrollmentStatus | string; care_plan_review_on: string | null;
}
// `cid_main` é o código sem ponto ("F322"), sem rótulo.
export interface PsyEnrollment extends PsyEnrollmentRow {
  health_unit_id: string; origin: string; cid_main: string; cid_secondary: string[]; substances: string[]; esf_covered: boolean;
  esf_cnes: string | null; closed_on: string | null; destination: string | null; reception_id: string | null; created_at: string;
}
export type PsyEnrollmentPatch = Partial<PsyEnrollmentFields> & { next_visit_at?: string | null };
export interface PsyEnrollmentClose { destination: string; closed_on: string }

// ── PTS ──
export interface PsyCareGoal { text: string; responsible_user_id: string; due_on: string | null }
export interface PsyCarePlan {
  id: string; version: number; needs: string; goals: PsyCareGoal[]; intensity: CareIntensity | string; review_on: string;
  created_by: PsyPro; created_at: string;
}
export interface PsyCarePlanInput {
  needs: string; goals: { text: string; responsible_user_id: string; due_on?: string | null }[]; intensity: CareIntensity; review_on: string;
}
// `GET /care_plans/due`: revisões vencidas (a coordenação vê o CAPS; os demais, só onde são referência). `review_on` nulo = sem PTS.
export interface PsyCarePlanDue { enrollment_id: string; patient: PsyPatientRef; review_on: string | null }

// ── Grupos e Hoje ──
// `weekday` 1–7.
export interface PsyGroup {
  id: string; health_unit_id: string; name: string; kind: PsyGroupKind | string; weekday: number; starts_at: string; ends_at: string;
  responsible: PsyPro; capacity: number; sigtap_code: string; active: boolean;
}
export interface PsyGroupInput {
  health_unit_id: string; name: string; kind: PsyGroupKind; weekday: number; starts_at: string; ends_at: string;
  responsible_user_id: string; capacity: number; sigtap_code: string; active?: boolean;
}
export type PsyGroupPatch = Partial<Omit<PsyGroupInput, "health_unit_id">>;
// `action_id`: a ação não cancelada do grupo no dia (presença registrada).
export interface PsyTodayGroup {
  id: string; name: string; kind: PsyGroupKind | string; starts_at: string; ends_at: string; responsible: PsyPro; capacity: number;
  sigtap_code: string; action_id: string | null;
}
export interface PsyTodayVisit { enrollment_id: string; patient: PsyPatientRef; next_visit_at: string; reference: PsyPro }
export interface PsyToday { date: string; groups: PsyTodayGroup[]; visits: PsyTodayVisit[] }

// ── Ações e documentos ──
// Matriculado vai sempre por `enrollment_id` (só `patient_id` não liga à RAAS, P40); familiar sem cadastro por `family_name`.
export type PsyParticipantInput = { enrollment_id: string } | { patient_id: string } | { family_name: string };
// `authorization_number` com 13 dígitos; `quantity` 1–999 (padrão 1).
export interface PsyActionInput {
  health_unit_id: string; sigtap_code: string; performed_at: string; place: PsyPlace; quantity?: number; notes?: string | null;
  authorization_number?: string | null; group_id?: string | null; participants: PsyParticipantInput[];
}
export interface PsyActionRow {
  id: string; sigtap: PsySigtap; instrument: PsyInstrument | string; performed_at: string; place: PsyPlace | string; quantity: number;
  professional: PsyPro; group_id: string | null; participants_count: number; cancelled: boolean;
}
export type PsyActionParticipant = { enrollment_id: string | null; patient: PsyPatientRef } | { family_name: string };
export interface PsyAction extends PsyActionRow {
  health_unit_id: string; month: string; origin: PsyActionOrigin | string; notes: string | null; authorization_number: string | null;
  participants: PsyActionParticipant[]; cancelled_at: string | null; cancel_reason: string | null; created_at: string;
}
// R9 (P56): receita, registro da Notificação de papel (19d; sempre papel, sem SNCR, P58) e atestado pela ação.
export type PsyDocumentInput =
  | { kind: "prescription"; content: PrescriptionInput }
  | { kind: "controlled_notification_record"; content: NotificationRecordInput }
  | { kind: "sick_note"; content: SickNoteInput };

// ── Leitos e acolhimento noturno ──
export interface PsyBedInput { health_unit_id: string; label: string; active?: boolean }
export interface PsyBedPatch { label?: string; active?: boolean }
export interface PsyBoardItem {
  // `ended_at`: ISO quando a permanência já foi encerrada, nulo enquanto aberta.
  bed: PsyBed; stay: { id: string; patient: PsyPatientRef; started_at: string; expected_end_at: string; ended_at: string | null } | null;
  // Noites usadas na janela e o limite (no CAPS III, o de intercaladas); nulos sem permanência.
  nights_used: number | null; limit: number | null;
}
export interface PsyBedBoard { date: string; window_days: number; items: PsyBoardItem[] }
export interface PsyReassessment { reason: string }
export interface PsyNightStayInput {
  bed_id: string; enrollment_id: string; started_at: string; expected_end_at: string; reassessment?: PsyReassessment;
}
export interface PsyNightStayClose { ended_at: string; reason: string; reassessment?: PsyReassessment }
export interface PsyNightStay {
  id: string; patient: PsyPatientRef; started_at: string; expected_end_at: string; health_unit_id: string; bed: PsyBed;
  enrollment_id: string; ended_at: string | null; end_reason: string | null; nights: string[];
  reassessment: { reason: string; by: PsyPro } | null; started_by: PsyPro; closed_by: PsyPro | null; created_at: string;
}

// ── Regras da cidade (admin escreve com step-up; admin e lead leem) ──
export interface PsyNightLimits {
  caps_iii: { consecutive: number; alternate: number; window_days: number };
  caps_ad_iii: { total: number; window_days: number };
  caps_ad_iv: { total: number; window_days: number };
}
export interface PsySettings { night_limits: PsyNightLimits; care_plan_review_days: number }
// Parcial; cada modalidade vai com a forma inteira.
export interface PsySettingsPatch { night_limits?: Partial<PsyNightLimits>; care_plan_review_days?: number }

// ── RAAS do mês, remessa e fichas ──
// `problems` bloqueiam o fechamento; `warnings` (ex.: `no_actions`, `phone_missing`) não (P24, P57).
export interface PsyMonthRecord {
  id: string; enrollment_id: string; patient: PsyPatientRef; status: MonthStatus | string; homeless: boolean | null;
  actions_count: number; problems: string[]; warnings: string[];
}
export interface PsyMonthCounts {
  records: number; open: number; closed: number; exported: number; with_problems: number; with_warnings: number; actions: number;
}
export interface PsyMonth {
  month: string; health_unit_id: string; status: MonthStatus | string; closure: { closed_at: string; closed_by: PsyPro } | null;
  counts: PsyMonthCounts; records: PsyMonthRecord[];
}
export interface PsyHomelessResult {
  id: string; enrollment_id: string; health_unit_id: string; month: string; status: MonthStatus | string; homeless: boolean | null;
}
export interface PsyRaasExport {
  id: string; health_unit_id: string; month: string; competence: string; layout_version: string | null; records_count: number;
  sha256: string; created_at: string; created_by: PsyPro;
}

// ── Matriciamento e vínculo ──
// Sem `topic` na lista (P4).
export interface PsyMatrixSupportRow {
  id: string; health_unit_id: string; health_team: { id: string; name: string; ine: string | null; health_unit_id: string };
  held_on: string; participants: PsyPro[]; sigtap: PsySigtap; action_id: string | null; action_cancelled_at: string | null;
  cases_count: number; created_at: string;
}
export interface PsyMatrixCase { id: string; patient: PsyPatientRef; shared_text: string; created_at: string }
export interface PsyMatrixSupport extends PsyMatrixSupportRow { topic: string; cases: PsyMatrixCase[] }
export interface PsyMatrixSupportInput {
  health_unit_id: string; health_team_id: string; held_on: string; topic: string; participants_user_ids: string[]; sigtap_code: string;
}
export interface PsySharedCase { held_on: string; shared_text: string }
// Visto pela UBS: sem nome nem modalidade do CAPS (P46/P48); `caps.phone` pode ser nulo; casos também depois da alta (P44).
export type PsyLink =
  | { enrolled: false; shared_cases?: PsySharedCase[] }
  | { enrolled: true; caps: { phone: string | null }; since: string; reference: { name: string }; shared_cases: PsySharedCase[] };

// ── Painel (P52); sem rótulo de destino ──
export interface PsyDashboard {
  month: string;
  enrollments_active: { health_unit_id: string; name: string; caps_modality: CapsModality | string; count: PsyCount }[];
  new_in_month: PsyCount; closed_by_destination: Record<string, PsyCount>; care_plans_overdue: PsyCount;
  actions_by_instrument: { raas_psi: PsyCount; bpa_c: PsyCount; bpa_i: PsyCount };
  bed_occupancy: { nights: PsyCount; bed_days: PsyCount };
  raas_month: { open: PsyCount; closed: PsyCount; exported: PsyCount; no_actions: PsyCount };
}

async function psyItems<T>(url: string): Promise<T[]> {
  return (await jsonFetch<{ items?: T[] }>(url)).items ?? [];
}
async function psyPage<T>(url: string): Promise<PsyPage<T>> {
  const b = await jsonFetch<{ items?: T[]; next_before?: string | null }>(url);
  return { items: b.items ?? [], next_before: b.next_before ?? null };
}

// ── Unidades, opções e busca de pessoa ──
export function listPsyUnits(): Promise<PsyUnit[]> {
  return psyItems<PsyUnit>(psyPath("units"));
}
export function getPsyOptions(unitId: string): Promise<PsyOptions> {
  return jsonFetch<PsyOptions>(withQuery(psyPath("options"), psyQuery({ health_unit_id: unitId })));
}
async function psyLookup(body: { cpf: string } | { cns: string }): Promise<PharmacyPerson> {
  const b = await jsonFetch<Omit<PharmacyPerson, "citizen_id" | "registration_id">>(psyPath("person_lookup"), psyWrite("POST", body));
  return { ...b, citizen_id: null, registration_id: null };
}
export function lookupPsyPerson(cpf: string): Promise<PharmacyPerson> {
  return psyLookup({ cpf });
}
// R16: usuário sem CPF (ex.: em situação de rua) pelo CNS.
export function lookupPsyPersonByCns(cns: string): Promise<PharmacyPerson> {
  return psyLookup({ cns });
}
export async function findPsyDuplicates(q: DuplicateQuery): Promise<DuplicateCandidate[]> {
  const b = await jsonFetch<{ candidates?: Omit<DuplicateCandidate, "registration_id">[] }>(
    psyPath("patients", "duplicates"), psyWrite("POST", psyCompact(q, [ "mother_name" ])));
  return (b.candidates ?? []).map((c) => ({ ...c, registration_id: null }));
}
export function getPsyPrefill(unitId: string, patientId: string): Promise<PsyPrefill> {
  return jsonFetch<PsyPrefill>(withQuery(psyPath("prefill"), psyQuery({ patient_id: patientId, health_unit_id: unitId })));
}

// ── Encaminhamento, acolhimento e matrícula ──
// Da UBS (health_professional em contexto).
export function createPsyReferral(i: PsyReferralInput): Promise<PsyReferralCreated> {
  return jsonFetch<PsyReferralCreated>(psyPath("referrals"), psyWrite("POST", i));
}
export function listPsyReferrals(unitId: string, q: { status?: ReferralStatus; before?: string | null } = {}): Promise<PsyPage<PsyReferralRow>> {
  return psyPage(withQuery(psyPath("referrals"), psyQuery({ health_unit_id: unitId, status: q.status ?? "pending", before: q.before })));
}
export function getPsyReferral(id: string): Promise<PsyReferral> {
  return jsonFetch<PsyReferral>(psyPath("referrals", id));
}
export function recordPsyReception(i: PsyReceptionInput): Promise<PsyReceptionResult> {
  return jsonFetch<PsyReceptionResult>(psyPath("receptions"), psyWrite("POST", psyCompact(i, [ "referral_id", "notes", "enrollment" ])));
}
export function createPsyEnrollment(i: PsyEnrollmentInput): Promise<PsyEnrollment> {
  return jsonFetch<PsyEnrollment>(psyPath("enrollments"), psyWrite("POST", i));
}
// R13: o filtro por nome é local e precisa da lista inteira — lê todas as páginas (500 por página).
const PSY_MAX_PAGES = 50;
// Defesa em profundidade: a lista (que vai ao cache) leva só estes campos, mesmo que o api mande outro por engano.
const psyPatientRef = (p: PsyPatientRef): PsyPatientRef => ({ patient_id: p.patient_id, name: p.name, cns_masked: p.cns_masked ?? null });
const psyPro = (p: PsyPro): PsyPro => ({ user_id: p.user_id, name: p.name, cbo_code: p.cbo_code ?? null });
const psyEnrollmentRow = (r: PsyEnrollmentRow): PsyEnrollmentRow => ({
  id: r.id, patient: psyPatientRef(r.patient), started_on: r.started_on, reference: psyPro(r.reference), next_visit_at: r.next_visit_at ?? null,
  status: r.status, care_plan_review_on: r.care_plan_review_on ?? null
});
export async function listPsyEnrollments(q: { unitId: string; status: PsyEnrollmentStatus }): Promise<PsyEnrollmentRow[]> {
  const rows: PsyEnrollmentRow[] = [];
  const seen = new Set<string>();
  let before: string | null = null;
  for (let n = 0; n < PSY_MAX_PAGES; n++) {
    const page: PsyPage<PsyEnrollmentRow> = await psyPage(withQuery(psyPath("enrollments"),
      psyQuery({ health_unit_id: q.unitId, status: q.status, before })));
    rows.push(...page.items.map(psyEnrollmentRow));
    // Cursor que já passou (ou que não acaba) prenderia o laço: para ali.
    if (!page.next_before || seen.has(page.next_before)) break;
    seen.add(page.next_before);
    before = page.next_before;
  }
  return rows;
}
export function getPsyEnrollment(id: string): Promise<PsyEnrollment> {
  return jsonFetch<PsyEnrollment>(psyPath("enrollments", id));
}
export function updatePsyEnrollment(id: string, p: PsyEnrollmentPatch): Promise<PsyEnrollment> {
  return jsonFetch<PsyEnrollment>(psyPath("enrollments", id), psyWrite("PATCH", p));
}
export function closePsyEnrollment(id: string, i: PsyEnrollmentClose): Promise<PsyEnrollment> {
  return jsonFetch<PsyEnrollment>(psyPath("enrollments", id, "close"), psyWrite("POST", i));
}

// ── PTS (o GET grava a trilha `care_plans`) ──
export function listPsyCarePlans(enrollmentId: string): Promise<PsyCarePlan[]> {
  return psyItems<PsyCarePlan>(psyPath("enrollments", enrollmentId, "care_plans"));
}
export function createPsyCarePlan(enrollmentId: string, i: PsyCarePlanInput): Promise<PsyCarePlan> {
  return jsonFetch<PsyCarePlan>(psyPath("enrollments", enrollmentId, "care_plans"), psyWrite("POST", i));
}
export async function listPsyCarePlansDue(unitId: string): Promise<PsyCarePlanDue[]> {
  const items = await psyItems<PsyCarePlanDue>(withQuery(psyPath("care_plans", "due"), psyQuery({ health_unit_id: unitId })));
  return items.map((r) => ({ enrollment_id: r.enrollment_id, patient: psyPatientRef(r.patient), review_on: r.review_on ?? null }));
}

// ── Grupos e Hoje ──
export function listPsyGroups(unitId: string, q: { active?: boolean } = {}): Promise<PsyGroup[]> {
  const active = q.active === undefined ? null : String(q.active);
  return psyItems<PsyGroup>(withQuery(psyPath("groups"), psyQuery({ health_unit_id: unitId, active })));
}
export function createPsyGroup(i: PsyGroupInput): Promise<PsyGroup> {
  return jsonFetch<PsyGroup>(psyPath("groups"), psyWrite("POST", i));
}
export function updatePsyGroup(id: string, i: PsyGroupPatch): Promise<PsyGroup> {
  return jsonFetch<PsyGroup>(psyPath("groups", id), psyWrite("PATCH", i));
}
// Sem data, o api usa hoje na cidade.
export function getPsyToday(unitId: string, date?: string | null): Promise<PsyToday> {
  return jsonFetch<PsyToday>(withQuery(psyPath("today"), psyQuery({ health_unit_id: unitId, date })));
}

// ── Ações e documentos ──
export function createPsyAction(i: PsyActionInput): Promise<PsyAction> {
  return jsonFetch<PsyAction>(psyPath("actions"), psyWrite("POST", psyCompact(i, [ "notes", "authorization_number", "group_id" ])));
}
export function listPsyActions(enrollmentId: string, before?: string | null): Promise<PsyPage<PsyActionRow>> {
  return psyPage(withQuery(psyPath("actions"), psyQuery({ enrollment_id: enrollmentId, before })));
}
export function getPsyAction(id: string): Promise<PsyAction> {
  return jsonFetch<PsyAction>(psyPath("actions", id));
}
// Devolve o item da lista (sem evolução). Mês fechado: só a coordenação (403 `lead_required`).
export function cancelPsyAction(id: string, reason: string): Promise<PsyActionRow> {
  return jsonFetch<PsyActionRow>(psyPath("actions", id, "cancel"), psyWrite("POST", { reason }));
}
export function listPsyActionDocuments(actionId: string): Promise<ClinicalDocument[]> {
  return psyItems<ClinicalDocument>(psyPath("actions", actionId, "documents"));
}
export function issuePsyDocument(actionId: string, input: PsyDocumentInput, replacesDocumentId?: string | null): Promise<ClinicalDocument> {
  return jsonFetch<ClinicalDocument>(psyPath("actions", actionId, "documents"), psyWrite("POST", {
    kind: input.kind, content: input.content, ...(replacesDocumentId ? { replaces_document_id: replacesDocumentId } : {})
  }));
}
export function issuePsyPrescription(actionId: string, content: PrescriptionInput, replacesDocumentId?: string | null): Promise<ClinicalDocument> {
  return issuePsyDocument(actionId, { kind: "prescription", content }, replacesDocumentId);
}

// ── Leitos (admin; escrita com step-up) e acolhimento noturno ──
export function listPsyBeds(unitId: string): Promise<PsyBed[]> {
  return psyItems<PsyBed>(withQuery(psyPath("beds"), psyQuery({ health_unit_id: unitId })));
}
export function createPsyBed(i: PsyBedInput): Promise<PsyBed> {
  return jsonFetch<PsyBed>(psyPath("beds"), psyWrite("POST", i));
}
export function updatePsyBed(id: string, i: PsyBedPatch): Promise<PsyBed> {
  return jsonFetch<PsyBed>(psyPath("beds", id), psyWrite("PATCH", i));
}
export function getPsyBedBoard(unitId: string, date?: string | null): Promise<PsyBedBoard> {
  return jsonFetch<PsyBedBoard>(withQuery(psyPath("beds", "board"), psyQuery({ health_unit_id: unitId, date })));
}
// `reassessment` só quando a coordenação passa do limite de noites.
export function startPsyNightStay(i: PsyNightStayInput): Promise<PsyNightStay> {
  return jsonFetch<PsyNightStay>(psyPath("night_stays"), psyWrite("POST", psyCompact(i, [ "reassessment" ])));
}
export function getPsyNightStay(id: string): Promise<PsyNightStay> {
  return jsonFetch<PsyNightStay>(psyPath("night_stays", id));
}
export function closePsyNightStay(id: string, i: PsyNightStayClose): Promise<PsyNightStay> {
  return jsonFetch<PsyNightStay>(psyPath("night_stays", id, "close"), psyWrite("POST", psyCompact(i, [ "reassessment" ])));
}

// ── Regras da cidade ──
export function getPsySettings(): Promise<PsySettings> {
  return jsonFetch<PsySettings>(psyPath("settings"));
}
export function updatePsySettings(s: PsySettingsPatch): Promise<PsySettings> {
  return jsonFetch<PsySettings>(psyPath("settings"), psyWrite("PATCH", s));
}

// ── RAAS do mês, remessa e fichas ──
export function getPsyMonth(month: string, unitId: string): Promise<PsyMonth> {
  return jsonFetch<PsyMonth>(withQuery(psyPath("months", month), psyQuery({ health_unit_id: unitId })));
}
export function setPsyHomeless(recordId: string, homeless: boolean): Promise<PsyHomelessResult> {
  return jsonFetch<PsyHomelessResult>(psyPath("monthly_records", recordId), psyWrite("PATCH", { homeless }));
}
// Fechar e reabrir: coordenação, com step-up.
export function closePsyMonth(month: string, unitId: string): Promise<PsyMonth> {
  return jsonFetch<PsyMonth>(psyPath("months", month, "close"), psyWrite("POST", { health_unit_id: unitId }));
}
export function reopenPsyMonth(month: string, unitId: string, reason: string): Promise<PsyMonth> {
  return jsonFetch<PsyMonth>(psyPath("months", month, "reopen"), psyWrite("POST", { health_unit_id: unitId, reason }));
}
export function listPsyRaasExports(unitId: string, month?: string | null): Promise<PsyRaasExport[]> {
  return psyItems<PsyRaasExport>(withQuery(psyPath("raas_exports"), psyQuery({ health_unit_id: unitId, month })));
}
// Coordenação e faturista, com step-up (P15); sem layout homologado → 422 `raas_layout_unavailable`.
export function createPsyRaasExport(unitId: string, month: string): Promise<PsyRaasExport> {
  return jsonFetch<PsyRaasExport>(psyPath("raas_exports"), psyWrite("POST", { health_unit_id: unitId, month }));
}
// Arquivo e fichas por fetch (e não por navegação) para a tela mostrar a recusa.
export function fetchPsyRaasFile(id: string): Promise<SignatureFile> {
  return binaryFetch(psyPath("raas_exports", id, "file"), "application/octet-stream, */*");
}
export function fetchPsySheets(month: string, q: { unitId: string; enrollmentId?: string | null }): Promise<SignatureFile> {
  return binaryFetch(withQuery(psyPath("months", month, "sheets.pdf"), psyQuery({ health_unit_id: q.unitId, enrollment_id: q.enrollmentId })),
    "application/pdf");
}

// ── Matriciamento e vínculo ──
export function listPsyMatrixSupports(unitId: string, before?: string | null): Promise<PsyPage<PsyMatrixSupportRow>> {
  return psyPage(withQuery(psyPath("matrix_supports"), psyQuery({ health_unit_id: unitId, before })));
}
export function getPsyMatrixSupport(id: string): Promise<PsyMatrixSupport> {
  return jsonFetch<PsyMatrixSupport>(psyPath("matrix_supports", id));
}
export function createPsyMatrixSupport(i: PsyMatrixSupportInput): Promise<PsyMatrixSupport> {
  return jsonFetch<PsyMatrixSupport>(psyPath("matrix_supports"), psyWrite("POST", i));
}
// Devolve só o caso (201): releia o matriciamento para a lista.
export function addPsyMatrixCase(supportId: string, i: { patient_id: string; shared_text: string }): Promise<PsyMatrixCase> {
  return jsonFetch<PsyMatrixCase>(psyPath("matrix_supports", supportId, "cases"), psyWrite("POST", i));
}
// Da UBS (health_professional em contexto).
export function getPsyLink(patientId: string): Promise<PsyLink> {
  return jsonFetch<PsyLink>(psyPath("patients", patientId, "link"));
}

// ── Linha do tempo do CAPS e painel ──
export function getPsyEnrollmentTimeline(enrollmentId: string, before?: string | null): Promise<PsyTimelinePage> {
  return psyPage(withQuery(psyPath("enrollments", enrollmentId, "timeline"), psyQuery({ before })));
}
// Sem `unitId`, todos os CAPS que o papel alcança.
export function getPsyDashboard(q: { month?: string | null; unitId?: string | null }): Promise<PsyDashboard> {
  return jsonFetch<PsyDashboard>(withQuery(psyPath("dashboard"), psyQuery({ month: q.month, health_unit_id: q.unitId })));
}

// ─── Urgência (módulo 32a; ADR 0050; contrato 2026-11-05 §2–§11) ───
// Formas do api real (preflight §A; contrato §14 Q1–Q29). Na URL só ids e o mês: CPF, CNS, nome, queixa e a
// descrição do não identificado vão sempre no corpo. Escritas com corpo JSON (`{}` quando vazio); listas
// desembrulham `{ items }` (menos os locais, que trazem `location_required`). A TV (pareamento e painel) não
// tem sessão: vai sem cookie, com o token no cabeçalho X-Display-Token.
const URGENCY_BASE = import.meta.env.VITE_URGENCY_BASE || "/urgency";
const WAITING_ROOM_BASE = import.meta.env.VITE_WAITING_ROOM_BASE || "/waiting_room";
const urgencyPath = (...parts: string[]) => [ URGENCY_BASE, ...parts.map(encodeURIComponent) ].join("/");
const waitingRoomPath = (...parts: string[]) => [ WAITING_ROOM_BASE, ...parts.map(encodeURIComponent) ].join("/");
const urgencyWrite = (method: "POST" | "PATCH", body?: unknown): RequestInit => ({ method, body: JSON.stringify(body ?? {}) });
const urgencyQuery = (params: Record<string, string | null | undefined>) =>
  new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string" && e[1] !== ""));

export type UrgencyColor = "red" | "orange" | "yellow" | "green" | "blue";
export type UrgencyState = "waiting_classification" | "classified" | "in_care" | "closed";
// Q25: `registered_in_error` (aberto por engano ou em duplicidade, com `reason`) fica fora do painel e do cidadão.
export type UrgencyOutcomeKind =
  | "discharged" | "discharged_to_primary_care" | "transferred" | "left_without_care" | "left_against_advice" | "death"
  | "registered_in_error";
export type CallKind = "classification" | "care";
// Painel: contagens de 1 a 4 chegam como "lt5" (0 fica 0); tempos com contagem 0 chegam null.
export type UrgencyCount = number | "lt5";
export type UrgencyTime = number | "lt5" | null;
// Task 1 carry: o api pode mandar a consulta descartada (sem consulta utilizável).
export type UrgencyConsultationStatus = "draft" | "finalized" | "discarded";

// <patient-ref> (contrato §2): `description` só do provisório e só no detalhe (e na lista de provisórios, Q29).
export interface UrgencyPatientRef {
  patient_id: string; name: string; cns_masked: string | null; unidentified: boolean; description?: string | null;
}
// `candidates` vem sempre [] (Q4).
export interface UrgencyLookup { patient: UrgencyPatientRef | null; candidates: UrgencyPatientRef[] }
// 409 duplicate_suspected (Q23): `{ error, path: "new_patient", candidates }`, na forma do 24a/27a.
export type UrgencyDuplicateCandidate = Omit<DuplicateCandidate, "registration_id">;
// D1 + Q23: `duplicates_reviewed` só com `new_patient` (reenvio depois de conferir os candidatos).
export type UrgencyArrivalInput = { health_unit_id: string } & (
  | { patient_id: string }
  | { new_patient: NewPatient; duplicates_reviewed?: true }
  | { unidentified: { description: string } }
);
// A chegada nunca traz a descrição do provisório.
export interface UrgencyArrival { attendance_id: string; encounter_id: string; ticket: string | null; patient: UrgencyPatientRef }

export interface UrgencyLastCall { kind: CallKind; location: string | null; called_at: string }
// Fila (Urgency::Queue): aguardando classificação manda `max_wait_minutes: null`.
export interface UrgencyWaitingRow {
  encounter_id: string; attendance_id: string; ticket: string | null; patient: UrgencyPatientRef; arrived_at: string;
  waited_minutes: number; last_call: UrgencyLastCall | null; max_wait_minutes?: number | null;
}
// `overdue` pelo relógio da 1ª classificação (`classified_at`) contra o tempo máximo da vigente (Q18): vem pronto do api.
export interface UrgencyColorRow extends UrgencyWaitingRow {
  color: UrgencyColor; overdue: boolean; max_wait_minutes: number; classified_at: string;
}
// Em atendimento: os campos da espera + cor e chamada; nunca `overdue`.
export interface UrgencyInCareRow extends UrgencyWaitingRow {
  color: UrgencyColor | null; max_wait_minutes: number | null; called_at: string | null; called_by_name: string | null;
  consultation_id: string | null; consultation_status: UrgencyConsultationStatus | null;
  // Módulo 32b: leito e horas, quando o encontro está em observação.
  observation?: UrgencyInCareObservation | null;
}
export interface UrgencyQueue {
  awaiting_classification: UrgencyWaitingRow[]; by_color: UrgencyColorRow[]; in_care: UrgencyInCareRow[];
}

export interface UrgencyLevel { color: UrgencyColor; max_wait_minutes: number }
// Prévia da cor (Q1, Q23): `pain_scale` nulo → `suggested: null`. A queixa é aceita e ignorada.
export interface UrgencySuggestInput { encounter_id: string; complaint?: string; vital_signs: VitalSigns; pain_scale: number | null }
export interface UrgencySuggestion {
  suggested: { color: UrgencyColor; criterion: string; rule_id?: string } | null; levels: UrgencyLevel[];
}
// Q22: `pain_scale` (0–10) obrigatório; `vital_signs` sem `pain_score`. `justification` só quando exigida.
export interface UrgencyClassificationInput {
  complaint: string; vital_signs: VitalSigns; pain_scale: number; color: UrgencyColor; justification?: string;
}
// Sem acesso clínico (a recepção, Q19) não vêm `complaint`, `vital_signs`, `pain_scale`, `justification`, `criterion`
// nem `suggested.criterion`. `criterion` do topo só quando a cor final é a sugerida.
export interface UrgencyClassificationView {
  id: string; position: number; color: UrgencyColor; suggested_color: UrgencyColor | null;
  suggested: { color: UrgencyColor; criterion?: string | null } | null; criterion?: string | null;
  complaint?: string; vital_signs?: VitalSigns; pain_scale?: number | null; justification?: string | null;
  max_wait_minutes: number; protocol_definition_id: string | null; classified_at: string;
  by: { name: string; cbo_code: string | null };
}
// Q25: `reason` só em registered_in_error (10–500); limites do api: destino 3–200, vaga ≤500, retorno 1–90 dias e motivo 3–300.
export interface UrgencyOutcomeInput {
  kind: UrgencyOutcomeKind; destination?: string; vacancy_request?: string; return_guidance?: { days: number; reason: string };
  reason?: string;
}
// Sem acesso clínico não vêm `destination`, `vacancy_request`, `reason` nem `return_guidance.reason`.
export interface UrgencyOutcomeView {
  kind: UrgencyOutcomeKind; destination?: string | null; vacancy_request?: string | null;
  return_guidance: { days: number; reason?: string | null } | null; reason?: string | null; recorded_at: string;
  by: { name: string };
}
// Detalhe (D4, Q6): a cor vigente, o tempo máximo dela e o estouro vêm prontos.
export interface UrgencyEncounter {
  id: string; attendance_id: string; health_unit_id: string; state: UrgencyState; ticket: string | null; arrived_at: string;
  patient: UrgencyPatientRef; color: UrgencyColor | null; max_wait_minutes: number | null; overdue: boolean;
  first_classified_at: string | null; classifications: UrgencyClassificationView[];
  consultation_id: string | null; consultation_status: UrgencyConsultationStatus | null; outcome: UrgencyOutcomeView | null;
  // Módulo 32b: `observation` vem sempre (recepção inclusive); `prescription` (só a versão ativa) e `administrations`
  // (48 h) só com acesso clínico (Q9): sem ele as chaves nem existem.
  observation?: UrgencyObservationBlock;
  prescription?: UrgencyPrescription | null;
  administrations?: UrgencyDetailAdministration[];
}
export interface UrgencyCall { id: string; kind: CallKind; ticket: string | null; location: string | null; called_at: string }
// Identificação (só a recepção): paciente existente (fusão) ou novo, com a conferência de duplicado (Q23).
export type IdentifyInput = { patient_id: string } | { new_patient: NewPatient; duplicates_reviewed?: true };
// Q17: `moved` e `kept_duplicates` (itens repetidos que ficaram no provisório); 0 com paciente novo.
export interface UrgencyIdentifyResult { encounter: UrgencyEncounter; merged: boolean; moved: number; kept_duplicates: number }
export interface UrgencyOutcomeResult { encounter: UrgencyEncounter; attendance: { id: string; status: string; outcome: string | null } }

// Locais de chamada (D6): nome 1–40; `location_required` vem com a lista.
export interface CallLocation { id: string; health_unit_id: string; name: string; active: boolean }
export interface CallLocationList { items: CallLocation[]; location_required: boolean }
// TVs (D7, A18): nome 1–60; `active: false` também revoga.
export interface WaitingRoomDisplay {
  id: string; health_unit_id: string; name: string; active: boolean; show_wait_times: boolean; paired: boolean;
  paired_at: string | null; last_seen_at: string | null; revoked: boolean; revoked_at: string | null;
}
// O código é texto de 6 dígitos (o zero da frente conta): nunca Number().
export interface PairingCode { code: string; expires_at: string }
// Painel da TV: nunca nome, CPF, cor da pessoa nem queixa. `wait_times` null fora da UPA ou com o flag desligado;
// quando vem, traz as 5 cores.
export interface BoardCall { ticket: string; location: string | null; kind: CallKind; called_at: string }
export interface BoardWaitTime { color: UrgencyColor; median_minutes: number | "lt5_patients" }
export interface WaitingRoomBoard { unit: { name: string }; calls: BoardCall[]; wait_times: BoardWaitTime[] | null; updated_at: string }

// Painel do gestor (Urgency::Dashboard, Q15): sem total; `registered_in_error` fora de tudo (Q25).
export interface UrgencyTimeRow { color: UrgencyColor; count: UrgencyCount; median_minutes: UrgencyTime; p90_minutes: UrgencyTime }
export interface UrgencyOverMaxWait { color: UrgencyColor; count: UrgencyCount; over: UrgencyCount }
export type UrgencyCareOutcomeKind = Exclude<UrgencyOutcomeKind, "registered_in_error">;
export interface UrgencyDashboard {
  month: string; units: { id: string; name: string }[];
  door_to_classification: UrgencyTimeRow[]; classification_to_physician: UrgencyTimeRow[]; over_max_wait: UrgencyOverMaxWait[];
  by_color: Record<UrgencyColor | "unclassified", UrgencyCount>;
  by_outcome: Record<UrgencyCareOutcomeKind, UrgencyCount>;
  // Evasão = só left_without_care (Q28).
  evasion: { before_classification: UrgencyCount; after_classification: UrgencyCount };
  stay: { count: UrgencyCount; median_minutes: UrgencyTime; p90_minutes: UrgencyTime };
  // Módulo 32b (Q10/A30): horas com 1 casa; de 1 a 4 estadias o bloco inteiro vem "lt5" (bed_hours inclusive); 0 estadias: nulos.
  observation?: {
    stays: UrgencyCount; over_24h: UrgencyCount; median_hours: UrgencyTime; p90_hours: UrgencyTime; bed_hours: UrgencyTime;
  };
}
// Retornos pedidos à UBS (D10, Q20): nunca o motivo.
export interface CounterReferral {
  encounter_id: string; patient: UrgencyPatientRef; upa: { name: string }; closed_at: string; return_days: number; due_on: string;
}
// Q29: provisórios ainda não identificados (abertos ou fechados nos últimos 7 dias), para a recepção. Nenhum dado clínico.
export interface ProvisionalEncounter {
  encounter_id: string; attendance_id: string; arrived_at: string; closed_at: string | null;
  outcome_kind: UrgencyOutcomeKind | null; patient: UrgencyPatientRef;
}

// ── Recepção, classificação, fila e desfecho ──
export function lookupUrgencyPerson(q: { cpf: string } | { cns: string }): Promise<UrgencyLookup> {
  return jsonFetch<UrgencyLookup>(urgencyPath("person_lookup"), urgencyWrite("POST", q));
}
export function createUrgencyArrival(i: UrgencyArrivalInput): Promise<UrgencyArrival> {
  return jsonFetch<UrgencyArrival>(urgencyPath("arrivals"), urgencyWrite("POST", i));
}
export function getUrgencyQueue(unitId: string): Promise<UrgencyQueue> {
  return jsonFetch<UrgencyQueue>(withQuery(urgencyPath("queue"), urgencyQuery({ health_unit_id: unitId })));
}
// Grava trilha no api (o detalhe tem o clínico ou a descrição).
export async function getUrgencyEncounter(id: string): Promise<UrgencyEncounter> {
  return (await jsonFetch<{ encounter: UrgencyEncounter }>(urgencyPath("encounters", id))).encounter;
}
export function suggestUrgencyColor(i: UrgencySuggestInput): Promise<UrgencySuggestion> {
  return jsonFetch<UrgencySuggestion>(urgencyPath("suggest"), urgencyWrite("POST", i));
}
// 201 `{ encounter, suggested: { color, criterion } | null }` (sem `rule_id`).
export function classifyUrgency(
  encounterId: string, i: UrgencyClassificationInput
): Promise<{ encounter: UrgencyEncounter; suggested: UrgencySuggestion["suggested"] }> {
  return jsonFetch(urgencyPath("encounters", encounterId, "classifications"), urgencyWrite("POST", i));
}
// `{ encounter, call }`; `call` null sem o waiting_room_display.
export function callForClassification(encounterId: string, callLocationId: string | null): Promise<{ encounter: UrgencyEncounter; call: UrgencyCall | null }> {
  return jsonFetch(urgencyPath("encounters", encounterId, "call_for_classification"), urgencyWrite("POST", callLocationBody(callLocationId)));
}
// Chamar de novo (Q7): sob /attendance; a nova chamada repete o tipo da última. 201 `{ call_id, call }`.
export function recallAttendance(attendanceId: string, callLocationId: string | null): Promise<{ call_id: string; call: UrgencyCall }> {
  return jsonFetch(`${ATTENDANCE_BASE}/attendances/${encodeURIComponent(attendanceId)}/recall`, urgencyWrite("POST", callLocationBody(callLocationId)));
}
// 201 `{ encounter, attendance: { id, status, outcome } }`.
export function recordUrgencyOutcome(encounterId: string, i: UrgencyOutcomeInput): Promise<UrgencyOutcomeResult> {
  return jsonFetch<UrgencyOutcomeResult>(urgencyPath("encounters", encounterId, "outcome"), urgencyWrite("POST", i));
}
export function identifyUrgencyPatient(encounterId: string, i: IdentifyInput): Promise<UrgencyIdentifyResult> {
  return jsonFetch<UrgencyIdentifyResult>(urgencyPath("encounters", encounterId, "identify"), urgencyWrite("POST", i));
}
export async function listCounterReferrals(unitId: string): Promise<CounterReferral[]> {
  const b = await jsonFetch<{ items?: CounterReferral[] }>(withQuery(urgencyPath("counter_referrals"), urgencyQuery({ health_unit_id: unitId })));
  return b.items ?? [];
}
// Grava trilha no api (leva a descrição física).
export async function listProvisionalEncounters(unitId: string): Promise<ProvisionalEncounter[]> {
  const b = await jsonFetch<{ items?: ProvisionalEncounter[] }>(
    withQuery(urgencyPath("provisional_encounters"), urgencyQuery({ health_unit_id: unitId })));
  return b.items ?? [];
}
// Sem `unitId`, todas as UPAs ativas que o papel alcança.
export function getUrgencyDashboard(q: { month: string; unitId?: string | null }): Promise<UrgencyDashboard> {
  return jsonFetch<UrgencyDashboard>(withQuery(urgencyPath("dashboard"), urgencyQuery({ month: q.month, health_unit_id: q.unitId })));
}

// ── Locais de chamada (sob /attendance, Q7) e TVs (admin, com step-up) ──
export function listCallLocations(unitId: string): Promise<CallLocationList> {
  return jsonFetch<CallLocationList>(withQuery(`${ATTENDANCE_BASE}/call_locations`, urgencyQuery({ health_unit_id: unitId })));
}
export function createCallLocation(i: { health_unit_id: string; name: string; active: boolean }): Promise<CallLocation> {
  return jsonFetch<CallLocation>(`${ATTENDANCE_BASE}/call_locations`, urgencyWrite("POST", i));
}
export function updateCallLocation(id: string, i: { name: string; active: boolean }): Promise<CallLocation> {
  return jsonFetch<CallLocation>(`${ATTENDANCE_BASE}/call_locations/${encodeURIComponent(id)}`, urgencyWrite("PATCH", i));
}
export async function listWaitingRoomDisplays(unitId: string): Promise<WaitingRoomDisplay[]> {
  const b = await jsonFetch<{ items?: WaitingRoomDisplay[] }>(withQuery(waitingRoomPath("displays"), urgencyQuery({ health_unit_id: unitId })));
  return b.items ?? [];
}
export function createWaitingRoomDisplay(
  i: { health_unit_id: string; name: string; active: boolean; show_wait_times: boolean }
): Promise<WaitingRoomDisplay> {
  return jsonFetch<WaitingRoomDisplay>(waitingRoomPath("displays"), urgencyWrite("POST", i));
}
export function updateWaitingRoomDisplay(id: string, i: { name: string; active: boolean; show_wait_times: boolean }): Promise<WaitingRoomDisplay> {
  return jsonFetch<WaitingRoomDisplay>(waitingRoomPath("displays", id), urgencyWrite("PATCH", i));
}
// 201; TV desativada → 422 display_inactive.
export function createPairingCode(displayId: string): Promise<PairingCode> {
  return jsonFetch<PairingCode>(waitingRoomPath("displays", displayId, "pairing_code"), urgencyWrite("POST"));
}
export function revokeWaitingRoomDisplay(displayId: string): Promise<WaitingRoomDisplay> {
  return jsonFetch<WaitingRoomDisplay>(waitingRoomPath("displays", displayId, "revoke"), urgencyWrite("POST"));
}

// ── A TV: sem cookie (credentials: "omit"), fora da sessão; recusa vira ApiError como no jsonFetch ──
async function displayFetch<T>(input: string, init: RequestInit): Promise<T> {
  const res = await fetch(input, { ...init, credentials: "omit" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    let body: unknown = text;
    if (text) { try { body = JSON.parse(text); } catch { /* deixa string */ } }
    throw new ApiError(res.status, body, `${res.status} on ${input}`);
  }
  return await res.json() as T;
}
// 201 `{ display_token }`. O api exige Content-Type JSON (415 json_required); o código vai como texto.
export function pairWaitingRoomDisplay(code: string): Promise<{ display_token: string }> {
  return displayFetch(waitingRoomPath("pair"), {
    method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ code })
  });
}
// A URL é exatamente /waiting_room/board: o api recusa qualquer chave na query (sem cache-buster).
// 401 display_revoked ou invalid_token → parear de novo.
export function fetchWaitingRoomBoard(token: string): Promise<WaitingRoomBoard> {
  return displayFetch(waitingRoomPath("board"), { headers: { Accept: "application/json", "X-Display-Token": token } });
}

// ─── Urgência — observação, prescrição e checagem (módulo 32b; ADR 0050; contrato 2026-11-10 §2–§9) ───
// Formas REAIS do api (api-shapes.md da Task 0, que vale sobre o plano D1–D19). Na URL só ids, unidade, local, estado
// e cursor: nome, CPF, CNS, medicamento, motivo e nota vão sempre no corpo. Listas desembrulham `{ items }`; o mapa
// e o aprazamento chegam sem embrulho. Os campos opcionais do corpo só entram quando existem: o api recusa chave
// desconhecida (422 invalid_request) e recusa `stock_*` com a baixa de estoque desligada.
export type ObservationAlert = "near_limit" | "over_limit" | null;
export type BedStayEndKind = "bed_change" | "observation_ended" | "outcome";
export type FrequencyKind = "once" | "interval" | "if_needed";
export type UrgencyPrescriptionStatus = "active" | "superseded" | "suspended" | "ended";
export type AdministrationStatus = "administered" | "not_administered" | "refused";
export type ShortfallCause = "no_location" | "insufficient_balance" | "lot_unavailable";
export type ShortfallState = "open" | "reconciled";
// Domínio fechado do api (catalog.rb DOSE_UNITS).
export const URGENCY_DOSE_UNITS = [
  "mg", "mcg", "g", "mL", "UI", "mEq", "gota", "comprimido", "capsula", "ampola", "frasco", "jato", "aplicacao", "sache"
] as const;
export type UrgencyDoseUnit = typeof URGENCY_DOSE_UNITS[number];

// Leitos (só municipal_admin; escrita com step-up). `occupied` vem do api.
export interface UrgencyBed { id: string; health_unit_id: string; label: string; active: boolean; occupied: boolean }
export interface UrgencyBedInput { health_unit_id: string; label: string; active?: boolean }
export interface UrgencyBedPatch { label?: string; active?: boolean }

// Mapa da observação (sem trilha; polling). `hours` é inteiro, desde a PRIMEIRA entrada do encontro.
export interface ObservationStayRef {
  stay_id: string; encounter_id: string; ticket: string | null; patient: UrgencyPatientRef; started_at: string;
  hours: number; alert: ObservationAlert;
}
export interface ObservationBed { bed_id: string; label: string; active: boolean; stay: ObservationStayRef | null }
// Sem `attendance_id` (o api não manda).
export interface ObservationWaiting { encounter_id: string; ticket: string | null; patient: UrgencyPatientRef; called_at: string | null }
export interface UrgencyObservationMap { beds: ObservationBed[]; waiting_bed: ObservationWaiting[] }
export interface UrgencyInCareObservation { bed_label: string; hours: number; alert: ObservationAlert }

// Detalhe do encontro: a estadia é plana e o bloco traz `current`.
export interface UrgencyStay {
  stay_id: string; bed_id: string; bed_label: string; started_at: string; ended_at: string | null;
  end_kind: BedStayEndKind | null; started_by: { name: string | null }; ended_by: { name: string | null } | null;
}
export interface UrgencyObservationBlock { current: UrgencyStay | null; stays: UrgencyStay[]; hours: number; alert: ObservationAlert }

// <item> da farmácia (Pharmacy::Json): `name` é o rótulo do catálogo; `catmat_code` é número.
export interface UrgencyCatalogItem {
  catalog_item_id: string; catmat_code: number; name: string; unit: string; dispensing_unit: string;
  controlled: boolean; controlled_list: string | null;
}
// Saída: as 3 chaves sempre presentes. Entrada: `interval_hours` só e sempre em interval, `max_per_day` só e sempre em if_needed.
export interface UrgencyFrequency { kind: FrequencyKind; interval_hours: number | null; max_per_day: number | null }
export interface UrgencyFrequencyInput { kind: FrequencyKind; interval_hours?: number; max_per_day?: number }
export interface UrgencyPrescriptionItem {
  id: string; position: number; catalog_item: UrgencyCatalogItem | null; controlled: boolean; controlled_list: string | null;
  dose: string; dose_unit: UrgencyDoseUnit; route: MedicationRoute; frequency: UrgencyFrequency; first_dose_at: string;
  instructions: string | null; stock_quantity_per_dose: string; stock_unit: string;
}
export interface UrgencyPrescription {
  id: string; encounter_id: string; version: number; status: UrgencyPrescriptionStatus; supersedes_id: string | null;
  prescribed_at: string; prescribed_by: { name: string | null; cbo_code: string }; status_changed_at: string | null;
  suspension_reason: string | null; items: UrgencyPrescriptionItem[];
}
// `dose` e `stock_quantity_per_dose` são TEXTO decimal (número JSON volta 422). Dose até 5 inteiros e 3 casas; estoque até 2 casas.
export interface UrgencyPrescriptionItemInput {
  catalog_item_id: string; dose: string; dose_unit: UrgencyDoseUnit; route: MedicationRoute; frequency: UrgencyFrequencyInput;
  first_dose_at?: string; instructions?: string; stock_quantity_per_dose?: string;
}
// POST /urgency/medication_search: o termo só no corpo (2 a 60 caracteres).
export interface UrgencyMedicationHit {
  catalog_item_id: string; catmat_code: number; name: string; strength: string | null; dosage_form: string | null;
  unit: string | null; controlled_list: string | null;
}

// Checagem. No detalhe, cada uma traz também o item e o medicamento.
export interface UrgencyAdministration {
  id: string; status: AdministrationStatus; scheduled_at: string | null; administered_at: string | null; reason: string | null;
  stock_lot: { id: string; lot_number: string; expires_on: string } | null; stock_quantity: string | null;
  recorded_at: string; by: { name: string | null; cbo_code: string };
}
export interface UrgencyDetailAdministration extends UrgencyAdministration {
  prescription_item_id: string; catalog_item: UrgencyCatalogItem | null; controlled: boolean;
}
export interface ScheduleSlot { scheduled_at: string; administration: UrgencyAdministration | null }
export interface ScheduleLot { id: string; lot_number: string; expires_on: string; balance: string }
// Item da prescrição + `item_id`; `recent` e `remaining` só em if_needed; `lots` só com a baixa utilizável.
export interface ScheduleItem extends UrgencyPrescriptionItem {
  item_id: string; slots: ScheduleSlot[]; recent: UrgencyAdministration[] | null; remaining: number | null;
  last_administration: UrgencyAdministration | null; lots?: ScheduleLot[];
}
// Sem versão ativa: `prescription_id: null`, `items: []` e sem `version`.
export interface UrgencyMedicationSchedule {
  prescription_id: string | null; version?: number; stock_deduction: boolean; items: ScheduleItem[];
}
export interface UrgencyAdministrationInput {
  prescription_item_id: string; scheduled_at?: string; status: AdministrationStatus; reason?: string; administered_at?: string;
  stock_lot_id?: string; stock_quantity?: string;
}
export interface UrgencyAdministrationResult { administration: UrgencyAdministration; shortfall: { cause: ShortfallCause } | null }

// Faltas da baixa (farmácia). `created_at`, `administered_at` e `reconciled_at` em UTC.
export interface UrgencyShortfall {
  shortfall_id: string; created_at: string; stock_location_id: string | null; catalog_item: UrgencyCatalogItem; quantity: string;
  cause: ShortfallCause; administration: { administered_at: string | null; ticket: string | null };
  reconciled_at: string | null; reconciled_by: { name: string | null } | null;
}
export interface UrgencyShortfallPage { items: UrgencyShortfall[]; next_before: string | null }

// ── Leitos e mapa ──
export async function listUrgencyBeds(unitId: string): Promise<UrgencyBed[]> {
  const b = await jsonFetch<{ items?: UrgencyBed[] }>(withQuery(urgencyPath("beds"), urgencyQuery({ health_unit_id: unitId })));
  return b.items ?? [];
}
export async function createUrgencyBed(i: UrgencyBedInput): Promise<UrgencyBed> {
  return (await jsonFetch<{ bed: UrgencyBed }>(urgencyPath("beds"), urgencyWrite("POST", i))).bed;
}
export async function updateUrgencyBed(id: string, p: UrgencyBedPatch): Promise<UrgencyBed> {
  return (await jsonFetch<{ bed: UrgencyBed }>(urgencyPath("beds", id), urgencyWrite("PATCH", p))).bed;
}
// Sem trilha no api; serve ao polling.
export function getUrgencyObservation(unitId: string): Promise<UrgencyObservationMap> {
  return jsonFetch<UrgencyObservationMap>(withQuery(urgencyPath("observation"), urgencyQuery({ health_unit_id: unitId })));
}

// ── Observação: entrada, troca e saída devolvem o detalhe do encontro, não a estadia ──
// `expectedStayId` (Q15) vai SEMPRE no corpo: null declara uma entrada (sem estadia aberta), um id declara a troca a partir dessa
// estadia; se o leito do paciente já mudou, o api recusa com 409 observation_changed e nada é gravado.
export async function startObservation(encounterId: string, bedId: string, expectedStayId: string | null): Promise<UrgencyEncounter> {
  return (await jsonFetch<{ encounter: UrgencyEncounter }>(
    urgencyPath("encounters", encounterId, "observation"),
    urgencyWrite("POST", { bed_id: bedId, expected_stay_id: expectedStayId }))).encounter;
}
export async function endObservation(encounterId: string): Promise<UrgencyEncounter> {
  return (await jsonFetch<{ encounter: UrgencyEncounter }>(
    urgencyPath("encounters", encounterId, "observation", "end"), urgencyWrite("POST"))).encounter;
}

// ── Prescrição interna ──
export async function searchUrgencyMedication(query: string): Promise<UrgencyMedicationHit[]> {
  const b = await jsonFetch<{ items?: UrgencyMedicationHit[] }>(urgencyPath("medication_search"), urgencyWrite("POST", { query }));
  return b.items ?? [];
}
// `expectedActiveId` (Q16) vai SEMPRE no corpo: null declara uma prescrição nova (sem versão ativa), um id declara a alteração
// dessa versão; se a ativa mudou, o api recusa com 409 prescription_changed e nada é gravado.
export async function issueUrgencyPrescription(encounterId: string, items: UrgencyPrescriptionItemInput[], expectedActiveId: string | null): Promise<UrgencyPrescription> {
  return (await jsonFetch<{ prescription: UrgencyPrescription }>(
    urgencyPath("encounters", encounterId, "prescriptions"), urgencyWrite("POST", { items, expected_active_id: expectedActiveId }))).prescription;
}
export async function suspendUrgencyPrescription(prescriptionId: string, reason: string): Promise<UrgencyPrescription> {
  return (await jsonFetch<{ prescription: UrgencyPrescription }>(
    urgencyPath("prescriptions", prescriptionId, "suspend"), urgencyWrite("POST", { reason }))).prescription;
}

// ── Aprazamento e checagem ──
// Grava trilha no api (recurso `medication_schedule`).
export function getMedicationSchedule(encounterId: string): Promise<UrgencyMedicationSchedule> {
  return jsonFetch<UrgencyMedicationSchedule>(urgencyPath("encounters", encounterId, "medication_schedule"));
}
export function recordAdministration(i: UrgencyAdministrationInput): Promise<UrgencyAdministrationResult> {
  const body: Record<string, unknown> = {};
  for (const [ key, value ] of Object.entries(i)) if (value !== undefined) body[key] = value;
  return jsonFetch<UrgencyAdministrationResult>(urgencyPath("administrations"), urgencyWrite("POST", body));
}

// ─── Ouvidoria (módulo 33; ADR 0051; contrato 2026-11-11 §5–§7, §11) ───
// Na URL só ids, os filtros da Caixa (`state[]`, `color[]`, `kind[]`, `channel[]`, `subject_id`, `health_unit_id`, `q` =
// protocolo), o cursor, `from`/`to` do painel e o ano do relatório; CPF, nome, contato, texto, extrato, resposta, motivo e
// justificativa vão no corpo (busca de pessoa por POST, Q6). Formas do api real (api-shapes.md), não as do plano: listas em
// `{ items }` (Caixa e ponto de resposta paginados em 50 com `next_before`, sem `limit`, Q23); detalhe com `can` e sem
// `cycle_started_on`; `options` com `health_units`, assuntos em árvore e `professionals` (D8 recusada); anexo do detalhe só
// `{ id, uploaded_by }`, e o upload manda `anexo-N.<ext>`, nunca o nome real (Q2); cancelamento e ações do respondente com o
// `expected_state` do encaminhamento (Q33); painel com partições em objeto e `total` (Q53–Q55). O api recusa chave desconhecida
// e texto opcional vazio: campo opcional vazio não vai. Toda escrita leva corpo (`{}` sem campo; sem ele, 415).

const OMBUDSMAN_BASE = import.meta.env.VITE_OMBUDSMAN_BASE || "/ombudsman";
const DEPARTMENTS_BASE = import.meta.env.VITE_DEPARTMENTS_BASE || "/departments";
const ombPath = (...parts: string[]) => [ OMBUDSMAN_BASE, ...parts.map(encodeURIComponent) ].join("/");
const depPath = (...parts: string[]) => [ DEPARTMENTS_BASE, ...parts.map(encodeURIComponent) ].join("/");
const ombWrite = (method: "POST" | "PATCH", body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });
// Query das listas, na ordem dada: lista vira `chave[]` repetida (vazia não vai, Q51); escalar só preenchido.
function ombListQuery(params: Record<string, readonly string[] | string | null | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [ key, value ] of Object.entries(params)) {
    if (Array.isArray(value)) for (const v of value) p.append(`${key}[]`, v);
    else if (typeof value === "string" && value.trim() !== "") p.set(key, value.trim());
  }
  return p;
}
// Tira as chaves opcionais vazias (undefined, null, "", só espaços ou lista vazia); o texto que vai, vai aparado.
function ombCompact<T extends object>(body: T, keys: (keyof T)[]): T {
  const out = { ...body };
  for (const key of keys) {
    const v = out[key] as unknown;
    if (typeof v === "string") {
      const trimmed = v.trim();
      if (trimmed === "") delete out[key];
      else (out as Record<keyof T, unknown>)[key] = trimmed;
    } else if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) delete out[key];
  }
  return out;
}
async function ombItems<T>(url: string): Promise<T[]> {
  return (await jsonFetch<{ items?: T[] }>(url)).items ?? [];
}
async function ombPage<T>(url: string): Promise<{ items: T[]; next_before: string | null }> {
  const b = await jsonFetch<{ items?: T[]; next_before?: string | null }>(url);
  return { items: b.items ?? [], next_before: b.next_before ?? null };
}

export type OmbudsmanKind = "complaint" | "report" | "praise" | "suggestion" | "request";
export type IdentificationMode = "identified" | "preserved" | "anonymous";
export type OmbudsmanChannel = "web" | "in_person" | "phone" | "ouvidorsus";
// A equipe registra só pelos três últimos (o `web` é do cidadão).
export type OmbudsmanStaffChannel = Exclude<OmbudsmanChannel, "web">;
export type ManifestationState = "received" | "in_analysis" | "forwarded" | "awaiting_complement" | "answered" | "archived";
// `null` nos estados finais.
export type DeadlineColor = "green" | "yellow" | "red" | "paused";
export type ArchiveReason =
  | "duplicate" | "no_complement" | "lack_of_clarity" | "lack_of_civility" | "improper" | "loss_of_object" | "forwarded_elsewhere";
// Só em `complaint`, `request` e `report`.
export type Resolution = "resolved" | "not_resolved";
export type ForwardingState = "pending" | "replied" | "declined" | "cancelled";
// O detalhe só traz o pedido pendente.
export type ReopenRequestState = "pending";
export type OmbudsmanActionName =
  | "classify" | "forward" | "request_complement" | "complement" | "extend" | "interim_response" | "final_response"
  | "archive" | "reopen" | "change_resolution";

export interface OmbudsmanRef { id: string; name: string }
export interface OmbudsmanSubjectRef { id: string; name: string; parent: OmbudsmanRef | null }
export interface OmbudsmanDestination { kind: "department" | "health_unit"; id: string; name: string }

export interface OmbudsmanListItem {
  id: string;
  protocol: string;
  kind: OmbudsmanKind;
  identification_mode: IdentificationMode;
  channel: OmbudsmanChannel;
  state: ManifestationState;
  subject: OmbudsmanSubjectRef | null;
  // Unidade REFERIDA na manifestação.
  health_unit: OmbudsmanRef | null;
  urgent: boolean;
  received_at: string;
  // Sempre presente, também nos estados finais.
  due_on: string;
  color: DeadlineColor | null;
  pending_forwardings: number;
}
export interface OmbudsmanPage { items: OmbudsmanListItem[]; next_before: string | null }
export interface OmbudsmanListQuery {
  state?: string[];
  color?: string[];
  kind?: string[];
  channel?: string[];
  subject_id?: string | null;
  health_unit_id?: string | null;
  // Só o protocolo (`AAAA-NNNNNN`) ou o prefixo `AAAA-` (Q51): a tela confere antes.
  q?: string;
  before?: string | null;
}

// `identified`: o que o api manda; `contact` só existe sem cidadão ligado (Q24, Q57).
export interface OmbudsmanIdentitySummary {
  name: string | null;
  cpf_masked: string | null;
  phone_masked: string | null;
  contact?: string | null;
}
export interface OmbudsmanEvent {
  id: string;
  kind: string;
  actor: "staff" | "citizen" | "system";
  // Só da equipe.
  actor_name: string | null;
  at: string;
  // A chave só existe quando há texto.
  text?: string;
  data: Record<string, unknown>;
  visible_to_citizen: boolean;
}
export interface OmbudsmanForwarding {
  id: string;
  destination: OmbudsmanDestination;
  extract: string;
  state: ForwardingState;
  due_on: string;
  // `null` fora de `pending`.
  color: DeadlineColor | null;
  extended: boolean;
  created_at: string;
  // As quatro só existem quando preenchidas; `reply` também traz o motivo do `declined` (Q9).
  extension_reason?: string;
  reply?: string;
  replied_at?: string;
  replied_by_name?: string;
}
// Só isso (Q2): sem nome, tipo nem data. A tela mostra "Anexo N".
export interface OmbudsmanAttachment { id: string; uploaded_by: "citizen" | "staff" }
export interface OmbudsmanReopenRequest {
  id: string;
  cycle: number;
  state: ReopenRequestState;
  reason: string;
  created_at: string;
  decision_text?: string;
  decided_at?: string;
}
// O que quem lê pode fazer agora (json.rb:59-81).
export interface OmbudsmanCan {
  classify: boolean;
  forward: boolean;
  cancel_forwarding: boolean;
  request_complement: boolean;
  complement: boolean;
  extend: boolean;
  interim_response: boolean;
  final_response: boolean;
  archive: boolean;
  reopen: boolean;
  change_resolution: boolean;
  decide_reopen: boolean;
  open_identity: boolean;
  record_identity_consent: boolean;
}
export interface OmbudsmanManifestation extends OmbudsmanListItem {
  body: string;
  ouvidorsus_number: string | null;
  referred_professional: OmbudsmanRef | null;
  cycle: number;
  extended: boolean;
  extension_reason: string | null;
  complement_used: boolean;
  complement_requested_at: string | null;
  complement_due_on: string | null;
  resolution: Resolution | null;
  archive_reason: ArchiveReason | null;
  duplicate_of: { id: string; protocol: string } | null;
  external_body_name: string | null;
  concluded_at: string | null;
  // `preserved` e `anonymous` chegam como a string "preserved"; a tela lê campo a campo.
  identity: OmbudsmanIdentitySummary | "preserved";
  identity_available: boolean;
  events: OmbudsmanEvent[];
  forwardings: OmbudsmanForwarding[];
  attachments: OmbudsmanAttachment[];
  reopen_request: OmbudsmanReopenRequest | null;
  can: OmbudsmanCan;
}
// `POST …/identity` (só ouvidor, com justificativa): fica no estado do diálogo, nunca em cache. `full_name` = nome civil,
// nulo no par declarado (Q50).
export interface OmbudsmanFullIdentity {
  name: string | null;
  full_name: string | null;
  cpf: string | null;
  phone: string | null;
  manifestant_name: string | null;
  manifestant_contact: string | null;
  manifestant_cpf: string | null;
}
// `GET /ombudsman/options` (Q7): só ativos; profissionais com as unidades do vínculo (a tela filtra pela unidade, D8).
export interface OmbudsmanOptions {
  subjects: { id: string; name: string; children: OmbudsmanRef[] }[];
  departments: (OmbudsmanRef & { has_active_responder: boolean })[];
  health_units: (OmbudsmanRef & { kind: string; has_active_responder: boolean })[];
  professionals: (OmbudsmanRef & { health_unit_ids: string[] })[];
}
// `GET /ombudsman/subjects` (configuração): árvore de dois níveis, com os inativos; `children` só no primeiro nível.
export interface OmbudsmanSubject {
  id: string;
  name: string;
  active: boolean;
  children?: { id: string; name: string; active: boolean }[];
}
// Só par verificado (Q58); sem ele, `null`.
export interface OmbudsmanPerson { citizen_id: string; name: string; cpf_masked: string }
// Registro pela equipe (contrato §5; api-shapes §3.1): ou `citizen_id`, ou `manifestant_*`; nada disso na anônima.
// Campo opcional vazio não vai.
export interface NewManifestationInput {
  kind: OmbudsmanKind;
  identification_mode: IdentificationMode;
  channel: OmbudsmanStaffChannel;
  // Só no canal `ouvidorsus`.
  ouvidorsus_number?: string | null;
  citizen_id?: string | null;
  manifestant_name?: string | null;
  manifestant_contact?: string | null;
  manifestant_cpf?: string | null;
  body: string;
  health_unit_id?: string | null;
  attachment_ids?: string[];
}
export interface OmbudsmanCreated { id: string; protocol: string; due_on: string }
export interface OmbudsmanReceipt { protocol: string; kind: OmbudsmanKind; received_at: string; due_on: string; channel: OmbudsmanChannel }
// Nunca protocolo, identidade, texto original, assunto ou anexos.
export interface OmbudsmanInboxItem {
  id: string;
  destination: OmbudsmanDestination;
  extract: string;
  due_on: string;
  color: DeadlineColor | null;
  state: ForwardingState;
  created_at: string;
  extended: boolean;
  reply?: string;
}
export interface OmbudsmanInboxPage { items: OmbudsmanInboxItem[]; next_before: string | null }
export interface Department { id: string; name: string; active: boolean }
export interface OmbudsmanResponder {
  id: string;
  user: { id: string; email: string; name: string };
  destination: OmbudsmanDestination;
  active: boolean;
}
export interface ResponderCandidate { id: string; name: string; email: string }
export interface OmbudsmanSettings {
  response_days: number;
  extension_days: number;
  urgent_days: number;
  complement_days: number;
  forwarding_days: number;
  forwarding_extension_days: number;
  warning_days: number;
  anonymous_daily_cap: number;
}
// Painel (api-shapes §2.7). Célula = número ou `{ suppressed: true }`; zero também pode vir escondido (Q54); `total` sempre
// à mostra; taxa e média `null` = sem denominador; a satisfação pode vir toda escondida (Q55).
export type OmbudsmanSubjectCount =
  | { id: string; name: string; unclassified?: false; count: SmallCount }
  // Sempre o último (Q49).
  | { id: null; name: null; unclassified: true; count: SmallCount };
export interface OmbudsmanDashboard {
  period: { from: string; to: string };
  total: number;
  by_kind: Record<OmbudsmanKind, SmallCount> & { total: number };
  by_channel: Record<OmbudsmanChannel, SmallCount> & { total: number };
  by_state: Record<ManifestationState, SmallCount> & { total: number };
  by_subject: OmbudsmanSubjectCount[];
  by_health_unit: { id: string; name: string; count: SmallCount }[];
  on_time_rate: SmallCount | null;
  avg_days_to_conclude: SmallCount | null;
  resolution_rate: SmallCount | null;
  satisfaction: {
    responses: SmallCount;
    met: { yes: SmallCount; partly: SmallCount; no: SmallCount };
    clear: { yes: SmallCount; no: SmallCount };
    avg_score: SmallCount | null;
  };
}
// Por profissional (só ouvidor): sem supressão, por nome.
export interface ProfessionalPanelRow { professional: OmbudsmanRef; by_kind: Record<OmbudsmanKind, number>; total: number }
// Sem `published_by` (Q35); textos nulos quando não gravados; rascunho = painel vivo do ano, publicado = snapshot.
export interface OmbudsmanAnnualReport {
  year: number;
  state: "draft" | "published";
  recurring_problems: string | null;
  actions_taken: string | null;
  notes: string | null;
  numbers: OmbudsmanDashboard;
  published_at: string | null;
}

// ── Caixa, detalhe, registro e ações ──
export function listOmbudsmanManifestations(q: OmbudsmanListQuery): Promise<OmbudsmanPage> {
  return ombPage<OmbudsmanListItem>(withQuery(ombPath("manifestations"), ombListQuery({
    state: q.state, color: q.color, kind: q.kind, channel: q.channel,
    subject_id: q.subject_id, health_unit_id: q.health_unit_id, q: q.q, before: q.before
  })));
}
export function getOmbudsmanManifestation(id: string): Promise<OmbudsmanManifestation> {
  return jsonFetch<OmbudsmanManifestation>(ombPath("manifestations", id));
}
export function createOmbudsmanManifestation(i: NewManifestationInput): Promise<OmbudsmanCreated> {
  return jsonFetch<OmbudsmanCreated>(ombPath("manifestations"), ombWrite("POST", ombCompact(i, [
    "ouvidorsus_number", "citizen_id", "manifestant_name", "manifestant_contact", "manifestant_cpf", "health_unit_id", "attachment_ids"
  ])));
}
export function getOmbudsmanReceipt(id: string): Promise<OmbudsmanReceipt> {
  return jsonFetch<OmbudsmanReceipt>(ombPath("manifestations", id, "receipt"));
}
// D9: o corpo é o da ação (api-shapes §3.2), sempre com o `expected_state` lido; responde com o detalhe.
export function runOmbudsmanAction(
  id: string, action: OmbudsmanActionName, body: Record<string, unknown> & { expected_state: ManifestationState }
): Promise<OmbudsmanManifestation> {
  return jsonFetch<OmbudsmanManifestation>(ombPath("manifestations", id, action), ombWrite("POST", body));
}
// Q33: `expected_state` do ENCAMINHAMENTO (o que a tela leu, em geral "pending").
export function cancelOmbudsmanForwarding(id: string, expectedState: ForwardingState): Promise<OmbudsmanManifestation> {
  return jsonFetch<OmbudsmanManifestation>(ombPath("forwardings", id, "cancel"), ombWrite("POST", { expected_state: expectedState }));
}
export function decideReopenRequest(id: string, i: { decision: "accept" | "reject"; text: string }): Promise<OmbudsmanManifestation> {
  return jsonFetch<OmbudsmanManifestation>(ombPath("reopen_requests", id, "decide"), ombWrite("POST", i));
}

// ── Identidade e anexos ──
export function revealOmbudsmanIdentity(id: string, justification: string): Promise<OmbudsmanFullIdentity> {
  return jsonFetch<OmbudsmanFullIdentity>(ombPath("manifestations", id, "identity"), ombWrite("POST", { justification }));
}
export function recordIdentityConsent(id: string, i: { granted: boolean; text: string }): Promise<OmbudsmanManifestation> {
  return jsonFetch<OmbudsmanManifestation>(ombPath("manifestations", id, "identity_consent"), ombWrite("POST", i));
}
const OMB_FILE_EXT: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png" };
// Q2: o api exige `filename`, mas o nome real pode trazer o nome da pessoa: vai `anexo-<n>.<ext>` (n = posição na tela).
export async function uploadOmbudsmanAttachment(file: File, n: number): Promise<{ id: string }> {
  const data = await readBase64(file);
  const filename = `anexo-${n}.${OMB_FILE_EXT[file.type] ?? "bin"}`;
  return jsonFetch<{ id: string }>(ombPath("attachments"), ombWrite("POST", { filename, content_type: file.type, data }));
}
// Endereço curto (5 min, preso ao usuário). Justificativa só fora do `identified` (lá o api a ignora).
export async function getOmbudsmanAttachmentUrl(id: string, justification?: string): Promise<string> {
  const body = justification === undefined ? {} : { justification };
  return (await jsonFetch<{ url: string; expires_at: string }>(ombPath("attachments", id, "link"), ombWrite("POST", body))).url;
}
// O arquivo do endereço curto (GET /ombudsman/files/<token>); 410 `link_expired` depois de 5 min. O nome do
// Content-Disposition não é usado pela tela. Com VITE_OMBUDSMAN_BASE, vai pela mesma base das outras chamadas.
export function fetchOmbudsmanFile(url: string): Promise<SignatureFile> {
  return binaryFetch(url.replace(/^\/ombudsman(?=\/)/, OMBUDSMAN_BASE), "application/pdf,image/jpeg,image/png");
}

// ── Busca de pessoa e opções ──
export async function lookupOmbudsmanPerson(cpf: string): Promise<OmbudsmanPerson | null> {
  return (await jsonFetch<OmbudsmanPerson | null>(ombPath("person_lookup"), ombWrite("POST", { cpf }))) ?? null;
}
export function getOmbudsmanOptions(): Promise<OmbudsmanOptions> {
  return jsonFetch<OmbudsmanOptions>(ombPath("options"));
}

// ── Ponto de resposta (Q33, Q48: responde com o item do inbox) ──
export function listOmbudsmanInbox(q: { before?: string | null } = {}): Promise<OmbudsmanInboxPage> {
  return ombPage<OmbudsmanInboxItem>(withQuery(ombPath("inbox"), ombListQuery({ before: q.before })));
}
export function replyOmbudsmanInbox(id: string, expectedState: ForwardingState, body: string): Promise<OmbudsmanInboxItem> {
  return jsonFetch<OmbudsmanInboxItem>(ombPath("inbox", id, "reply"), ombWrite("POST", { expected_state: expectedState, body }));
}
export function declineOmbudsmanInbox(id: string, expectedState: ForwardingState, reason: string): Promise<OmbudsmanInboxItem> {
  return jsonFetch<OmbudsmanInboxItem>(ombPath("inbox", id, "decline"), ombWrite("POST", { expected_state: expectedState, reason }));
}
export function extendOmbudsmanInbox(id: string, expectedState: ForwardingState, reason: string): Promise<OmbudsmanInboxItem> {
  return jsonFetch<OmbudsmanInboxItem>(ombPath("inbox", id, "extend"), ombWrite("POST", { expected_state: expectedState, reason }));
}

// ── Configuração: setores (sem o portão da ouvidoria, Q12), respondentes, assuntos e prazos ──
export function listDepartments(): Promise<Department[]> {
  return ombItems<Department>(depPath());
}
export function createDepartment(name: string): Promise<Department> {
  return jsonFetch<Department>(depPath(), ombWrite("POST", { name }));
}
// Só a chave que muda (o api aceita cada uma sozinha): mandar a outra lida antes desfaria a mudança de outra pessoa.
export function updateDepartment(id: string, i: { name: string } | { active: boolean }): Promise<Department> {
  return jsonFetch<Department>(depPath(id), ombWrite("PATCH", i));
}
export function listOmbudsmanResponders(): Promise<OmbudsmanResponder[]> {
  return ombItems<OmbudsmanResponder>(ombPath("responders"));
}
export function listResponderCandidates(): Promise<ResponderCandidate[]> {
  return ombItems<ResponderCandidate>(ombPath("responder_candidates"));
}
export function createOmbudsmanResponder(
  i: { user_id: string } & ({ department_id: string } | { health_unit_id: string })
): Promise<OmbudsmanResponder> {
  return jsonFetch<OmbudsmanResponder>(ombPath("responders"), ombWrite("POST", i));
}
export function updateOmbudsmanResponder(id: string, i: { active: boolean }): Promise<OmbudsmanResponder> {
  return jsonFetch<OmbudsmanResponder>(ombPath("responders", id), ombWrite("PATCH", i));
}
export function listOmbudsmanSubjects(): Promise<OmbudsmanSubject[]> {
  return ombItems<OmbudsmanSubject>(ombPath("subjects"));
}
// Sem pai = assunto de primeiro nível (`parent_id` não vai).
export function createOmbudsmanSubject(i: { name: string; parent_id: string | null }): Promise<OmbudsmanSubject> {
  return jsonFetch<OmbudsmanSubject>(ombPath("subjects"), ombWrite("POST", ombCompact(i, [ "parent_id" ])));
}
// O pai não muda.
export function updateOmbudsmanSubject(id: string, i: { name: string } | { active: boolean }): Promise<OmbudsmanSubject> {
  return jsonFetch<OmbudsmanSubject>(ombPath("subjects", id), ombWrite("PATCH", i));
}
export function getOmbudsmanSettings(): Promise<OmbudsmanSettings> {
  return jsonFetch<OmbudsmanSettings>(ombPath("settings"));
}
export function updateOmbudsmanSettings(s: OmbudsmanSettings): Promise<OmbudsmanSettings> {
  return jsonFetch<OmbudsmanSettings>(ombPath("settings"), ombWrite("PATCH", s));
}

// ── Painel e relatório anual ──
export function getOmbudsmanDashboard(q: { from: string; to: string }): Promise<OmbudsmanDashboard> {
  return jsonFetch<OmbudsmanDashboard>(withQuery(ombPath("dashboard"), ombListQuery({ from: q.from, to: q.to })));
}
export function getOmbudsmanProfessionalsPanel(q: { from: string; to: string }): Promise<ProfessionalPanelRow[]> {
  return ombItems<ProfessionalPanelRow>(withQuery(ombPath("dashboard", "professionals"), ombListQuery({ from: q.from, to: q.to })));
}
export function getAnnualReport(year: number): Promise<OmbudsmanAnnualReport> {
  return jsonFetch<OmbudsmanAnnualReport>(ombPath("annual_reports", String(year)));
}
export function updateAnnualReport(
  year: number, i: { recurring_problems: string; actions_taken: string; notes: string }
): Promise<OmbudsmanAnnualReport> {
  return jsonFetch<OmbudsmanAnnualReport>(ombPath("annual_reports", String(year)), ombWrite("PATCH", i));
}
// Só ano encerrado (Q27: `year_not_closed`); já publicado → 409 `already_published`.
export function publishAnnualReport(year: number): Promise<OmbudsmanAnnualReport> {
  return jsonFetch<OmbudsmanAnnualReport>(ombPath("annual_reports", String(year), "publish"), ombWrite("POST"));
}

// ─── Visita domiciliar e atividade coletiva (módulo 24b; ADR 0052; contrato 2026-11-12 §5–§9.1) ───
// Na URL só ids, datas, filtros codificados (`state[]`, `outcome[]`, `activity_type[]`, `reason[]`), cursor e limite;
// pessoa, motivos, medidas, observação, temas, motivos de retirada e engano e o token vão só no corpo (busca de pessoa
// por POST). Listas em `{ items, next_before }`, com o cursor opaco repassado como veio. Toda escrita leva corpo
// (`{}` sem campo; sem ele, 415). Formas do api real (preflight-reconciliation §2), não as do plano: onde os dois
// divergem, vale o api. Domicílios e moradores da visita vêm das rotas de leitura do 24a (Q11): nenhuma rota nova.

const HOME_VISITS_BASE = import.meta.env.VITE_HOME_VISITS_BASE || "/home_visits";
const COLLECTIVE_BASE = import.meta.env.VITE_COLLECTIVE_BASE || "/collective_activities";
const FIELD_DEVICES_BASE = import.meta.env.VITE_FIELD_DEVICES_BASE || "/field_devices";
const hvPath = (base: string, ...parts: string[]) => [ base, ...parts.map(encodeURIComponent) ].join("/");
const hvWrite = (method: "POST", body: unknown = {}): RequestInit => ({ method, body: JSON.stringify(body) });

export type VisitOutcome = 1 | 2 | 3;
export type VisitShift = 1 | 2 | 3;
export type VisitSubject = "resident" | "family_responsible" | "none";
export type VisitOrigin = "dashboard" | "field_app";
export type DayState = "open" | "closed";
// Situação da ficha (contrato §6; `not_exported` = Q5): código desconhecido aparece cru, nunca some.
export type FichaSituation =
  | "open" | "empty" | "not_exported" | "not_generated" | "pending" | "sending" | "accepted" | "rejected" | "failed" | "correction_pending"
  | (string & {});
export type MicroAreaScope = "responsible" | "assigned" | "team";
export type MeasurementKey = "weight_kg" | "height_cm" | "systolic" | "diastolic" | "temperature_c" | "glucose_mg_dl";
export type CollectiveField = "meeting_topics" | "target_audience" | "health_topics" | "health_practices" | "participants";
export type FieldRule = "required" | "forbidden" | "optional";

// ── Domínios (D-1, D-2; Q13, Q34–Q40) ──
export interface CodeLabel { code: number; label: string }
export interface MeasurementRange { min: number; max: number; decimals: number }
export interface HomeVisitDomains {
  motivo_visita: (CodeLabel & { group: string; group_label: string })[];
  desfecho: CodeLabel[]; turno: CodeLabel[]; tipo_glicemia: CodeLabel[];
  // Tipo de imóvel em TEXTO, como o 24a grava (home_visits/json.rb:165-166).
  tipo_de_imovel: { code: string; label: string }[];
  non_residential_property_types: string[];
  non_residential_reasons: number[];
  male_forbidden_reasons: number[];
  // Q34/Q40: sem pessoa só estes motivos; 29 e 34–37 levam o documento do responsável familiar.
  without_person_allowed_reasons: number[];
  responsible_document_reasons: number[];
  reasons_max: number;
  measurement_ranges: Record<MeasurementKey, MeasurementRange>;
}
export interface CollectiveDomains {
  activity_types: CodeLabel[]; meeting_topics: CodeLabel[]; target_audience: CodeLabel[]; health_topics: CodeLabel[]; health_practices: CodeLabel[];
  // Q37: procedimento SIGTAP só desta lista fechada, com o código em TEXTO.
  procedures: { code: string; label: string }[];
  rules: {
    // Q36: tamanho máximo de cada lista.
    list_max: Record<"meeting_topics" | "target_audience" | "health_topics" | "health_practices", number>;
    by_type: Record<string, Record<CollectiveField, FieldRule>>;
    health_topics_with_meeting_topic: number[];
    practices_only_in_type: { type: number; practices: number[] }[];
    procedure_practices: number[]; smoking_practices: number[];
    participant_measurements: Record<"weight_kg" | "height_cm", MeasurementRange>;
  };
}

// ── Contexto (§6; D-4, D-5) ──
export interface VisitMicroArea { id: string; code: string; name: string; scope: MicroAreaScope }
export interface HomeVisitTeam {
  id: string; ine: string; name: string | null; cbo: string;
  can_register: boolean; reads_whole_team: boolean; out_of_area_allowed: boolean; can_assign: boolean; can_register_device: boolean;
  micro_areas: VisitMicroArea[];
  professionals: { id: string; name: string; cbo: string }[];
}
export interface HomeVisitContext { today: string; min_date: string; teams: HomeVisitTeam[]; domains: HomeVisitDomains }

// ── Visita e folha do dia (§6; D-4, D-12) ──
export interface VisitMeasurements {
  weight_kg?: number; height_cm?: number; systolic?: number; diastolic?: number; temperature_c?: number; glucose_mg_dl?: number; glucose_type?: number;
}
export interface VisitPatientRef { id: string; display_name: string | null; has_cpf: boolean; cns_masked: string | null }
export interface HomeVisit {
  id: string; client_uuid: string; day_id: string; occurred_at: string; shift: VisitShift; origin: VisitOrigin | string;
  property_type: string; micro_area: { id: string; code: string } | null; out_of_area: boolean;
  household: { id: string; address_short: string } | null; family_id: string | null;
  subject: VisitSubject | string; patient: VisitPatientRef | null;
  outcome: VisitOutcome; reasons: number[]; shared: boolean; measurements: VisitMeasurements | null;
  state: "recorded" | "withdrawn" | string;
  // `reason` e `name` podem vir nulos (só o dono e a equipe leem o motivo; profissional sem perfil).
  withdrawn: { at: string; reason: string | null; by: { name: string | null } } | null;
  recorded_by: { name: string | null };
  // Só no GET /home_visits/:id.
  note?: string | null;
  can_withdraw: boolean;
}
export interface HomeVisitDay {
  id: string; professional: { id: string; name: string }; team: { id: string; ine: string; name: string | null };
  day: string; sequence: number; state: DayState | string; closed_at: string | null;
  // Q6: `full` = folha cheia (99 visitas).
  closed_by: "user" | "job" | "full" | (string & {}) | null;
  visits_count: number; withdrawn_count: number; ficha: { status: FichaSituation; reasons: string[] };
  blockers: { code: string; visit_id: string | null }[];
  own: boolean;
  // Q50: false = a exportação LEDI da cidade está desligada (a ficha sai `not_exported`).
  ledi_export_enabled: boolean;
  // Só no GET /home_visits/days/:id e nas listas que o trazem; o `day` do POST /home_visits NÃO traz.
  visits?: HomeVisit[];
}

// ── Pessoa (§5; D-6, D-7) ──
export interface QuickPatient {
  full_name: string; birth_date: string; sex: PatientSex; mother_name?: string | null; cpf?: string | null; no_cpf_reason?: string | null; cns?: string | null;
}
export interface VisitPerson {
  patient_id: string; display_name: string | null; birth_date: string | null; has_cpf: boolean; cns_masked: string | null; sex: PatientSex | null;
}
export interface VisitCandidate {
  patient_id: string; display_name: string | null; birth_date: string | null; has_cpf: boolean; has_cns: boolean; sex: PatientSex | null;
}
export type PersonScope = "home_visits" | "collective_activities";
export type PersonDoc = { cpf: string } | { cns: string };

// ── Domicílio para a visita (Q11): forma de tela, montada por adaptador a partir de `Household` e `Registration` do 24a ──
export interface VisitHousehold {
  id: string; address_short: string; property_type: string; status: "active" | "inactive"; micro_area: { id: string; code: string };
  // `sex` do responsável vem dos cadastros ativos (só no detalhe; na lista é null): a regra de 5 e 6 olha o sexo dele (Q35).
  families: { id: string; responsible: { patient_id: string; display_name: string | null; sex: PatientSex | null }; moved_out: boolean; responsible_exited: boolean }[];
  // Alguma família ainda mora aqui (Q44, Q51).
  has_active_family: boolean;
}
export interface VisitHouseholdDetail extends VisitHousehold {
  // `unidentified`: cadastro provisório da urgência, que o api recusa (Q41, `patient_unidentified`).
  residents: { patient_id: string; display_name: string | null; sex: PatientSex | null; family_id: string | null; unidentified: boolean }[];
}
export interface VisitHouseholdPage { items: VisitHousehold[]; next_before: string | null }

// ── Entrada e listas ──
export interface HomeVisitInput {
  client_uuid: string; team_id: string; occurred_at: string; household_id?: string; micro_area_id?: string; out_of_area?: boolean;
  property_type?: string; subject: VisitSubject; patient_id?: string; new_patient?: QuickPatient; family_id?: string; duplicates_reviewed?: boolean;
  outcome: VisitOutcome; reasons: number[]; shared: boolean; measurements?: VisitMeasurements; note?: string;
}
// `limit` (1–100) é opcional em todas as listas (field_list_query.rb:13-22).
export interface HomeVisitDayQuery { team_id: string; professional_id?: string; from?: string; to?: string; state?: string[]; before?: string | null; limit?: number }
export interface HomeVisitDayPage { items: HomeVisitDay[]; next_before: string | null }
export interface HomeVisitQuery {
  team_id: string; micro_area_id?: string; professional_id?: string; from?: string; to?: string; outcome?: number[]; before?: string | null; limit?: number;
}
export interface HomeVisitPage { items: HomeVisit[]; next_before: string | null }
// A contagem só aceita estas chaves: `professional_id` e `outcome[]` dão 422 invalid_request (visits_controller.rb:21,86).
export interface HomeVisitCounts { done: number; refused: number; absent: number; withdrawn: number }

// ── Atribuição de microárea (§6) ──
export interface FieldAssignment {
  id: string; micro_area: { id: string; code: string; name: string };
  // `cbo` nulo se o vínculo do profissional acabou; `ended_at` só depois do /end (home_visits/json.rb:15-20).
  professional: { id: string; name: string; cbo: string | null };
  assigned_at: string; assigned_by: { name: string | null }; ended_at?: string;
}
export interface FieldAssignmentList { items: FieldAssignment[]; candidates: { professional_id: string; name: string; cbo: string }[] }

// ── Quem visitar (§8) ──
export type WhoToVisitReason =
  // Q60: `due_on` nulo = a prática nunca foi feita ("nunca feita").
  | { code: "care_line"; care_line: string; practice: string; status: "overdue" | "due_soon"; due_on: string | null }
  | { code: "registration_due"; status: "due_soon" | "expired"; due_on: string }
  | { code: "never_visited" }
  | { code: string };
export interface WhoToVisitItem {
  patient_id: string; display_name: string | null; age: number | null; household: { id: string; address_short: string } | null; family_id: string | null;
  micro_area: { id: string; code: string }; last_visit_on: string | null; reasons: WhoToVisitReason[];
}
export interface WhoToVisitQuery { micro_area_id: string; reason?: string[]; before?: string | null; limit?: number }
export interface WhoToVisitPage { items: WhoToVisitItem[]; next_before: string | null }
export interface WhoToVisitCounts { care_line: number; registration_due: number; never_visited: number; people: number }

// ── Atividade coletiva (§7; D-4, D-8, D-9, Q57) ──
export interface CollectiveOptions {
  today: string; min_date: string;
  // Q57c: os profissionais vêm POR EQUIPE (quem registra fora o próprio usuário), os da equipe primeiro; não há lista na raiz.
  teams: {
    id: string; ine: string; name: string | null; cbo: string; can_register: boolean;
    professionals: { id: string; name: string; cbo: string; has_cns: boolean; in_team: boolean }[];
  }[];
  units: { id: string; name: string; has_cnes: boolean }[];
  domains: CollectiveDomains;
}
export interface CollectiveParticipant {
  patient: VisitPatientRef; altered_evaluation: boolean;
  measurements: { weight_kg?: number; height_cm?: number } | null; smoking: { quit: boolean; dropped_out: boolean } | null;
}
export interface CollectiveActivity {
  id: string; client_uuid: string; team: { id: string; ine: string; name: string | null }; unit: { id: string; name: string };
  held_on: string; shift: VisitShift; activity_type: number;
  place: { health_unit: { id: string; name: string } } | { text: string };
  participants_count: number;
  // Derivado pelo api (participantes com avaliação alterada): só na resposta, nunca no corpo (Q38).
  altered_count: number;
  meeting_topics?: number[]; target_audience?: number[]; health_topics?: number[]; health_practices?: number[]; procedure_code?: string | null;
  professionals: { id: string; name: string; cbo: string }[];
  participants?: CollectiveParticipant[];
  recorded_by: { name: string | null };
  state: "recorded" | "mistaken" | string;
  mistaken: { at: string; reason: string | null; by: { name: string | null } } | null;
  ficha: { status: FichaSituation; reasons: string[] };
  can_mark_mistaken: boolean;
}
// Q57a: a lista não traz estas chaves (elas não existem, não são null).
export type CollectiveActivitySummary = Omit<CollectiveActivity,
  "meeting_topics" | "target_audience" | "health_topics" | "health_practices" | "procedure_code" | "participants">;
export type CollectiveParticipantInput =
  ({ patient_id: string } | { new_patient: QuickPatient; duplicates_reviewed?: boolean })
  & { altered_evaluation?: boolean; measurements?: { weight_kg?: number; height_cm?: number }; smoking?: { quit: boolean; dropped_out: boolean } };
// Sem `altered_count`: o api o deriva e recusa a chave (Q38; collective_activities/rules.rb:46-49,90-92).
export interface CollectiveActivityInput {
  client_uuid: string; team_id: string; held_on: string; shift: VisitShift; activity_type: number;
  place_health_unit_id?: string; place_text?: string; participants_count: number;
  meeting_topics: number[]; target_audience: number[]; health_topics: number[]; health_practices: number[];
  // Um dos códigos de `domains.procedures` (Q37).
  procedure_code?: string;
  professionals: { professional_id: string }[]; participants: CollectiveParticipantInput[];
}
export interface CollectiveQuery { team_id: string; from?: string; to?: string; activity_type?: number[]; state?: string[]; before?: string | null; limit?: number }
export interface CollectivePage { items: CollectiveActivitySummary[]; next_before: string | null }

// ── Aparelhos de campo (§9.1) ──
export interface FieldDevice {
  id: string; name: string; created_at: string; last_used_at: string | null;
  status: "active" | "inactive" | "revoked" | (string & {});
  revoked_at: string | null;
  revoked_reason: "user" | "admin" | "membership_ended" | "user_disabled" | (string & {}) | null;
}
// O token e o QR só vêm nesta resposta, uma vez.
export interface FieldDeviceCreated { device: FieldDevice; token: string; qr_payload: string }
export interface AdminFieldDevice extends FieldDevice { user: { id: string; name: string } }

// Query na ordem dada: escalar só preenchido; lista vira `chave[]` repetida (vazia não vai); nulo e vazio nunca vão.
function hvQuery(params: Record<string, readonly (string | number)[] | string | number | null | undefined>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [ key, value ] of Object.entries(params)) {
    if (Array.isArray(value)) for (const v of value) p.append(`${key}[]`, String(v));
    else if (typeof value === "number") p.set(key, String(value));
    else if (typeof value === "string" && value !== "") p.set(key, value);
  }
  return p;
}
async function hvPage<T>(url: string): Promise<{ items: T[]; next_before: string | null }> {
  const b = await jsonFetch<{ items?: T[]; next_before?: string | null }>(url);
  return { items: b.items ?? [], next_before: b.next_before ?? null };
}

// ── Folha do dia e visitas ──
export function getHomeVisitContext(): Promise<HomeVisitContext> {
  return jsonFetch<HomeVisitContext>(hvPath(HOME_VISITS_BASE, "context"));
}
export function listHomeVisitDays(q: HomeVisitDayQuery): Promise<HomeVisitDayPage> {
  return hvPage<HomeVisitDay>(withQuery(hvPath(HOME_VISITS_BASE, "days"), hvQuery({
    team_id: q.team_id, professional_id: q.professional_id, from: q.from, to: q.to, state: q.state, before: q.before, limit: q.limit })));
}
export function getHomeVisitDay(id: string): Promise<HomeVisitDay> {
  return jsonFetch<HomeVisitDay>(hvPath(HOME_VISITS_BASE, "days", id));
}
export function closeHomeVisitDay(id: string): Promise<HomeVisitDay> {
  return jsonFetch<HomeVisitDay>(hvPath(HOME_VISITS_BASE, "days", id, "close"), hvWrite("POST", { expected_state: "open" }));
}
// 201 = gravou; 200 = o mesmo `client_uuid` já estava gravado (reenvio idempotente). O `day` do POST não traz `visits`.
export async function recordHomeVisit(i: HomeVisitInput): Promise<{ visit: HomeVisit; day: HomeVisitDay; replayed: boolean }> {
  const { body, status } = await jsonFetchWithStatus<{ visit: HomeVisit; day: HomeVisitDay }>(HOME_VISITS_BASE, hvWrite("POST", i));
  return { visit: body.visit, day: body.day, replayed: status === 200 };
}
export function getHomeVisit(id: string): Promise<HomeVisit> {
  return jsonFetch<HomeVisit>(hvPath(HOME_VISITS_BASE, id));
}
export function withdrawHomeVisit(id: string, reason: string): Promise<HomeVisit> {
  return jsonFetch<HomeVisit>(hvPath(HOME_VISITS_BASE, id, "withdraw"), hvWrite("POST", { expected_state: "recorded", reason }));
}
export function listHomeVisits(q: HomeVisitQuery): Promise<HomeVisitPage> {
  return hvPage<HomeVisit>(withQuery(HOME_VISITS_BASE, hvQuery({
    team_id: q.team_id, micro_area_id: q.micro_area_id, professional_id: q.professional_id, from: q.from, to: q.to, outcome: q.outcome,
    before: q.before, limit: q.limit })));
}
export function countHomeVisits(q: { team_id: string; micro_area_id?: string; from?: string; to?: string }): Promise<HomeVisitCounts> {
  return jsonFetch<HomeVisitCounts>(withQuery(hvPath(HOME_VISITS_BASE, "count"), hvQuery({
    team_id: q.team_id, micro_area_id: q.micro_area_id, from: q.from, to: q.to })));
}

// ── Domicílios da visita: adaptadores sobre as rotas de leitura do 24a (Q11) ──
function visitHousehold(h: Household, residents?: VisitHouseholdDetail["residents"]): VisitHousehold {
  const sexOf = (patientId: string) => residents?.find((r) => r.patient_id === patientId)?.sex ?? null;
  return {
    id: h.id, address_short: addressLine(h.address), property_type: h.property_type, status: h.status, micro_area: h.micro_area,
    families: h.families.map((f) => ({
      id: f.id, responsible: { patient_id: f.responsible.patient_id, display_name: f.responsible.display_name, sex: sexOf(f.responsible.patient_id) },
      moved_out: f.moved_out, responsible_exited: f.responsible_exited })),
    has_active_family: h.families.some((f) => !f.moved_out)
  };
}
export async function listVisitHouseholds(microAreaId: string, before?: string | null): Promise<VisitHouseholdPage> {
  const page = await listHouseholds({ microAreaId, before });
  return { items: page.households.map((h) => visitHousehold(h)), next_before: page.next_before };
}
// Moradores = cadastros ativos do domicílio (o api só devolve os ativos que o usuário pode ler).
export async function getVisitHousehold(id: string): Promise<VisitHouseholdDetail> {
  const [ household, registrations ] = await Promise.all([ getHousehold(id), listRegistrations({ householdId: id }) ]);
  const residents = registrations.map((r) => ({
    patient_id: r.patient.id, display_name: r.patient.display_name, sex: r.patient.sex, family_id: r.family_id,
    unidentified: r.patient.no_cpf_reason === "unidentified" }));
  return { ...visitHousehold(household, residents), residents };
}

// ── Pessoa: busca e duplicados por POST, no escopo de quem chama ──
// 404 person_not_found = ninguém (null); 409 citizen_not_verified sobe como erro (Q8).
export async function lookupVisitPerson(scope: PersonScope, doc: PersonDoc): Promise<VisitPerson | null> {
  try {
    return await jsonFetch<VisitPerson>(hvPath(scope === "home_visits" ? HOME_VISITS_BASE : COLLECTIVE_BASE, "people", "lookup"), hvWrite("POST", doc));
  } catch (err) {
    if (err instanceof ApiError && err.status === 404 && errorCode(err) === "person_not_found") return null;
    throw err;
  }
}
export async function findVisitDuplicates(
  scope: PersonScope, q: { full_name: string; birth_date: string; mother_name?: string | null }
): Promise<VisitCandidate[]> {
  const b = await jsonFetch<{ candidates?: VisitCandidate[] }>(
    hvPath(scope === "home_visits" ? HOME_VISITS_BASE : COLLECTIVE_BASE, "people", "duplicates"), hvWrite("POST", q));
  return b.candidates ?? [];
}

// ── Atribuição de microárea (criar e encerrar pedem step-up) ──
export async function listFieldAssignments(teamId: string): Promise<FieldAssignmentList> {
  const b = await jsonFetch<Partial<FieldAssignmentList>>(withQuery(hvPath(HOME_VISITS_BASE, "assignments"), hvQuery({ team_id: teamId })));
  return { items: b.items ?? [], candidates: b.candidates ?? [] };
}
export function createFieldAssignment(i: { micro_area_id: string; professional_id: string }): Promise<FieldAssignment> {
  return jsonFetch<FieldAssignment>(hvPath(HOME_VISITS_BASE, "assignments"), hvWrite("POST", i));
}
export function endFieldAssignment(id: string): Promise<FieldAssignment> {
  return jsonFetch<FieldAssignment>(hvPath(HOME_VISITS_BASE, "assignments", id, "end"), hvWrite("POST"));
}

// ── Quem visitar (§8; nominal) ──
export function listWhoToVisit(q: WhoToVisitQuery): Promise<WhoToVisitPage> {
  return hvPage<WhoToVisitItem>(withQuery(hvPath(HOME_VISITS_BASE, "who_to_visit"), hvQuery({
    micro_area_id: q.micro_area_id, reason: q.reason, before: q.before, limit: q.limit })));
}
export function countWhoToVisit(microAreaId: string): Promise<WhoToVisitCounts> {
  return jsonFetch<WhoToVisitCounts>(withQuery(hvPath(HOME_VISITS_BASE, "who_to_visit", "count"), hvQuery({ micro_area_id: microAreaId })));
}

// ── Atividade coletiva ──
export function getCollectiveOptions(): Promise<CollectiveOptions> {
  return jsonFetch<CollectiveOptions>(hvPath(COLLECTIVE_BASE, "options"));
}
// O POST devolve a atividade pura; `replayed` = status 200 (o mesmo `client_uuid` já estava gravado).
export async function recordCollectiveActivity(i: CollectiveActivityInput): Promise<{ activity: CollectiveActivity; replayed: boolean }> {
  const { body, status } = await jsonFetchWithStatus<CollectiveActivity>(COLLECTIVE_BASE, hvWrite("POST", i));
  return { activity: body, replayed: status === 200 };
}
export function listCollectiveActivities(q: CollectiveQuery): Promise<CollectivePage> {
  return hvPage<CollectiveActivitySummary>(withQuery(COLLECTIVE_BASE, hvQuery({
    team_id: q.team_id, from: q.from, to: q.to, activity_type: q.activity_type, state: q.state, before: q.before, limit: q.limit })));
}
export function getCollectiveActivity(id: string): Promise<CollectiveActivity> {
  return jsonFetch<CollectiveActivity>(hvPath(COLLECTIVE_BASE, id));
}
export function markCollectiveMistaken(id: string, reason: string): Promise<CollectiveActivity> {
  return jsonFetch<CollectiveActivity>(hvPath(COLLECTIVE_BASE, id, "mark_mistaken"), hvWrite("POST", { expected_state: "recorded", reason }));
}

// ── Aparelhos de campo (cadastrar e revogar pedem step-up; listar e revogar seguem abertos com home_visits desligado, Q62) ──
export async function listFieldDevices(): Promise<FieldDevice[]> {
  return (await jsonFetch<{ items?: FieldDevice[] }>(FIELD_DEVICES_BASE)).items ?? [];
}
export function registerFieldDevice(name: string): Promise<FieldDeviceCreated> {
  return jsonFetch<FieldDeviceCreated>(FIELD_DEVICES_BASE, hvWrite("POST", { name }));
}
export async function revokeFieldDevice(id: string): Promise<FieldDevice> {
  return (await jsonFetch<{ device: FieldDevice }>(hvPath(FIELD_DEVICES_BASE, id, "revoke"), hvWrite("POST"))).device;
}
export async function listAdminFieldDevices(userId?: string): Promise<AdminFieldDevice[]> {
  const b = await jsonFetch<{ items?: AdminFieldDevice[] }>(withQuery(hvPath(FIELD_DEVICES_BASE, "admin"), hvQuery({ user_id: userId })));
  return b.items ?? [];
}
export async function adminRevokeFieldDevice(id: string): Promise<AdminFieldDevice> {
  return (await jsonFetch<{ device: AdminFieldDevice }>(hvPath(FIELD_DEVICES_BASE, "admin", id, "revoke"), hvWrite("POST"))).device;
}
