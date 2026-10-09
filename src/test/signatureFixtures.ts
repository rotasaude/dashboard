// Dados comuns aos testes do módulo 19b (assinatura digital). Relógio dos
// testes: quinta, 2026-10-08 10:00 em São Paulo (-03:00). A autora é `us1`,
// a mesma das fixtures da consulta do 19a.
import type {
  SessionUser, SignatureBlock, SignatureDetail, SignatureOverview, SignatureRequest, SignerCertificate
} from "../lib/api";
import { sessionWith } from "./campaignFixtures";

export const NOW19B = "2026-10-08T10:00:00-03:00";

// Profissional com as duas funcionalidades ligadas; janela de step-up aberta
// (sessionWith põe `mfa_verified_at` = agora). `{ mfa_verified_at: null }`
// força o pedido do código.
export function signer(roles: string[] = [ "health_professional" ], over: Partial<SessionUser> = {}): SessionUser {
  return sessionWith(roles, {
    id: "us1", email_address: "medica@curitiba.demo", features: [ "clinical_record", "digital_signature" ], ...over
  });
}

// 2026-10-08 → 2027-03-15: 158 dias.
export function certificate(over: Partial<SignerCertificate> = {}): SignerCertificate {
  return {
    id: "sc1", provider: "vidaas", issuer: "AC VALID RFB v5", serial_number: "5A3F09",
    not_after: "2027-03-15T23:59:59-03:00", status: "active", expires_in_days: 158, ...over
  };
}

export function signatureBlock(over: Partial<SignatureBlock> = {}): SignatureBlock {
  return {
    mode: "digital", request_id: "sr1", signature_id: "sg1", signed_at: "2026-10-07T10:21:00-03:00",
    signer_name: "Helena Prado", verification: "valid", simulated: false, ...over
  };
}

export function pendingRequest(over: Partial<SignatureRequest> = {}): SignatureRequest {
  return {
    id: "sr1", document_type: "consultation", document_id: "cs1", consultation_id: "cs1",
    patient_display_name: "Joana Lima", finalized_at: "2026-10-07T10:20:00-03:00", status: "pending",
    reason_code: "no_session", attempts: 0, ...over
  };
}

export function signatureDetail(over: Partial<SignatureDetail> = {}): SignatureDetail {
  return {
    id: "sg1", document_type: "consultation", document_id: "cs1", signed_at: "2026-10-07T10:21:00-03:00",
    signer_name: "Helena Prado", signer_cpf_masked: "***.456.789-**", policy: "AD-RB", provider: "vidaas",
    simulated: false, verification: "valid",
    verification_reasons: [], verified_at: "2026-10-08T09:00:00-03:00",
    content: { schema: "rotasaude.consultation.v1", consultation: { id: "cs1", assessment: "Diabetes descompensado." } },
    ...over
  };
}

export function overview(over: Partial<SignatureOverview> = {}): SignatureOverview {
  return {
    professionals: [
      { user_id: "us1", name: "Helena Prado", certificate_status: "active", not_after: "2027-03-15T23:59:59-03:00",
        pending_count: 0, oldest_pending_at: null },
      { user_id: "us2", name: "Lúcia Prado", certificate_status: "expiring", not_after: "2026-10-20T23:59:59-03:00",
        pending_count: 3, oldest_pending_at: "2026-10-06T16:00:00-03:00" },
      { user_id: "us3", name: "Rafael Souza", certificate_status: "none", not_after: null,
        pending_count: 0, oldest_pending_at: null }
    ],
    documents_by_mode: { digital: 42, manual: 17, pending: 3 },
    invalid_or_indeterminate: [
      { signature_id: "sg9", document_type: "consultation_addendum", signer_name: "Lúcia Prado",
        verification: "indeterminate", verified_at: "2026-10-08T08:00:00-03:00", simulated: false }
    ],
    ...over
  };
}
