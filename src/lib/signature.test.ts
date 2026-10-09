// src/lib/signature.test.ts
import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  CERTIFICATE_STATUS_VIEW, SIGNATURE_DISABLED, SIMULATED_NOTICE, VERIFICATION_VIEW, batchSummary, callbackLanding,
  callbackSummary, canSeeSignatureOverview, canSign, certificateNotice, defaultOverviewPeriod, documentLabel,
  fmtDay, isPendingOverdue, isSimulatedProvider, oauthErrorPhrase, overviewSummary, printHint, providerLabel,
  readSignatureCallback, reasonLabel, returnToPaperProblem, sessionBadge, signatureError, signatureFileName,
  signatureMarker, signatureSettling, usesSimulatedPsc
} from "./signature";
import { NOW19B, certificate, overview, signatureBlock } from "../test/signatureFixtures";

const NOW = Date.parse(NOW19B);
const user = (roles: string[], features: string[] = [ "digital_signature" ], operator = false) =>
  ({ operator, memberships: roles.map((role) => ({ role })), features });

describe("quem pode", () => {
  it("assinar: profissional com digital_signature, nunca operador", () => {
    expect(canSign(user([ "health_professional" ]))).toBe(true);
    expect(canSign(user([ "health_professional" ], [ "clinical_record" ]))).toBe(false);
    expect(canSign(user([ "health_professional" ], [ "digital_signature" ], true))).toBe(false);
    expect(canSign(user([ "municipal_admin", "citizen_verifier" ]))).toBe(false);
    expect(canSign(null)).toBe(false);
  });

  it("painel: municipal_admin com digital_signature, nunca operador", () => {
    expect(canSeeSignatureOverview(user([ "municipal_admin" ]))).toBe(true);
    expect(canSeeSignatureOverview(user([ "municipal_admin" ], []))).toBe(false);
    expect(canSeeSignatureOverview(user([ "health_professional" ]))).toBe(false);
    expect(canSeeSignatureOverview(user([ "municipal_admin" ], [ "digital_signature" ], true))).toBe(false);
  });
});

describe("PSC simulado (R10)", () => {
  it("aviso fixo e rótulo do prestador simulado", () => {
    expect(SIMULATED_NOTICE).toBe("Assinatura simulada — sem validade jurídica");
    expect(providerLabel("simulated")).toBe("PSC simulado");
    expect(isSimulatedProvider("simulated")).toBe(true);
    expect(isSimulatedProvider("vidaas")).toBe(false);
    expect(isSimulatedProvider(null)).toBe(false);
    expect(isSimulatedProvider(undefined)).toBe(false);
  });

  it("a sessão usa o PSC simulado só com as DUAS chaves", () => {
    expect(usesSimulatedPsc(user([ "health_professional" ], [ "digital_signature", "signature_psc_mock" ]))).toBe(true);
    expect(usesSimulatedPsc(user([ "health_professional" ], [ "digital_signature" ]))).toBe(false);
    expect(usesSimulatedPsc(user([ "health_professional" ], [ "signature_psc_mock" ]))).toBe(false);
    expect(usesSimulatedPsc(user([ "health_professional" ], []))).toBe(false);
    expect(usesSimulatedPsc(null)).toBe(false);
  });
});

describe("certificado", () => {
  it("rótulo do prestador; desconhecido sai cru", () => {
    expect(providerLabel("vidaas")).toBe("VIDaaS");
    expect(providerLabel("birdid")).toBe("BirdID");
    expect(providerLabel("novopsc")).toBe("novopsc");
  });

  it("dia no fuso da cidade; ausente ou nulo vira travessão", () => {
    expect(fmtDay("2027-03-15T23:59:59-03:00")).toBe("15/03/2027");
    expect(fmtDay(null)).toBe("—");
    expect(fmtDay(undefined)).toBe("—");
  });

  it("aviso do certificado: longe, 30 dias, amanhã, hoje, vencido e revogado", () => {
    expect(certificateNotice(certificate())).toBeNull();
    expect(certificateNotice(certificate({ not_after: "2026-11-07T23:59:59-03:00", expires_in_days: 30 }))).toEqual(
      { tone: "warn", text: "o certificado vence em 30 dias (07/11/2026) — renove no prestador e vincule de novo" });
    expect(certificateNotice(certificate({ not_after: "2026-10-09T23:59:59-03:00", expires_in_days: 1 }))?.text)
      .toBe("o certificado vence amanhã (09/10/2026) — renove no prestador e vincule de novo");
    expect(certificateNotice(certificate({ not_after: "2026-10-08T23:59:59-03:00", expires_in_days: 0 }))?.text)
      .toBe("o certificado vence hoje (08/10/2026) — renove no prestador e vincule de novo");
    expect(certificateNotice(certificate({ not_after: "2026-10-06T23:59:59-03:00", expires_in_days: -2 }))).toEqual({
      tone: "down",
      text: "certificado vencido em 06/10/2026 — renove no prestador e vincule de novo; até lá, as consultas ficam pendentes"
    });
    expect(certificateNotice(certificate({ status: "expired", expires_in_days: 0, not_after: "2026-10-08T00:00:00-03:00" }))?.tone)
      .toBe("down");
    expect(certificateNotice(certificate({ status: "revoked" }))).toEqual({
      tone: "down", text: "certificado revogado — vincule outro certificado; até lá, as consultas ficam pendentes"
    });
  });
});

describe("sessão de assinatura", () => {
  it("ativa só enquanto expires_at está no futuro", () => {
    expect(sessionBadge({ active: true, expires_at: "2026-10-08T18:40:00-03:00" }, NOW))
      .toEqual({ active: true, label: "assinatura ativa até 18:40" });
    expect(sessionBadge({ active: true, expires_at: "2026-10-08T09:59:00-03:00" }, NOW))
      .toEqual({ active: false, label: "sem sessão de assinatura" });
    expect(sessionBadge({ active: false }, NOW).active).toBe(false);
    expect(sessionBadge({ active: true }, NOW).active).toBe(false);
    expect(sessionBadge(undefined, NOW).label).toBe("sem sessão de assinatura");
  });
});

describe("marcador, motivos e impresso", () => {
  it("digital: válida, inválida, indeterminada", () => {
    expect(signatureMarker(signatureBlock())).toEqual(
      { label: "assinada digitalmente", tone: "ok", detail: "Helena Prado · 07/10/2026, 10:21", simulated: false });
    expect(signatureMarker(signatureBlock({ verification: "invalid" }))).toMatchObject({ label: "assinatura digital inválida", tone: "down" });
    expect(signatureMarker(signatureBlock({ verification: "indeterminate" }))).toMatchObject(
      { label: "assinatura digital indeterminada", tone: "warn" });
  });

  it("validação desconhecida (api mais novo) ou ausente: nunca verde, valor cru em alerta", () => {
    const unknown = signatureMarker(signatureBlock({ verification: "revoked_later" as never }));
    expect(unknown).toMatchObject({ label: "assinatura digital: revoked_later", tone: "warn" });
    expect(signatureMarker(signatureBlock({ verification: undefined }))).toMatchObject(
      { label: "assinatura digital: sem validação", tone: "warn" });
  });

  it("reler depois de finalizar: só enquanto há bloco sem pedido ou pendente sem motivo", () => {
    expect(signatureSettling({ signature: { mode: "manual" }, addenda: [] })).toBe(true);
    expect(signatureSettling({ signature: { mode: "pending", request_id: "sr1" }, addenda: [] })).toBe(true);
    expect(signatureSettling({ signature: { mode: "manual", request_id: "sr1", reason_code: "user_request" }, addenda: [] })).toBe(false);
    expect(signatureSettling({ signature: { mode: "pending", request_id: "sr1", reason_code: "no_session" }, addenda: [] })).toBe(false);
    expect(signatureSettling({ signature: signatureBlock(), addenda: [] })).toBe(false);
    expect(signatureSettling({ signature: signatureBlock(), addenda: [ { signature: { mode: "manual" } } ] })).toBe(true);
    expect(signatureSettling({ addenda: [ {} ] })).toBe(false);
  });

  it("digital simulada: o marcador deixa a simulação visível; só digital+simulated", () => {
    expect(signatureMarker(signatureBlock({ simulated: true }))).toMatchObject(
      { label: "assinada digitalmente", tone: "ok", simulated: true });
    expect(signatureMarker(signatureBlock({ simulated: true, verification: "invalid" })).simulated).toBe(true);
    expect(signatureMarker(signatureBlock({ simulated: undefined })).simulated).toBe(false);
    expect(signatureMarker({ mode: "pending", request_id: "sr1", simulated: true }).simulated).toBe(false);
    expect(signatureMarker({ mode: "manual", simulated: true }).simulated).toBe(false);
  });

  it("pendente com e sem motivo; à mão com o motivo da volta ao papel", () => {
    expect(signatureMarker({ mode: "pending", request_id: "sr1", reason_code: "no_session" })).toEqual(
      { label: "assinatura pendente", tone: "warn", detail: "sem sessão de assinatura aberta", simulated: false });
    expect(signatureMarker({ mode: "pending", request_id: "sr1" }).detail).toBe("assinando…");
    expect(signatureMarker({ mode: "manual", reason_code: "feature_disabled" })).toEqual(
      { label: "assinatura à mão (papel)", tone: "neutral", detail: "assinatura digital desligada na cidade", simulated: false });
    expect(signatureMarker({ mode: "manual" }).detail).toBeNull();
  });

  it("motivo desconhecido sai cru; ausente vira travessão", () => {
    expect(reasonLabel("session_expired")).toBe("a sessão de assinatura venceu");
    expect(reasonLabel("quota_exceeded")).toBe("quota_exceeded");
    expect(reasonLabel(null)).toBe("—");
  });

  it("motivos do contrato real (R3)", () => {
    expect(reasonLabel("certificate_cpf_mismatch")).toBe("o certificado autorizado é de outro CPF");
    expect(reasonLabel("certificate_untrusted")).toBe("a cadeia do certificado não é reconhecida (ICP-Brasil)");
    expect(reasonLabel("professional_cpf_missing")).toBe("seu cadastro está sem CPF — procure a administração da cidade");
  });

  it("documento e nome do arquivo baixado (só o id)", () => {
    expect(documentLabel("consultation")).toBe("consulta");
    expect(documentLabel("consultation_addendum")).toBe("adendo");
    expect(documentLabel("prescription")).toBe("prescription");
    expect(signatureFileName("sg1", "pdf")).toBe("assinatura-sg1.pdf");
    expect(signatureFileName("sg1", "package")).toBe("assinatura-sg1.zip");
  });

  it("aviso do impresso", () => {
    expect(printHint(undefined, false)).toBeNull();
    expect(printHint(signatureBlock(), false)).toBe("o impresso é o PDF assinado digitalmente");
    expect(printHint(signatureBlock(), true))
      .toBe("com adendo, o impresso é o do prontuário; os documentos assinados estão em “Ver o que foi assinado”");
    expect(printHint({ mode: "pending" }, false)).toBe("o impresso sai com espaço para assinatura à mão");
    expect(printHint({ mode: "manual" }, true)).toBe("o impresso sai com espaço para assinatura à mão");
  });

  it("motivo da volta ao papel: ao menos 10 caracteres sem os espaços das pontas", () => {
    expect(returnToPaperProblem("curto")).toBe("descreva o motivo com pelo menos 10 caracteres");
    expect(returnToPaperProblem("   nove 99   ")).toBe("descreva o motivo com pelo menos 10 caracteres");
    expect(returnToPaperProblem("paciente pediu o papel")).toBeNull();
  });
});

describe("frases das recusas", () => {
  const err = (status: number, body: unknown) => new ApiError(status, body, String(status));

  it("códigos do contrato viram frases; nunca o código cru", () => {
    expect(signatureError(err(422, { error: "certificate_cpf_mismatch" })))
      .toBe("o certificado autorizado no prestador é de outro CPF — escolha o certificado em seu nome");
    expect(signatureError(err(409, { error: "certificate_not_linked" })))
      .toBe("vincule um certificado em Conta → Assinatura digital antes de assinar");
    expect(signatureError(err(422, { error: "invalid_state" })))
      .toBe("este retorno do prestador não vale mais (já usado ou vencido) — comece de novo");
    expect(signatureError(err(409, { error: "not_pending" })))
      .toBe("este documento não está mais pendente ou a assinatura está em andamento — a lista foi atualizada");
    expect(signatureError(err(503, { error: "provider_unavailable" }))).toBe("o prestador não respondeu — tente de novo em alguns minutos");
  });

  it("códigos novos do api real (R3)", () => {
    expect(signatureError(err(422, { error: "certificate_untrusted" })))
      .toBe("a cadeia do certificado não é reconhecida (ICP-Brasil) — vincule outro certificado");
    expect(signatureError(err(422, { error: "professional_cpf_missing" })))
      .toBe("seu cadastro está sem CPF — procure a administração da cidade");
    expect(signatureError(err(422, { error: "invalid_provider" })))
      .toBe("o prestador do certificado não está mais disponível nesta cidade — vincule outro certificado");
    expect(signatureError(err(403, { error: "authorization_denied" })))
      .toBe("a autorização foi negada no prestador (ou o certificado é de outro prestador) — nada foi alterado");
  });

  it("interruptor: o da assinatura e o do prontuário têm frases próprias", () => {
    expect(signatureError(err(403, { error: "feature_disabled", feature: "digital_signature" }))).toBe(SIGNATURE_DISABLED);
    expect(signatureError(err(403, { error: "feature_disabled", feature: "clinical_record" })))
      .toBe("o prontuário está desligado nesta cidade");
  });

  it("o resto cai na tradução comum", () => {
    expect(signatureError(err(500, "boom"))).toBe("não foi possível concluir — tente de novo");
    expect(signatureError(new Error("rede"))).toBe("não foi possível concluir — tente de novo");
    expect(signatureError(err(401, { error: "unauthenticated" }))).toBe("sessão expirada — entre de novo");
  });
});

describe("retorno do prestador", () => {
  it("lê state, code e error só na rota de retorno, sob a base do dashboard", () => {
    expect(readSignatureCallback("/dashboard/signature/callback", "?state=st1&code=c1", "/dashboard/"))
      .toEqual({ state: "st1", code: "c1", error: null });
    expect(readSignatureCallback("/dashboard/signature/callback/", "?state=st1&error=access_denied", "/dashboard/"))
      .toEqual({ state: "st1", code: null, error: "access_denied" });
    expect(readSignatureCallback("/dashboard/", "?state=st1&code=c1", "/dashboard/")).toBeNull();
    expect(readSignatureCallback("/signature/callback", "?state=st1&code=c1", "/dashboard/")).toBeNull();
  });

  it("erro do prestador vira frase", () => {
    expect(oauthErrorPhrase("access_denied")).toBe("a autorização foi negada no prestador — nada foi alterado");
    expect(oauthErrorPhrase(null)).toBe("o prestador não concluiu a autorização — comece de novo");
  });

  it("resumo do que voltou", () => {
    expect(callbackSummary({ purpose: "link", result: certificate() }))
      .toBe("Certificado VIDaaS vinculado, válido até 15/03/2027.");
    expect(callbackSummary({ purpose: "session", result: { expires_at: "2026-10-08T22:00:00-03:00" } }))
      .toBe("Sessão de assinatura aberta até 22:00.");
    expect(batchSummary({ signed: 3, failed: [] })).toBe("3 documentos assinados.");
    expect(batchSummary({ signed: 1, failed: [] })).toBe("1 documento assinado.");
    expect(batchSummary({ signed: 2, failed: [ { request_id: "sr9", reason_code: "provider_unavailable" } ] }))
      .toBe("2 documentos assinados; 1 não assinado — fica em Pendentes de assinatura.");
    expect(batchSummary({ signed: 0, failed: [
      { request_id: "sr8", reason_code: "provider_rejected" }, { request_id: "sr9", reason_code: "provider_rejected" } ] }))
      .toBe("nenhum documento assinado; 2 não assinados — ficam em Pendentes de assinatura.");
  });

  it("destino: o return_to devolvido, senão o padrão do propósito", () => {
    expect(callbackLanding({ purpose: "session", result: { expires_at: "x" }, return_to: "/attendance" })).toBe("/attendance");
    expect(callbackLanding({ purpose: "link", result: certificate() })).toBe("/signature");
    expect(callbackLanding({ purpose: "batch", result: { signed: 1, failed: [] } })).toBe("/signature-pending");
    expect(callbackLanding({ purpose: "session", result: { expires_at: "x" } })).toBe("/overview");
    expect(callbackLanding({ purpose: "session", result: { expires_at: "x" }, return_to: "//evil.example" })).toBe("/overview");
  });

  it("destino: barra invertida e destinos fora do formato caem no padrão (tão estrito quanto o api)", () => {
    const s = { purpose: "session" as const, result: { expires_at: "x" } };
    expect(callbackLanding({ ...s, return_to: "/\\evil.example" })).toBe("/overview");
    expect(callbackLanding({ ...s, return_to: "\\evil" })).toBe("/overview");
    expect(callbackLanding({ ...s, return_to: "https://evil.example" })).toBe("/overview");
    expect(callbackLanding({ ...s, return_to: "/" })).toBe("/overview");
    expect(callbackLanding({ ...s, return_to: "" })).toBe("/overview");
  });
});

describe("painel do admin", () => {
  it("pendente há mais de 24 h", () => {
    expect(isPendingOverdue("2026-10-06T16:00:00-03:00", NOW)).toBe(true);
    expect(isPendingOverdue("2026-10-07T10:30:00-03:00", NOW)).toBe(false);
    expect(isPendingOverdue(null, NOW)).toBe(false);
  });

  it("resumo e período padrão de 30 dias no fuso da cidade", () => {
    expect(overviewSummary(overview(), NOW)).toEqual({ withCertificate: 2, withoutCertificate: 1, expiring: 1, pendingOverdue: 1 });
    expect(defaultOverviewPeriod(NOW)).toEqual({ from: "2026-09-08", to: "2026-10-08" });
  });

  it("rótulos de estado", () => {
    expect(CERTIFICATE_STATUS_VIEW.expiring).toEqual({ label: "vence em até 30 dias", tone: "warn" });
    expect(VERIFICATION_VIEW.indeterminate).toEqual({ label: "indeterminada", tone: "warn" });
  });
});
