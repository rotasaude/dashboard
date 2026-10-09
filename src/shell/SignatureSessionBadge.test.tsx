import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getSignatureSession: vi.fn(), openSignatureSession: vi.fn(), closeSignatureSession: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { SIMULATED_NOTICE } from "../lib/signature";
import { SignatureSessionBadge } from "./SignatureSessionBadge";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW19B, signer } from "../test/signatureFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("SignatureSessionBadge", () => {
  let redirect: ReturnType<typeof vi.fn>;
  let onSelect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: [ "Date", "setInterval", "clearInterval" ] });
    vi.setSystemTime(new Date(NOW19B));
    redirect = vi.fn();
    onSelect = vi.fn();
    mocked(api.fetchCurrentSession).mockResolvedValue(signer());
  });

  const renderIt = () =>
    renderWithProviders(<SignatureSessionBadge active="attendance" onSelect={onSelect} redirect={redirect} />);

  it("sessão ativa: diz até quando e encerra", async () => {
    mocked(api.getSignatureSession).mockResolvedValueOnce({ active: true, expires_at: "2026-10-08T22:00:00-03:00", provider: "vidaas" })
      .mockResolvedValue({ active: false });
    mocked(api.closeSignatureSession).mockResolvedValue(undefined);
    renderIt();
    const badge = await screen.findByLabelText("sessão de assinatura");
    expect(await within(badge).findByText("assinatura ativa até 22:00")).not.toBeNull();
    expect(within(badge).queryByText(SIMULATED_NOTICE)).toBeNull();
    fireEvent.click(within(badge).getByRole("button", { name: "encerrar" }));
    await waitFor(() => expect(api.closeSignatureSession).toHaveBeenCalledTimes(1));
    expect(await within(badge).findByText("sem sessão de assinatura")).not.toBeNull();
  });

  it("a sessão vence com a tela aberta: o selo muda sozinho", async () => {
    mocked(api.getSignatureSession).mockResolvedValue({ active: true, expires_at: "2026-10-08T10:30:00-03:00", provider: "vidaas" });
    renderIt();
    expect(await screen.findByText("assinatura ativa até 10:30")).not.toBeNull();
    act(() => { vi.advanceTimersByTime(31 * 60_000); });
    expect(await screen.findByText("sem sessão de assinatura")).not.toBeNull();
    expect(screen.getByRole("button", { name: "abrir sessão" })).not.toBeNull();
  });

  it("sem sessão: abre pelo prestador e volta para a tela atual", async () => {
    mocked(api.getSignatureSession).mockResolvedValue({ active: false });
    mocked(api.openSignatureSession).mockResolvedValue({ authorize_url: "https://psc.example/authorize?s=1" });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "abrir sessão" }));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://psc.example/authorize?s=1"));
    expect(api.openSignatureSession).toHaveBeenCalledWith("/attendance");
  });

  it("sem certificado vinculado: leva a Conta → Assinatura digital", async () => {
    mocked(api.getSignatureSession).mockResolvedValue({ active: false });
    mocked(api.openSignatureSession).mockRejectedValue(new ApiError(409, { error: "certificate_not_linked" }, "409"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "abrir sessão" }));
    await waitFor(() => expect(onSelect).toHaveBeenCalledWith("signature"));
    expect(redirect).not.toHaveBeenCalled();
  });

  it("prestador fora do ar: diz, sem sair da tela", async () => {
    mocked(api.getSignatureSession).mockResolvedValue({ active: false });
    mocked(api.openSignatureSession).mockRejectedValue(new ApiError(503, { error: "provider_unavailable" }, "503"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "abrir sessão" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o prestador não respondeu — tente de novo em alguns minutos");
  });

  it("prestador que deixou de existir (invalid_provider): diz com a frase própria", async () => {
    mocked(api.getSignatureSession).mockResolvedValue({ active: false });
    mocked(api.openSignatureSession).mockRejectedValue(new ApiError(422, { error: "invalid_provider" }, "422"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "abrir sessão" }));
    expect((await screen.findByRole("alert")).textContent)
      .toBe("o prestador do certificado não está mais disponível nesta cidade — vincule outro certificado");
    expect(redirect).not.toHaveBeenCalled();
  });

  it("cadastro sem CPF (professional_cpf_missing): diz a frase própria", async () => {
    mocked(api.getSignatureSession).mockResolvedValue({ active: false });
    mocked(api.openSignatureSession).mockRejectedValue(new ApiError(409, { error: "professional_cpf_missing" }, "409"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "abrir sessão" }));
    expect((await screen.findByRole("alert")).textContent).toBe("seu cadastro está sem CPF — procure a administração da cidade");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("quem não pode assinar não vê o selo nem chama o api", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(signer([ "citizen_verifier" ]));
    renderIt();
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
    expect(screen.queryByLabelText("sessão de assinatura")).toBeNull();
    expect(api.getSignatureSession).not.toHaveBeenCalled();
  });

  describe("aviso de PSC simulado", () => {
    it("sessão ativa com prestador simulado mostra o aviso", async () => {
      mocked(api.getSignatureSession).mockResolvedValue({ active: true, expires_at: "2026-10-08T22:00:00-03:00", provider: "simulated" });
      renderIt();
      const badge = await screen.findByLabelText("sessão de assinatura");
      expect(await within(badge).findByText("assinatura ativa até 22:00")).not.toBeNull();
      expect(within(badge).getByText(SIMULATED_NOTICE)).not.toBeNull();
    });

    it("sem sessão, com o interruptor signature_psc_mock na sessão, mostra o aviso", async () => {
      mocked(api.fetchCurrentSession).mockResolvedValue(signer([ "health_professional" ], {
        features: [ "clinical_record", "digital_signature", "signature_psc_mock" ]
      }));
      mocked(api.getSignatureSession).mockResolvedValue({ active: false });
      renderIt();
      const badge = await screen.findByLabelText("sessão de assinatura");
      expect(await within(badge).findByText("sem sessão de assinatura")).not.toBeNull();
      expect(within(badge).getByText(SIMULATED_NOTICE)).not.toBeNull();
    });

    it("caso normal: sem o aviso", async () => {
      mocked(api.getSignatureSession).mockResolvedValue({ active: false });
      renderIt();
      expect(await screen.findByText("sem sessão de assinatura")).not.toBeNull();
      expect(screen.queryByText(SIMULATED_NOTICE)).toBeNull();
    });
  });
});
