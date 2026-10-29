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
const EXPIRING = position({ lots: [
  lotBalance(),
  lotBalance({ lot: stockLot({ id: "lot0", lot_number: "AMX2609", expires_on: "2026-09-30" }), balance: "4", expiring_soon: false, expired: true }),
  lotBalance({ lot: stockLot({ id: "lot7", lot_number: "AMX2801", expires_on: "2028-01-31" }), balance: "99", expiring_soon: false, expired: false }),
  lotBalance({ lot: stockLot({ id: "lot8", lot_number: "AMX2610", expires_on: "2026-11-05" }), balance: "0", expiring_soon: true, expired: false })
] });

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
    expect(within(expiring.getByRole("row", { name: /AMX2611/ })).queryByText("vencido")).toBeNull();
    // ruling 1: lote que não vence (flags falsos) e lote sem saldo não entram na lista.
    expect(expiring.queryByText(/AMX2801/)).toBeNull();
    expect(expiring.queryByText(/AMX2610/)).toBeNull();
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
    // as contagens são do local, mesmo com "Todos os locais" marcado (D15): nenhuma leitura sem local.
    expect(mocked(api.getPharmacyAlerts).mock.calls.every((c) => c[0] === "l1")).toBe(true);
    expect(mocked(api.getPharmacyAlerts)).not.toHaveBeenCalledWith(null);
    expect(mocked(api.getPharmacyAlerts)).not.toHaveBeenCalledWith(undefined);
  });

  it("\"Todos os locais\" só para o almoxarife do central no próprio local", async () => {
    // pharmacist numa unidade
    const first = renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    expect(await screen.findByText("Vencendo: 2")).not.toBeNull();
    expect(screen.queryByLabelText("Todos os locais")).toBeNull();
    first.unmount(); cleanup();
    // stock_keeper olhando um local alheio (roles: [])
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...CENTRAL, roles: [] } ]);
    const second = renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    expect(await screen.findByText("Vencendo: 2")).not.toBeNull();
    expect(screen.queryByLabelText("Todos os locais")).toBeNull();
    second.unmount(); cleanup();
    // stock_keeper numa unidade (não central)
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [ "stock_keeper" ] } ]);
    renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    expect(await screen.findByText("Vencendo: 2")).not.toBeNull();
    expect(screen.queryByLabelText("Todos os locais")).toBeNull();
  });

  it("api sem os campos por lote: mostra todos os lotes e a data decide o \"vencido\"", async () => {
    const bare = (l: ReturnType<typeof lotBalance>) => { const { expiring_soon, expired, ...rest } = l; void expiring_soon; void expired; return rest; };
    mocked(api.listPositions).mockImplementation((q: { expiring?: boolean }) => Promise.resolve({ positions: [ q.expiring
      ? position({ lots: [ bare(lotBalance()), bare(lotBalance({ lot: stockLot({ id: "lot0", lot_number: "AMX2609", expires_on: "2026-09-30" }), balance: "4" })) ] })
      : position() ], next_before: null }));
    renderWithProviders(<PharmacyAlerts today={TODAY27} />);
    const expiring = within(await screen.findByRole("region", { name: "Vencendo e vencidos" }));
    expect(await expiring.findByRole("row", { name: /AMX2611/ })).not.toBeNull();
    expect(within(expiring.getByRole("row", { name: /AMX2609/ })).getByText("vencido")).not.toBeNull();
    expect(within(expiring.getByRole("row", { name: /AMX2611/ })).queryByText("vencido")).toBeNull();
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
