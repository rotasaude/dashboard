import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  searchPharmacyItems: vi.fn(), recordReceipt: vi.fn(), recordOpening: vi.fn(), getBnafarDomains: vi.fn(), listObmPresentations: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError, type StockItem } from "../../lib/api";
import { ReceiptForm } from "./ReceiptForm";
import { bnafarErrorText } from "../../lib/bnafar";
import { renderWithProviders } from "../../test/campaignFixtures";
import { AMOXI, CENTRAL, CLONA, TODAY27, stockLot } from "../../test/pharmacyFixtures";
import { VC_LOCATION, VECTOR_ITEM } from "../../test/vectorControlFixtures";
import { BNAFAR_DOMAINS, PRESENTATIONS, bnafarUser } from "../../test/bnafarFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const AMOXI_VMP: StockItem = { ...AMOXI, vmp_code: "VMP0001" };
const LOSARTANA: StockItem = {
  catalog_item_id: "ci3", catmat_code: 267000, name: "Losartana 50 mg comprimido", unit: "mg", dispensing_unit: "comprimido",
  controlled: false, controlled_list: null, vmp_code: "VMP0003"
};
const CLONA_NO_VMP: StockItem = { ...CLONA, controlled: false, controlled_list: null, vmp_code: null };
const LOSARTANA_AMPP = [ { ampp_code: "AMPP0030", vmp_code: "VMP0003", description: "Losartana 50 mg, caixa com 30", anvisa_registration: "9876543210987", manufacturer_cnpj: "11222333000181" } ];
const ITEMS = [ AMOXI_VMP, LOSARTANA, CLONA_NO_VMP, VECTOR_ITEM ];

async function add(term: string, name: string, unit = "") {
  text(unit === "g" ? "Buscar produto de controle vetorial" : "Buscar medicamento", term);
  fireEvent.click(await screen.findByRole("button", { name: `${name} · ${unit}` }));
}

function setup(over: { domains?: typeof BNAFAR_DOMAINS; location?: typeof CENTRAL; mode?: "receipt" | "opening" } = {}) {
  mocked(api.getBnafarDomains).mockResolvedValue(over.domains ?? BNAFAR_DOMAINS);
  return renderWithProviders(<ReceiptForm location={over.location ?? CENTRAL} mode={over.mode ?? "receipt"} today={TODAY27} onDone={() => undefined} />);
}
const doc = () => { text("Número do documento", "NF 1234"); text("Fornecedor ou doador", "Distribuidora Sul"); };
// Os campos de uma linha única (sem o nome do item no rótulo).
function fillSingle(over: { price?: string; cnpj?: string; anvisa?: string; program?: string; ampp?: string } = {}) {
  text("Lote", "L1"); text("Validade", "2026-12-31"); text("Quantidade (cápsula)", "10");
  if (over.price !== "") text("Valor unitário (R$)", over.price ?? "12,50");
  if (over.cnpj !== "") text("CNPJ do fabricante", over.cnpj ?? "11.222.333/0001-81");
  if (over.anvisa !== "") text("Registro ANVISA", over.anvisa ?? "1234567890123");
  if (over.program !== "") text("Programa de saúde", over.program ?? "AF");
  if (over.ampp) text("Apresentação (AMPP)", over.ampp);
}

describe("ReceiptForm: campos do envio à BNAFAR", () => {
  beforeEach(() => {
    for (const fn of [ api.recordReceipt, api.recordOpening, api.searchPharmacyItems, api.getBnafarDomains, api.listObmPresentations ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(bnafarUser([ "stock_keeper" ]));
    mocked(api.searchPharmacyItems).mockImplementation(async (_q: string, domain?: string) => (domain ? [ VECTOR_ITEM ] : ITEMS.filter((i) => !i.vector_product_id)));
    mocked(api.listObmPresentations).mockImplementation(async (vmp: string) => (vmp === "VMP0003" ? LOSARTANA_AMPP : PRESENTATIONS));
    mocked(api.recordReceipt).mockResolvedValue({ id: "r1", location: CENTRAL, kind: "invoice", items: [ { lot: stockLot(), quantity: "10" } ], at: "2026-10-29T09:00:00-03:00" });
    mocked(api.recordOpening).mockResolvedValue({ id: "r2", location: CENTRAL, kind: "opening", items: [ { lot: stockLot(), quantity: "10" } ], at: "2026-10-29T09:00:00-03:00" });
  });

  it("domínio ligado: a linha sem valor trava o envio, com o nome do item, e nada é enviado", async () => {
    setup();
    await screen.findByText("Almoxarifado Central");
    doc();
    await add("amox", "Amoxicilina 500 mg cápsula", "cápsula");
    await add("losa", "Losartana 50 mg comprimido", "comprimido");
    for (const [ name, ampp ] of [ [ "Amoxicilina 500 mg cápsula", "AMPP0001" ], [ "Losartana 50 mg comprimido", "AMPP0030" ] ]) {
      text(`Lote — ${name}`, `L-${ampp}`); text(`Validade — ${name}`, "2026-12-31");
      fireEvent.change(screen.getByLabelText(name.startsWith("Amox") ? "Quantidade (cápsula) — Amoxicilina 500 mg cápsula" : "Quantidade (comprimido) — Losartana 50 mg comprimido"), { target: { value: "10" } });
      if (name.startsWith("Amox")) text(`Valor unitário (R$) — ${name}`, "12,50");
      text(`CNPJ do fabricante — ${name}`, "11222333000181"); text(`Registro ANVISA — ${name}`, "1234567890123");
      text(`Programa de saúde — ${name}`, "AF");
      await screen.findByRole("option", { name: new RegExp(ampp) });
      text(`Apresentação (AMPP) — ${name}`, ampp);
    }
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    const items = (await screen.findAllByRole("listitem")).map((li) => li.textContent);
    expect(items).toEqual([ "Losartana 50 mg comprimido: informe valor unitário (R$)" ]);
    expect(mocked(api.recordReceipt)).not.toHaveBeenCalled();
  });

  it("o AMPP escolhido preenche ANVISA e CNPJ vazios; corpo com centavos, documentos limpos e ampp_code", async () => {
    setup();
    await screen.findByText("Almoxarifado Central");
    doc();
    await add("amox", "Amoxicilina 500 mg cápsula", "cápsula");
    text("Lote", "AMX2611"); text("Validade", "2026-12-31"); text("Quantidade (cápsula)", "10");
    text("Valor unitário (R$)", "1.234,56"); text("Programa de saúde", "HIPERTEN");
    await screen.findByRole("option", { name: /AMPP AMPP0002/ });
    text("Apresentação (AMPP)", "AMPP0001");
    expect((screen.getByLabelText("Registro ANVISA") as HTMLInputElement).value).toBe("1234567890123");
    expect((screen.getByLabelText("CNPJ do fabricante") as HTMLInputElement).value).toBe("11222333000181");
    // um valor já digitado não é trocado pela apresentação
    text("Registro ANVISA", "12345678901");
    text("Apresentação (AMPP)", "AMPP0002");
    text("Apresentação (AMPP)", "AMPP0001");
    expect((screen.getByLabelText("Registro ANVISA") as HTMLInputElement).value).toBe("12345678901");
    text("CNPJ do fabricante", "11.222.333/0001-81");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(mocked(api.recordReceipt)).toHaveBeenCalledWith({
      location_id: "l1", document: { kind: "invoice", number: "NF 1234", supplier: "Distribuidora Sul" },
      items: [ { catalog_item_id: "ci1", lot_number: "AMX2611", expires_on: "2026-12-31", quantity: "10", unit_price_cents: 123456,
        manufacturer_cnpj: "11222333000181", anvisa_registration: "12345678901", health_program: "HIPERTEN", ampp_code: "AMPP0001" } ] }));
  });

  it("recusa do api na linha certa: required em items[2] e lot_mismatch em items[0]", async () => {
    mocked(api.recordReceipt).mockRejectedValue(new ApiError(422, { error: "required", path: "items[2].unit_price_cents", problems: [
      { path: "items[2].unit_price_cents", error: "required" }, { path: "items[0].lot_number", error: "lot_mismatch" } ] }, "422"));
    setup({ domains: { ...BNAFAR_DOMAINS, enabled_domains: [] } });
    await screen.findByText("Almoxarifado Central");
    doc();
    for (const [ term, name, unit ] of [ [ "amox", "Amoxicilina 500 mg cápsula", "cápsula" ], [ "losa", "Losartana 50 mg comprimido", "comprimido" ], [ "clon", "Clonazepam 2 mg comprimido", "comprimido" ] ]) {
      await add(term, name, unit);
    }
    for (const [ name, unit ] of [ [ "Amoxicilina 500 mg cápsula", "cápsula" ], [ "Losartana 50 mg comprimido", "comprimido" ], [ "Clonazepam 2 mg comprimido", "comprimido" ] ]) {
      text(`Lote — ${name}`, "L1"); text(`Validade — ${name}`, "2026-12-31"); text(`Quantidade (${unit}) — ${name}`, "10");
    }
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    const lines = (await screen.findAllByRole("listitem")).map((li) => li.textContent);
    expect(lines).toEqual([ "Clonazepam 2 mg comprimido: informe o valor unitário — obrigatório para o envio à BNAFAR",
      `Amoxicilina 500 mg cápsula: ${bnafarErrorText("lot_mismatch")}` ]);
    expect((screen.getByLabelText("Lote — Amoxicilina 500 mg cápsula") as HTMLInputElement).value).toBe("L1");
  });

  it("item sem VMP: aviso, sem AMPP, e a entrada segue; internacional manda o nome e nenhum CNPJ", async () => {
    setup();
    await screen.findByText("Almoxarifado Central");
    doc();
    await add("clon", "Clonazepam 2 mg comprimido", "comprimido");
    expect(screen.getByText(/ainda não tem VMP no catálogo/)).not.toBeNull();
    expect(screen.queryByLabelText("Apresentação (AMPP)")).toBeNull();
    text("Lote", "C1"); text("Validade", "2026-12-31"); text("Quantidade (comprimido)", "10");
    text("Valor unitário (R$)", "3,00"); text("Registro ANVISA", "1234567890123"); text("Programa de saúde", "AF");
    fireEvent.click(screen.getByLabelText("Fabricante internacional (sem CNPJ)"));
    expect(screen.queryByLabelText("CNPJ do fabricante")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect((await screen.findAllByRole("listitem")).map((li) => li.textContent)).toEqual([ "Clonazepam 2 mg comprimido: informe nome do fabricante internacional" ]);
    text("Fabricante internacional (nome)", "Pfizer Ireland");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(mocked(api.recordReceipt)).toHaveBeenCalledTimes(1));
    const [ body ] = mocked(api.recordReceipt).mock.calls[0];
    expect(body.items).toEqual([ { catalog_item_id: "ci2", lot_number: "C1", expires_on: "2026-12-31", quantity: "10", manufacturer: "Pfizer Ireland",
      unit_price_cents: 300, manufacturer_international: true, anvisa_registration: "1234567890123", health_program: "AF" } ]);
    expect("manufacturer_cnpj" in body.items[0]).toBe(false);
    expect("ampp_code" in body.items[0]).toBe(false);
  });

  it("domínio desligado: nada é exigido, os campos são opcionais e o corpo não leva chave vazia", async () => {
    setup({ domains: { ...BNAFAR_DOMAINS, enabled_domains: [] } });
    await screen.findByText("Almoxarifado Central");
    doc();
    await add("amox", "Amoxicilina 500 mg cápsula", "cápsula");
    expect(screen.getByLabelText("Valor unitário (R$) (opcional)")).not.toBeNull();
    text("Lote", "AMX2611"); text("Validade", "2026-12-31"); text("Quantidade (cápsula)", "10");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(mocked(api.recordReceipt)).toHaveBeenCalledWith({
      location_id: "l1", document: { kind: "invoice", number: "NF 1234", supplier: "Distribuidora Sul" },
      items: [ { catalog_item_id: "ci1", lot_number: "AMX2611", expires_on: "2026-12-31", quantity: "10" } ] }));
  });

  it("valor preenchido mas inválido é recusado mesmo com o domínio desligado", async () => {
    setup({ domains: { ...BNAFAR_DOMAINS, enabled_domains: [] } });
    await screen.findByText("Almoxarifado Central");
    doc();
    await add("amox", "Amoxicilina 500 mg cápsula", "cápsula");
    text("Lote", "AMX2611"); text("Validade", "2026-12-31"); text("Quantidade (cápsula)", "10");
    text("Valor unitário (R$) (opcional)", "12,345");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect((await screen.findAllByRole("listitem")).map((li) => li.textContent)).toEqual([ "Amoxicilina 500 mg cápsula: valor unitário inválido — use reais com vírgula, maior que zero" ]);
    expect(mocked(api.recordReceipt)).not.toHaveBeenCalled();
  });

  it("local vector_control com o domínio utilizável: sem AMPP, quatro exigidos e nunca ampp_code", async () => {
    setup({ location: VC_LOCATION, domains: { ...BNAFAR_DOMAINS, enabled_domains: [ "vector_control" ] } });
    await screen.findByText("UVZ — insumos");
    doc();
    await add("pyri", VECTOR_ITEM.name, "g");
    expect(screen.queryByLabelText("Apresentação (AMPP)")).toBeNull();
    expect(screen.queryByText(/ainda não tem VMP/)).toBeNull();
    text("Lote", "PY1"); text("Validade", "2026-12-31"); text("Quantidade (g)", "500");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    expect((await screen.findAllByRole("listitem")).map((li) => li.textContent)).toEqual([ "Pyriproxyfen 0,5% G: informe valor unitário (R$)" ]);
    text("Valor unitário (R$)", "8,90"); text("CNPJ do fabricante", "11222333000181"); text("Registro ANVISA", "12345678901"); text("Programa de saúde", "AF");
    fireEvent.click(screen.getByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(mocked(api.recordReceipt)).toHaveBeenCalledTimes(1));
    expect(mocked(api.recordReceipt).mock.calls[0][0].items).toEqual([ { vector_product_id: "pr1", lot_number: "PY1", expires_on: "2026-12-31", quantity: "500",
      unit_price_cents: 890, manufacturer_cnpj: "11222333000181", anvisa_registration: "12345678901", health_program: "AF" } ]);
  });

  it("abertura exige os mesmos campos com o domínio utilizável", async () => {
    setup({ mode: "opening" });
    await screen.findByText("Almoxarifado Central");
    await add("amox", "Amoxicilina 500 mg cápsula", "cápsula");
    text("Lote", "AMX2611"); text("Validade", "2026-12-31"); text("Quantidade (cápsula)", "40");
    fireEvent.click(screen.getByRole("button", { name: "Registrar abertura" }));
    expect((await screen.findAllByRole("listitem")).map((li) => li.textContent)).toEqual([ "Amoxicilina 500 mg cápsula: informe valor unitário (R$)" ]);
    expect(mocked(api.recordOpening)).not.toHaveBeenCalled();
    await screen.findByRole("option", { name: /AMPP AMPP0001/ });
    fillSingle({ ampp: "AMPP0001", cnpj: "", anvisa: "" });
    fireEvent.click(screen.getByRole("button", { name: "Registrar abertura" }));
    await waitFor(() => expect(mocked(api.recordOpening)).toHaveBeenCalledWith({ location_id: "l1", items: [ {
      catalog_item_id: "ci1", lot_number: "L1", expires_on: "2026-12-31", quantity: "10", unit_price_cents: 1250, manufacturer_cnpj: "11222333000181",
      anvisa_registration: "1234567890123", health_program: "AF", ampp_code: "AMPP0001" } ] }));
  });
});
