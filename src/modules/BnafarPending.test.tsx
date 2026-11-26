// src/modules/BnafarPending.test.tsx — "Pendências do envio à BNAFAR" (módulo 27b; Q16, Q33, Q45, Q46; F-09, F-11, F-13, F-14, F-33).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { BNAFAR_DOMAINS, FIVE_MISSING, PRESENTATIONS, bnafarUser, lotBnafar, pendencies } from "../test/bnafarFixtures";
import { AMOXI } from "../test/pharmacyFixtures";
import * as api from "../lib/api";
import { ApiError, type BnafarPendency } from "../lib/api";
import { BNAFAR_DISABLED, BNAFAR_NO_ROLE, bnafarErrorText } from "../lib/bnafar";
import { BnafarPending } from "./BnafarPending";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listBnafarPendencies: vi.fn(),
  updateLotBnafar: vi.fn(), getBnafarDomains: vi.fn(), listObmPresentations: vi.fn() }));

const CODES = [ "lot_incomplete", "lot_number_too_long", "location_without_cnes", "product_without_code", "fractional_balance", "exit_type_missing", "domain_off" ];
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const KEEPER = () => bnafarUser([ "stock_keeper" ]);
const ADMIN = () => bnafarUser([ "municipal_admin" ]);
const nav = () => ({ onGoToLocations: vi.fn(), onGoToColdChain: vi.fn(), onGoToVectorProducts: vi.fn(), onGoToAdjustments: vi.fn() });

beforeEach(() => {
  mocked(api.fetchCurrentSession).mockResolvedValue(KEEPER());
  mocked(api.listBnafarPendencies).mockResolvedValue(pendencies(CODES));
  mocked(api.getBnafarDomains).mockResolvedValue(BNAFAR_DOMAINS);
  mocked(api.listObmPresentations).mockResolvedValue(PRESENTATIONS);
  mocked(api.updateLotBnafar).mockResolvedValue({ id: "lt1", bnafar: lotBnafar({ version: 1 }) });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const item = (o: Partial<BnafarPendency>): BnafarPendency => ({ ...pendencies([ "domain_off" ]).items[0], ...o });
const page = (items: BnafarPendency[], o: Record<string, unknown> = {}) => ({ items, next_before: null,
  totals: { by_code: Object.fromEntries([ ...new Set(items.map((i) => i.code)) ].map((c) => [ c, items.filter((i) => i.code === c).length ])), by_location: {} }, ...o });

describe("Pendências do envio à BNAFAR (27b)", () => {
  it("as sete pendências aparecem em seções, com as frases e as contagens do api", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValue(pendencies(CODES, { totals: { by_code: Object.fromEntries(CODES.map((c, i) => [ c, i + 10 ])), by_location: {} } }));
    renderWithProviders(<BnafarPending {...nav()} />);
    for (const [ i, code ] of CODES.entries()) {
      const sec = await screen.findByRole("region", { name: bnafarErrorText(code) });
      expect(within(sec).getByText(String(i + 10))).not.toBeNull();
    }
    expect(screen.getByText("Local 2")).not.toBeNull();
    expect(screen.getAllByText(AMOXI.name).length).toBeGreaterThan(0);
    expect(screen.getByText("AMX2611")).not.toBeNull();
    expect(screen.getByText("Valor unitário (R$), CNPJ do fabricante, Registro ANVISA, Programa de saúde, Apresentação (AMPP)")).not.toBeNull();
    for (const h of [ "Local", "Item", "Lote", "O que falta" ]) expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    expect(screen.queryByText(/paciente|cidadão|CPF/i)).toBeNull();
  });

  it("o filtro manda code= e o 'Carregar mais' manda before=, sem repetir o filtro de outro código", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValue(page([ item({ code: "domain_off" }) ], { next_before: "c1" }));
    renderWithProviders(<BnafarPending {...nav()} />);
    await screen.findByRole("region", { name: bnafarErrorText("domain_off") });
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    await waitFor(() => expect(mocked(api.listBnafarPendencies)).toHaveBeenLastCalledWith({ code: null, before: "c1" }));
    fireEvent.click(screen.getByRole("tab", { name: bnafarErrorText("fractional_balance") }));
    await waitFor(() => expect(mocked(api.listBnafarPendencies)).toHaveBeenLastCalledWith({ code: "fractional_balance", before: null }));
  });

  it("Completar dados do lote abre o formulário com a versão e o VMP, manda expected_version 0 e relê a lista", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValue(pendencies([ "lot_incomplete" ]));
    renderWithProviders(<BnafarPending {...nav()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Completar dados do lote — AMX2611" }));
    const form = await screen.findByRole("form", { name: "Dados do lote AMX2611" });
    fireEvent.change(within(form).getByLabelText("Valor unitário (R$)"), { target: { value: "12,50" } });
    await waitFor(() => expect(mocked(api.listObmPresentations)).toHaveBeenCalledWith("VMP0001"));
    await within(form).findByRole("option", { name: /AF —/ });
    fireEvent.change(within(form).getByLabelText("Apresentação (AMPP)"), { target: { value: "AMPP0001" } });
    fireEvent.change(within(form).getByLabelText("Programa de saúde"), { target: { value: "AF" } });
    const calls = mocked(api.listBnafarPendencies).mock.calls.length;
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do lote" }));
    await waitFor(() => expect(mocked(api.updateLotBnafar)).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateLotBnafar).mock.calls[0][0]).toBe("lt1");
    expect(mocked(api.updateLotBnafar).mock.calls[0][1]).toMatchObject({ location_id: "l2", expected_version: 0 });
    await waitFor(() => expect(mocked(api.listBnafarPendencies).mock.calls.length).toBeGreaterThan(calls));
  });

  it("lote com lot_version usa essa versão; lote sem VMP não oferece AMPP", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValue(page([ item({ code: "lot_incomplete", lot_id: "lt9", stock_lot_id: "lt9", lot_number: "L9", lot_version: 4, vmp_code: null, fields: [ "unit_price_cents" ] }) ]));
    renderWithProviders(<BnafarPending {...nav()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Completar dados do lote — L9" }));
    const form = await screen.findByRole("form", { name: "Dados do lote L9" });
    fireEvent.change(within(form).getByLabelText("Valor unitário (R$)"), { target: { value: "3" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do lote" }));
    await waitFor(() => expect(mocked(api.updateLotBnafar)).toHaveBeenCalledWith("lt9", { location_id: "l2", expected_version: 4, unit_price_cents: 300 }));
    expect(mocked(api.listObmPresentations)).not.toHaveBeenCalled();
  });

  it("vacina: o CNPJ faltante vira a frase do catálogo, sem campo", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValue(page([ item({ code: "lot_incomplete", item_key: "immunobiological:v1", lot_id: "lt8", stock_lot_id: "lt8", lot_number: "V8", lot_version: 1, vmp_code: null, fields: [ "manufacturer_cnpj", "unit_price_cents" ] }) ]));
    renderWithProviders(<BnafarPending {...nav()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Completar dados do lote — V8" }));
    const form = await screen.findByRole("form", { name: "Dados do lote V8" });
    expect(within(form).queryByLabelText("CNPJ do fabricante")).toBeNull();
    expect(within(form).getByText(/catálogo de imunobiológicos/)).not.toBeNull();
  });

  it("atalhos: o admin abre Locais e a rede de frio; o almoxarife não vê os botões", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    mocked(api.listBnafarPendencies).mockResolvedValue(page([ item({ code: "location_without_cnes", fields: [ "cnes" ] }) ]));
    const n = nav();
    renderWithProviders(<BnafarPending {...n} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Locais e configurações" }));
    expect(n.onGoToLocations).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Salas e rede de frio" }));
    expect(n.onGoToColdChain).toHaveBeenCalled();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(KEEPER());
    renderWithProviders(<BnafarPending {...nav()} />);
    await screen.findByRole("region", { name: bnafarErrorText("location_without_cnes") });
    expect(screen.queryByRole("button", { name: "Abrir Locais e configurações" })).toBeNull();
    expect(screen.getByText("o CNES deste local vem da unidade de saúde — confira o cadastro da unidade")).not.toBeNull();
  });

  it("produto sem código: vetorial abre Produtos; medicamento e vacina só a frase; saldo com fração abre Ajustes", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValue(page([
      item({ code: "product_without_code", item_key: "vector_control:p1", fields: [ "catmat_code" ] }),
      item({ code: "product_without_code", item_key: "medication:c1", fields: [ "vmp_code" ], stock_location_id: "l3" }),
      item({ code: "product_without_code", item_key: "immunobiological:v1", fields: [ "obm_vmp" ], stock_location_id: "l4" }),
      item({ code: "fractional_balance" })
    ]));
    const n = nav();
    renderWithProviders(<BnafarPending {...n} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Produtos e parâmetros" }));
    expect(n.onGoToVectorProducts).toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Abrir Produtos e parâmetros" }).length).toBe(1);
    expect(screen.getByText("o VMP vem do catálogo de medicamentos da plataforma — peça à equipe do Rota Saúde")).not.toBeNull();
    expect(screen.getByText("o código OBM vem do catálogo de imunobiológicos — peça à equipe do Rota Saúde")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Inventário e ajustes" }));
    expect(n.onGoToAdjustments).toHaveBeenCalled();
  });

  it("código desconhecido aparece cru, em seção própria", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValue(page([ item({ code: "novo_codigo", fields: [ "xyz" ] }) ]));
    renderWithProviders(<BnafarPending {...nav()} />);
    const sec = await screen.findByRole("region", { name: "novo_codigo" });
    expect(within(sec).getByText("xyz")).not.toBeNull();
  });

  it("sem pendência: vazio; 403 missing_role: a frase do papel; sem estoque: desligado", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValue(page([]));
    renderWithProviders(<BnafarPending {...nav()} />);
    expect(await screen.findByText("nenhuma pendência")).not.toBeNull();
    cleanup();
    mocked(api.listBnafarPendencies).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    renderWithProviders(<BnafarPending {...nav()} />);
    expect(await screen.findByText(BNAFAR_NO_ROLE)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(bnafarUser([ "stock_keeper" ], []));
    renderWithProviders(<BnafarPending {...nav()} />);
    expect(await screen.findByText(/desligad|não está ligad|não está habilitad/i)).not.toBeNull();
    expect(BNAFAR_DISABLED).toBeTruthy();
    expect(FIVE_MISSING.length).toBe(5);
  });
});
