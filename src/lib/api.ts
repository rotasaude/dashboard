// Cliente HTTP do dashboard. Read API /admin/api/* (envelope { data, as_of })
// + sessão /session. credentials: "include" (cookie HttpOnly, ADR-0022).
import type { DraftCandidate, OpenDraft } from "./consultationDrafts";
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
  id: string; name: string; kind: string; screening_scope?: ScreeningScope;
  // Módulo 21b: a unidade coleta amostras para o laboratório municipal.
  collects_samples?: boolean;
  // Módulo 25 (D15): unidade notificadora (notificação negativa semanal).
  notifying?: boolean;
}
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

export async function createUnit(name: string, kind: string, address: UnitAddress): Promise<HealthUnitRow> {
  const payload = await jsonFetch<{ unit: HealthUnitRow }>(`${ATTENDANCE_BASE}/units`, {
    method: "POST", body: JSON.stringify({ name, kind, ...address })
  });
  return payload.unit;
}

export async function updateUnit(
  id: string, name: string, kind: string, address: UnitAddress, screeningScope?: ScreeningScope, collectsSamples?: boolean,
  notifying?: boolean
): Promise<HealthUnitRow> {
  const body: Record<string, unknown> = { name, kind, ...address };
  if (screeningScope) body.screening_scope = screeningScope;
  if (collectsSamples !== undefined) body.collects_samples = collectsSamples;
  if (notifying !== undefined) body.notifying = notifying;
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
}

export interface QueueRow {
  id: string; cpf_masked: string; checked_in_at: string; protocol_name: string | null; priority: number | null;
  source: "triage" | "appointment"; appointment_time: string | null;
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

export async function callAttendance(id: string, healthUnitId: string): Promise<CallResult> {
  return jsonFetch(`${ATTENDANCE_BASE}/attendances/${encodeURIComponent(id)}/call`, {
    method: "POST", body: JSON.stringify({ health_unit_id: healthUnitId })
  });
}

export async function callNext(unitId: string): Promise<CallResult> {
  return jsonFetch(`${ATTENDANCE_BASE}/units/${encodeURIComponent(unitId)}/call_next`, { method: "POST", body: "{}" });
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
  // Nulos juntos: ACS (515105) e agente de endemias (515140) não têm conselho (módulo 24a).
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
  | { kind: "appointment_request_open"; kinds?: RequestKind[]; target_unit_id?: string };

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
}

export interface NamedRef { id: string; name: string }
export interface CampaignOptions {
  protocols: string[];
  tiers: string[];
  outcomes: string[];
  neighborhoods: NamedRef[];
  units: NamedRef[];
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
export type CredentialKind = "ledi" | "cadsus";
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
export interface AddendumChanges { evaluated_problems?: EvaluatedProblem[]; conducts?: string[]; exam_requests?: ExamRequest[] }
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
export interface ConsultationOptions { care_types: CodedOption[]; conducts: CodedOption[]; cid10_allowed_for_cbo: boolean }
// Corpo do autosave (Divergência D5: todos os campos editáveis a cada PATCH).
export interface ConsultationDraftInput {
  subjective: string; objective: string; assessment: string; plan: string; vitals: VitalSigns; care_type: string | null;
  evaluated_problems: EvaluatedProblem[]; conducts: string[]; exam_requests: ExamRequest[];
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

export function startConsultation(attendanceId: string): Promise<Consultation> {
  return jsonFetch(attendancePath(attendanceId, "consultation"), postProfessional({}));
}

export function saveConsultationDraft(id: string, input: ConsultationDraftInput): Promise<Consultation> {
  return jsonFetch(consultationPath(id), { method: "PATCH", body: JSON.stringify(input) });
}

export function finalizeConsultation(id: string, outcome: OutcomeBody): Promise<Consultation> {
  return jsonFetch(consultationPath(id, "finalize"), postProfessional({ outcome }));
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
  | "clinical_document" | "controlled_notification" | "campaign" | "exam" | "procedure";

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

export type ProcedureSource = "attendance" | "consultation" | "lab_report" | "manual";
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
  procedure_id: string; reasons: string[]; fix: PendingFix | string;
  performed_on?: string; sigtap_code?: string; label?: string; late?: boolean;
  // Módulo 24a: L8 (`has_cpf`, CNS mascarado) e L6 (`address_from_household`: endereço do cadastro domiciliar).
  patient?: { id: string; display_name: string | null; has_cpf?: boolean; cns_masked?: string | null; address_from_household?: boolean };
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

export type CareStatus = "ok" | "due_soon" | "overdue" | "untracked";
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
  appointment_request_id: string | null; schedule: { at: string; place: string; notes: string | null } | null;
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
export interface RegulationScheduleInput { at: string; place: string; notes?: string | null; version: number }
export interface CareProvider {
  id: string; name: string; cnes: string; kind: ProviderKind | string; health_unit: { id: string; name: string } | null; active: boolean;
}
export interface CareProviderInput { name: string; cnes?: string; kind: ProviderKind; health_unit_id?: string | null; active: boolean }
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
