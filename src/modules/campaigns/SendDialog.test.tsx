// src/modules/campaigns/SendDialog.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), sendCampaign: vi.fn(), scheduleCampaign: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { SendDialog, channelsText } from "./SendDialog";
import { campaign, renderWithProviders, sessionWith } from "../../test/campaignFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const PHRASE = "moradores de Boqueirão que faltaram a um agendamento entre 01/07/2026 e 29/09/2026";

function renderDialog(smsEnabled: boolean | null = true) {
  const handlers = { onDone: vi.fn(), onBelowMinimum: vi.fn(), onInvalidAudience: vi.fn(), onCancel: vi.fn(), onGoToSecurity: vi.fn() };
  renderWithProviders(<SendDialog campaign={campaign()} phrase={PHRASE} counts={{ citizens: 12, phones: 9 }}
    smsEnabled={smsEnabled} {...handlers} />);
  return handlers;
}

function chooseSchedule(value: string) {
  fireEvent.click(screen.getByRole("radio", { name: "Agendar para" }));
  fireEvent.change(screen.getByLabelText("Data e hora (horário da cidade)"), { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("SendDialog", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-09-29T10:00:00-03:00"));
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "campaign_manager" ]));
  });

  it("agora: mostra o público em frase, a contagem e os canais; confirma e devolve a campanha", async () => {
    const sent = campaign({ status: "sending" });
    mocked(api.sendCampaign).mockResolvedValue(sent);
    const { onDone } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));

    // O botão só aparece depois que a sessão carregou; antes disso a mesma
    // região mostra "exige um autenticador cadastrado".
    const confirmButton = await screen.findByRole("button", { name: "Enviar agora" });
    const confirm = screen.getByRole("region", { name: "Enviar campanha" });
    expect(confirm.textContent).toContain(PHRASE);
    expect(confirm.textContent).toContain("≈ 12 pessoas (9 telefones)");
    expect(confirm.textContent).toContain("aviso no wpda + SMS para quem aceitou receber (o SMS só sai entre 8h e 20h)");
    fireEvent.click(confirmButton);

    await waitFor(() => expect(api.sendCampaign).toHaveBeenCalledWith("c1"));
    expect(onDone).toHaveBeenCalledWith(sent);
  });

  it("janela de verificação fechada: pede o código antes de enviar", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "campaign_manager" ], { mfa_verified_at: null }));
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
    mocked(api.sendCampaign).mockResolvedValue(campaign({ status: "sending" }));
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.change(await screen.findByLabelText("Código do autenticador"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar agora" }));

    await waitFor(() => expect(api.sendCampaign).toHaveBeenCalled());
    expect(api.stepUpMfa).toHaveBeenCalledWith("123456");
  });

  it("agendar: recusa horário a menos de 5 minutos, sem chamar a API", () => {
    renderDialog();
    chooseSchedule("2026-09-29T10:03");
    expect(screen.getByRole("alert").textContent).toBe("agende para pelo menos 5 minutos a partir de agora");
    expect(screen.queryByRole("region", { name: "Agendar campanha" })).toBeNull();
  });

  it("agendar: manda o instante lido no fuso da cidade", async () => {
    const scheduled = campaign({ status: "scheduled", send_at: "2026-09-29T17:30:00.000Z" });
    mocked(api.scheduleCampaign).mockResolvedValue(scheduled);
    const { onDone } = renderDialog();
    chooseSchedule("2026-09-29T14:30");

    const confirmButton = await screen.findByRole("button", { name: "Agendar" });
    expect(screen.getByRole("region", { name: "Agendar campanha" }).textContent).toMatch(/29\/09\/2026.*14:30/);
    fireEvent.click(confirmButton);
    await waitFor(() => expect(api.scheduleCampaign).toHaveBeenCalledWith("c1", "2026-09-29T17:30:00.000Z"));
    expect(onDone).toHaveBeenCalledWith(scheduled);
  });

  it("servidor recusa invalid_send_at: mensagem traduzida e o diálogo continua", async () => {
    mocked(api.scheduleCampaign).mockRejectedValue(new ApiError(422, { error: "invalid_send_at" }, "422"));
    const { onDone } = renderDialog();
    chooseSchedule("2026-09-29T10:06");
    fireEvent.click(await screen.findByRole("button", { name: "Agendar" }));

    expect(await screen.findByText("horário fora da janela: agende de 5 minutos a 90 dias a partir de agora")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Agendar campanha" })).toBeTruthy();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("invalid_send_at: 'Mudar horário' volta à escolha, e o novo horário é o que vai", async () => {
    mocked(api.scheduleCampaign).mockRejectedValueOnce(new ApiError(422, { error: "invalid_send_at" }, "422"))
      .mockResolvedValue(campaign({ status: "scheduled" }));
    renderDialog();
    chooseSchedule("2026-09-29T10:06");
    fireEvent.click(await screen.findByRole("button", { name: "Agendar" }));
    await screen.findByText("horário fora da janela: agende de 5 minutos a 90 dias a partir de agora");

    fireEvent.click(screen.getByRole("button", { name: "Mudar horário" }));
    expect(screen.getByRole("dialog", { name: "Como enviar" })).toBeTruthy();
    chooseSchedule("2026-09-29T14:30");
    fireEvent.click(await screen.findByRole("button", { name: "Agendar" }));
    await waitFor(() => expect(api.scheduleCampaign).toHaveBeenLastCalledWith("c1", "2026-09-29T17:30:00.000Z"));
  });

  it("below_minimum: devolve ao editor, sem chamar onDone", async () => {
    mocked(api.sendCampaign).mockRejectedValue(new ApiError(422, { error: "below_minimum" }, "422"));
    const { onDone, onBelowMinimum } = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Enviar agora" }));

    await waitFor(() => expect(onBelowMinimum).toHaveBeenCalled());
    expect(onDone).not.toHaveBeenCalled();
  });

  it("canais", () => {
    expect(channelsText(false)).toBe("aviso no wpda (SMS desligado nesta cidade)");
    expect(channelsText(null)).toBe("aviso no wpda (não foi possível consultar o SMS da cidade)");
  });

  it("Esc e Cancelar fecham", () => {
    const { onCancel } = renderDialog();
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Como enviar" }), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(onCancel).toHaveBeenCalledTimes(2);
  });
});
