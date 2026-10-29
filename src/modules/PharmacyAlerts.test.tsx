import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listMyPharmacyLocations: vi.fn(), getPharmacyAlerts: vi.fn(), listPositions: vi.fn() }));
import * as api from "../lib/api";
import { PharmacyAlerts } from "./PharmacyAlerts";
import { PHARMACY_ALERTS_REFRESH_MS } from "../lib/pharmacy";
import { renderWithProviders } from "../test/campaignFixtures";
import { AMOXI, CENTRAL, CLONA, TODAY27, UBS_FARM, lotBalance, phAlerts, phUser, position, stockLot } from "../test/pharmacyFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const EXPIRING = position({ lots: [ lotBalance(), lotBalance({ lot: stockLot({ id: "lot0", lot_number: "AMX2609", expires_on: "2026-09-30" }), balance: "4" }) ] });

describe("PharmacyAlerts", () => {
  beforeEach(() => {
    mocked(api.getPharmacyAlerts).mockReset().mockResolvedValue(phAlerts());
    mocked(api.listPositions).mockReset().mockImplementation((q: { expiring?: boolean }) =>
      Promise.resolve({ positions: [ q.expiring ? EXPIRING : position() ], next_before: null }));
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
  });

  it("as cinco contagens relidas a cada minuto (sem trilha); as listas leem ao abrir e não releem", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    for (const t of [ "Vencendo: 2", "Vencidos: 1", "Abaixo do mínimo: 1", "Em trânsito: 1", "Ajustes aguardando aprovação: 1" ]) {
      expect(await screen.findByText(t)).not.toBeNull();
    }
    const expiring = within(await screen.findByRole("region", { name: "Vencendo e vencidos" }));
    expect((await expiring.findByRole("row", { name: /AMX2611 · Amoxicilina 500 mg cápsula/ })).textContent).toContain("20/11/2026");
    expect(within(expiring.getByRole("row", { name: /AMX2609/ })).getByText("vencido")).not.toBeNull();
    expect(within(await screen.findByRole("region", { name: "Abaixo do mínimo" })).getByText("30 cápsula (mínimo 50)")).not.toBeNull();
    expect(mocked(api.getPharmacyAlerts)).toHaveBeenCalledWith("l2");
    expect(mocked(api.listPositions)).toHaveBeenCalledWith({ locationId: "l2", expiring: true });
    expect(mocked(api.listPositions)).toHaveBeenCalledWith({ locationId: "l2", belowMinimum: true });
    const reads = mocked(api.listPositions).mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(PHARMACY_ALERTS_REFRESH_MS); });
    await waitFor(() => expect(mocked(api.getPharmacyAlerts)).toHaveBeenCalledTimes(2));
    expect(mocked(api.listPositions).mock.calls.length).toBe(reads);
  });

  it("central: as listas de todos os locais; as contagens, do central", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL ]);
    renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    fireEvent.click(await screen.findByLabelText("Todos os locais"));
    await waitFor(() => expect(mocked(api.listPositions)).toHaveBeenLastCalledWith({ locationId: null, belowMinimum: true }));
    expect(mocked(api.listPositions)).toHaveBeenCalledWith({ locationId: null, expiring: true });
    expect(mocked(api.getPharmacyAlerts)).toHaveBeenCalledWith("l1");
  });

  it("emenda H10: a ordem das listas segue o nome do item, e a unidade é a de dispensação", async () => {
    const zeta = position({ item: { ...AMOXI, catalog_item_id: "ci9", name: "Zidovudina 300 mg comprimido", dispensing_unit: "comprimido" }, balance: "3", minimum: "10" });
    const alfa = position({ item: CLONA, balance: "7", minimum: "20" });
    mocked(api.listPositions).mockImplementation((q: { belowMinimum?: boolean }) =>
      Promise.resolve({ positions: q.belowMinimum ? [ zeta, alfa ] : [], next_before: null }));
    renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    const below = within(await screen.findByRole("region", { name: "Abaixo do mínimo" }));
    const rows = await below.findAllByRole("row");
    const body = rows.filter((r) => /mínimo \d/.test(r.textContent ?? ""));
    expect(body.map((r) => /Clonazepam|Zidovudina/.exec(r.textContent ?? "")?.[0])).toEqual([ "Clonazepam", "Zidovudina" ]);
    expect(below.getByText("7 comprimido (mínimo 20)")).not.toBeNull();
    expect(within(screen.getByRole("region", { name: "Vencendo e vencidos" })).getByText("nada aqui")).not.toBeNull();
  });

  it("lista cortada na primeira página aponta para Posição e extrato; sem next_before, não", async () => {
    mocked(api.listPositions).mockImplementation((q: { expiring?: boolean }) =>
      Promise.resolve({ positions: [ position() ], next_before: q.expiring ? "cur1" : null }));
    renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    const expiring = within(await screen.findByRole("region", { name: "Vencendo e vencidos" }));
    const link = await expiring.findByRole("link", { name: "Ver na posição" });
    expect(link.getAttribute("href")).toBe("#/pharmacy-stock");
    expect(within(screen.getByRole("region", { name: "Abaixo do mínimo" })).queryByRole("link", { name: "Ver na posição" })).toBeNull();
  });

  it("os atalhos de ação só aparecem onde há papel no local (almoxarife do central vê o local alheio sem eles)", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [] } ]);
    renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    expect(await screen.findByText("Em trânsito: 1")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "Transferências" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Inventário e ajustes" })).toBeNull();
    expect(mocked(api.getPharmacyAlerts)).toHaveBeenCalledWith("l2");
  });

  it("com papel no local, as contagens de trânsito e de ajustes apontam para as telas", async () => {
    renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    expect((await screen.findByRole("link", { name: "Transferências" })).getAttribute("href")).toBe("#/pharmacy-transfers");
    expect(screen.getByRole("link", { name: "Inventário e ajustes" }).getAttribute("href")).toBe("#/pharmacy-adjustments");
  });

  it("recusa do api numa lista aparece na lista; as contagens seguem", async () => {
    mocked(api.listPositions).mockRejectedValue(new api.ApiError(500, null, "boom"));
    renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    expect(await screen.findByText("Vencendo: 2")).not.toBeNull();
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Abaixo do mínimo" })).getByRole("alert")).not.toBeNull());
  });
});
