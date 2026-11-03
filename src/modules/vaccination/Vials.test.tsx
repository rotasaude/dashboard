// src/modules/vaccination/Vials.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../../test/campaignFixtures";
import { BCG_ITEM, CATALOG29, COLD_CENTRAL, LEAD_ROOM, NOW29, ROOM, TODAY29, monthly, vacLotBalance, vacPosition, vacUser, vial } from "../../test/vaccinationFixtures";
import * as api from "../../lib/api";
import { VialsPanel } from "./VialsPanel";
import { VaccinationSummary } from "../VaccinationSummary";

vi.mock("../../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listMyVaccineLocations: vi.fn(),
  getVaccinationCatalog: vi.fn(), listVials: vi.fn(), openVial: vi.fn(), closeOutVial: vi.fn(), listPositions: vi.fn(), getMonthlySummary: vi.fn() }));
beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
  vi.mocked(api.getVaccinationCatalog).mockResolvedValue(CATALOG29);
  vi.mocked(api.listVials).mockResolvedValue([ vial(), vial({ id: "v2", expires_at: "2026-11-02T09:00:00-03:00", status: "expired" }) ]);
  vi.mocked(api.listPositions).mockResolvedValue({ positions: [ vacPosition({ item: BCG_ITEM, lots: [ vacLotBalance({ lot: { ...vacLotBalance().lot, id: "lot15",
    item: BCG_ITEM, lot_number: "BCG2610" } }) ] }) ], next_before: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("frascos (F-29.5)", () => {
  it("tempo restante e doses; vacinador não descarta", async () => {
    renderWithProviders(<VialsPanel room={ROOM} now={NOW29} lead={false} />);
    expect(await screen.findByText("vence em 4 h 0 min")).not.toBeNull();
    expect(screen.getByText("restam 7 de 10 doses")).not.toBeNull();
    expect(screen.getAllByText("vencido").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /^Descartar/ })).toBeNull();
  });

  it("responsável descarta com motivo e confirmação; relê", async () => {
    vi.mocked(api.closeOutVial).mockResolvedValue(vial({ status: "closed_out" }));
    renderWithProviders(<VialsPanel room={LEAD_ROOM} now={NOW29} lead />);
    fireEvent.click((await screen.findAllByRole("button", { name: "Descartar — BCG2610" }))[0]);
    fireEvent.change(screen.getByLabelText("Motivo do descarte"), { target: { value: "caiu" } });
    fireEvent.click(screen.getByRole("button", { name: "Descartar frasco" }));
    expect(screen.getByText("o motivo precisa ter de 10 a 500 caracteres")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo do descarte"), { target: { value: "frasco caiu e trincou" } });
    fireEvent.click(screen.getByRole("button", { name: "Descartar frasco" }));
    fireEvent.click(screen.getByRole("button", { name: "Sim, descartar" }));
    await waitFor(() => expect(api.closeOutVial).toHaveBeenCalledWith("v1", "frasco caiu e trincou"));
    await waitFor(() => expect(api.listVials).toHaveBeenCalledTimes(2));
    const ok = await screen.findByRole("status");
    expect(document.activeElement).toBe(ok);
    expect(ok.textContent).toContain("Frasco descartado");
  });

  it("abre frasco do lote multidose disponível e diz a recusa de lote bloqueado", async () => {
    vi.mocked(api.listVials).mockResolvedValue([]);
    vi.mocked(api.openVial).mockRejectedValueOnce(new api.ApiError(422, { problems: [ { path: "lot_id", error: "lot_blocked" } ] }, "x"));
    vi.mocked(api.openVial).mockResolvedValueOnce(vial());
    renderWithProviders(<VialsPanel room={ROOM} now={NOW29} lead={false} />);
    await screen.findByRole("option", { name: /BCG2610/ });
    fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "lot15" } });
    fireEvent.click(screen.getByRole("button", { name: "Abrir frasco" }));
    await waitFor(() => expect(api.openVial).toHaveBeenCalledWith("r1", "lot15"));
    expect((await screen.findByRole("alert")).textContent).toContain("bloqueado");
    fireEvent.click(screen.getByRole("button", { name: "Abrir frasco" }));
    expect((await screen.findByRole("status")).textContent).toContain("Frasco aberto");
  });
});

describe("resumo mensal (F-29.5)", () => {
  it("sala e rede de frio; mês futuro recusado; colunas do SIES", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM, { ...COLD_CENTRAL, roles: [ "stock_keeper" ] } ]);
    vi.mocked(api.getMonthlySummary).mockResolvedValue(monthly());
    renderWithProviders(<VaccinationSummary today={TODAY29} />);
    fireEvent.change(await screen.findByLabelText("Mês"), { target: { value: "2026-12" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver resumo" }));
    expect(screen.getByText("o mês não pode ser futuro")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "2026-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver resumo" }));
    await waitFor(() => expect(api.getMonthlySummary).toHaveBeenCalledWith({ roomId: "r1" }, "2026-10"));
    const table = await screen.findByRole("region", { name: "Movimentação do mês" });
    expect(within(table).getByText("BCG2610")).not.toBeNull();
    expect(within(table).getByText("Frasco quebrado: 10")).not.toBeNull();
    expect(within(table).getByText("Total")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "l9" } });
    fireEvent.change(await screen.findByLabelText("Mês"), { target: { value: "2026-10" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver resumo" }));
    await waitFor(() => expect(api.getMonthlySummary).toHaveBeenLastCalledWith({ central: true }, "2026-10"));
  });

  it("código de perda desconhecido aparece cru; mês inválido do api vira frase", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
    vi.mocked(api.getMonthlySummary).mockResolvedValue(monthly({ rows: [ { ...monthly().rows[0], physical_loss: { mystery: 4 } } ] }));
    renderWithProviders(<VaccinationSummary today={TODAY29} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver resumo" }));
    expect(await screen.findByText("mystery: 4")).not.toBeNull();
  });
});
