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
export async function revertProtocol(name: string, reason: string): Promise<void> {
  await jsonFetch<unknown>(`${PROTOCOLS_BASE}/revert`, {
    method: "POST", body: JSON.stringify({ name, reason })
  });
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
