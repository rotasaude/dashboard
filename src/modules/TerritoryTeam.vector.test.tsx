// src/modules/TerritoryTeam.vector.test.tsx
// Módulo 35a (contrato §20 Q13(1), Q14(1); Task 18A): o agente de endemias
// (515140) cadastra e edita pelo 24a só imóvel não residencial, sem família
// nem morador, nas microáreas atribuídas a ele. O api diz quais pelo
// GET /territory/teams: `can_register` e `property_types` por microárea (null
// = todos os tipos: ACS, enfermeiro e médico seguem como antes).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getTerritoryContext: vi.fn(), listHouseholds: vi.fn(), getHousehold: vi.fn(), listRegistrations: vi.fn(),
    createHousehold: vi.fn(), updateHousehold: vi.fn(), addFamily: vi.fn(), updateFamily: vi.fn(), listPanelNeighborhoods: vi.fn(),
    findDuplicates: vi.fn(), lookupTerritoryPerson: vi.fn(), createRegistration: vi.fn(), updateRegistration: vi.fn(), getRegistration: vi.fn() };
});

import * as api from "../lib/api";
import { TerritoryTeam } from "./TerritoryTeam";
import { DOMAINS } from "../lib/territoryDictionaries";
import { renderWithProviders } from "../test/campaignFixtures";
import { TEAM_ESF, TODAY24, household, microArea, registration, territoryContext, territoryUser } from "../test/territoryFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const NON_RESIDENTIAL = [ "2", "3", "4", "5", "6", "12", "13" ];
const NOTE = "Nesta microárea você cadastra só imóvel não residencial (ponto estratégico, comércio, terreno baldio, escola, creche, estabelecimento religioso e outros).";
const CBO_TEXT = "só o ACS da microárea, enfermeiro ou médico da equipe grava o cadastro — o agente de endemias, só imóvel não residencial";
const OLD_CBO_TEXT = "só o ACS da microárea, enfermeiro ou médico da equipe grava o cadastro";
const HAS_RESIDENT = "este imóvel tem morador ativo; só a equipe da APS edita";
const NOT_ASSIGNED = "esta microárea não está mais atribuída a você — recarregue a tela";
const label = (code: string) => DOMAINS.tipo_de_imovel.find((t) => String(t.code) === code)!.label;
const ALL_LABELS = DOMAINS.tipo_de_imovel.map((t) => t.label);
const AGENT_LABELS = NON_RESIDENTIAL.map(label);

// Contexto do agente: ma1 atribuída (can_register, tipos não residenciais); ma2 não atribuída.
function agentContext() {
  return territoryContext({ teams: [ { ...TEAM_ESF, unit: { id: "u1", name: "UBS Vila Verde" }, reads_whole_team: false,
    micro_areas: [ { ...microArea(), can_register: true, property_types: NON_RESIDENTIAL },
      { ...microArea({ id: "ma2", code: "02", name: "Vila Verde de baixo", acs: { professional_id: "pr3", name: "Carla Mendes" } }), can_register: false, property_types: null } ]
  } ] });
}
const COMMERCE = household({ property_type: "4", living_conditions: {}, families: [] });

function listed(h: api.Household) {
  const { living_conditions: _omit, ...row } = h;
  return { households: [ row ], next_before: null };
}

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getTerritoryContext, api.listHouseholds, api.getHousehold, api.listRegistrations,
    api.createHousehold, api.updateHousehold, api.addFamily, api.updateFamily, api.listPanelNeighborhoods, api.findDuplicates, api.lookupTerritoryPerson,
    api.createRegistration, api.updateRegistration, api.getRegistration ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser());
  mocked(api.getTerritoryContext).mockResolvedValue(agentContext());
  mocked(api.listPanelNeighborhoods).mockResolvedValue([ { id: "nb1", name: "Vila Verde", active: true } ]);
  mocked(api.listHouseholds).mockResolvedValue(listed(COMMERCE));
  mocked(api.getHousehold).mockResolvedValue(COMMERCE);
  mocked(api.listRegistrations).mockResolvedValue([ registration() ]);
  mocked(api.createHousehold).mockResolvedValue(COMMERCE);
  mocked(api.updateHousehold).mockResolvedValue({ ...COMMERCE, version: 3 });
});

const typeIn = (name: string, value: string) => fireEvent.change(screen.getByLabelText(name), { target: { value } });
const typeOptions = () => within(screen.getByLabelText("Tipo de imóvel")).getAllByRole("option").map((o) => o.textContent).slice(1);

async function fillAddress() {
  typeIn("CEP", "81020-000");
  typeIn("Tipo de logradouro", "081");
  typeIn("Logradouro", "das Flores");
  typeIn("Número", "120");
  await screen.findByRole("option", { name: "Vila Verde" });
  typeIn("Bairro", "nb1");
}

async function openHousehold() {
  fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
  await screen.findByText("perto da escola");
}

describe("TerritoryTeam — agente de endemias (35a, Q13(1))", () => {
  it("agente: novo domicílio só com os tipos não residenciais; o corpo leva o tipo escolhido", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText(NOTE)).not.toBeNull();
    // Só a microárea atribuída (can_register): a ma2 nem aparece.
    const areas = within(screen.getByLabelText("Microárea")).getAllByRole("option").map((o) => o.textContent);
    expect(areas).toEqual([ "01 · Vila Verde de cima" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Novo domicílio" }));
    expect(typeOptions()).toEqual(AGENT_LABELS);
    for (const residential of [ "Domicílio", "Abrigo", "Delegacia", "Outros" ]) expect(typeOptions()).not.toContain(residential);
    await fillAddress();
    typeIn("Tipo de imóvel", "4");
    fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
    await waitFor(() => expect(api.createHousehold).toHaveBeenCalledTimes(1));
    expect(mocked(api.createHousehold).mock.calls[0][0]).toEqual({
      micro_area_id: "ma1",
      address: { zip: "81020000", street_type: "081", street: "das Flores", number: "120", no_number: false, complement: null,
        neighborhood_id: "nb1", district: null, reference: null },
      property_type: "4", living_conditions: null, contact_phone: null, refused: false
    });
    expect(await screen.findByText("Domicílio salvo. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(api.listHouseholds).toHaveBeenCalledWith({ microAreaId: "ma1", before: null });
    // Abrir a microárea + a releitura depois de salvar (lista nominal com trilha).
    await waitFor(() => expect(api.listHouseholds).toHaveBeenCalledTimes(2));
    expect(api.getTerritoryContext).toHaveBeenCalledTimes(1);
  });

  it("agente: sem família nem cadastro individual; residencial só leitura", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    expect(api.getHousehold).toHaveBeenCalledTimes(1);
    expect(api.getHousehold).toHaveBeenCalledWith("hh1");
    // Os moradores nem são lidos (trilha nominal): o agente não grava pessoa.
    expect(api.listRegistrations).not.toHaveBeenCalled();
    expect(screen.queryByRole("region", { name: "Moradores" })).toBeNull();
    for (const name of [ "Nova família", "Adicionar morador" ]) expect(screen.queryByRole("button", { name })).toBeNull();
    expect(screen.queryByLabelText("CPF")).toBeNull();
    // Imóvel "4": edita só o domicílio, com os tipos dele.
    fireEvent.click(screen.getByRole("button", { name: "Editar domicílio" }));
    expect(typeOptions()).toEqual(AGENT_LABELS);
    expect(api.listHouseholds).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
    await waitFor(() => expect(api.updateHousehold).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(api.listHouseholds).toHaveBeenCalledTimes(2));
    expect(mocked(api.updateHousehold).mock.calls[0][1].property_type).toBe("4");
    expect(mocked(api.updateHousehold).mock.calls[0][2]).toBe(2);
    cleanup();

    // Imóvel "1" (residencial, com família): só leitura; nem família nem morador.
    const HOME = household();
    mocked(api.listHouseholds).mockResolvedValue(listed(HOME));
    mocked(api.getHousehold).mockResolvedValue(HOME);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    for (const name of [ "Editar domicílio", "Nova família", "Adicionar morador", "Inativar domicílio", "Reativar domicílio" ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("button", { name: /Editar família|Trocar responsável|Abrir cadastro/ })).toBeNull();
    // A família aparece só contada, sem o nome do responsável.
    expect(screen.getByText("1 família morando")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/Maria das Dores/);
    expect(api.listRegistrations).not.toHaveBeenCalled();
    expect(api.updateHousehold).toHaveBeenCalledTimes(1);
  });

  it("ACS (property_types ausente ou null): nada muda", async () => {
    // ACS: o contexto do 24a sem o campo novo.
    mocked(api.getTerritoryContext).mockResolvedValue(territoryContext());
    const HOME = household();
    mocked(api.listHouseholds).mockResolvedValue(listed(HOME));
    mocked(api.getHousehold).mockResolvedValue(HOME);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo domicílio" }));
    expect(typeOptions()).toEqual(ALL_LABELS);
    expect(typeOptions().length).toBe(14);
    expect(screen.queryByText(NOTE)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await openHousehold();
    expect((await screen.findAllByText("Maria das Dores")).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Nova família" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Adicionar morador" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Editar domicílio" })).not.toBeNull();
    expect(api.listRegistrations).toHaveBeenCalledTimes(1);
    cleanup();

    // Enfermeiro: property_types null explícito, as duas microáreas.
    mocked(api.getTerritoryContext).mockResolvedValue(territoryContext({ teams: [ { ...TEAM_ESF, unit: { id: "u1", name: "UBS Vila Verde" },
      reads_whole_team: true, micro_areas: [ { ...microArea(), can_register: true, property_types: null },
        { ...microArea({ id: "ma2", code: "02", name: "Vila Verde de baixo" }), can_register: true, property_types: null } ] } ] }));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo domicílio" }));
    expect(typeOptions()).toEqual(ALL_LABELS);
    expect(within(screen.getByLabelText("Microárea")).getAllByRole("option").length).toBe(2);
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  it("ACS e enfermeiro: 403 cbo_not_allowed e out_of_scope com as frases do 24a de sempre", async () => {
    for (const context of [ territoryContext(), territoryContext({ teams: [ { ...TEAM_ESF, unit: { id: "u1", name: "UBS Vila Verde" },
      reads_whole_team: true, micro_areas: [ { ...microArea(), can_register: true, property_types: null } ] } ] }) ]) {
      mocked(api.getTerritoryContext).mockResolvedValue(context);
      mocked(api.createHousehold).mockReset();
      mocked(api.createHousehold).mockRejectedValue(new api.ApiError(403, { error: "cbo_not_allowed" }, "403"));
      renderWithProviders(<TerritoryTeam today={TODAY24} />);
      fireEvent.click(await screen.findByRole("button", { name: "Novo domicílio" }));
      await fillAddress();
      typeIn("Tipo de imóvel", "2");
      fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
      expect(await screen.findByText(OLD_CBO_TEXT)).not.toBeNull();
      expect(screen.queryByText(CBO_TEXT)).toBeNull();
      mocked(api.createHousehold).mockRejectedValue(new api.ApiError(403, { error: "out_of_scope" }, "403"));
      fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
      expect(await screen.findByText("esta microárea não é da sua equipe")).not.toBeNull();
      expect(api.createHousehold).toHaveBeenCalledTimes(2);
      cleanup();
    }
  });

  it("agente: editar ou inativar imóvel com morador ativo → a frase do morador, sem marcar o tipo", async () => {
    mocked(api.updateHousehold).mockRejectedValue(new api.ApiError(403, { error: "cbo_not_allowed" }, "403"));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Editar domicílio" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
    expect(await screen.findByText(HAS_RESIDENT)).not.toBeNull();
    expect(screen.getByLabelText("Tipo de imóvel").getAttribute("aria-invalid")).toBeNull();
    expect(document.activeElement).not.toBe(screen.getByLabelText("Tipo de imóvel"));
    expect(screen.queryByText(CBO_TEXT)).toBeNull();
    expect(api.updateHousehold).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Inativar domicílio" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar inativação" }));
    expect(await screen.findByText(HAS_RESIDENT)).not.toBeNull();
    expect(mocked(api.updateHousehold).mock.calls[1][1].status).toBe("inactive");
    // Atribuição encerrada no meio da sessão.
    mocked(api.updateHousehold).mockRejectedValue(new api.ApiError(403, { error: "out_of_scope" }, "403"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar inativação" }));
    expect(await screen.findByText(NOT_ASSIGNED)).not.toBeNull();
    expect(api.updateHousehold).toHaveBeenCalledTimes(3);
    expect(api.listRegistrations).not.toHaveBeenCalled();
  });

  it("403 cbo_not_allowed mostra a frase nova", async () => {
    mocked(api.createHousehold).mockRejectedValue(new api.ApiError(403, { error: "cbo_not_allowed" }, "403"));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo domicílio" }));
    await fillAddress();
    typeIn("Tipo de imóvel", "2");
    fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
    expect(await screen.findByText(CBO_TEXT)).not.toBeNull();
    // A tela só oferece os tipos da lista: o tipo nunca é a causa, nada é marcado.
    const type = screen.getByLabelText("Tipo de imóvel");
    expect(type.getAttribute("aria-invalid")).toBeNull();
    expect(document.activeElement).not.toBe(type);
    expect(api.createHousehold).toHaveBeenCalledTimes(1);
    // A microárea deixou de ser atribuída: a frase do agente, sem campo.
    mocked(api.createHousehold).mockRejectedValue(new api.ApiError(403, { error: "out_of_scope" }, "403"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
    expect(await screen.findByText(NOT_ASSIGNED)).not.toBeNull();
    expect(screen.queryByText("esta microárea não é da sua equipe")).toBeNull();
    expect(screen.getByLabelText("Tipo de imóvel").getAttribute("aria-invalid")).toBeNull();
    expect(api.createHousehold).toHaveBeenCalledTimes(2);
  });

  it("nada do imóvel vai para a URL nem para o storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const before = window.location.href;
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo domicílio" }));
    await fillAddress();
    typeIn("Tipo de imóvel", "4");
    expect(setItem).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
    setItem.mockRestore();
  });
});
