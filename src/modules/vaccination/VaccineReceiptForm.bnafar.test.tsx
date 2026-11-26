import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  recordVaccineReceipt: vi.fn(), recordVaccineOpening: vi.fn(), getBnafarDomains: vi.fn(), listObmPresentations: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError, type VaccinationCatalog } from "../../lib/api";
import { VaccineReceiptForm } from "./VaccineReceiptForm";
import { bnafarErrorText } from "../../lib/bnafar";
import { renderWithProviders } from "../../test/campaignFixtures";
import { stockLot } from "../../test/pharmacyFixtures";
import { CATALOG29, COLD_CENTRAL, PENTA, TODAY29 } from "../../test/vaccinationFixtures";
import { BNAFAR_DOMAINS, bnafarUser } from "../../test/bnafarFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const CATALOG: VaccinationCatalog = { ...CATALOG29, immunobiologicals: [ { ...PENTA, obm_vmp: "OBM0042" }, ...CATALOG29.immunobiologicals.slice(1) ] };
const OBM = [ { ampp_code: "AMPP0900", vmp_code: "OBM0042", description: "Penta frasco-ampola 1 dose", anvisa_registration: "1234567890123", manufacturer_cnpj: "11222333000181" } ];
const ON = { ...BNAFAR_DOMAINS, enabled_domains: [ "immunobiological" as const ] };
const saved = { id: "r1", location: COLD_CENTRAL, kind: "invoice" as const, items: [ { lot: stockLot(), quantity: "20" } ], at: "2026-11-02T09:00:00-03:00" };

function setup(domains = ON, mode: "receipt" | "opening" = "receipt", catalog = CATALOG) {
  mocked(api.getBnafarDomains).mockResolvedValue(domains);
  return renderWithProviders(<VaccineReceiptForm location={COLD_CENTRAL} catalog={catalog} mode={mode} today={TODAY29} onDone={() => undefined} />);
}
function addPenta() {
  fireEvent.click(screen.getByRole("button", { name: "Acrescentar lote" }));
  text("Vacina", "42"); text("Fabricante", "serum"); text("Lote", "PE2611"); text("Validade", "2027-03-31"); text("Frascos (1 dose cada)", "20");
}

describe("VaccineReceiptForm: campos do envio à BNAFAR", () => {
  beforeEach(() => {
    for (const fn of [ api.recordVaccineReceipt, api.recordVaccineOpening, api.getBnafarDomains, api.listObmPresentations ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(bnafarUser([ "stock_keeper" ], [ "vaccination", "bnafar", "bnafar_vaccines" ]));
    mocked(api.listObmPresentations).mockResolvedValue(OBM);
    mocked(api.recordVaccineReceipt).mockResolvedValue(saved);
    mocked(api.recordVaccineOpening).mockResolvedValue({ ...saved, kind: "opening" });
  });

  it("com o domínio imunobiológico: os campos são exigidos, sem fabricante nem CNPJ, e o AMPP vem do obm_vmp", async () => {
    setup();
    await screen.findByRole("form", { name: "Entrada por nota ou doação" });
    text("Número do documento", "NF-77"); text("Fornecedor ou doador", "Ministério da Saúde");
    addPenta();
    expect(screen.queryByLabelText("CNPJ do fabricante")).toBeNull();
    expect(screen.queryByLabelText("Fabricante internacional (sem CNPJ)")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect((await screen.findAllByRole("listitem")).map((li) => li.textContent)).toEqual([ "Penta (DTP/HepB/Hib): informe valor unitário (R$)" ]);
    expect(mocked(api.recordVaccineReceipt)).not.toHaveBeenCalled();
    text("Valor unitário (R$)", "45,90"); text("Programa de saúde", "AF");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect((await screen.findAllByRole("listitem")).map((li) => li.textContent)).toEqual([ "Penta (DTP/HepB/Hib): informe registro ANVISA" ]);
    await screen.findByRole("option", { name: /AMPP AMPP0900/ });
    text("Apresentação (AMPP)", "AMPP0900");
    expect((screen.getByLabelText("Registro ANVISA") as HTMLInputElement).value).toBe("1234567890123");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(mocked(api.recordVaccineReceipt)).toHaveBeenCalledTimes(1));
    const [ body ] = mocked(api.recordVaccineReceipt).mock.calls[0];
    expect(body.items).toEqual([ { immunobiological_code: "42", manufacturer_key: "serum", lot_number: "PE2611", expires_on: "2027-03-31", quantity: "20",
      package: { units_per_package: 1, packages: 20 }, unit_price_cents: 4590, anvisa_registration: "1234567890123", health_program: "AF", ampp_code: "AMPP0900" } ]);
  });

  it("vacina sem obm_vmp: aviso e AMPP não exigido", async () => {
    setup(ON, "receipt", CATALOG29);
    await screen.findByRole("form", { name: "Entrada por nota ou doação" });
    text("Número do documento", "NF-77"); text("Fornecedor ou doador", "Ministério da Saúde");
    addPenta();
    expect(screen.getByText(/ainda não tem VMP no catálogo/)).not.toBeNull();
    text("Valor unitário (R$)", "45,90"); text("Registro ANVISA", "1234567890123"); text("Programa de saúde", "AF");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(mocked(api.recordVaccineReceipt)).toHaveBeenCalledTimes(1));
    expect("ampp_code" in mocked(api.recordVaccineReceipt).mock.calls[0][0].items[0]).toBe(false);
  });

  it("sem o domínio: nada é exigido, o corpo não leva chave do envio", async () => {
    setup({ ...BNAFAR_DOMAINS, enabled_domains: [] });
    await screen.findByRole("form", { name: "Entrada por nota ou doação" });
    text("Número do documento", "NF-77"); text("Fornecedor ou doador", "Ministério da Saúde");
    addPenta();
    expect(screen.getByLabelText("Valor unitário (R$) (opcional)")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(mocked(api.recordVaccineReceipt)).toHaveBeenCalledTimes(1));
    expect(mocked(api.recordVaccineReceipt).mock.calls[0][0].items).toEqual([ { immunobiological_code: "42", manufacturer_key: "serum", lot_number: "PE2611",
      expires_on: "2027-03-31", quantity: "20", package: { units_per_package: 1, packages: 20 } } ]);
  });

  it("o corpo da abertura leva os campos preenchidos", async () => {
    setup(ON, "opening");
    await screen.findByRole("form", { name: "Inventário inicial" });
    addPenta();
    await screen.findByRole("option", { name: /AMPP AMPP0900/ });
    text("Valor unitário (R$)", "45,90"); text("Programa de saúde", "AF"); text("Apresentação (AMPP)", "AMPP0900");
    fireEvent.click(screen.getByRole("button", { name: "Registrar inventário inicial" }));
    await waitFor(() => expect(mocked(api.recordVaccineOpening)).toHaveBeenCalledWith({ location_id: "l9", items: [ {
      immunobiological_code: "42", manufacturer_key: "serum", lot_number: "PE2611", expires_on: "2027-03-31", quantity: "20",
      package: { units_per_package: 1, packages: 20 }, unit_price_cents: 4590, anvisa_registration: "1234567890123", health_program: "AF", ampp_code: "AMPP0900" } ] }));
  });

  it("recusa do api com código do envio mostra a frase do envio na linha", async () => {
    mocked(api.recordVaccineReceipt).mockRejectedValue(new ApiError(422, { error: "anvisa_mismatch", path: "items[0].anvisa_registration",
      problems: [ { path: "items[0].anvisa_registration", error: "anvisa_mismatch" } ] }, "422"));
    setup({ ...BNAFAR_DOMAINS, enabled_domains: [] });
    await screen.findByRole("form", { name: "Entrada por nota ou doação" });
    text("Número do documento", "NF-77"); text("Fornecedor ou doador", "Ministério da Saúde");
    addPenta();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect(await screen.findByText(`Penta (DTP/HepB/Hib): ${bnafarErrorText("anvisa_mismatch")}`)).not.toBeNull();
    expect((screen.getByLabelText("Lote") as HTMLInputElement).value).toBe("PE2611");
  });
});
