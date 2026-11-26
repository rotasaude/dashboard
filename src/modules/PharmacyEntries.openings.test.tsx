// src/modules/PharmacyEntries.openings.test.tsx — "Aberturas deste local" em "Entradas e abertura" (módulo 27b; Q13, F-20).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listMyPharmacyLocations: vi.fn(), searchPharmacyItems: vi.fn(), recordReceipt: vi.fn(), recordOpening: vi.fn(), listStockOpenings: vi.fn() }));
import * as api from "../lib/api";
import { PharmacyEntries } from "./PharmacyEntries";
import { renderWithProviders } from "../test/campaignFixtures";
import { AMOXI, CENTRAL, TODAY27, phUser, stockLot } from "../test/pharmacyFixtures";
import { opening } from "../test/bnafarFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("PharmacyEntries — aberturas do local", () => {
  beforeEach(() => {
    for (const fn of [ api.recordOpening, api.searchPharmacyItems, api.listStockOpenings ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL ]);
    mocked(api.searchPharmacyItems).mockResolvedValue([ AMOXI ]);
    mocked(api.recordOpening).mockResolvedValue({ id: "r2", location: CENTRAL, kind: "opening", items: [ { lot: stockLot(), quantity: "40" } ], at: "2026-10-29T09:00:00-03:00" });
  });

  it("a lista mostra a data, os itens e o autor; a da planilha e a desfeita têm a marca; carregar mais pelo cursor", async () => {
    mocked(api.listStockOpenings)
      .mockResolvedValueOnce({ items: [
        opening(),
        opening({ stock_entry_id: "se2", from_import: true, recorded_by: { name: "Rui Tavares" },
          lots: [ ...opening().lots, { ...opening().lots[0], stock_lot_id: "lt9", lot_number: "AMX2701" } ] }),
        opening({ stock_entry_id: "se3", from_import: true, reverted: true, recorded_by: { name: "—" } })
      ], next_before: "c3" })
      .mockResolvedValueOnce({ items: [ opening({ stock_entry_id: "se4", recorded_by: { name: "Bia Lopes" } }) ], next_before: null });
    renderWithProviders(<PharmacyEntries today={TODAY27} />);
    const table = await screen.findByRole("table", { name: "Aberturas deste local" });
    await within(table).findByText("Helena Prado");
    expect(mocked(api.listStockOpenings)).toHaveBeenCalledWith("l1", null);
    const rows = within(table).getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]).queryByText("importada pela planilha")).toBeNull();
    expect(within(rows[0]).queryByText("desfeita")).toBeNull();
    expect(within(rows[0]).getByText("1")).not.toBeNull();
    expect(within(rows[1]).getByText("Rui Tavares")).not.toBeNull();
    expect(within(rows[1]).getByText("2")).not.toBeNull();
    expect(within(rows[1]).getByText("importada pela planilha")).not.toBeNull();
    expect(within(rows[1]).queryByText("desfeita")).toBeNull();
    expect(within(rows[2]).getByText("desfeita")).not.toBeNull();
    expect(within(rows[2]).getByText("—")).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Carregar mais aberturas" }));
    await within(table).findByText("Bia Lopes");
    expect(mocked(api.listStockOpenings)).toHaveBeenLastCalledWith("l1", "c3");
    expect(screen.queryByRole("button", { name: "Carregar mais aberturas" })).toBeNull();
  });

  it("sem aberturas: a frase de vazio", async () => {
    mocked(api.listStockOpenings).mockResolvedValue({ items: [], next_before: null });
    renderWithProviders(<PharmacyEntries today={TODAY27} />);
    expect(await screen.findByText("nenhuma abertura registrada neste local")).not.toBeNull();
  });

  it("registrar uma abertura relê o painel", async () => {
    mocked(api.listStockOpenings).mockResolvedValue({ items: [], next_before: null });
    renderWithProviders(<PharmacyEntries today={TODAY27} />);
    await screen.findByText("nenhuma abertura registrada neste local");
    expect(mocked(api.listStockOpenings)).toHaveBeenCalledTimes(1);
    mocked(api.listStockOpenings).mockResolvedValue({ items: [ opening() ], next_before: null });
    fireEvent.click(screen.getByLabelText("Inventário de abertura"));
    text("Buscar medicamento", "amox");
    fireEvent.click(await screen.findByRole("button", { name: "Amoxicilina 500 mg cápsula · cápsula" }));
    text("Lote", "AMX2611"); text("Validade", "2026-11-20"); text("Quantidade (cápsula)", "40");
    fireEvent.click(screen.getByRole("button", { name: "Registrar abertura" }));
    expect((await screen.findByRole("status")).textContent).toBe("Abertura registrada: 1 lote.");
    await waitFor(() => expect(mocked(api.listStockOpenings)).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Helena Prado")).not.toBeNull();
  });
});
