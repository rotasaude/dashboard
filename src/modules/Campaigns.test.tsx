import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), listCampaigns: vi.fn(), getSmsSetting: vi.fn(),
    getCampaignOptions: vi.fn(), getCampaign: vi.fn(), previewAudience: vi.fn()
  };
});

import * as api from "../lib/api";
import { Campaigns } from "./Campaigns";
import { sendLabel } from "./campaigns/CampaignList";
import { OPTIONS, campaign, renderWithProviders, sessionWith } from "../test/campaignFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const draft = campaign({ id: "c1", title: "Rascunho da gripe" });
const scheduled = campaign({ id: "c2", title: "Agendada", status: "scheduled", send_at: "2026-09-30T12:00:00.000Z" });
const sent = campaign({ id: "c3", title: "Enviada", status: "sent", dispatched_at: "2026-09-28T13:00:00.000Z",
  recipients_count: 1234, phones_count: 1000, sms_enabled: false,
  stats: { read_count: 10, sms: { not_opted_in: 1234, duplicate_phone: 0, pending: 0, deferred: 0, sent: 0, failed: 0, unavailable: 0 } } });

function renderAs(roles: string[]) {
  mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith(roles));
  const onNavigate = vi.fn();
  renderWithProviders(<Campaigns onNavigate={onNavigate} />);
  return { onNavigate };
}

describe("Campaigns", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocked(api.listCampaigns).mockResolvedValue([ draft, scheduled, sent ]);
    mocked(api.getSmsSetting).mockResolvedValue({ enabled: false, gateway_configured: false });
    mocked(api.getCampaignOptions).mockResolvedValue(OPTIONS);
    mocked(api.previewAudience).mockResolvedValue({ citizens: 12, phones: 9 });
  });

  it("gestor vê a lista com status, envio e destinatários, sem a chave de SMS", async () => {
    renderAs([ "campaign_manager" ]);
    const list = within(await screen.findByRole("region", { name: "Lista" }));
    expect(await list.findByText("Rascunho da gripe")).toBeTruthy();
    expect(list.getByText("rascunho")).toBeTruthy();
    expect(list.getByText(/agendada para 30\/09\/2026.*09:00/)).toBeTruthy();
    expect(list.getByText("1.234")).toBeTruthy();
    expect(screen.queryByRole("region", { name: "SMS das campanhas" })).toBeNull();
  });

  it("municipal_admin sem o papel: só a chave de SMS, e nunca pede a lista", async () => {
    renderAs([ "municipal_admin" ]);
    expect(await screen.findByRole("region", { name: "SMS das campanhas" })).toBeTruthy();
    expect(screen.getByText(/Criar e enviar campanhas é do papel gestor de campanhas/)).toBeTruthy();
    expect(screen.queryByRole("region", { name: "Lista" })).toBeNull();
    expect(api.listCampaigns).not.toHaveBeenCalled();
  });

  it("com os dois papéis: chave e lista", async () => {
    renderAs([ "municipal_admin", "campaign_manager" ]);
    expect(await screen.findByRole("region", { name: "SMS das campanhas" })).toBeTruthy();
    expect(await screen.findByRole("region", { name: "Lista" })).toBeTruthy();
  });

  it("'Nova campanha' abre o editor, e 'Voltar à lista' volta", async () => {
    renderAs([ "campaign_manager" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Nova campanha" }));
    expect(await screen.findByRole("region", { name: "Nova campanha" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar à lista" }));
    expect(await screen.findByRole("region", { name: "Lista" })).toBeTruthy();
  });

  it("rascunho abre no editor; enviada abre no painel", async () => {
    mocked(api.getCampaign).mockImplementation(async (id: string) => (id === "c1" ? draft : sent));
    renderAs([ "campaign_manager" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rascunho da gripe" }));
    expect(((await screen.findByLabelText("Título")) as HTMLInputElement).value).toBe("Rascunho da gripe");

    fireEvent.click(screen.getByRole("button", { name: "Voltar à lista" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Enviada" }));
    expect(await screen.findByRole("region", { name: "Resultado" })).toBeTruthy();
  });

  it("sendLabel", () => {
    expect(sendLabel(draft)).toBe("—");
    expect(sendLabel(sent)).toMatch(/28\/09\/2026.*10:00/);
  });
});
