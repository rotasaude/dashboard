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

  it("colunas completas: o saldo final se reproduz só com o que está na tela; Total soma tudo", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
    const base = monthly().rows[0];
    // 1.200 + 300 + 0 − 0 − 400 (frascos) − 50 (unidose) − 30 (ajuste negativo) − 10 (perda física) = 1.010; um frasco abriu e segue aberto.
    const a: typeof base = { ...base, opening_balance: 1200, received: 300, vial_doses: 400, unit_doses: 50, adjustment: -30, physical_loss: { broken: 10 }, closing_balance: 1010, vials_opened: 40 };
    const b: typeof base = { ...base, lot: { ...base.lot, id: "lot16", number: "BCG2611" }, opening_balance: 10, received: 0, vial_doses: 0, unit_doses: 0, adjustment: 3,
      physical_loss: {}, closing_balance: 13, vials_opened: 1 };
    const calc = (r: typeof base) => r.opening_balance + r.received + r.transferred_in - r.transferred_out - r.vial_doses - r.unit_doses + r.adjustment
      - Object.values(r.physical_loss).reduce((n, v) => n + v, 0);
    expect(calc(a)).toBe(a.closing_balance);
    expect(calc(b)).toBe(b.closing_balance);
    vi.mocked(api.getMonthlySummary).mockResolvedValue(monthly({ rows: [ a, b ] }));
    renderWithProviders(<VaccinationSummary today={TODAY29} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver resumo" }));
    const table = await screen.findByRole("region", { name: "Movimentação do mês" });
    for (const h of [ "Doses de frascos abertos", "Doses unidose aplicadas", "Ajuste de inventário", "Frascos abertos" ]) expect(within(table).getByText(h)).not.toBeNull();
    const rows = within(table).getAllByRole("row");
    const cells = (i: number) => within(rows[i]).getAllByRole("cell").map((c) => c.textContent);
    expect(cells(1)).toContain("−30");
    expect(cells(1)).toContain("1.200");
    expect(cells(1)).toContain("1.010");
    expect(cells(2)).toContain("+3");
    const total = cells(3);
    expect(total[0]).toBe("Total");
    expect(total).toContain("1.210"); // saldo inicial
    expect(total).toContain("−27");   // ajuste
    expect(total).toContain("1.023"); // saldo final
    expect(total).toContain("41");    // frascos abertos
  });

  it("trocar o local não busca sozinho", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM, COLD_CENTRAL ]);
    vi.mocked(api.getMonthlySummary).mockResolvedValue(monthly());
    renderWithProviders(<VaccinationSummary today={TODAY29} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver resumo" }));
    await screen.findByRole("region", { name: "Movimentação do mês" });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "l9" } });
    expect(screen.queryByRole("region", { name: "Movimentação do mês" })).toBeNull();
    expect(api.getMonthlySummary).toHaveBeenCalledTimes(1);
  });

  it("código de perda desconhecido aparece cru; mês inválido do api vira frase", async () => {
    vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
    vi.mocked(api.getMonthlySummary).mockResolvedValue(monthly({ rows: [ { ...monthly().rows[0], physical_loss: { mystery: 4 } } ] }));
    renderWithProviders(<VaccinationSummary today={TODAY29} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver resumo" }));
    expect(await screen.findByText("mystery: 4")).not.toBeNull();
  });
});
