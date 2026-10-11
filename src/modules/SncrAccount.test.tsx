// src/modules/SncrAccount.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getSncrStock: vi.fn(), requestSncrNumbers: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { SncrAccount } from "./SncrAccount";
import { renderWithProviders } from "../test/campaignFixtures";
import { controlledUser, stock } from "../test/controlledFixtures";
import { SNCR_SIMULATED_NOTICE, SNCR_STATE_STORAGE_KEY } from "../lib/controlled";
import { CONTROLLED_DISABLED } from "../lib/clinicalDocuments";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const RCE = "Receita de controle especial (RCE)";
const RET = "Receita de antimicrobiano (RET)";

afterEach(cleanup);

describe("SncrAccount", () => {
  let redirect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    redirect = vi.fn();
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser());
    mocked(api.getSncrStock).mockResolvedValue(stock());
  });

  it("saldo por tipo, pedidos do mês e saldo baixo", async () => {
    renderWithProviders(<SncrAccount redirect={redirect} />);
    const rce = await screen.findByRole("region", { name: RCE });
    expect(within(rce).getByText("812")).not.toBeNull();
    expect(within(rce).getByText("1 de 3")).not.toBeNull();
    expect(within(rce).queryByRole("status")).toBeNull();
    const ret = screen.getByRole("region", { name: RET });
    expect(within(ret).getByText("40")).not.toBeNull();
    expect(within(ret).getByRole("status").textContent).toBe("saldo baixo: menos de 50 números — obtenha mais antes que acabe");
    expect(document.body.textContent).not.toMatch(/undefined|null|Numeração simulada/);
  });

  it("Obter números do SNCR guarda o state e vai ao login da Anvisa com kind e return_to", async () => {
    window.sessionStorage.clear();
    mocked(api.requestSncrNumbers).mockResolvedValue({ authorize_url: "https://sncr-auth.example.br/auth/login?client_url=x", state: "st9" });
    renderWithProviders(<SncrAccount redirect={redirect} />);
    fireEvent.click(await screen.findByRole("button", { name: `Obter números do SNCR: ${RET}` }));
    await waitFor(() => expect(redirect).toHaveBeenCalledWith("https://sncr-auth.example.br/auth/login?client_url=x"));
    expect(api.requestSncrNumbers).toHaveBeenCalledWith("ret", "/sncr");
    expect(window.sessionStorage.getItem(SNCR_STATE_STORAGE_KEY)).toBe("st9");
    window.sessionStorage.clear();
  });

  it("sem números: diz que sai em papel; com 3 pedidos no mês, sem botão", async () => {
    mocked(api.getSncrStock).mockResolvedValue(stock({ rce: { free: 0, used: 3000, voided: 0, requests_this_month: 3 } }));
    renderWithProviders(<SncrAccount redirect={redirect} />);
    const rce = await screen.findByRole("region", { name: RCE });
    expect(within(rce).getByRole("status").textContent).toBe("sem números: as receitas de controle especial saem em papel");
    expect(within(rce).queryByRole("button")).toBeNull();
    expect(within(rce).getByText("limite de 3 pedidos por mês atingido — o próximo pedido fica para o mês que vem")).not.toBeNull();
  });

  it("limite do mês alcançado noutra aba (409): diz e relê o saldo", async () => {
    mocked(api.requestSncrNumbers).mockRejectedValue(new ApiError(409, { error: "monthly_limit_reached" }, "409"));
    renderWithProviders(<SncrAccount redirect={redirect} />);
    fireEvent.click(await screen.findByRole("button", { name: `Obter números do SNCR: ${RCE}` }));
    expect((await screen.findByRole("alert")).textContent).toBe("você já fez os 3 pedidos deste mês para este tipo — o limite volta no mês que vem");
    await waitFor(() => expect(api.getSncrStock).toHaveBeenCalledTimes(2));
    expect(redirect).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: `Obter números do SNCR: ${RCE}` }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("enfermeira (403 cbo_not_allowed): diz quem pede", async () => {
    mocked(api.getSncrStock).mockRejectedValue(new ApiError(403, { error: "cbo_not_allowed" }, "403"));
    renderWithProviders(<SncrAccount redirect={redirect} />);
    expect((await screen.findByRole("alert")).textContent).toBe("só médicos e dentistas pedem números do SNCR e prescrevem controlado");
  });

  it("SNCR simulado: faixa sem validade", async () => {
    mocked(api.getSncrStock).mockResolvedValue(stock({ simulated: true }));
    renderWithProviders(<SncrAccount redirect={redirect} />);
    expect(await screen.findByText(SNCR_SIMULATED_NOTICE)).not.toBeNull();
  });

  it("interruptor desligado: diz, sem consultar", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser([ "health_professional" ], { features: [ "clinical_documents" ] }));
    renderWithProviders(<SncrAccount redirect={redirect} />);
    expect(await screen.findByText(CONTROLLED_DISABLED)).not.toBeNull();
    expect(api.getSncrStock).not.toHaveBeenCalled();
  });

  it("dois cliques em Obter números → um só requestSncrNumbers", async () => {
    window.sessionStorage.clear();
    mocked(api.requestSncrNumbers).mockResolvedValue({ authorize_url: "https://sncr-auth.example.br/x", state: "st1" });
    renderWithProviders(<SncrAccount redirect={redirect} />);
    const button = await screen.findByRole("button", { name: `Obter números do SNCR: ${RCE}` });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(redirect).toHaveBeenCalledTimes(1));
    expect(api.requestSncrNumbers).toHaveBeenCalledTimes(1);
    window.sessionStorage.clear();
  });

  it("SNCR fora do ar (503): diz, não guarda state e religa o botão", async () => {
    window.sessionStorage.clear();
    mocked(api.requestSncrNumbers).mockRejectedValue(new ApiError(503, { error: "sncr_unavailable" }, "503"));
    renderWithProviders(<SncrAccount redirect={redirect} />);
    fireEvent.click(await screen.findByRole("button", { name: `Obter números do SNCR: ${RCE}` }));
    expect((await screen.findByRole("alert")).textContent).toBe("o SNCR não respondeu — tente de novo em alguns minutos; nenhum número foi gasto");
    expect(redirect).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(SNCR_STATE_STORAGE_KEY)).toBeNull();
    expect((screen.getByRole("button", { name: `Obter números do SNCR: ${RCE}` }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("pedido inválido (422 invalid_content): diz", async () => {
    mocked(api.requestSncrNumbers).mockRejectedValue(new ApiError(422, { error: "invalid_content", field: "kind" }, "422"));
    renderWithProviders(<SncrAccount redirect={redirect} />);
    fireEvent.click(await screen.findByRole("button", { name: `Obter números do SNCR: ${RCE}` }));
    expect((await screen.findByRole("alert")).textContent).toBe("pedido inválido — recarregue a página e tente de novo");
  });
});
