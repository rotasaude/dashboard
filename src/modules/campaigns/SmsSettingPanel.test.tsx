// src/modules/campaigns/SmsSettingPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getSmsSetting: vi.fn(), setSmsSetting: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { GATEWAY_WARNING, SmsSettingPanel } from "./SmsSettingPanel";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const renderIt = () => renderWithProviders(<SmsSettingPanel onGoToSecurity={vi.fn()} />);
const panel = () => within(screen.getByRole("region", { name: "SMS das campanhas" }));

describe("SmsSettingPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ]));
  });

  it("desligado, com provedor: sem aviso", async () => {
    mocked(api.getSmsSetting).mockResolvedValue({ enabled: false, gateway_configured: true });
    renderIt();
    expect(await screen.findByRole("button", { name: "Ligar SMS" })).toBeTruthy();
    expect(panel().getByText("desligado")).toBeTruthy();
    expect(screen.queryByText(GATEWAY_WARNING)).toBeNull();
  });

  it("sem provedor na plataforma: aviso literal da spec", async () => {
    mocked(api.getSmsSetting).mockResolvedValue({ enabled: false, gateway_configured: false });
    renderIt();
    expect((await screen.findByText(GATEWAY_WARNING)).getAttribute("role")).toBe("note");
    expect(GATEWAY_WARNING).toBe("A plataforma ainda não tem provedor de SMS: os avisos saem, o SMS fica pendente como não enviado");
  });

  it("ligar com step-up: grava, mostra ligado e mantém o aviso de provedor", async () => {
    mocked(api.getSmsSetting).mockResolvedValue({ enabled: false, gateway_configured: false });
    mocked(api.setSmsSetting).mockResolvedValue({ enabled: true, gateway_configured: false });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Ligar SMS" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ligar" }));

    await waitFor(() => expect(api.setSmsSetting).toHaveBeenCalledWith(true));
    expect((await screen.findByText("SMS ligado")).getAttribute("role")).toBe("status");
    expect(panel().getByText("ligado")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Desligar SMS" })).toBeTruthy();
    expect(screen.getByText(GATEWAY_WARNING)).toBeTruthy();
  });

  it("janela fechada: pede o código", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ], { mfa_verified_at: null }));
    mocked(api.getSmsSetting).mockResolvedValue({ enabled: true, gateway_configured: true });
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
    mocked(api.setSmsSetting).mockResolvedValue({ enabled: false, gateway_configured: true });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Desligar SMS" }));
    fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Desligar" }));

    await waitFor(() => expect(api.setSmsSetting).toHaveBeenCalledWith(false));
    expect(api.stepUpMfa).toHaveBeenCalledWith("654321");
  });

  it("403: seu papel não permite", async () => {
    mocked(api.getSmsSetting).mockResolvedValue({ enabled: false, gateway_configured: true });
    mocked(api.setSmsSetting).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "403"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Ligar SMS" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ligar" }));
    expect(await screen.findByText("seu papel não permite esta ação")).toBeTruthy();
  });

  it("409 city_profile_missing: mostra a mensagem traduzida", async () => {
    mocked(api.getSmsSetting).mockResolvedValue({ enabled: false, gateway_configured: true });
    mocked(api.setSmsSetting).mockRejectedValue(new ApiError(409, { error: "city_profile_missing" }, "409"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Ligar SMS" }));
    fireEvent.click(await screen.findByRole("button", { name: "Ligar" }));
    expect(await screen.findByText("a cidade ainda não tem perfil configurado; fale com o suporte")).toBeTruthy();
    expect(screen.queryByText("a API recusou a ação")).toBeNull();
  });

  it("falha ao ler a chave", async () => {
    mocked(api.getSmsSetting).mockRejectedValue(new ApiError(500, "boom", "500"));
    renderIt();
    expect(await screen.findByText("não foi possível concluir — tente de novo")).toBeTruthy();
  });
});
