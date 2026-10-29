import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listMyPharmacyLocations: vi.fn(), searchPharmacyItems: vi.fn(), recordReceipt: vi.fn(), recordOpening: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { PharmacyEntries } from "./PharmacyEntries";
import { renderWithProviders } from "../test/campaignFixtures";
import { AMOXI, CENTRAL, CLONA, TODAY27, UBS_FARM, phUser, stockLot } from "../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

async function addAmoxi() {
  text("Buscar medicamento", "amox");
  fireEvent.click(await screen.findByRole("button", { name: "Amoxicilina 500 mg cápsula · cápsula" }));
}

describe("PharmacyEntries", () => {
  beforeEach(() => {
    for (const fn of [ api.recordReceipt, api.recordOpening, api.searchPharmacyItems ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL ]);
    mocked(api.searchPharmacyItems).mockResolvedValue([ AMOXI ]);
    mocked(api.recordReceipt).mockResolvedValue({ id: "r1", location: CENTRAL, kind: "invoice", items: [ { lot: stockLot(), quantity: "300" } ], at: "2026-10-29T09:00:00-03:00" });
    mocked(api.recordOpening).mockResolvedValue({ id: "r2", location: CENTRAL, kind: "opening", items: [ { lot: stockLot(), quantity: "40" } ], at: "2026-10-29T09:00:00-03:00" });
  });

  it("nota fiscal: item, lote, validade e embalagem; a conta antes; corpo com quantidade e embalagem", async () => {
    renderWithProviders(<PharmacyEntries today={TODAY27} />);
    await screen.findByText("Almoxarifado Central");
    text("Tipo de entrada", "invoice"); text("Número do documento", "NF 1234"); text("Fornecedor ou doador", "Distribuidora Sul");
    await addAmoxi();
    text("Lote", "AMX2611"); text("Validade", "2026-11-20");
    fireEvent.click(screen.getByLabelText("Por embalagem"));
    text("Unidades por embalagem", "30"); text("Embalagens", "10");
    expect(screen.getByText("= 300 cápsula")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(mocked(api.recordReceipt)).toHaveBeenCalledWith({
      location_id: "l1", document: { kind: "invoice", number: "NF 1234", supplier: "Distribuidora Sul" },
      items: [ { catalog_item_id: "ci1", lot_number: "AMX2611", expires_on: "2026-11-20", quantity: "300", package: { units_per_package: 30, packages: 10 } } ] }));
    expect((await screen.findByRole("status")).textContent).toBe("Entrada registrada: 1 lote.");
    // limpa as linhas e o documento, mantém o tipo de entrada
    expect(screen.queryByLabelText("Lote")).toBeNull();
    expect((screen.getByLabelText("Número do documento") as HTMLInputElement).value).toBe("");
  });

  it("todas as recusas de uma vez; a recusa do api com path marca o item e o formulário fica", async () => {
    mocked(api.recordReceipt).mockRejectedValue(new ApiError(422, { error: "invalid_item", path: "items[0].catalog_item_id" }, "422"));
    renderWithProviders(<PharmacyEntries today={TODAY27} />);
    await screen.findByText("Almoxarifado Central");
    await addAmoxi();
    text("Lote", "AMX2611"); text("Validade", "2026-10-28"); text("Quantidade (cápsula)", "1.000");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    const alerts = (await screen.findAllByRole("listitem")).map((li) => li.textContent);
    expect(alerts).toEqual(expect.arrayContaining([ "informe o número do documento", "informe o fornecedor ou doador",
      "Amoxicilina 500 mg cápsula: lote vencido — não entra no estoque" ]));
    expect(mocked(api.recordReceipt)).not.toHaveBeenCalled();
    text("Número do documento", "NF 1234"); text("Fornecedor ou doador", "Distribuidora Sul"); text("Validade", "2026-11-20"); text("Quantidade (cápsula)", "300");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText("Amoxicilina 500 mg cápsula: item do catálogo inválido ou inativo")).not.toBeNull();
    expect((screen.getByLabelText("Lote") as HTMLInputElement).value).toBe("AMX2611");
  });

  it("farmacêutico: só a abertura, sem documento; opening_exists com a frase", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    mocked(api.recordOpening).mockRejectedValueOnce(new ApiError(409, { error: "opening_exists", path: "items[0].catalog_item_id" }, "409"));
    renderWithProviders(<PharmacyEntries today={TODAY27} />);
    await screen.findByText("Farmácia UBS Centro");
    expect(screen.queryByLabelText("Entrada")).toBeNull();
    expect(screen.queryByLabelText("Número do documento")).toBeNull();
    await addAmoxi();
    text("Lote", "AMX2611"); text("Validade", "2026-11-20"); text("Quantidade (cápsula)", "40");
    fireEvent.click(screen.getByRole("button", { name: "Registrar abertura" }));
    expect(await screen.findByText("Amoxicilina 500 mg cápsula: este item já teve inventário de abertura neste local — corrija por ajuste")).not.toBeNull();
    expect(mocked(api.recordOpening)).toHaveBeenCalledWith({ location_id: "l2",
      items: [ { catalog_item_id: "ci1", lot_number: "AMX2611", expires_on: "2026-11-20", quantity: "40" } ] });
  });

  it("almoxarife escolhe a abertura: corpo sem documento e a frase da abertura", async () => {
    renderWithProviders(<PharmacyEntries today={TODAY27} />);
    await screen.findByText("Almoxarifado Central");
    fireEvent.click(screen.getByLabelText("Inventário de abertura"));
    expect(screen.queryByLabelText("Número do documento")).toBeNull();
    await addAmoxi();
    text("Lote", "AMX2611"); text("Validade", "2026-11-20"); text("Quantidade (cápsula)", "40,5");
    fireEvent.click(screen.getByRole("button", { name: "Registrar abertura" }));
    await waitFor(() => expect(mocked(api.recordOpening)).toHaveBeenCalledWith({ location_id: "l1",
      items: [ { catalog_item_id: "ci1", lot_number: "AMX2611", expires_on: "2026-11-20", quantity: "40.5" } ] }));
    expect((await screen.findByRole("status")).textContent).toBe("Abertura registrada: 1 lote.");
    expect(mocked(api.recordReceipt)).not.toHaveBeenCalled();
  });

  it("422 com problems: cada recusa na linha dela pelo índice do corpo; embalagem acima do limite recusada antes", async () => {
    mocked(api.searchPharmacyItems).mockResolvedValue([ AMOXI, CLONA ]);
    mocked(api.recordReceipt).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "items[0].quantity", problems: [
      { path: "items[0].quantity", error: "invalid_request" }, { path: "items[1].catalog_item_id", error: "invalid_item" } ] }, "422"));
    renderWithProviders(<PharmacyEntries today={TODAY27} />);
    await screen.findByText("Almoxarifado Central");
    text("Número do documento", "NF 9"); text("Fornecedor ou doador", "Sul");
    await addAmoxi();
    text("Buscar medicamento", "clon");
    fireEvent.click(await screen.findByRole("button", { name: "Clonazepam 2 mg comprimido · comprimido" }));
    expect(screen.getByText("controlado · lista B1")).not.toBeNull();
    text("Lote — Amoxicilina 500 mg cápsula", "A1"); text("Validade — Amoxicilina 500 mg cápsula", "2026-11-20");
    fireEvent.click(screen.getByLabelText("Por embalagem — Amoxicilina 500 mg cápsula"));
    text("Unidades por embalagem — Amoxicilina 500 mg cápsula", "10000"); text("Embalagens — Amoxicilina 500 mg cápsula", "10");
    text("Lote — Clonazepam 2 mg comprimido", "C1"); text("Validade — Clonazepam 2 mg comprimido", "2026-12-20");
    text("Quantidade (comprimido) — Clonazepam 2 mg comprimido", "5");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText("Amoxicilina 500 mg cápsula: unidades por embalagem × embalagens passa de 99999,99 — confira")).not.toBeNull();
    expect(mocked(api.recordReceipt)).not.toHaveBeenCalled();
    text("Unidades por embalagem — Amoxicilina 500 mg cápsula", "30");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    const items = (await screen.findAllByRole("listitem")).map((li) => li.textContent);
    expect(items).toEqual([ "Amoxicilina 500 mg cápsula: quantidade inválida — use até 2 casas depois da vírgula",
      "Clonazepam 2 mg comprimido: item do catálogo inválido ou inativo" ]);
  });
});
