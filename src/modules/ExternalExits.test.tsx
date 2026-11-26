// src/modules/ExternalExits.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { BALANCE_CHANGED, LOT_BLOCKED_TEXT, NO_LOCATION, PHARMACY_DISABLED, PHARMACY_NO_ROLE } from "../lib/pharmacy";
import { BNAFAR_ERRORS } from "../lib/bnafarErrors";
import { BNAFAR_DOMAINS_KEY } from "../lib/bnafar";
import { renderWithProviders } from "../test/campaignFixtures";
import { BNAFAR_DOMAINS, TODAY27B, bnafarUser, externalExit, externalExitDetail } from "../test/bnafarFixtures";
import { CENTRAL, CENTRAL_REF, UBS_FARM, adminLocation, lotBalance, position, stockLot } from "../test/pharmacyFixtures";
import { COLD_CENTRAL, ROOM } from "../test/vaccinationFixtures";
import { ExternalExits } from "./ExternalExits";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
  listMyPharmacyLocations: vi.fn(), listMyVaccineLocations: vi.fn(), listAdminLocations: vi.fn(), listVaccineRooms: vi.fn(), listPositions: vi.fn(),
  getBnafarDomains: vi.fn(), recordExternalExit: vi.fn(), listExternalExits: vi.fn(), getExternalExit: vi.fn() }));

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
// O api trata o chefe de sala como almoxarife da sala; a sessão dele é de profissional.
const KEEPER_ROOM = { ...ROOM, roles: [ "room_lead" ] };
const LOT_A = lotBalance({ lot: stockLot({ id: "lotA", lot_number: "AMX2702", expires_on: "2027-02-01" }), balance: "30.00", expiring_soon: false });
const LOT_B = lotBalance({ lot: stockLot({ id: "lotB", lot_number: "AMX2611", expires_on: "2026-11-20" }), balance: "10.00", expired: true });
const POS = position({ location: CENTRAL_REF, lots: [ LOT_A, LOT_B ], balance: "40.00" });

const has = (t: string) => (content: string) => content.includes(t);
const field = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const register = () => fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
async function form() { return screen.findByRole("form", { name: "Registrar saída externa" }); }
async function fillValid(over: { lot?: string; quantity?: string } = {}) {
  await form();
  await screen.findByRole("option", { name: /AMX2702/ });
  field("Tipo de saída", "S-D");
  field("Destino", "cnes");
  field("Código do destino", "2384299");
  field("Motivo", "doação à unidade vizinha sem demanda local");
  field("Lote", over.lot ?? "lotA");
  field("Quantidade (inteira)", over.quantity ?? "5");
}
const refusal = (path: string, code: string) => new ApiError(422, { error: code, problems: [ { path, error: code } ] }, "422");

function setup(opts: { roles?: string[]; features?: string[]; ph?: unknown[]; vac?: unknown[]; admin?: unknown[]; rooms?: unknown; closedWindow?: boolean } = {}) {
  const user = bnafarUser(opts.roles ?? [ "stock_keeper" ], opts.features ?? [ "pharmacy" ]);
  mocked(api.fetchCurrentSession).mockResolvedValue(opts.closedWindow ? { ...user, mfa_verified_at: null } : user);
  mocked(api.listMyPharmacyLocations).mockResolvedValue(opts.ph ?? [ CENTRAL ]);
  mocked(api.listMyVaccineLocations).mockResolvedValue(opts.vac ?? []);
  mocked(api.listAdminLocations).mockResolvedValue(opts.admin ?? []);
  mocked(api.listVaccineRooms).mockResolvedValue(opts.rooms ?? { rooms: [], cold_chain_central: null });
  return renderWithProviders(<ExternalExits today={TODAY27B} />);
}

describe("ExternalExits", () => {
  beforeEach(() => {
    for (const fn of [ api.listMyPharmacyLocations, api.listMyVaccineLocations, api.listAdminLocations, api.listVaccineRooms, api.listPositions,
      api.getBnafarDomains, api.recordExternalExit, api.listExternalExits, api.getExternalExit, api.stepUpMfa ]) mocked(fn).mockReset();
    mocked(api.getBnafarDomains).mockResolvedValue(BNAFAR_DOMAINS);
    mocked(api.listPositions).mockResolvedValue({ positions: [ POS ], next_before: null });
    mocked(api.listExternalExits).mockResolvedValue({ external_exits: [ externalExit() ], next_before: null });
    mocked(api.recordExternalExit).mockResolvedValue(externalExitDetail());
  });

  it("saída: inteira, até o saldo, documento normalizado, corrida de saldo relê uma vez", async () => {
    mocked(api.recordExternalExit).mockImplementation(() => new Promise((r) => setTimeout(() => r(externalExitDetail()), 20)));
    setup();
    await fillValid({ quantity: "2,5" });
    register();
    expect(await screen.findByText("a quantidade é um número inteiro, sem vírgula")).not.toBeNull();
    field("Quantidade (inteira)", "0"); register();
    expect(await screen.findByText("a quantidade precisa ser ao menos 1")).not.toBeNull();
    field("Quantidade (inteira)", "31"); register();
    expect(await screen.findByText("saída maior que o saldo inteiro do lote (30)")).not.toBeNull();
    field("Quantidade (inteira)", "5");
    field("Código do destino", "23840430"); register();
    expect(await screen.findByText("o CNES tem 7 dígitos")).not.toBeNull();
    expect(api.recordExternalExit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Confirmar saída" })).toBeNull();

    field("Destino", "cnpj");
    field("Código do destino", "12.abc.345/01de-35");
    register();
    confirm(); confirm();
    await waitFor(() => expect(api.recordExternalExit).toHaveBeenCalledTimes(1));
    expect(api.recordExternalExit).toHaveBeenCalledWith({
      location_id: "l1", exit_type: "S-D", destination_kind: "cnpj", destination_code: "12ABC34501DE35",
      reason: "doação à unidade vizinha sem demanda local", items: [ { lot_id: "lotA", quantity: 5 } ]
    });
    expect(await screen.findByText("Saída registrada. Ela vai à BNAFAR no envio de amanhã, se o envio estiver ligado.")).not.toBeNull();
    expect(api.recordExternalExit).toHaveBeenCalledTimes(1);
  });

  it("step-up: janela fechada pede o código antes de gravar", async () => {
    mocked(api.stepUpMfa).mockResolvedValue(undefined);
    setup({ closedWindow: true });
    await fillValid();
    register();
    field("Código do autenticador", "123456");
    confirm();
    await waitFor(() => expect(api.stepUpMfa).toHaveBeenCalledWith("123456"));
    await waitFor(() => expect(api.recordExternalExit).toHaveBeenCalledTimes(1));
  });

  it("corrida de saldo: insufficient_balance mostra a frase na linha e relê as posições uma vez", async () => {
    mocked(api.recordExternalExit).mockRejectedValue(refusal("items[0].quantity", "insufficient_balance"));
    setup();
    await fillValid();
    await waitFor(() => expect(api.listPositions).toHaveBeenCalledTimes(1));
    register(); confirm();
    expect(await screen.findByText(has(BALANCE_CHANGED))).not.toBeNull();
    await waitFor(() => expect(api.listPositions).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(api.listPositions).toHaveBeenCalledTimes(2);
    expect(screen.getByLabelText("Motivo")).toHaveProperty("value", "doação à unidade vizinha sem demanda local");
    expect(api.recordExternalExit).toHaveBeenCalledTimes(1);
  });

  it("lote bloqueado do api usa a frase da temperatura; lote de vacina fora do YAML e quantidade fora do frasco aparecem na linha", async () => {
    mocked(api.recordExternalExit).mockRejectedValueOnce(refusal("items[0].lot_id", "lot_blocked"));
    setup();
    await fillValid();
    register(); confirm();
    expect(await screen.findByText(has(LOT_BLOCKED_TEXT))).not.toBeNull();
    mocked(api.recordExternalExit).mockRejectedValueOnce(refusal("items[0].lot_id", "invalid_items"));
    register(); confirm();
    expect(await screen.findByText(has(BNAFAR_ERRORS.invalid_items))).not.toBeNull();
    mocked(api.recordExternalExit).mockRejectedValueOnce(refusal("items[0].quantity", "invalid_quantity"));
    register(); confirm();
    expect(await screen.findByText(has(BNAFAR_ERRORS.invalid_quantity))).not.toBeNull();
  });

  it("lote bloqueado nunca sai e lote vencido só na devolução ao fornecedor: recusado antes de ir ao api", async () => {
    mocked(api.listPositions).mockResolvedValue({ next_before: null, positions: [ position({ location: CENTRAL_REF, lots: [
      LOT_A, LOT_B, lotBalance({ lot: stockLot({ id: "lotC", lot_number: "AMX2801", expires_on: "2027-08-01" }), balance: "9.00", blocked: true }) ] }) ] });
    setup();
    await fillValid({ lot: "lotC" });
    register();
    expect(await screen.findByText(LOT_BLOCKED_TEXT)).not.toBeNull();
    field("Lote", "lotB"); register();
    expect(await screen.findByText(BNAFAR_ERRORS.lot_expired)).not.toBeNull();
    field("Tipo de saída", "S-DF"); register();
    expect(await screen.findByRole("button", { name: "Confirmar saída" })).not.toBeNull();
    expect(api.recordExternalExit).not.toHaveBeenCalled();
  });

  it("os tipos de saída vêm da leitura compartilhada dos domínios (mesma chave das outras telas)", async () => {
    const { client } = setup();
    expect(await form()).not.toBeNull();
    expect(client.getQueryData([ BNAFAR_DOMAINS_KEY ])).toEqual(BNAFAR_DOMAINS);
  });

  it("sem bnafar na sessão a tela funciona (Q16): formulário e lista do local", async () => {
    setup({ features: [ "pharmacy" ] });
    expect(await form()).not.toBeNull();
    await waitFor(() => expect(api.listExternalExits).toHaveBeenCalledWith({ locationId: "l1", before: null }));
    expect(await screen.findByText("2384299")).not.toBeNull();
  });

  it("uma sala de vacina do almoxarife aparece no seletor, com a farmácia", async () => {
    setup({ features: [ "pharmacy", "vaccination" ], ph: [ CENTRAL ], vac: [ KEEPER_ROOM, { ...COLD_CENTRAL, roles: [ "stock_keeper" ] } ] });
    const pick = (await screen.findByLabelText("Local")) as HTMLSelectElement;
    const names = Array.from(pick.options).map((o) => o.text);
    expect(names.map((n) => n.split(" — ")[0])).toEqual([ "Almoxarifado Central", "Rede de frio municipal", "Sala de vacina UBS Centro" ]);
    expect(names.every((n) => n.includes(" — "))).toBe(true);
    fireEvent.change(pick, { target: { value: KEEPER_ROOM.id } });
    await waitFor(() => expect(api.listExternalExits).toHaveBeenCalledWith({ locationId: KEEPER_ROOM.id, before: null }));
    expect(await form()).not.toBeNull();
  });

  it("chefe de sala (profissional, sem Membership de almoxarife) grava pela sala; o vacinador só lê", async () => {
    setup({ roles: [ "health_professional" ], features: [ "vaccination" ], vac: [ KEEPER_ROOM, { ...ROOM, id: "l6", name: "Sala B", roles: [ "vaccinator" ] } ] });
    expect(await form()).not.toBeNull();
    expect(screen.queryByLabelText("Local")).toBeNull(); // só a sala do chefe é oferecida; a do vacinador não
    expect(screen.getByText(`Saída externa de ${KEEPER_ROOM.name}`)).not.toBeNull();
    cleanup();
    setup({ roles: [ "health_professional" ], features: [ "vaccination" ], vac: [ { ...ROOM, roles: [ "vaccinator" ] } ] });
    expect(await screen.findByText(NO_LOCATION)).not.toBeNull();
    expect(screen.queryByRole("form", { name: "Registrar saída externa" })).toBeNull();
  });

  it("chefe de sala: formulário com a quantidade em doses", async () => {
    setup({ roles: [ "health_professional" ], features: [ "vaccination" ], vac: [ KEEPER_ROOM ] });
    expect(await form()).not.toBeNull();
    expect(screen.getByLabelText("Quantidade (doses, inteira)")).not.toBeNull();
  });

  it("só vacina ligada: o almoxarife da sala usa a tela; sem local, a frase de sem local", async () => {
    setup({ features: [ "vaccination" ], vac: [ KEEPER_ROOM ] });
    expect(await form()).not.toBeNull();
    expect(api.listMyPharmacyLocations).not.toHaveBeenCalled();
    cleanup();
    setup({ features: [ "pharmacy" ], ph: [ UBS_FARM ] });
    expect(await screen.findByText(NO_LOCATION)).not.toBeNull();
  });

  it("o admin escolhe o local e vê só a lista (sem formulário)", async () => {
    setup({ roles: [ "municipal_admin" ], features: [ "pharmacy", "vaccination" ], admin: [ adminLocation({ id: "l2", name: "Farmácia UBS Centro" }), adminLocation({ id: "l1", name: "Almoxarifado Central", kind: "central" }) ],
      rooms: { rooms: [ { id: "r1", name: "Sala 1", active: true, health_unit: { id: "u1", name: "UBS" }, stock_location_id: "l5", staff: [] } ],
        cold_chain_central: { ...adminLocation({ id: "l9", name: "Rede de frio municipal", kind: "cold_chain_central" }) } } });
    const pick = (await screen.findByLabelText("Local")) as HTMLSelectElement;
    expect(pick.options.length).toBe(4);
    await waitFor(() => expect(api.listExternalExits).toHaveBeenCalled());
    expect(screen.queryByRole("form", { name: "Registrar saída externa" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar saída" })).toBeNull();
    expect(api.listPositions).not.toHaveBeenCalled();
    fireEvent.change(pick, { target: { value: "l9" } });
    await waitFor(() => expect(api.listExternalExits).toHaveBeenLastCalledWith({ locationId: "l9", before: null }));
  });

  it("lista: data, tipo, destino e itens, sem coluna Por; Ver motivo lê o detalhe no clique", async () => {
    mocked(api.getExternalExit).mockResolvedValue(externalExitDetail());
    setup();
    await screen.findByText("2384299");
    for (const h of [ "Data", "Tipo", "Destino", "Itens" ]) expect(screen.getAllByText(h).length).toBeGreaterThan(0);
    expect(screen.queryByText("Por")).toBeNull();
    expect(screen.getAllByText("Doação").length).toBeGreaterThan(0);
    expect(api.getExternalExit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Ver motivo" }));
    expect(await screen.findByText("doação à unidade vizinha, sem demanda local")).not.toBeNull();
    expect(api.getExternalExit).toHaveBeenCalledWith("ex1");
    expect(api.getExternalExit).toHaveBeenCalledTimes(1);
  });

  it("portões: sem farmácia nem vacina, a frase de desligado; papel sem estoque, a de sem papel", async () => {
    setup({ features: [] });
    expect(await screen.findByText(PHARMACY_DISABLED)).not.toBeNull();
    expect(api.listMyPharmacyLocations).not.toHaveBeenCalled();
    cleanup();
    setup({ roles: [ "pharmacist" ] });
    expect(await screen.findByText(PHARMACY_NO_ROLE)).not.toBeNull();
    expect(within(document.body).queryByRole("form", { name: "Registrar saída externa" })).toBeNull();
  });
});
