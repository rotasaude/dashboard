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
  updateLotBnafar: vi.fn(), listAdminLocations: vi.fn(), listMyPharmacyLocations: vi.fn(), listMyVaccineLocations: vi.fn(), listVaccineRooms: vi.fn(), getBnafarDomains: vi.fn(), listObmPresentations: vi.fn() }));

const CODES = [ "lot_incomplete", "lot_number_too_long", "location_without_cnes", "product_without_code", "fractional_balance", "exit_type_missing", "domain_off" ];
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const KEEPER = () => bnafarUser([ "stock_keeper" ]);
const ADMIN = () => bnafarUser([ "municipal_admin" ]);
const CNES_PHRASE = "o CNES deste local vem da unidade de saúde — confira o cadastro da unidade";
const nav = () => ({ onGoToLocations: vi.fn(), onGoToColdChain: vi.fn(), onGoToVectorProducts: vi.fn(), onGoToAdjustments: vi.fn() });

beforeEach(() => {
  mocked(api.fetchCurrentSession).mockResolvedValue(KEEPER());
  mocked(api.listBnafarPendencies).mockResolvedValue(pendencies(CODES));
  mocked(api.getBnafarDomains).mockResolvedValue(BNAFAR_DOMAINS);
  mocked(api.listAdminLocations).mockResolvedValue([ { id: "l2", name: "Central", kind: "central" }, { id: "l5", name: "Rede de frio", kind: "cold_chain_central" }, { id: "l6", name: "UBS", kind: "unit" } ] as never);
  mocked(api.listMyPharmacyLocations).mockResolvedValue([]);
  mocked(api.listMyVaccineLocations).mockResolvedValue([]);
  mocked(api.listVaccineRooms).mockResolvedValue({ rooms: [], cold_chain_central: null });
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
    await waitFor(() => expect(mocked(api.listBnafarPendencies)).toHaveBeenLastCalledWith({ locationId: null, code: null, before: "c1" }));
    fireEvent.click(screen.getByRole("tab", { name: bnafarErrorText("fractional_balance") }));
    await waitFor(() => expect(mocked(api.listBnafarPendencies)).toHaveBeenLastCalledWith({ locationId: null, code: "fractional_balance", before: null }));
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

  const cnesPage = (id: string) => page([ item({ code: "location_without_cnes", fields: [ "cnes" ], stock_location_id: id }) ]);
  it("CNES: o central abre Locais; a rede de frio abre Salas; outro local só a frase; o almoxarife nenhum botão", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    const n = nav();
    mocked(api.listBnafarPendencies).mockResolvedValue(cnesPage("l2"));
    renderWithProviders(<BnafarPending {...n} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Locais e configurações" }));
    expect(n.onGoToLocations).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Abrir Salas e rede de frio" })).toBeNull();
    cleanup();
    mocked(api.listBnafarPendencies).mockResolvedValue(cnesPage("l5"));
    renderWithProviders(<BnafarPending {...n} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Salas e rede de frio" }));
    expect(n.onGoToColdChain).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Abrir Locais e configurações" })).toBeNull();
    cleanup();
    mocked(api.listBnafarPendencies).mockResolvedValue(cnesPage("l6"));
    renderWithProviders(<BnafarPending {...n} />);
    await screen.findByText(CNES_PHRASE);
    await waitFor(() => expect(mocked(api.listAdminLocations)).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: /Abrir (Locais|Salas)/ })).toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(KEEPER());
    renderWithProviders(<BnafarPending {...nav()} />);
    await screen.findByText(CNES_PHRASE);
    expect(screen.queryByRole("button", { name: /Abrir (Locais|Salas)/ })).toBeNull();
  });

  it("CNES: se a leitura dos locais falha, o admin vê os dois atalhos", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    mocked(api.listAdminLocations).mockRejectedValue(new ApiError(500, {}, "x"));
    mocked(api.listBnafarPendencies).mockResolvedValue(cnesPage("l6"));
    renderWithProviders(<BnafarPending {...nav()} />);
    expect(await screen.findByRole("button", { name: "Abrir Locais e configurações" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Abrir Salas e rede de frio" })).not.toBeNull();
  });

  it("depois de salvar, o painel fecha quando o lote sai da lista", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValueOnce(pendencies([ "lot_incomplete" ])).mockResolvedValue(page([]));
    renderWithProviders(<BnafarPending {...nav()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Completar dados do lote — AMX2611" }));
    const form = await screen.findByRole("form", { name: "Dados do lote AMX2611" });
    await within(form).findByRole("option", { name: /AF —/ });
    fireEvent.change(within(form).getByLabelText("Apresentação (AMPP)"), { target: { value: "AMPP0001" } });
    fireEvent.change(within(form).getByLabelText("Valor unitário (R$)"), { target: { value: "12,50" } });
    fireEvent.change(within(form).getByLabelText("Programa de saúde"), { target: { value: "AF" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do lote" }));
    await waitFor(() => expect(screen.queryByRole("form", { name: "Dados do lote AMX2611" })).toBeNull());
    expect(screen.getByRole("status").textContent).toContain("AMX2611");
  });

  it("select de locais: nome vem da leitura de locais (admin e almoxarife), nunca o UUID; o filtro zerado segue como opção e 'todos' limpa", async () => {
    const byLoc = { by_code: { domain_off: 1 }, by_location: { l2: 1, l7: 4 } };
    mocked(api.listBnafarPendencies).mockResolvedValue(page([ item({ code: "domain_off" }) ], { totals: byLoc }));
    mocked(api.listAdminLocations).mockResolvedValue([ { id: "l7", name: "UBS Norte", kind: "unit" } ] as never);
    mocked(api.fetchCurrentSession).mockResolvedValue(ADMIN());
    renderWithProviders(<BnafarPending {...nav()} />);
    expect(await screen.findByRole("option", { name: "UBS Norte (4)" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "Local 2 (1)" })).not.toBeNull();
    expect(mocked(api.listMyPharmacyLocations)).not.toHaveBeenCalled();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(KEEPER());
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { id: "l7", name: "UBS Sul", kind: "unit" } ] as never);
    renderWithProviders(<BnafarPending {...nav()} />);
    expect(await screen.findByRole("option", { name: "UBS Sul (4)" })).not.toBeNull();
    expect(mocked(api.listAdminLocations)).toHaveBeenCalledTimes(1);
    // sem nome conhecido: rótulo neutro, nunca o id
    mocked(api.listMyPharmacyLocations).mockResolvedValue([]);
    cleanup();
    mocked(api.listBnafarPendencies).mockResolvedValue(page([ item({ code: "domain_off" }) ], { totals: { by_code: { domain_off: 1 }, by_location: { l2: 1, "uuid-9": 2 } } }));
    renderWithProviders(<BnafarPending {...nav()} />);
    expect(await screen.findByRole("option", { name: "Local sem nome (2)" })).not.toBeNull();
    cleanup();
    // filtro zerado: continua como opção com contagem 0 e "todos" limpa
    mocked(api.listBnafarPendencies).mockResolvedValueOnce(page([ item({ code: "domain_off" }) ], { totals: byLoc }))
      .mockResolvedValueOnce(page([], { totals: { by_code: {}, by_location: { l2: 1 } } })).mockResolvedValue(page([ item({ code: "domain_off" }) ], { totals: byLoc }));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { id: "l7", name: "UBS Sul", kind: "unit" } ] as never);
    renderWithProviders(<BnafarPending {...nav()} />);
    await screen.findByRole("option", { name: "UBS Sul (4)" });
    const sel = screen.getByLabelText("Local", { selector: "select" }) as HTMLSelectElement;
    fireEvent.change(sel, { target: { value: "l7" } });
    expect(await screen.findByRole("option", { name: "UBS Sul (0)" })).not.toBeNull();
    expect(sel.value).toBe("l7");
    fireEvent.change(sel, { target: { value: "" } });
    await waitFor(() => expect(mocked(api.listBnafarPendencies)).toHaveBeenLastCalledWith({ locationId: null, code: null, before: null }));
  });

  it("'Atualizar' limpa o aviso de lote salvo", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValueOnce(pendencies([ "lot_incomplete" ])).mockResolvedValue(page([]));
    renderWithProviders(<BnafarPending {...nav()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Completar dados do lote — AMX2611" }));
    const form = await screen.findByRole("form", { name: "Dados do lote AMX2611" });
    await within(form).findByRole("option", { name: /AF —/ });
    fireEvent.change(within(form).getByLabelText("Apresentação (AMPP)"), { target: { value: "AMPP0001" } });
    fireEvent.change(within(form).getByLabelText("Valor unitário (R$)"), { target: { value: "12,50" } });
    fireEvent.change(within(form).getByLabelText("Programa de saúde"), { target: { value: "AF" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do lote" }));
    await screen.findByRole("status");
    fireEvent.click(screen.getByRole("button", { name: "Atualizar" }));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("filtro por local: select com as contagens de totals.by_location; manda location_id e fecha o painel", async () => {
    mocked(api.listBnafarPendencies).mockResolvedValue(page(pendencies([ "lot_incomplete", "domain_off" ]).items,
      { totals: { by_code: { lot_incomplete: 1, domain_off: 1 }, by_location: { l2: 1, l3: 1 } } }));
    renderWithProviders(<BnafarPending {...nav()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Completar dados do lote — AMX2611" }));
    await screen.findByRole("form", { name: "Dados do lote AMX2611" });
    expect(screen.getByRole("option", { name: "Local 3 (1)" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Local", { selector: "select" }), { target: { value: "l3" } });
    await waitFor(() => expect(mocked(api.listBnafarPendencies)).toHaveBeenLastCalledWith({ locationId: "l3", code: null, before: null }));
    expect(screen.queryByRole("form", { name: "Dados do lote AMX2611" })).toBeNull();
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

  it("chefe de sala (profissional com vacina) lê a lista e não vê o botão de completar o lote (Q32)", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(bnafarUser([ "health_professional" ], [ "vaccination" ]));
    mocked(api.listBnafarPendencies).mockResolvedValue(pendencies([ "lot_incomplete" ]));
    renderWithProviders(<BnafarPending {...nav()} />);
    expect(await screen.findByRole("region", { name: bnafarErrorText("lot_incomplete") })).not.toBeNull();
    expect(screen.queryByText(BNAFAR_NO_ROLE)).toBeNull();
    expect(screen.queryByRole("button", { name: /Completar dados do lote/ })).toBeNull();
    expect(screen.getByText("peça ao almoxarife do local para completar os dados do lote")).not.toBeNull();
  });
});
