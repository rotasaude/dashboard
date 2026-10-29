import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listAdminLocations: vi.fn(), createAdminLocation: vi.fn(), updateAdminLocation: vi.fn(), addLocationStaff: vi.fn(), removeLocationStaff: vi.fn(),
  getPharmacySettings: vi.fn(), updatePharmacySettings: vi.fn(), listAllUnits: vi.fn(), listMemberships: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { PharmacyAdmin } from "./PharmacyAdmin";
import { renderWithProviders } from "../test/campaignFixtures";
import { adminLocation, phSettings, phUser } from "../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("PharmacyAdmin", () => {
  beforeEach(() => {
    for (const fn of [ api.createAdminLocation, api.updateAdminLocation, api.addLocationStaff, api.removeLocationStaff, api.updatePharmacySettings ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "municipal_admin" ]));
    mocked(api.listAdminLocations).mockResolvedValue([ adminLocation(), adminLocation({ id: "l1", name: "Almoxarifado Central", kind: "central", health_unit: null, staff: [] }) ]);
    mocked(api.listAllUnits).mockResolvedValue([ { id: "u1", name: "UBS Centro", kind: "ubs", active: true }, { id: "u3", name: "UBS Norte", kind: "ubs", active: true } ]);
    mocked(api.listMemberships).mockResolvedValue([
      { id: "m1", user: { id: "u-9", email_address: "marta@curitiba.demo" }, role: "pharmacist", granted_at: "2026-10-01T00:00:00Z" },
      { id: "m2", user: { id: "u-7", email_address: "paulo@curitiba.demo" }, role: "stock_keeper", granted_at: "2026-10-01T00:00:00Z" },
      { id: "m3", user: { id: "u-5", email_address: "ana@curitiba.demo" }, role: "pharmacist", granted_at: "2026-10-01T00:00:00Z" } ]);
    mocked(api.getPharmacySettings).mockResolvedValue(phSettings());
    mocked(api.createAdminLocation).mockResolvedValue(adminLocation({ id: "l3", name: "Farmácia UBS Norte", health_unit: { id: "u3", name: "UBS Norte" }, staff: [] }));
    mocked(api.updatePharmacySettings).mockResolvedValue(phSettings({ continuous_interval_days: 28 }));
  });

  it("locais: tipo, unidade, situação e equipe", async () => {
    renderWithProviders(<PharmacyAdmin />);
    const row = await screen.findByRole("row", { name: /Farmácia UBS Centro/ });
    expect(row.textContent).toContain("Farmácia da unidade");
    expect(row.textContent).toContain("UBS Centro");
    expect(row.textContent).toContain("ativo");
    expect(row.textContent).toContain("1 pessoa");
    const central = screen.getByRole("row", { name: /Almoxarifado Central/ });
    expect(central.textContent).toContain("Almoxarifado central");
    expect(central.textContent).toContain("ninguém");
  });

  it("novo local: unidade exigida na farmácia da unidade; step-up e o corpo", async () => {
    renderWithProviders(<PharmacyAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo local" }));
    text("Tipo", "unit"); text("Nome", "Farmácia UBS Norte");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("escolha a unidade de saúde da farmácia");
    text("Unidade de saúde", "u3");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar local" }));
    await waitFor(() => expect(mocked(api.createAdminLocation)).toHaveBeenCalledWith({ kind: "unit", health_unit_id: "u3", name: "Farmácia UBS Norte", active: true }));
  });

  it("novo local: nome curto recusado; almoxarifado central não pede unidade nem leva health_unit_id", async () => {
    renderWithProviders(<PharmacyAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo local" }));
    expect(screen.getByText("O tipo não muda depois de criado.")).not.toBeNull();
    text("Tipo", "central"); text("Nome", "Ab");
    expect(screen.queryByLabelText("Unidade de saúde")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("o nome do local tem de 3 a 120 caracteres");
    expect(mocked(api.createAdminLocation)).not.toHaveBeenCalled();
    text("Nome", "Almoxarifado Sul");
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar local" }));
    await waitFor(() => expect(mocked(api.createAdminLocation)).toHaveBeenCalledWith({ kind: "central", name: "Almoxarifado Sul", active: true }));
    expect(mocked(api.createAdminLocation).mock.calls[0][0]).not.toHaveProperty("health_unit_id");
  });

  it("editar: o tipo não muda; a recusa do api aparece junto do formulário", async () => {
    mocked(api.updateAdminLocation).mockRejectedValue(new ApiError(409, { error: "location_has_stock" }, "409"));
    renderWithProviders(<PharmacyAdmin />);
    const row = await screen.findByRole("row", { name: /Farmácia UBS Centro/ });
    fireEvent.click(within(row).getByRole("button", { name: "Editar" }));
    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).disabled).toBe(true);
    expect((screen.getByLabelText("Tipo") as HTMLSelectElement).value).toBe("unit");
    expect((screen.getByLabelText("Unidade de saúde") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText("O tipo e a unidade não mudam depois de criado.")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Ativo"));
    fireEvent.click(screen.getByRole("button", { name: "Revisar" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar local" }));
    expect(await screen.findByText("o local ainda tem saldo — transfira ou ajuste antes de desativar")).not.toBeNull();
    expect(mocked(api.updateAdminLocation)).toHaveBeenCalledWith("l2", { kind: "unit", health_unit_id: "u1", name: "Farmácia UBS Centro", active: false });
  });

  it("equipe: só quem tem o papel; farmacêutico sem CBO 2234 recusado com a frase", async () => {
    mocked(api.addLocationStaff).mockRejectedValue(new ApiError(422, { error: "cbo_not_allowed" }, "422"));
    renderWithProviders(<PharmacyAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Equipe de Farmácia UBS Centro" }));
    const panel = within(await screen.findByRole("region", { name: "Equipe de Farmácia UBS Centro" }));
    expect(panel.getByText(/Marta Souza/)).not.toBeNull();
    text("Papel no local", "stock_keeper");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toContain("paulo@curitiba.demo");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).not.toContain("marta@curitiba.demo");
    // Marta já é farmacêutica deste local: não se oferece de novo; Ana, que tem o papel e ainda não está no local, sim.
    text("Papel no local", "pharmacist");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).not.toContain("marta@curitiba.demo");
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toContain("ana@curitiba.demo");
    text("Pessoa", "u-5");
    fireEvent.click(panel.getByRole("button", { name: "Vincular" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar vínculo" }));
    expect((await screen.findByText("farmacêutico precisa de vínculo profissional com CBO 2234"))).not.toBeNull();
    expect(mocked(api.addLocationStaff)).toHaveBeenCalledWith("l2", "u-5", "pharmacist");
  });

  it("equipe: vincular sem escolher recusa; sem nome, o e-mail; desvincular com step-up", async () => {
    mocked(api.listAdminLocations).mockResolvedValue([ adminLocation({ staff: [ { user_id: "u-7", name: null, role: "stock_keeper" } ] }) ]);
    mocked(api.removeLocationStaff).mockResolvedValue(undefined);
    renderWithProviders(<PharmacyAdmin />);
    fireEvent.click(await screen.findByRole("button", { name: "Equipe de Farmácia UBS Centro" }));
    const panel = within(await screen.findByRole("region", { name: "Equipe de Farmácia UBS Centro" }));
    expect(panel.getByText("paulo@curitiba.demo")).not.toBeNull();
    fireEvent.click(panel.getByRole("button", { name: "Vincular" }));
    expect((await screen.findByRole("alert")).textContent).toBe("escolha o papel no local");
    fireEvent.click(panel.getByRole("button", { name: "Desvincular paulo@curitiba.demo" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar desvínculo" }));
    await waitFor(() => expect(mocked(api.removeLocationStaff)).toHaveBeenCalledWith("l2", "u-7", "stock_keeper"));
    expect(mocked(api.addLocationStaff)).not.toHaveBeenCalled();
  });

  it("configurações: faixas conferidas antes; corpo com números depois do step-up", async () => {
    renderWithProviders(<PharmacyAdmin />);
    await screen.findByDisplayValue("25");
    text("Intervalo do uso contínuo (dias)", "91");
    fireEvent.click(screen.getByRole("button", { name: "Revisar configurações" }));
    expect((await screen.findByRole("alert")).textContent).toBe("intervalo do uso contínuo de 1 a 90 dias");
    text("Intervalo do uso contínuo (dias)", "28");
    fireEvent.click(screen.getByRole("button", { name: "Revisar configurações" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar configurações" }));
    await waitFor(() => expect(mocked(api.updatePharmacySettings)).toHaveBeenCalledWith(phSettings({ continuous_interval_days: 28 })));
    expect(typeof mocked(api.updatePharmacySettings).mock.calls[0][0].continuous_interval_days).toBe("number");
  });

  it("configurações: as outras quatro faixas, uma por vez", async () => {
    renderWithProviders(<PharmacyAdmin />);
    await screen.findByDisplayValue("25");
    const cases: [ string, string, string ][] = [
      [ "Validade da receita comum (dias)", "0", "validade da receita comum de 1 a 365 dias" ],
      [ "Validade da receita de uso contínuo (dias)", "366", "validade da receita de uso contínuo de 1 a 365 dias" ],
      [ "Alerta de validade (dias)", "0", "alerta de validade de 1 a 365 dias" ],
      [ "Limite do ajuste sem aprovação (%)", "101", "limite do ajuste: número inteiro de 0 a 100" ] ];
    for (const [ label, bad, phrase ] of cases) {
      const before = (screen.getByLabelText(label) as HTMLInputElement).value;
      text(label, bad);
      fireEvent.click(screen.getByRole("button", { name: "Revisar configurações" }));
      expect((await screen.findByRole("alert")).textContent).toBe(phrase);
      text(label, before);
    }
    expect(mocked(api.updatePharmacySettings)).not.toHaveBeenCalled();
  });

  it("sem ser administrador, nada é lido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listAdminLocations).mockClear(); mocked(api.getPharmacySettings).mockClear();
    renderWithProviders(<PharmacyAdmin />);
    expect(await screen.findByText(/papel|permiss/i)).not.toBeNull();
    expect(mocked(api.listAdminLocations)).not.toHaveBeenCalled();
    expect(mocked(api.getPharmacySettings)).not.toHaveBeenCalled();
  });
});
