// src/modules/VaccinationStock.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { adjustment } from "../test/pharmacyFixtures";
import { BCG_ITEM, CATALOG29, COLD_CENTRAL, LEAD_ROOM, NOW29, PENTA_ITEM, ROOM, TODAY29, vacLotBalance, vacPosition, vacUser } from "../test/vaccinationFixtures";
import * as api from "../lib/api";
import { VaccinationStock } from "./VaccinationStock";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listMyVaccineLocations: vi.fn(),
  getVaccinationCatalog: vi.fn(), listPositions: vi.fn(), listTransfers: vi.fn(), sendTransfer: vi.fn(), recordVaccineReceipt: vi.fn(),
  recordVaccineOpening: vi.fn(), recordAdjustment: vi.fn(), listAdjustments: vi.fn(), listVials: vi.fn(), listLotMovements: vi.fn(),
  listMyPharmacyLocations: vi.fn() }));
const lot = (id: string, item = PENTA_ITEM, over = {}) => vacLotBalance({ lot: { ...vacLotBalance().lot, id, item, lot_number: `L-${id}` }, ...over });

beforeEach(() => {
  vi.mocked(api.getVaccinationCatalog).mockResolvedValue(CATALOG29);
  vi.mocked(api.listTransfers).mockResolvedValue({ transfers: [], next_before: null });
  vi.mocked(api.listAdjustments).mockResolvedValue({ adjustments: [], next_before: null });
  vi.mocked(api.listVials).mockResolvedValue([]);
  vi.mocked(api.listLotMovements).mockResolvedValue({ movements: [], next_before: null });
  vi.mocked(api.listPositions).mockResolvedValue({ positions: [ vacPosition({ lots: [ lot("a"), lot("b", PENTA_ITEM, { blocked: true }) ] }),
    vacPosition({ item: BCG_ITEM, lots: [ lot("c", BCG_ITEM) ] }) ], next_before: null });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

// O almoxarife da rede de frio recebe também as salas, com `roles: []` (D2): são os destinos da transferência.
function mount(loc = COLD_CENTRAL, roles = [ "stock_keeper" ]) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser(roles));
  vi.mocked(api.listMyVaccineLocations).mockResolvedValue(loc.kind === "cold_chain_central" ? [ loc, { ...ROOM, roles: [] } ] : [ loc ]);
  return renderWithProviders(<VaccinationStock today={TODAY29} now={NOW29} />);
}

describe("estoque de imunobiológicos (F-29.5)", () => {
  // Divergência com o brief: o api fecha o fabricante pela `key` (V19) e o número do documento sem espaço (Catalog::DOCUMENT_NUMBER).
  it("entrada na rede de frio: frascos × doses, fabricante pela key, validade conferida", async () => {
    vi.mocked(api.recordVaccineReceipt).mockResolvedValue({ id: "rc1", kind: "invoice", location: COLD_CENTRAL, items: [], at: "2026-11-02T10:00:00-03:00" });
    mount();
    const entry = await screen.findByRole("region", { name: "Entrada e inventário inicial" });
    fireEvent.change(await within(entry).findByLabelText("Número do documento"), { target: { value: "NF 88" } });
    fireEvent.change(within(entry).getByLabelText("Fornecedor ou doador"), { target: { value: "SESA-PR" } });
    fireEvent.click(within(entry).getByRole("button", { name: "Acrescentar lote" }));
    fireEvent.change(within(entry).getByLabelText("Vacina"), { target: { value: "15" } });
    expect([ ...(within(entry).getByLabelText("Fabricante") as HTMLSelectElement).options ].map((o) => o.value)).toEqual([ "", "fap" ]);
    fireEvent.change(within(entry).getByLabelText("Fabricante"), { target: { value: "fap" } });
    fireEvent.change(within(entry).getByLabelText("Lote"), { target: { value: "BCG2611" } });
    fireEvent.change(within(entry).getByLabelText("Validade"), { target: { value: "2026-11-01" } });
    fireEvent.change(within(entry).getByLabelText("Frascos"), { target: { value: "5" } });
    expect(within(entry).getByText("= 50 doses")).not.toBeNull();
    fireEvent.click(within(entry).getByRole("button", { name: "Registrar entrada" }));
    expect(within(entry).getByText("BCG: lote vencido — não entra no estoque")).not.toBeNull();
    expect(within(entry).getByText(/número do documento: só letras, números/)).not.toBeNull();
    expect(api.recordVaccineReceipt).not.toHaveBeenCalled();
    fireEvent.change(within(entry).getByLabelText("Número do documento"), { target: { value: "NF-88" } });
    fireEvent.change(within(entry).getByLabelText("Validade"), { target: { value: "2027-05-31" } });
    fireEvent.click(within(entry).getByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(api.recordVaccineReceipt).toHaveBeenCalledWith({ location_id: "l9",
      document: { kind: "invoice", number: "NF-88", supplier: "SESA-PR" },
      items: [ { immunobiological_code: "15", manufacturer_key: "fap", lot_number: "BCG2611", expires_on: "2027-05-31", quantity: "50",
        package: { units_per_package: 10, packages: 5 } } ] }));
    expect(await within(entry).findByRole("status")).not.toBeNull();
  });

  it("transferência: destino são as salas; vacinas diferentes não se confundem (itemKey)", async () => {
    mount();
    const transfers = await screen.findByRole("region", { name: "Transferências" });
    const dest = within(transfers).getByLabelText(/Destino/) as HTMLSelectElement;
    expect([ ...dest.options ].map((o) => o.value)).toEqual([ "", "l5" ]);
    fireEvent.click(await within(transfers).findByRole("button", { name: "Acrescentar BCG" }));
    expect(within(transfers).getByText(/L-c/)).not.toBeNull();
    expect(within(transfers).queryByText(/L-a/)).toBeNull();
    expect(api.listMyPharmacyLocations).not.toHaveBeenCalled();
  });

  it("transferência da rede de frio leva from_location_id e não oferece o lote bloqueado", async () => {
    vi.mocked(api.sendTransfer).mockResolvedValue({ id: "t1", from: COLD_CENTRAL, to: ROOM, status: "sent", sent_at: "2026-11-02T10:00:00-03:00",
      received_at: null, items: [] });
    mount();
    const transfers = await screen.findByRole("region", { name: "Transferências" });
    fireEvent.click(await within(transfers).findByRole("button", { name: "Acrescentar Penta (DTP/HepB/Hib)" }));
    const lotSelect = within(transfers).getByLabelText("Lote") as HTMLSelectElement;
    expect([ ...lotSelect.options ].map((o) => o.value)).toEqual([ "a" ]);
    fireEvent.change(within(transfers).getByLabelText(/Destino/), { target: { value: "l5" } });
    fireEvent.change(within(transfers).getByLabelText("Quantidade"), { target: { value: "5" } });
    fireEvent.click(within(transfers).getByRole("button", { name: "Enviar transferência" }));
    await waitFor(() => expect(api.sendTransfer).toHaveBeenCalledWith({ to_location_id: "l5", from_location_id: "l9",
      items: [ { lot_id: "a", quantity: "5" } ] }));
  });

  it("sala: lote bloqueado na posição; vacinador sem ajustes, responsável com", async () => {
    mount(ROOM, [ "health_professional" ]);
    const pos = await screen.findByRole("region", { name: "Posição" });
    expect(await within(pos).findByText("bloqueado — aguarda a conduta")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Inventário e ajustes" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Entrada e inventário inicial" })).toBeNull();
    expect(within(screen.getByRole("region", { name: "Transferências" })).queryByLabelText(/Destino/)).toBeNull();
    fireEvent.click(within(pos).getByRole("button", { name: "Extrato — L-a" }));
    expect(await screen.findByRole("region", { name: "Extrato do lote L-a" })).not.toBeNull();
    expect(api.listLotMovements).toHaveBeenCalledWith("a", "l5", null);
    cleanup();
    mount(LEAD_ROOM, [ "health_professional" ]);
    expect(await screen.findByRole("region", { name: "Inventário e ajustes" })).not.toBeNull();
  });

  it("posição: vencido e vence em breve, um lote por linha com o fabricante", async () => {
    vi.mocked(api.listPositions).mockResolvedValue({ positions: [ vacPosition({ lots: [
      lot("d", PENTA_ITEM, { expired: true, expiring_soon: true, lot: { ...vacLotBalance().lot, id: "d", lot_number: "L-d", expires_on: "2026-10-31" } }),
      lot("e", PENTA_ITEM, { expiring_soon: true }) ] }) ], next_before: null });
    mount(ROOM, [ "health_professional" ]);
    const pos = await screen.findByRole("region", { name: "Posição" });
    expect(await within(pos).findByText("vencido")).not.toBeNull();
    expect(within(pos).getByText("vence em breve")).not.toBeNull();
    expect(within(pos).getAllByText("Serum Institute").length).toBe(2);
    expect(api.listPositions).toHaveBeenCalledWith(expect.objectContaining({ locationId: "l5" }));
  });

  it("inventário inicial da sala pelo responsável: recusas do api na linha, todas de uma vez", async () => {
    vi.mocked(api.recordVaccineOpening).mockRejectedValue(new api.ApiError(422, { error: "manufacturer_not_in_catalog", path: "items[0].manufacturer_key",
      problems: [ { path: "items[0].manufacturer_key", error: "manufacturer_not_in_catalog" }, { path: "items[0].package", error: "invalid_quantity" } ] }, "422"));
    mount(LEAD_ROOM, [ "health_professional" ]);
    const region = await screen.findByRole("region", { name: "Inventário e ajustes" });
    const inv = await within(region).findByRole("form", { name: "Inventário inicial" });
    expect(within(inv).queryByLabelText("Número do documento")).toBeNull();
    fireEvent.click(within(inv).getByRole("button", { name: "Acrescentar lote" }));
    fireEvent.change(within(inv).getByLabelText("Vacina"), { target: { value: "42" } });
    fireEvent.change(within(inv).getByLabelText("Fabricante"), { target: { value: "serum" } });
    fireEvent.change(within(inv).getByLabelText("Lote"), { target: { value: "PNT2612" } });
    fireEvent.change(within(inv).getByLabelText("Validade"), { target: { value: "2027-01-31" } });
    fireEvent.change(within(inv).getByLabelText("Frascos"), { target: { value: "12" } });
    expect(within(inv).getByText("= 12 doses")).not.toBeNull();
    fireEvent.click(within(inv).getByRole("button", { name: "Registrar inventário inicial" }));
    await waitFor(() => expect(api.recordVaccineOpening).toHaveBeenCalledWith({ location_id: "l5",
      items: [ { immunobiological_code: "42", manufacturer_key: "serum", lot_number: "PNT2612", expires_on: "2027-01-31", quantity: "12",
        package: { units_per_package: 1, packages: 12 } } ] }));
    expect(await within(inv).findByText(/Penta \(DTP\/HepB\/Hib\): o fabricante não está na lista desta vacina/)).not.toBeNull();
    expect(within(inv).getByText(/Penta \(DTP\/HepB\/Hib\): as doses por frasco não batem com o catálogo/)).not.toBeNull();
    expect((within(inv).getByLabelText("Frascos") as HTMLInputElement).value).toBe("12");
  });

  it("perda de vacina pede o motivo do SIES; lote bloqueado não é oferecido; perda de excursão pendente aparece", async () => {
    vi.mocked(api.recordAdjustment).mockResolvedValue(adjustment({ kind: "loss", status: "applied" }));
    vi.mocked(api.listAdjustments).mockResolvedValue({ adjustments: [ adjustment({ id: "ex1", kind: "loss", counted_quantity: null, quantity: "-20.00",
      lot: { ...vacLotBalance().lot, lot_number: "L-exc" }, reason: "Descarte por excursão de temperatura" }) ], next_before: null });
    mount();
    const inv = await screen.findByRole("region", { name: "Inventário e ajustes" });
    expect(await within(inv).findByText(/L-exc/)).not.toBeNull();
    const form = await within(inv).findByRole("form", { name: "Registrar ajuste, perda ou vencimento" });
    fireEvent.change(within(form).getByLabelText("Vacina"), { target: { value: "imm:42" } });
    fireEvent.change(within(form).getByLabelText("Tipo"), { target: { value: "loss" } });
    expect([ ...(within(form).getByLabelText("Lote") as HTMLSelectElement).options ].map((o) => o.value)).toEqual([ "", "a" ]);
    fireEvent.change(within(form).getByLabelText("Lote"), { target: { value: "a" } });
    fireEvent.change(within(form).getByLabelText("Quantidade"), { target: { value: "2" } });
    fireEvent.change(within(form).getByLabelText("Motivo"), { target: { value: "Frasco caiu no chão da sala" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar ajuste" }));
    expect(within(form).getByText("escolha o motivo da perda (lista do SIES)")).not.toBeNull();
    fireEvent.change(within(form).getByLabelText("Motivo da perda (SIES)"), { target: { value: "broken" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar ajuste" }));
    fireEvent.click(await within(inv).findByRole("button", { name: "Registrar ajuste" }));
    await waitFor(() => expect(api.recordAdjustment).toHaveBeenCalledWith({ location_id: "l9", lot_id: "a", kind: "loss", quantity: "2",
      reason: "Frasco caiu no chão da sala", loss_code: "broken" }));
  });
});
