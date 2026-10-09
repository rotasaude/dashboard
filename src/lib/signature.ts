// src/lib/signature.ts
// Regras de tela da assinatura digital (módulo 19b; spec §5, §9 e §10; ADR
// 0032; contrato 2026-10-08). Quem decide é o api: aqui só se traduz o que ele
// devolveu e se avisa antes de enviar. Nada clínico, nenhum token e nenhum
// `code` passa por aqui além do que a tela mostra ou devolve ao api.
import {
  errorCode,
  type BatchResult, type OAuthCallbackResult, type OverviewProfessional, type SignatureBlock, type SignatureFileKind,
  type SignatureOverview, type SignatureSessionState, type SignatureVerification, type SignerCertificate
} from "./api";
import { describeActionError } from "./actionErrors";
import { featureDisabledKey, hasFeature, sessionFeatures } from "./features";
import { cityDateFormat, cityIsoDate, fmtDateTime, fmtHourMinute } from "./format";
import type { Tone } from "../theme/tokens";

export const CERTIFICATE_KEY = "signatureCertificate";
export const SESSION_KEY = "signatureSession";
export const PENDING_KEY = "signaturePending";
export const SIGNATURE_KEY = "signatureDetail";
export const OVERVIEW_KEY = "signatureOverview";

// Caminhos `/<id do módulo>` que o dashboard manda como return_to (Divergência D3).
export const RETURN_TO = { account: "/signature", pending: "/signature-pending" } as const;

export const EXPIRING_DAYS = 30;
export const RETURN_REASON_MIN = 10;
export const BATCH_LIMIT = 50;
export const OVERDUE_MS = 24 * 60 * 60 * 1000;

export const SIGNATURE_DISABLED = "a assinatura digital está desligada nesta cidade";
export const CERTIFICATE_HELP =
  "Médicos têm certificado em nuvem gratuito pelo CFM. Para a enfermagem, o certificado é fornecido pelo município (COFEN 754/2024).";
// Aviso do PSC simulado (R10): só existe fora de produção; a assinatura não vale em juízo.
export const SIMULATED_NOTICE = "Assinatura simulada — sem validade jurídica";
export const RETURNED_TO_PAPER = "voltou ao papel — imprima a consulta e assine à mão";

const GENERIC = "não foi possível concluir — tente de novo";

// ─── Quem pode ────────────────────────────────────────────────────────────────

type SessionLike = { operator?: boolean; memberships?: { role: string }[]; features?: unknown } | null | undefined;
const rolesOf = (user: SessionLike) => user?.memberships?.map((m) => m.role) ?? [];

export function canSign(user: SessionLike): boolean {
  return !!user && !user.operator && rolesOf(user).includes("health_professional") && hasFeature(user, "digital_signature");
}

export function canSeeSignatureOverview(user: SessionLike): boolean {
  return !!user && !user.operator && rolesOf(user).includes("municipal_admin") && hasFeature(user, "digital_signature");
}

// Interruptor `signature_psc_mock` (maintenance) ligado sobre a assinatura digital.
export function usesSimulatedPsc(user: SessionLike): boolean {
  const features = sessionFeatures(user);
  return features.includes("digital_signature") && features.includes("signature_psc_mock");
}

export function isSimulatedProvider(provider?: string | null): boolean {
  return provider === "simulated";
}

// ─── Certificado e sessão ─────────────────────────────────────────────────────

const PROVIDER_LABEL: Record<string, string> = {
  vidaas: "VIDaaS", birdid: "BirdID", safeid: "SafeID", neoid: "NeoID", remoteid: "RemoteID", simulated: "PSC simulado"
};

export function providerLabel(provider: string): string {
  return PROVIDER_LABEL[provider] ?? provider;
}

const DAY: Intl.DateTimeFormatOptions = { day: "2-digit", month: "2-digit", year: "numeric" };

export function fmtDay(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : cityDateFormat(DAY).format(d);
}

export interface Notice { tone: Tone; text: string }

const RENEW = "renove no prestador e vincule de novo";
const UNTIL_THEN = "até lá, as consultas ficam pendentes";

export function certificateNotice(cert: SignerCertificate): Notice | null {
  if (cert.status === "revoked") {
    return { tone: "down", text: `certificado revogado — vincule outro certificado; ${UNTIL_THEN}` };
  }
  if (cert.status === "expired" || cert.expires_in_days < 0) {
    return { tone: "down", text: `certificado vencido em ${fmtDay(cert.not_after)} — ${RENEW}; ${UNTIL_THEN}` };
  }
  if (cert.expires_in_days <= EXPIRING_DAYS) {
    const when = cert.expires_in_days === 0 ? "vence hoje"
      : cert.expires_in_days === 1 ? "vence amanhã" : `vence em ${cert.expires_in_days} dias`;
    return { tone: "warn", text: `o certificado ${when} (${fmtDay(cert.not_after)}) — ${RENEW}` };
  }
  return null;
}

// Previsão a partir do último GET: a sessão vale até `expires_at`, e o selo
// muda sozinho quando o relógio passa dele (o api é quem decide de verdade).
export function sessionBadge(session: SignatureSessionState | undefined, nowMs: number): { active: boolean; label: string } {
  const until = session?.active && session.expires_at ? Date.parse(session.expires_at) : Number.NaN;
  if (!Number.isNaN(until) && until > nowMs) {
    return { active: true, label: `assinatura ativa até ${fmtHourMinute(session!.expires_at)}` };
  }
  return { active: false, label: "sem sessão de assinatura" };
}

// ─── Marcador, motivos e impresso ─────────────────────────────────────────────

const REASON_LABEL: Record<string, string> = {
  no_session: "sem sessão de assinatura aberta",
  session_expired: "a sessão de assinatura venceu",
  provider_unavailable: "o prestador não respondeu",
  provider_rejected: "o prestador recusou a assinatura",
  signer_unavailable: "o serviço de assinatura não respondeu",
  verification_failed: "a assinatura não passou na verificação",
  certificate_expired: "certificado vencido",
  certificate_revoked: "certificado revogado",
  certificate_cpf_mismatch: "o certificado autorizado é de outro CPF",
  certificate_untrusted: "a cadeia do certificado não é reconhecida (ICP-Brasil)",
  professional_cpf_missing: "seu cadastro está sem CPF — procure a administração da cidade",
  feature_disabled: "assinatura digital desligada na cidade",
  user_request: "voltou ao papel a pedido do autor"
};

export function reasonLabel(code: string | null | undefined): string {
  if (!code) return "—";
  return REASON_LABEL[code] ?? code;
}

const DOCUMENT_LABEL: Record<string, string> = { consultation: "consulta", consultation_addendum: "adendo" };

export function documentLabel(type: string): string {
  return DOCUMENT_LABEL[type] ?? type;
}

// `simulated`: só digital com PSC simulado — a tela mostra SIMULATED_NOTICE.
export interface Marker { label: string; tone: Tone; detail: string | null; simulated: boolean }

export function signatureMarker(block: SignatureBlock): Marker {
  if (block.mode === "digital") {
    const who = [ block.signer_name, block.signed_at ? fmtDateTime(block.signed_at) : null ].filter(Boolean).join(" · ") || null;
    const simulated = block.simulated === true;
    if (block.verification === "invalid") return { label: "assinatura digital inválida", tone: "down", detail: who, simulated };
    if (block.verification === "indeterminate") {
      return { label: "assinatura digital indeterminada", tone: "warn", detail: who, simulated };
    }
    if (block.verification === "valid") return { label: "assinada digitalmente", tone: "ok", detail: who, simulated };
    // Valor que este dashboard não conhece (api mais novo) ou ausente: nunca verde.
    return { label: `assinatura digital: ${block.verification ?? "sem validação"}`, tone: "warn", detail: who, simulated };
  }
  if (block.mode === "pending") {
    return { label: "assinatura pendente", tone: "warn", detail: block.reason_code ? reasonLabel(block.reason_code) : "assinando…", simulated: false };
  }
  return { label: "assinatura à mão (papel)", tone: "neutral", detail: block.reason_code ? reasonLabel(block.reason_code) : null, simulated: false };
}

// Logo depois de finalizar (ou de um adendo), o api ainda não criou o pedido
// (manual sem request_id) ou o job ainda está assinando (pending sem motivo):
// a tela relê a consulta até o bloco assentar (Ruling R8).
type WithBlocks = { signature?: SignatureBlock; addenda?: { signature?: SignatureBlock }[] };
const settling = (b: SignatureBlock | undefined) =>
  !!b && ((b.mode === "manual" && !b.request_id) || (b.mode === "pending" && !b.reason_code));

export function signatureSettling(c: WithBlocks): boolean {
  return settling(c.signature) || (c.addenda ?? []).some((a) => settling(a.signature));
}

// O api decide qual impresso sai (contrato §6): PDF assinado quando a consulta
// é digital, com verificação válida e sem adendo depois; o impresso do 19a nos demais casos.
export function printHint(block: SignatureBlock | undefined, hasAddenda: boolean): string | null {
  if (!block) return null;
  if (block.mode === "digital" && block.verification === "valid" && !hasAddenda) {
    return "o impresso é o PDF assinado digitalmente";
  }
  if (block.mode === "digital" && hasAddenda) {
    return "com adendo, o impresso é o do prontuário; os documentos assinados estão em “Ver o que foi assinado”";
  }
  if (block.mode === "digital") return "o impresso sai com o estado da assinatura e espaço para assinatura à mão";
  return "o impresso sai com espaço para assinatura à mão";
}

export function returnToPaperProblem(reason: string): string | null {
  return reason.trim().length < RETURN_REASON_MIN ? `descreva o motivo com pelo menos ${RETURN_REASON_MIN} caracteres` : null;
}

export function signatureFileName(id: string, kind: SignatureFileKind): string {
  return `assinatura-${id}.${kind === "pdf" ? "pdf" : "zip"}`;
}

// ─── Frases das recusas ───────────────────────────────────────────────────────

const ERRORS: Record<string, string> = {
  certificate_not_linked: "vincule um certificado em Conta → Assinatura digital antes de assinar",
  certificate_not_found: "nenhum certificado em nuvem encontrado para o seu CPF",
  certificate_cpf_mismatch: "o certificado autorizado no prestador é de outro CPF — escolha o certificado em seu nome",
  certificate_untrusted: "a cadeia do certificado não é reconhecida (ICP-Brasil) — vincule outro certificado",
  professional_cpf_missing: "seu cadastro está sem CPF — procure a administração da cidade",
  certificate_expired: "o certificado está vencido — renove no prestador e vincule de novo",
  certificate_revoked: "o certificado foi revogado — vincule outro certificado",
  provider_unavailable: "o prestador não respondeu — tente de novo em alguns minutos",
  authorization_denied: "a autorização foi negada no prestador (ou o certificado é de outro prestador) — nada foi alterado",
  authorization_expired: "a autorização demorou demais e venceu — comece de novo",
  invalid_state: "este retorno do prestador não vale mais (já usado ou vencido) — comece de novo",
  invalid_provider: "o prestador do certificado não está mais disponível nesta cidade — vincule outro certificado",
  not_author: "só quem escreveu o documento pode assiná-lo ou voltá-lo ao papel",
  already_signed: "este documento já foi assinado",
  not_pending: "este documento não está mais pendente ou a assinatura está em andamento — a lista foi atualizada",
  nothing_pending: "não há documentos pendentes — a lista foi atualizada",
  invalid_reason: `descreva o motivo com pelo menos ${RETURN_REASON_MIN} caracteres`,
  out_of_context: "fora do atendimento, abra o prontuário com motivo para ver o que foi assinado",
  opening_required: "a abertura justificada terminou — abra o prontuário de novo",
  invalid_period: "o período informado não é válido",
  missing_role: "seu papel não permite esta ação"
};

export function signatureError(err: unknown): string {
  const feature = featureDisabledKey(err);
  if (feature === "clinical_record") return "o prontuário está desligado nesta cidade";
  if (feature !== null) return SIGNATURE_DISABLED;
  const code = errorCode(err);
  if (code && ERRORS[code]) return ERRORS[code];
  const described = describeActionError(err);
  return "message" in described ? described.message : GENERIC;
}

// ─── Retorno do prestador ─────────────────────────────────────────────────────

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

export function batchSummary(result: BatchResult): string {
  const n = result.signed;
  const signed = n === 0 ? "nenhum documento assinado" : `${n} ${plural(n, "documento assinado", "documentos assinados")}`;
  const m = result.failed.length;
  if (m === 0) return `${signed}.`;
  return `${signed}; ${m} ${plural(m, "não assinado — fica", "não assinados — ficam")} em Pendentes de assinatura.`;
}

export function callbackSummary(result: OAuthCallbackResult): string {
  if (result.purpose === "link") {
    return `Certificado ${providerLabel(result.result.provider)} vinculado, válido até ${fmtDay(result.result.not_after)}.`;
  }
  if (result.purpose === "session") return `Sessão de assinatura aberta até ${fmtHourMinute(result.result.expires_at)}.`;
  return batchSummary(result.result);
}

const DEFAULT_LANDING: Record<OAuthCallbackResult["purpose"], string> = {
  link: RETURN_TO.account, session: "/overview", batch: RETURN_TO.pending
};

export function callbackLanding(result: OAuthCallbackResult): string {
  return result.return_to && /^\/[^/\\]/.test(result.return_to) ? result.return_to : DEFAULT_LANDING[result.purpose];
}

export function oauthErrorPhrase(error: string | null): string {
  return error === "access_denied"
    ? "a autorização foi negada no prestador — nada foi alterado"
    : "o prestador não concluiu a autorização — comece de novo";
}

export interface SignatureCallbackParams { state: string | null; code: string | null; error: string | null }

const CALLBACK_PATH = "signature/callback";

// Rota de retorno sob a base do dashboard (Divergência D1). Pura: a base vem
// por argumento (nos testes, import.meta.env.BASE_URL é "/").
export function readSignatureCallback(
  pathname: string = window.location.pathname,
  search: string = window.location.search,
  base: string = import.meta.env.BASE_URL
): SignatureCallbackParams | null {
  if (pathname.replace(/\/+$/, "") !== `${base}${CALLBACK_PATH}`) return null;
  const params = new URLSearchParams(search);
  const read = (key: string) => {
    const value = params.get(key);
    return value && value.trim() !== "" ? value : null;
  };
  return { state: read("state"), code: read("code"), error: read("error") };
}

// O `code` não pode ficar no histórico: troca a entrada pela base do dashboard.
export function clearSignatureCallbackFromUrl(base: string = import.meta.env.BASE_URL): void {
  window.history.replaceState({}, "", base);
}

// ─── Painel do admin ──────────────────────────────────────────────────────────

export const CERTIFICATE_STATUS_VIEW: Record<OverviewProfessional["certificate_status"], { label: string; tone: Tone }> = {
  active: { label: "ativo", tone: "ok" },
  expiring: { label: "vence em até 30 dias", tone: "warn" },
  none: { label: "sem certificado", tone: "neutral" }
};

export const VERIFICATION_VIEW: Record<SignatureVerification, { label: string; tone: Tone }> = {
  valid: { label: "válida", tone: "ok" },
  invalid: { label: "inválida", tone: "down" },
  indeterminate: { label: "indeterminada", tone: "warn" }
};

export function isPendingOverdue(oldest: string | null | undefined, nowMs: number): boolean {
  if (!oldest) return false;
  const at = Date.parse(oldest);
  return !Number.isNaN(at) && nowMs - at > OVERDUE_MS;
}

export function overviewSummary(o: SignatureOverview, nowMs: number) {
  const ps = o.professionals;
  return {
    withCertificate: ps.filter((p) => p.certificate_status !== "none").length,
    withoutCertificate: ps.filter((p) => p.certificate_status === "none").length,
    expiring: ps.filter((p) => p.certificate_status === "expiring").length,
    pendingOverdue: ps.filter((p) => isPendingOverdue(p.oldest_pending_at, nowMs)).length
  };
}

export function defaultOverviewPeriod(nowMs: number): { from: string; to: string } {
  return { from: cityIsoDate(new Date(nowMs - 29 * 86_400_000)), to: cityIsoDate(new Date(nowMs)) };
}

// ─── Navegador ────────────────────────────────────────────────────────────────

// Vai ao prestador na mesma aba: o retorno volta para /dashboard/signature/callback.
export function goToProvider(url: string): void {
  window.location.assign(url);
}

// Download pelo endereço `blob:`; o nome do arquivo leva só o id (nunca nome
// de paciente), e o endereço é revogado depois de 60 s.
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
