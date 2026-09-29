// src/modules/campaigns/CampaignPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), getCampaign: vi.fn(), getCampaignOptions: vi.fn(),
    unscheduleCampaign: vi.fn(), cancelCampaign: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError, type CampaignStats } from "../../lib/api";
import { CampaignPanel, SENDING_REFETCH_MS } from "./CampaignPanel";
import { OPTIONS, campaign, renderWithProviders, sessionWith } from "../../test/campaignFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const sms = (over: Partial<CampaignStats["sms"]> = {}): CampaignStats["sms"] => ({
  not_opted_in: 60, duplicate_phone: 2, pending: 0, deferred: 0, sent: 58, failed: 0, unavailable: 0, ...over
});
const sent = (over: Parameters<typeof campaign>[0] = {}) => campaign({
  status: "sent", dispatched_at: "2026-09-29T10:00:00-03:00", recipients_count: 120, phones_count: 98, sms_enabled: true,
  audience: { version: 1, geo: { scope: "neighborhoods", neighborhood_ids: [ "n1", "n2" ] },
    clinical: { all: [ { kind: "appointment_no_show", from: "2026-07-01", to: "2026-09-29" } ] } },
  stats: { read_count: 30, sms: sms() }, ...over
});

function renderPanel() {
  const onBack = vi.fn();
  const onEdit = vi.fn();
  renderWithProviders(<CampaignPanel campaignId="c1" onBack={onBack} onEdit={onEdit} onGoToSecurity={vi.fn()} />);
  return { onBack, onEdit };
}

describe("CampaignPanel", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "campaign_manager" ]));
    mocked(api.getCampaignOptions).mockResolvedValue(OPTIONS);
  });

  it("enviada: destinatários, telefones, lidos com percentual e o público em frase", async () => {
    mocked(api.getCampaign).mockResolvedValue(sent());
    renderPanel();
    const result = within(await screen.findByRole("region", { name: "Resultado" }));
    expect(result.getByText("120")).toBeTruthy();
    expect(result.getByText("98")).toBeTruthy();
    expect(result.getByText("30 (25%)")).toBeTruthy();
    expect(await screen.findByText(/moradores de Boqueirão e Xaxim que faltaram a um agendamento/)).toBeTruthy();
  });

  it("SMS por status, sem nenhuma lista de pessoas", async () => {
    mocked(api.getCampaign).mockResolvedValue(sent());
    renderPanel();
    const result = within(await screen.findByRole("region", { name: "Resultado" }));
    expect(result.getByText("enviado")).toBeTruthy();
    expect(result.getByText("58")).toBeTruthy();
    expect(result.getByText("sem opt-in de SMS")).toBeTruthy();
    // 7 status + o cabeçalho, e nenhum dado pessoal no painel.
    expect(result.getAllByRole("row").length).toBe(8);
    const text = document.body.textContent ?? "";
    expect(/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(text)).toBe(false);
    expect(/\(?\d{2}\)?\s?9?\d{4}-?\d{4}/.test(text)).toBe(false);
  });

  it("alerta destacado quando o SMS ficou sem provedor", async () => {
    mocked(api.getCampaign).mockResolvedValue(sent({ stats: { read_count: 0, sms: sms({ sent: 0, unavailable: 58 }) } }));
    renderPanel();
    const alerts = await screen.findAllByRole("alert");
    expect(alerts.some((a) => a.textContent?.startsWith("SMS não enviado: a plataforma ainda não tem provedor de SMS"))).toBe(true);
  });

  it("alerta quando algum SMS falhou", async () => {
    mocked(api.getCampaign).mockResolvedValue(sent({ stats: { read_count: 0, sms: sms({ failed: 3 }) } }));
    renderPanel();
    expect(await screen.findByText("3 SMS falharam no envio")).toBeTruthy();
  });

  it("SMS desligado no envio: diz isso e não mostra a tabela", async () => {
    mocked(api.getCampaign).mockResolvedValue(sent({ sms_enabled: false, stats: { read_count: 1, sms: sms({ sent: 0 }) } }));
    renderPanel();
    expect(await screen.findByText("SMS desligado nesta cidade no momento do envio: só o aviso no wpda.")).toBeTruthy();
    expect(screen.queryByText("sem opt-in de SMS")).toBeNull();
  });

  it("falhou: mostra o motivo", async () => {
    mocked(api.getCampaign).mockResolvedValue(campaign({ status: "failed", failure_reason: "below_minimum" }));
    renderPanel();
    expect(await screen.findByText("Não enviada: o público tinha menos de 5 telefones no momento do envio")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Resultado" })).toBeNull();
  });

  it("falhou com stats null: mostra o motivo e não quebra", async () => {
    mocked(api.getCampaign).mockResolvedValue(campaign({ status: "failed", failure_reason: "below_minimum", stats: null }));
    renderPanel();
    expect((await screen.findByText(/Não enviada: o público tinha menos de 5 telefones/)).getAttribute("role")).toBe("alert");
    expect(screen.queryByRole("region", { name: "Resultado" })).toBeNull();
  });

  it("enviando com stats null: nota, sem resultado nem zeros", async () => {
    mocked(api.getCampaign).mockResolvedValue(campaign({ status: "sending", stats: null }));
    renderPanel();
    expect(await screen.findByText("Os números aparecem quando o envio terminar.")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Resultado" })).toBeNull();
  });

  it("agendada: desagendar com step-up volta ao editor", async () => {
    mocked(api.getCampaign).mockResolvedValue(campaign({ status: "scheduled", send_at: "2026-09-30T12:00:00.000Z" }));
    mocked(api.unscheduleCampaign).mockResolvedValue(campaign({ status: "draft" }));
    const { onEdit } = renderPanel();
    expect(await screen.findByText(/agendada para 30\/09\/2026.*09:00/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Desagendar…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desagendar" }));
    await waitFor(() => expect(api.unscheduleCampaign).toHaveBeenCalledWith("c1"));
    expect(onEdit).toHaveBeenCalledWith("c1");
  });

  it("agendada: cancelar com step-up fica no painel, agora cancelada", async () => {
    mocked(api.getCampaign).mockResolvedValue(campaign({ status: "scheduled", send_at: "2026-09-30T12:00:00.000Z" }));
    mocked(api.cancelCampaign).mockResolvedValue(campaign({ status: "cancelled" }));
    const { onEdit } = renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar campanha…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar campanha" }));
    await waitFor(() => expect(api.cancelCampaign).toHaveBeenCalledWith("c1"));
    // A etiqueta de status e o subtítulo do painel dizem "cancelada".
    expect((await screen.findAllByText("cancelada")).length).toBe(2);
    expect(screen.queryByRole("button", { name: "Desagendar…" })).toBeNull();
    expect(onEdit).not.toHaveBeenCalled();
  });

  it("recusa invalid_transition aparece traduzida", async () => {
    mocked(api.getCampaign).mockResolvedValue(campaign({ status: "scheduled", send_at: "2026-09-30T12:00:00.000Z" }));
    mocked(api.unscheduleCampaign).mockRejectedValue(new ApiError(422, { error: "invalid_transition" }, "422"));
    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Desagendar…" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desagendar" }));
    expect(await screen.findByText("a campanha mudou de estado enquanto você decidia — volte à lista e abra de novo")).toBeTruthy();
  });

  it("enviando: relê sozinho até sair de 'enviando'", async () => {
    vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout", "setInterval", "clearInterval" ], shouldAdvanceTime: true });
    mocked(api.getCampaign).mockResolvedValueOnce(campaign({ status: "sending" })).mockResolvedValue(sent());
    renderPanel();
    expect(await screen.findByText("enviando")).toBeTruthy();
    await vi.advanceTimersByTimeAsync(SENDING_REFETCH_MS);
    expect(await screen.findByRole("region", { name: "Resultado" })).toBeTruthy();
  });
});
