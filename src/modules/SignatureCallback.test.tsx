// src/modules/SignatureCallback.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), completeSignatureOAuth: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { SignatureCallback } from "./SignatureCallback";
import { renderWithProviders } from "../test/campaignFixtures";
import { certificate, signer } from "../test/signatureFixtures";
import { SIMULATED_NOTICE } from "../lib/signature";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const OK = { state: "st1", code: "c1", error: null };
const SESSION = { purpose: "session", result: { expires_at: "2026-10-08T22:00:00-03:00" } };

afterEach(cleanup);

describe("SignatureCallback", () => {
  let onDone: ReturnType<typeof vi.fn>;
  let clearUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.completeSignatureOAuth).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(signer());
    onDone = vi.fn();
    clearUrl = vi.fn();
  });

  it("vínculo: limpa a URL antes de trocar o código, diz o resultado e volta à Conta", async () => {
    mocked(api.completeSignatureOAuth).mockResolvedValue({ purpose: "link", result: certificate(), return_to: "/signature" });
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("status")).textContent).toBe("Certificado VIDaaS vinculado, válido até 15/03/2027.");
    expect(api.completeSignatureOAuth).toHaveBeenCalledWith("st1", "c1");
    expect(clearUrl.mock.invocationCallOrder[0]).toBeLessThan(mocked(api.completeSignatureOAuth).mock.invocationCallOrder[0]);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onDone).toHaveBeenCalledWith("signature");
  });

  it("StrictMode: troca o código uma vez só", async () => {
    mocked(api.completeSignatureOAuth).mockResolvedValue(SESSION);
    renderWithProviders(<StrictMode><SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} /></StrictMode>);
    expect(await screen.findByText("Sessão de assinatura aberta até 22:00.")).not.toBeNull();
    expect(api.completeSignatureOAuth).toHaveBeenCalledTimes(1);
    expect(clearUrl).toHaveBeenCalledTimes(1);
  });

  it("state e code não vão ao console nem ao storage", async () => {
    const spies = [ "log", "info", "warn", "error", "debug" ].map((m) =>
      vi.spyOn(console, m as "log").mockImplementation(() => undefined));
    window.localStorage.clear();
    window.sessionStorage.clear();
    mocked(api.completeSignatureOAuth).mockResolvedValue(SESSION);
    renderWithProviders(<SignatureCallback params={{ state: "STATE-XYZ", code: "CODE-XYZ", error: null }} onDone={onDone} clearUrl={clearUrl} />);
    await screen.findByRole("status");
    const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join(" ");
    expect(logged).not.toContain("STATE-XYZ");
    expect(logged).not.toContain("CODE-XYZ");
    const stored = [ window.localStorage, window.sessionStorage ]
      .flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`)).join(" ");
    expect(stored).not.toContain("STATE-XYZ");
    expect(stored).not.toContain("CODE-XYZ");
    spies.forEach((s) => s.mockRestore());
  });

  it("sessão sem return_to devolvido: volta à visão geral", async () => {
    mocked(api.completeSignatureOAuth).mockResolvedValue(SESSION);
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(onDone).toHaveBeenCalledWith("overview");
  });

  it("return_to que não é módulo do catálogo: volta à visão geral", async () => {
    mocked(api.completeSignatureOAuth).mockResolvedValue({ ...SESSION, return_to: "/nao-existe" });
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    fireEvent.click(await screen.findByRole("button", { name: "Continuar" }));
    expect(onDone).toHaveBeenCalledWith("overview");
  });

  it("lote: quantos foram assinados, o que ficou e volta às Pendentes", async () => {
    mocked(api.completeSignatureOAuth).mockResolvedValue({
      purpose: "batch", return_to: "/signature-pending",
      result: { signed: 2, failed: [ { request_id: "sr9", reason_code: "provider_unavailable" } ] }
    });
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("status")).textContent)
      .toBe("2 documentos assinados; 1 não assinado — fica em Pendentes de assinatura.");
    expect(screen.getByRole("list", { name: "não assinados" }).textContent).toBe("o prestador não respondeu");
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onDone).toHaveBeenCalledWith("signature-pending");
  });

  it("autorização negada no prestador: avisa o api com { state, error } e volta à tela de origem (R11)", async () => {
    mocked(api.completeSignatureOAuth).mockRejectedValue(
      new ApiError(403, { error: "authorization_denied", return_to: "/signature" }, "403"));
    renderWithProviders(<SignatureCallback params={{ state: "st1", code: null, error: "access_denied" }} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent).toBe("a autorização foi negada no prestador — nada foi alterado");
    expect(api.completeSignatureOAuth).toHaveBeenCalledTimes(1);
    expect(api.completeSignatureOAuth).toHaveBeenCalledWith("st1", { error: "access_denied" });
    expect(clearUrl).toHaveBeenCalledTimes(1);
    expect(clearUrl.mock.invocationCallOrder[0]).toBeLessThan(mocked(api.completeSignatureOAuth).mock.invocationCallOrder[0]);
    fireEvent.click(screen.getByRole("button", { name: "Voltar a Assinatura digital" }));
    expect(onDone).toHaveBeenCalledWith("signature");
  });

  it("autorização negada sob StrictMode: avisa o api uma vez só", async () => {
    mocked(api.completeSignatureOAuth).mockRejectedValue(
      new ApiError(403, { error: "authorization_denied", return_to: "/signature-pending" }, "403"));
    renderWithProviders(<StrictMode>
      <SignatureCallback params={{ state: "st1", code: null, error: "access_denied" }} onDone={onDone} clearUrl={clearUrl} />
    </StrictMode>);
    fireEvent.click(await screen.findByRole("button", { name: "Voltar a Pendentes de assinatura" }));
    expect(api.completeSignatureOAuth).toHaveBeenCalledTimes(1);
    expect(clearUrl).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledWith("signature-pending");
  });

  it("autorização negada sem return_to válido no corpo: volta à visão geral", async () => {
    mocked(api.completeSignatureOAuth).mockRejectedValue(new ApiError(403, { error: "authorization_denied" }, "403"));
    renderWithProviders(<SignatureCallback params={{ state: "st1", code: null, error: "server_error" }} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent).toBe("o prestador não concluiu a autorização — comece de novo");
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao painel" }));
    expect(onDone).toHaveBeenCalledWith("overview");
  });

  it("erro do prestador sem state: não chama o api", async () => {
    renderWithProviders(<SignatureCallback params={{ state: null, code: null, error: "access_denied" }} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent).toBe("a autorização foi negada no prestador — nada foi alterado");
    expect(clearUrl).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.completeSignatureOAuth).not.toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Voltar ao painel" }));
    expect(onDone).toHaveBeenCalledWith("overview");
  });

  it("retorno já usado (invalid_state): diz para começar de novo", async () => {
    mocked(api.completeSignatureOAuth).mockRejectedValue(new ApiError(422, { error: "invalid_state" }, "422"));
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent)
      .toBe("este retorno do prestador não vale mais (já usado ou vencido) — comece de novo");
  });

  it("certificado de outro CPF: diz o motivo", async () => {
    mocked(api.completeSignatureOAuth).mockRejectedValue(new ApiError(422, { error: "certificate_cpf_mismatch" }, "422"));
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent)
      .toBe("o certificado autorizado no prestador é de outro CPF — escolha o certificado em seu nome");
  });

  it("cadeia do certificado não reconhecida: diz o motivo", async () => {
    mocked(api.completeSignatureOAuth).mockRejectedValue(new ApiError(422, { error: "certificate_untrusted" }, "422"));
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent)
      .toBe("a cadeia do certificado não é reconhecida (ICP-Brasil) — vincule outro certificado");
  });

  it("autorização vencida com return_to no corpo: diz e volta à tela de origem", async () => {
    mocked(api.completeSignatureOAuth).mockRejectedValue(
      new ApiError(409, { error: "authorization_expired", return_to: "/signature-pending" }, "409"));
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent).toBe("a autorização demorou demais e venceu — comece de novo");
    fireEvent.click(screen.getByRole("button", { name: "Voltar a Pendentes de assinatura" }));
    expect(onDone).toHaveBeenCalledWith("signature-pending");
  });

  it("recusa com return_to inválido no corpo: volta à visão geral", async () => {
    mocked(api.completeSignatureOAuth).mockRejectedValue(
      new ApiError(409, { error: "authorization_expired", return_to: "//evil.example" }, "409"));
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    fireEvent.click(await screen.findByRole("button", { name: "Voltar ao painel" }));
    expect(onDone).toHaveBeenCalledWith("overview");
  });

  it("sem state ou code: não chama o api", async () => {
    renderWithProviders(<SignatureCallback params={{ state: null, code: "c1", error: null }} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent).toBe("o prestador não concluiu a autorização — comece de novo");
    await waitFor(() => expect(api.completeSignatureOAuth).not.toHaveBeenCalled());
  });

  it("PSC simulado ligado na sessão: mostra o aviso", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(
      signer(undefined, { features: [ "clinical_record", "digital_signature", "signature_psc_mock" ] }));
    mocked(api.completeSignatureOAuth).mockResolvedValue(SESSION);
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    await screen.findByRole("status");
    expect(await screen.findByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("certificado vinculado do prestador simulado: mostra o aviso sem o interruptor", async () => {
    mocked(api.completeSignatureOAuth).mockResolvedValue(
      { purpose: "link", result: certificate({ provider: "simulated" }), return_to: "/signature" });
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("status")).textContent).toBe("Certificado PSC simulado vinculado, válido até 15/03/2027.");
    expect(screen.getByText(SIMULATED_NOTICE)).not.toBeNull();
  });

  it("caso normal: sem aviso de simulação", async () => {
    mocked(api.completeSignatureOAuth).mockResolvedValue({ purpose: "link", result: certificate(), return_to: "/signature" });
    renderWithProviders(<SignatureCallback params={OK} onDone={onDone} clearUrl={clearUrl} />);
    await screen.findByRole("status");
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
    expect(screen.queryByText(SIMULATED_NOTICE)).toBeNull();
  });
});
