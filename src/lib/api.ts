// Cliente HTTP do dashboard. Read API /admin/api/* (envelope { data, as_of })
// + sessão /session. credentials: "include" (cookie HttpOnly, ADR-0022).
const BASE = import.meta.env.VITE_ADMIN_API_BASE || "/admin/api";
const SESSION_BASE = import.meta.env.VITE_SESSION_BASE || "/session";

export interface ScopeBlock {
  municipality: { id: string | null; name: string; cross_tenant: boolean };
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

export interface Membership {
  municipality_id: string;
  municipality_name: string;
  municipality_uf: string | null;
  role: string;
}

export interface SessionUser {
  id: string;
  email_address: string;
  operator: boolean;
  memberships: Membership[];
  mfa_enrolled: boolean;
  mfa_verified_at: string | null;
}

async function jsonFetch<T>(input: string, init?: RequestInit): Promise<T> {
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
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
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

export interface GateResult { valid: boolean; errors?: string[]; }
export interface PreviewResult { outcome?: Record<string, unknown>; valid?: boolean; errors?: string[]; }
export interface DraftResult {
  id?: string; name?: string; version?: number; status?: string;
  error?: string; message?: string;
}

export async function gateProtocol(definition: unknown): Promise<GateResult> {
  try {
    await jsonFetch<unknown>(`${AUTHORING_BASE}/gate`, {
      method: "POST", body: JSON.stringify({ definition })
    });
    return { valid: true };
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
}
export interface AttendanceTriage { date: string; protocol_name: string }
export interface VerificationRow {
  id: string; verified_at: string; verified_by: string; phone_masked: string; active: boolean;
  revoked_at: string | null; revoked_by: string | null; revoke_reason: string | null;
}

export async function lookupCitizen(cpf: string, code: string): Promise<{ citizen: AttendanceCitizen; triages: AttendanceTriage[] }> {
  return jsonFetch(`${ATTENDANCE_BASE}/lookup`, { method: "POST", body: JSON.stringify({ cpf, code }) });
}

export async function verifyCitizen(cpf: string, code: string): Promise<void> {
  await jsonFetch<unknown>(`${ATTENDANCE_BASE}/verifications`, {
    method: "POST", body: JSON.stringify({ cpf, code, document_checked: true })
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

export interface HealthUnit extends Partial<UnitAddress> { id: string; name: string; kind: string }
export interface HealthUnitRow extends HealthUnit { active: boolean }

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

export async function updateUnit(id: string, name: string, kind: string, address: UnitAddress): Promise<HealthUnitRow> {
  const payload = await jsonFetch<{ unit: HealthUnitRow }>(`${ATTENDANCE_BASE}/units/${encodeURIComponent(id)}`, {
    method: "POST", body: JSON.stringify({ name, kind, ...address })
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
}
export interface CheckInTriage { id: string; date: string; protocol_name: string; priority: number }
export interface CheckInAppointment {
  id: string; scheduled_at: string; kind: "return" | "referral"; unit_name: string;
  protocol_name: string; priority: number;
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
}

export interface AppointmentRequestSummary { id: string; kind: string; target_unit_name: string; status: string }

export type AttendanceOutcome = "discharged" | "referred" | "return" | "left";

export async function lookupCheckIn(
  cpf: string, code: string, healthUnitId: string
): Promise<{ citizen: CheckInCitizen; triage: CheckInTriage | null; appointment: CheckInAppointment | null }> {
  return jsonFetch(`${ATTENDANCE_BASE}/check_ins/lookup`, {
    method: "POST", body: JSON.stringify({ cpf, code, health_unit_id: healthUnitId })
  });
}

export async function checkIn(
  cpf: string, code: string, healthUnitId: string, documentChecked: boolean
): Promise<{ attendance: Attendance; verified: boolean }> {
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

export async function checkInByException(
  cpf: string, target: { triageId: string } | { appointmentId: string }, healthUnitId: string, reason: string
): Promise<{ attendance: Attendance }> {
  const body: Record<string, unknown> = { cpf, health_unit_id: healthUnitId, reason };
  if ("triageId" in target) body.triage_id = target.triageId;
  else body.appointment_id = target.appointmentId;
  return jsonFetch(`${ATTENDANCE_BASE}/check_ins/exception`, { method: "POST", body: JSON.stringify(body) });
}

export async function listUnitQueue(unitId: string): Promise<{ waiting: QueueRow[]; in_care: QueueRow[] }> {
  return jsonFetch(`${ATTENDANCE_BASE}/units/${encodeURIComponent(unitId)}/queue`);
}

export async function callAttendance(id: string, healthUnitId: string): Promise<{ attendance: Attendance }> {
  return jsonFetch(`${ATTENDANCE_BASE}/attendances/${encodeURIComponent(id)}/call`, {
    method: "POST", body: JSON.stringify({ health_unit_id: healthUnitId })
  });
}

export async function callNext(unitId: string): Promise<{ attendance: Attendance }> {
  return jsonFetch(`${ATTENDANCE_BASE}/units/${encodeURIComponent(unitId)}/call_next`, { method: "POST", body: "{}" });
}

export async function closeAttendance(
  id: string, outcome: AttendanceOutcome, referralUnitId?: string, referralNote?: string
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

export interface RequestRow {
  id: string; kind: "return" | "referral"; origin_unit_name: string; created_at: string;
  cpf_masked: string; priority: number | null; note: string | null;
  reopened_reason: "expired" | "no_show" | null;
}

export async function listUnitRequests(unitId: string): Promise<RequestRow[]> {
  const payload = await jsonFetch<{ requests: RequestRow[] }>(`${ATTENDANCE_BASE}/units/${encodeURIComponent(unitId)}/requests`);
  return payload.requests;
}

export interface ScheduledAppointment { id: string; scheduled_at: string; status: string; confirmation_deadline_at: string | null }

export async function scheduleRequest(
  id: string, scheduledAtIso: string, healthUnitId: string
): Promise<ScheduledAppointment> {
  const payload = await jsonFetch<{ appointment: ScheduledAppointment }>(
    `${ATTENDANCE_BASE}/requests/${encodeURIComponent(id)}/appointments`,
    { method: "POST", body: JSON.stringify({ scheduled_at: scheduledAtIso, health_unit_id: healthUnitId }) }
  );
  return payload.appointment;
}

export async function dismissRequest(
  id: string, reason: string, healthUnitId: string
): Promise<{ id: string; status: string }> {
  const payload = await jsonFetch<{ request: { id: string; status: string } }>(
    `${ATTENDANCE_BASE}/requests/${encodeURIComponent(id)}/dismiss`,
    { method: "POST", body: JSON.stringify({ reason, health_unit_id: healthUnitId }) }
  );
  return payload.request;
}

export interface AgendaAppointment {
  id: string; scheduled_at: string; cpf_masked: string; kind: "return" | "referral"; status: string;
}

export async function listUnitAgenda(unitId: string, dateIso: string): Promise<AgendaAppointment[]> {
  const payload = await jsonFetch<{ appointments: AgendaAppointment[] }>(
    `${ATTENDANCE_BASE}/units/${encodeURIComponent(unitId)}/agenda?date=${encodeURIComponent(dateIso)}`
  );
  return payload.appointments;
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
  council: string;
  council_state: string;
  registration_number: string;
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
}

export interface ProfessionalShift {
  id: string;
  professional_link_id: string;
  unit_name: string;
  starts_at: string;
  ends_at: string;
  cancelled_at: string | null;
  cancel_reason: string | null;
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

export async function scheduleShift(linkId: string, startsAt: string, endsAt: string): Promise<ProfessionalShift> {
  return (await jsonFetch<{ shift: ProfessionalShift }>(`${PROFESSIONALS_BASE}/links/${professionalId(linkId)}/shifts`,
    postProfessional({ starts_at: startsAt, ends_at: endsAt }))).shift;
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
