import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), completeSncrOAuth: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { SncrCallback } from "./SncrCallback";
import { renderWithProviders } from "../test/campaignFixtures";
import { controlledUser } from "../test/controlledFixtures";
import { SNCR_SIMULATED_NOTICE, SNCR_STATE_STORAGE_KEY, SNCR_STOCK_KEY } from "../lib/controlled";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const BACK = { state: null, sessionId: "sid1", error: null };
const RECEIVED = { kind: "rce", received: 1000, batch_id: "b1", return_to: "/sncr" };

afterEach(() => { cleanup(); window.sessionStorage.clear(); });

describe("SncrCallback", () => {
  let onDone: ReturnType<typeof vi.fn>;
  let clearUrl: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.completeSncrOAuth).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser());
    window.sessionStorage.setItem(SNCR_STATE_STORAGE_KEY, "st1");
    onDone = vi.fn();
    clearUrl = vi.fn();
  });

  it("limpa a URL, usa o state guardado (e o apaga), diz quantos números chegaram, relê o estoque e volta à Conta → SNCR", async () => {
    mocked(api.completeSncrOAuth).mockResolvedValue(RECEIVED);
    const { client } = renderWithProviders(<SncrCallback params={BACK} onDone={onDone} clearUrl={clearUrl} />);
    const invalidate = vi.spyOn(client, "invalidateQueries");
    expect((await screen.findByRole("status")).textContent).toBe("1.000 números recebidos do SNCR para receita de controle especial (RCE).");
    expect(api.completeSncrOAuth).toHaveBeenCalledWith("st1", "sid1");
    expect(clearUrl.mock.invocationCallOrder[0]).toBeLessThan(mocked(api.completeSncrOAuth).mock.invocationCallOrder[0]);
    expect(window.sessionStorage.getItem(SNCR_STATE_STORAGE_KEY)).toBeNull();
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: [ SNCR_STOCK_KEY ] }));
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(onDone).toHaveBeenCalledWith("sncr");
  });

  it("state na URL vale sobre o guardado", async () => {
    mocked(api.completeSncrOAuth).mockResolvedValue(RECEIVED);
    renderWithProviders(<SncrCallback params={{ state: "url-st", sessionId: "sid1", error: null }} onDone={onDone} clearUrl={clearUrl} />);
    await screen.findByRole("status");
    expect(api.completeSncrOAuth).toHaveBeenCalledWith("url-st", "sid1");
    expect(window.sessionStorage.getItem(SNCR_STATE_STORAGE_KEY)).toBeNull();
  });

  it("StrictMode: troca o session_id uma vez só", async () => {
    mocked(api.completeSncrOAuth).mockResolvedValue(RECEIVED);
    renderWithProviders(<StrictMode><SncrCallback params={BACK} onDone={onDone} clearUrl={clearUrl} /></StrictMode>);
    await screen.findByRole("status");
    expect(api.completeSncrOAuth).toHaveBeenCalledTimes(1);
    expect(clearUrl).toHaveBeenCalledTimes(1);
  });

  it("session_id e state não vão ao console nem ao storage", async () => {
    const spies = [ "log", "info", "warn", "error", "debug" ].map((m) =>
      vi.spyOn(console, m as "log").mockImplementation(() => undefined));
    window.localStorage.clear();
    mocked(api.completeSncrOAuth).mockResolvedValue(RECEIVED);
    renderWithProviders(<SncrCallback params={{ state: null, sessionId: "SID-XYZ", error: null }} onDone={onDone} clearUrl={clearUrl} />);
    await screen.findByRole("status");
    const logged = spies.flatMap((s) => s.mock.calls.flat().map(String)).join(" ");
    expect(logged).not.toMatch(/SID-XYZ|st1/);
    const stored = [ window.localStorage, window.sessionStorage ]
      .flatMap((s) => Object.keys(s).map((k) => `${k}=${s.getItem(k)}`)).join(" ");
    expect(stored).not.toMatch(/SID-XYZ|st1/);
    spies.forEach((s) => s.mockRestore());
  });

  const FAILURES: Array<[ string, number, string, string ]> = [
    [ "autorização vencida", 409, "authorization_expired",
      "a autorização demorou demais e venceu — comece de novo; o pedido ao SNCR precisa sair em até 30 segundos" ],
    [ "SNCR esgotado", 503, "sncr_exhausted",
      "o SNCR está sem números para a sua UF agora — tente mais tarde; até lá, as receitas saem em papel" ],
    [ "state já usado", 422, "invalid_state", "este retorno do gov.br não vale mais (já usado ou vencido) — comece de novo" ],
    [ "SNCR fora do ar", 503, "sncr_unavailable", "o SNCR não respondeu — tente de novo em alguns minutos; nenhum número foi gasto" ],
    [ "inscrição não bate", 403, "registration_mismatch",
      "a conta gov.br usada não bate com a sua inscrição no conselho, ou você não tem cadastro de prescritor no SNCR — entre com a sua própria conta gov.br" ],
    [ "limite mensal", 409, "monthly_limit_reached", "você já fez os 3 pedidos deste mês para este tipo — o limite volta no mês que vem" ]
  ];

  it.each(FAILURES)("%s (%i %s): mostra a frase e volta à Conta → SNCR", async (_name, status, code, phrase) => {
    mocked(api.completeSncrOAuth).mockRejectedValue(new ApiError(status, { error: code, return_to: "/sncr" }, String(status)));
    renderWithProviders(<SncrCallback params={BACK} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent).toBe(phrase);
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Voltar a SNCR" }));
    expect(onDone).toHaveBeenCalledWith("sncr");
  });

  it("recusa no gov.br com state: avisa o api com o erro e diz que nada foi pedido", async () => {
    mocked(api.completeSncrOAuth).mockRejectedValue(new ApiError(403, { error: "authorization_denied", return_to: "/sncr" }, "403"));
    renderWithProviders(<SncrCallback params={{ state: null, sessionId: null, error: "access_denied" }} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent).toBe("a autorização foi negada no gov.br — nenhum número foi pedido");
    expect(api.completeSncrOAuth).toHaveBeenCalledWith("st1", { error: "access_denied" });
    fireEvent.click(screen.getByRole("button", { name: "Voltar a SNCR" }));
    expect(onDone).toHaveBeenCalledWith("sncr");
  });

  it("sem state (página de retorno recarregada, outra aba): nem chama o api", async () => {
    window.sessionStorage.clear();
    renderWithProviders(<SncrCallback params={BACK} onDone={onDone} clearUrl={clearUrl} />);
    expect((await screen.findByRole("alert")).textContent).toBe("o gov.br não concluiu a autorização — comece de novo");
    expect(api.completeSncrOAuth).not.toHaveBeenCalled();
    expect(clearUrl).toHaveBeenCalledTimes(1);
  });

  it("SNCR simulado: faixa sem validade no retorno", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(controlledUser([ "health_professional" ], {
      features: [ "clinical_documents", "controlled_prescriptions", "sncr_mock" ] }));
    mocked(api.completeSncrOAuth).mockResolvedValue(RECEIVED);
    renderWithProviders(<SncrCallback params={BACK} onDone={onDone} clearUrl={clearUrl} />);
    await screen.findByRole("status");
    expect(await screen.findByText(SNCR_SIMULATED_NOTICE)).not.toBeNull();
  });
});
