// src/modules/vaccination/EsaviPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { TODAY29, immunization, vacDashboard, vacUser } from "../../test/vaccinationFixtures";
import * as api from "../../lib/api";
import { EsaviButton } from "./EsaviButton";
import { VaccinationPanel } from "../VaccinationPanel";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), notifyEsavi: vi.fn(),
  getNotification: vi.fn(), getVaccinationDashboard: vi.fn(), listAllUnits: vi.fn() }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("ESAVI (F-29.8)", () => {
  // Chaves: um beforeEach que devolve o mock o faria ser chamado como limpeza (chamada fantasma sem argumentos).
  beforeEach(() => { vi.mocked(api.notifyEsavi).mockResolvedValue({ notification_id: "n9" }); });

  it("sem a vigilância ligada, nada é oferecido", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
    renderWithProviders(<EsaviButton imm={immunization()} />);
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Notificar ESAVI/ })).toBeNull();
  });

  it("vacinador: dois passos, uma chamada, frase e dica", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser([ "health_professional" ], { features: [ "clinical_record", "vaccination", "surveillance" ] }));
    renderWithProviders(<EsaviButton imm={immunization()} roomId="r1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Notificar ESAVI — Penta (DTP/HepB/Hib) 1ª dose" }));
    expect(api.notifyEsavi).not.toHaveBeenCalled();
    const yes = screen.getByRole("button", { name: "Sim, abrir a notificação" });
    fireEvent.click(yes); fireEvent.click(yes);
    await waitFor(() => expect(api.notifyEsavi).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Notificação de ESAVI aberta na vigilância, presa a esta dose.")).not.toBeNull();
    expect(screen.getByText("A equipe da vigilância completa a ficha e envia ao e-SUS Notifica.")).not.toBeNull();
    expect(api.getNotification).not.toHaveBeenCalled();
  });

  it("papel surveillance: abre a notificação; já notificada abre a existente", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser([ "health_professional", "surveillance" ], { features: [ "clinical_record", "vaccination", "surveillance" ] }));
    vi.mocked(api.notifyEsavi).mockRejectedValue(new api.ApiError(409, { error: "already_notified", notification_id: "n3" }, "409"));
    renderWithProviders(<EsaviButton imm={immunization()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Notificar ESAVI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, abrir a notificação" }));
    expect(await screen.findByText("esta dose já tem notificação de ESAVI aberta")).not.toBeNull();
    await waitFor(() => expect(api.getNotification).toHaveBeenCalledWith("n3"));
  });
});

describe("painel de vacinação (F-29.8)", () => {
  it("só contagens; mês e unidade na URL; cobertura com vírgula", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser([ "analyst" ]));
    vi.mocked(api.listAllUnits).mockResolvedValue([ { id: "u1", name: "UBS Centro", active: true } ] as never);
    vi.mocked(api.getVaccinationDashboard).mockResolvedValue(vacDashboard({ c2_coverage_by_team: [
      { team: { id: "t1", name: "eSF Centro 1" }, eligible: 40, complete: 30 }, { team: { id: "t2", name: "eSF Norte" }, eligible: 0, complete: 0 } ] }));
    renderWithProviders(<VaccinationPanel today={TODAY29} />);
    fireEvent.change(await screen.findByLabelText("Unidade"), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver painel" }));
    await waitFor(() => expect(api.getVaccinationDashboard).toHaveBeenCalledWith({ month: "2026-11", healthUnitId: "u1" }));
    expect(await screen.findByText("Fora do prazo de 24 h")).not.toBeNull();
    const c2 = screen.getByRole("region", { name: "Cobertura das vacinas do C2 por equipe" });
    expect(within(c2).getByText("75,0%")).not.toBeNull();
    expect(within(c2).getByText("—")).not.toBeNull();
    expect(api.getVaccinationDashboard).toHaveBeenCalledTimes(1);
  });
});

describe("ESAVI e painel: formas reais do api", () => {
  const sv = () => vacUser([ "health_professional", "surveillance" ], { features: [ "clinical_record", "vaccination", "surveillance" ] });

  it("200 existing: abre a mesma notificação e diz que já existia", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(sv());
    vi.mocked(api.notifyEsavi).mockResolvedValue({ notification_id: "n4", existing: true });
    renderWithProviders(<EsaviButton imm={immunization()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Notificar ESAVI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, abrir a notificação" }));
    expect(await screen.findByText("esta dose já tem notificação de ESAVI aberta")).not.toBeNull();
    await waitFor(() => expect(api.getNotification).toHaveBeenCalledWith("n4"));
  });

  it("403 feature_disabled da vigilância e dose cancelada", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(sv());
    vi.mocked(api.notifyEsavi).mockRejectedValue(new api.ApiError(403, { error: "feature_disabled", feature: "surveillance" }, "403"));
    renderWithProviders(<EsaviButton imm={immunization()} />);
    fireEvent.click(await screen.findByRole("button", { name: /^Notificar ESAVI/ }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, abrir a notificação" }));
    expect(await screen.findByText("a vigilância está desligada nesta cidade — notifique o ESAVI pelo e-SUS Notifica")).not.toBeNull();
  });

  it("dose cancelada não oferece o botão", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(sv());
    renderWithProviders(<EsaviButton imm={immunization({ status: "cancelled" })} />);
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Notificar ESAVI/ })).toBeNull();
  });

  it("painel: contagem suprimida vira 'menos de 5', aviso de atraso e escopo das cadernetas", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser([ "municipal_admin" ]));
    vi.mocked(api.listAllUnits).mockResolvedValue([ { id: "u1", name: "UBS Centro", active: true } ] as never);
    vi.mocked(api.getVaccinationDashboard).mockResolvedValue(vacDashboard({
      doses_by_immunobiological: [ { immunobiological: { code: "42", name: "Penta" }, room: { id: "r1", name: "Sala 1" }, count: null } ],
      c2_coverage_by_team: [ { team: { id: "t1", name: "eSF Sul" }, eligible: null, complete: null } ] }));
    renderWithProviders(<VaccinationPanel today={TODAY29} />);
    fireEvent.change(await screen.findByLabelText("Unidade"), { target: { value: "u1" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver painel" }));
    expect(await screen.findByText(/Há doses fora do prazo de 24 h/)).not.toBeNull();
    expect(screen.getAllByText("menos de 5").length).toBe(2);
    expect(screen.getAllByText(/vale para a cidade toda/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/NaN/)).toBeNull();
  });
});
