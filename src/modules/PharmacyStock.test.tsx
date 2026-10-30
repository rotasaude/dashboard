// src/modules/PharmacyStock.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listMyPharmacyLocations: vi.fn(), listPositions: vi.fn(), listLotMovements: vi.fn(), getMinimums: vi.fn(), putMinimums: vi.fn(), searchPharmacyItems: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { PharmacyStock } from "./PharmacyStock";
import { renderWithProviders } from "../test/campaignFixtures";
import { AMOXI, CENTRAL, CLONA, UBS_FARM, lotBalance, phUser, position, stockLot } from "../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("PharmacyStock", () => {
  beforeEach(() => {
    for (const fn of [ api.listPositions, api.listLotMovements, api.getMinimums, api.putMinimums, api.searchPharmacyItems ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist", "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [ "pharmacist", "stock_keeper" ] } ]);
    mocked(api.listPositions).mockResolvedValue({ positions: [ position() ], next_before: null });
    mocked(api.listLotMovements).mockResolvedValue({ movements: [
      { id: "m2", kind: "dispensing", quantity: "-21.00", document: { type: "dispensation", id: "dp1", number: null },
        by: { name: "Marta Souza" }, at: "2026-10-29T10:15:00-03:00" },
      { id: "m1", kind: "transfer_in", quantity: "51.00", document: { type: "transfer", id: "t1", number: null },
        by: { name: "Marta Souza" }, at: "2026-10-28T15:00:00-03:00" } ], next_before: null });
    mocked(api.getMinimums).mockResolvedValue([ { catalog_item_id: "ci1", minimum: "50", item: AMOXI } ]);
    mocked(api.putMinimums).mockResolvedValue([ { catalog_item_id: "ci1", minimum: "60.5", item: AMOXI } ]);
  });

  it("posição do local: saldo, mínimo e marcas; filtros na URL sem dado pessoal", async () => {
    renderWithProviders(<PharmacyStock />);
    const row = await screen.findByRole("row", { name: /Amoxicilina 500 mg cápsula/ });
    expect(row.textContent).toContain("30 cápsula");
    expect(within(row).getByText("abaixo do mínimo")).not.toBeNull();
    expect(within(row).getByText("vencendo")).not.toBeNull();
    expect(mocked(api.listPositions)).toHaveBeenLastCalledWith({ locationId: "l2", q: null, expiring: undefined, belowMinimum: undefined, before: null });
    fireEvent.change(screen.getByLabelText("Medicamento"), { target: { value: "amox" } });
    fireEvent.click(screen.getByLabelText("Abaixo do mínimo"));
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(mocked(api.listPositions)).toHaveBeenLastCalledWith({ locationId: "l2", q: "amox", expiring: undefined, belowMinimum: true, before: null }));
  });

  it("central: todos os locais sem location_id", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL ]);
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    renderWithProviders(<PharmacyStock />);
    fireEvent.click(await screen.findByLabelText("Todos os locais"));
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(mocked(api.listPositions)).toHaveBeenLastCalledWith({ locationId: null, q: null, expiring: undefined, belowMinimum: undefined, before: null }));
  });

  it("extrato do lote: movimentos com sinal e documento; dispensação sem nome de paciente", async () => {
    renderWithProviders(<PharmacyStock />);
    fireEvent.click(await screen.findByRole("button", { name: "Lotes de Amoxicilina 500 mg cápsula" }));
    fireEvent.click(await screen.findByRole("button", { name: "Extrato do lote AMX2611" }));
    const table = within(await screen.findByRole("region", { name: "Extrato do lote AMX2611" }));
    expect((await table.findByRole("row", { name: /dispensação/ })).textContent).toContain("-21");
    expect(table.getByRole("row", { name: /entrada por transferência/ }).textContent).toContain("+51");
    expect(mocked(api.listLotMovements)).toHaveBeenCalledWith("lot1", "l2", null);
    expect(document.body.textContent).not.toMatch(/Joana/);
  });

  it("mínimos: a lista inteira, vírgula e zero aceito", async () => {
    renderWithProviders(<PharmacyStock />);
    const input = await screen.findByLabelText("Mínimo de Amoxicilina 500 mg cápsula (cápsula)");
    fireEvent.change(input, { target: { value: "60.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar mínimos" }));
    expect((await screen.findByRole("alert")).textContent).toContain("use vírgula");
    fireEvent.change(input, { target: { value: "60,5" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar mínimos" }));
    await waitFor(() => expect(mocked(api.putMinimums)).toHaveBeenCalledWith("l2", [ { catalog_item_id: "ci1", minimum: "60.5" } ]));
    expect((await screen.findByRole("status")).textContent).toBe("Mínimos salvos.");
  });

  // ── Casos acrescentados pelas emendas e pela auto-revisão ──
  it("emendas: a página é ordenada pelo nome do item (o api ordena por id); a unidade é a de dispensação, nunca a concentração", async () => {
    mocked(api.listPositions).mockResolvedValue({ positions: [
      position({ item: CLONA, lots: [], balance: "12.5", minimum: null, below_minimum: false, expiring_soon: false }), position()
    ], next_before: null });
    renderWithProviders(<PharmacyStock />);
    await screen.findByRole("row", { name: /Amoxicilina/ });
    const names = screen.getAllByRole("row").slice(1).map((r) => r.textContent ?? "");
    expect(names[0]).toContain("Amoxicilina");
    expect(names[1]).toContain("Clonazepam");
    expect(names[1]).toContain("12,5 comprimido");
    expect(names[1]).not.toMatch(/\bmg\b.*\bmg\b/);
    expect(screen.queryByText(/12,5 mg/)).toBeNull();
  });

  it("consulta: o almoxarife do central abre a posição de local alheio (roles vazio), sem painel de mínimos", async () => {
    const alheio = { ...UBS_FARM, roles: [] as string[] };
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL, alheio ]);
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    renderWithProviders(<PharmacyStock />);
    const select = await screen.findByLabelText("Local");
    expect(await screen.findByLabelText("Mínimo de Amoxicilina 500 mg cápsula (cápsula)")).not.toBeNull();
    expect(screen.getByLabelText("Todos os locais")).not.toBeNull();
    fireEvent.change(select, { target: { value: alheio.id } });
    await waitFor(() => expect(mocked(api.listPositions)).toHaveBeenLastCalledWith(expect.objectContaining({ locationId: alheio.id })));
    expect(screen.queryByRole("button", { name: "Salvar mínimos" })).toBeNull();
    expect(screen.queryByLabelText("Todos os locais")).toBeNull();
    expect(screen.queryByLabelText("Mínimo de Amoxicilina 500 mg cápsula (cápsula)")).toBeNull();
    expect(mocked(api.getMinimums)).not.toHaveBeenCalledWith(alheio.id);
  });

  it("farmacêutico sem almoxarife: vê a posição mas não o painel de mínimos nem 'Todos os locais'", async () => {
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    renderWithProviders(<PharmacyStock />);
    await screen.findByRole("row", { name: /Amoxicilina 500 mg cápsula/ });
    expect(screen.queryByRole("button", { name: "Salvar mínimos" })).toBeNull();
    expect(screen.queryByLabelText("Todos os locais")).toBeNull();
    expect(mocked(api.getMinimums)).not.toHaveBeenCalled();
  });

  it("'Vencendo' vai como true só quando marcado; medicamento com 1 letra não lê", async () => {
    renderWithProviders(<PharmacyStock />);
    await screen.findByRole("row", { name: /Amoxicilina/ });
    const calls = mocked(api.listPositions).mock.calls.length;
    fireEvent.change(screen.getByLabelText("Medicamento"), { target: { value: "a" } });
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    expect((await screen.findByRole("alert")).textContent).toBe("digite ao menos 2 letras do medicamento");
    expect(mocked(api.listPositions)).toHaveBeenCalledTimes(calls);
    fireEvent.change(screen.getByLabelText("Medicamento"), { target: { value: "" } });
    fireEvent.click(screen.getByLabelText("Vencendo"));
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(mocked(api.listPositions)).toHaveBeenLastCalledWith({ locationId: "l2", q: null, expiring: true, belowMinimum: undefined, before: null }));
  });

  it("o campo digitado não lê sozinho; 'Carregar mais' segue o cursor do api", async () => {
    mocked(api.listPositions)
      .mockResolvedValueOnce({ positions: [ position() ], next_before: "c1" })
      .mockResolvedValueOnce({ positions: [ position({ item: CLONA, lots: [], balance: "3", minimum: null, below_minimum: false, expiring_soon: false }) ], next_before: null });
    renderWithProviders(<PharmacyStock />);
    await screen.findByRole("row", { name: /Amoxicilina/ });
    fireEvent.change(screen.getByLabelText("Medicamento"), { target: { value: "clona" } });
    expect(mocked(api.listPositions)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("row", { name: /Clonazepam/ })).not.toBeNull();
    expect(mocked(api.listPositions)).toHaveBeenLastCalledWith(expect.objectContaining({ before: "c1" }));
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("extrato mostra o motivo quando houver; 'Carregar mais' do extrato usa o cursor", async () => {
    mocked(api.listLotMovements)
      .mockResolvedValueOnce({ movements: [ { id: "m3", kind: "loss", quantity: "-2.00", document: null, reason: "Frasco quebrado", by: { name: "Marta Souza" }, at: "2026-10-29T11:00:00-03:00" } ], next_before: "m3" })
      .mockResolvedValueOnce({ movements: [ { id: "m4", kind: "receipt", quantity: "100.00", document: { type: "invoice", id: "n1", number: "NF 1234" }, by: { name: null }, at: "2026-10-01T08:00:00-03:00" } ], next_before: null });
    renderWithProviders(<PharmacyStock />);
    fireEvent.click(await screen.findByRole("button", { name: "Lotes de Amoxicilina 500 mg cápsula" }));
    fireEvent.click(await screen.findByRole("button", { name: "Extrato do lote AMX2611" }));
    const region = within(await screen.findByRole("region", { name: "Extrato do lote AMX2611" }));
    expect((await region.findByRole("row", { name: /perda/ })).textContent).toContain("Frasco quebrado");
    fireEvent.click(region.getByRole("button", { name: "Carregar mais" }));
    const entry = await region.findByRole("row", { name: /entrada por nota/ });
    expect(entry.textContent).toContain("NF 1234");
    // Almoxarife sem perfil profissional: by.name null vira "—", nunca "null".
    expect(entry.textContent).toContain("—");
    expect(entry.textContent).not.toContain("null");
    expect(mocked(api.listLotMovements)).toHaveBeenLastCalledWith("lot1", "l2", "m3");
  });

  it("extrato: devolução com `reason` null (quem não dispensa no local) mostra \"—\", sem quebrar nem escrever null", async () => {
    mocked(api.listLotMovements).mockResolvedValueOnce({ movements: [
      { id: "m5", kind: "return", quantity: "3.00", document: { type: "dispensation_item", id: "di1", number: null }, reason: null, by: { name: "Marta Souza" }, at: "2026-10-29T12:00:00-03:00" } ], next_before: null });
    renderWithProviders(<PharmacyStock />);
    fireEvent.click(await screen.findByRole("button", { name: "Lotes de Amoxicilina 500 mg cápsula" }));
    fireEvent.click(await screen.findByRole("button", { name: "Extrato do lote AMX2611" }));
    const region = within(await screen.findByRole("region", { name: "Extrato do lote AMX2611" }));
    const row = await region.findByRole("row", { name: /devolução/ });
    expect(row.textContent).toContain("—");
    expect(row.textContent).not.toContain("null");
  });

  it("lote vencido pela marca `expired` do api: etiqueta \"vencido\" só nele", async () => {
    mocked(api.listPositions).mockResolvedValue({ positions: [ position({ lots: [
      lotBalance({ lot: stockLot({ id: "old", lot_number: "VELHO1", expires_on: "2026-09-30" }), balance: "4", expiring_soon: false, expired: true }),
      lotBalance()
    ] }) ], next_before: null });
    renderWithProviders(<PharmacyStock />);
    fireEvent.click(await screen.findByRole("button", { name: "Lotes de Amoxicilina 500 mg cápsula" }));
    const lots = within(await screen.findByRole("region", { name: "Lotes de Amoxicilina 500 mg cápsula" }));
    expect(within(lots.getByRole("row", { name: /VELHO1/ })).getByText("vencido")).not.toBeNull();
    expect(within(lots.getByRole("row", { name: /AMX2611/ })).queryByText("vencido")).toBeNull();
  });

  it("mínimos: zero é aceito, a frase de erro diz o item, remover e acrescentar pelo ItemSearch, recusa do api com path", async () => {
    mocked(api.searchPharmacyItems).mockResolvedValue([ CLONA ]);
    mocked(api.putMinimums).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "minimums[1].catalog_item_id" }, "422"));
    renderWithProviders(<PharmacyStock />);
    fireEvent.change(await screen.findByLabelText("Acrescentar medicamento"), { target: { value: "clona" } });
    fireEvent.click(await screen.findByRole("button", { name: "Clonazepam 2 mg comprimido · comprimido" }));
    const clona = await screen.findByLabelText("Mínimo de Clonazepam 2 mg comprimido (comprimido)");
    fireEvent.click(screen.getByRole("button", { name: "Salvar mínimos" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Clonazepam 2 mg comprimido");
    expect(mocked(api.putMinimums)).not.toHaveBeenCalled();
    fireEvent.change(clona, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar mínimos" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Clonazepam 2 mg comprimido");
    expect(mocked(api.putMinimums)).toHaveBeenCalledWith("l2", [ { catalog_item_id: "ci1", minimum: "50" }, { catalog_item_id: "ci2", minimum: "0" } ]);
    fireEvent.click(screen.getByRole("button", { name: "Remover Clonazepam 2 mg comprimido" }));
    expect(screen.queryByLabelText("Mínimo de Clonazepam 2 mg comprimido (comprimido)")).toBeNull();
  });

  it("sem armazenamento local nem releitura sozinha", async () => {
    const set = vi.spyOn(Storage.prototype, "setItem");
    renderWithProviders(<PharmacyStock />);
    await screen.findByRole("row", { name: /Amoxicilina/ });
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
});
