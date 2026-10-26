// src/modules/TerritoryTeam.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getTerritoryContext: vi.fn(), listHouseholds: vi.fn(), getHousehold: vi.fn(), listRegistrations: vi.fn(),
    createHousehold: vi.fn(), updateHousehold: vi.fn(), addFamily: vi.fn(), updateFamily: vi.fn(), listPanelNeighborhoods: vi.fn(),
    findDuplicates: vi.fn(), lookupTerritoryPerson: vi.fn(), createRegistration: vi.fn(), updateRegistration: vi.fn(), getRegistration: vi.fn(), exitRegistration: vi.fn() };
});

import * as api from "../lib/api";
import { TerritoryTeam } from "./TerritoryTeam";
import { TERRITORY_DISABLED, TERRITORY_NO_ROLE } from "../lib/territoryRegistry";
import { renderWithProviders } from "../test/campaignFixtures";
import {
  TEAM_EAP, TODAY24, family, household, microArea, profilelessRegistration, registration, territoryContext, territoryUser
} from "../test/territoryFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const JOSE = registration({ id: "rg2", is_responsible: false, status: "expired",
  patient: { id: "pa2", display_name: "José das Dores", full_name: "José das Dores", mother_name: "Maria das Dores", birth_date: "2026-09-30",
    sex: "male", has_cpf: false, no_cpf_reason: "3", cns_masked: "*** **** **** 1234", identity_locked: false } });

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getTerritoryContext, api.listHouseholds, api.getHousehold, api.listRegistrations,
    api.createHousehold, api.updateHousehold, api.addFamily, api.updateFamily, api.listPanelNeighborhoods, api.findDuplicates, api.lookupTerritoryPerson,
    api.createRegistration, api.updateRegistration, api.getRegistration, api.exitRegistration ]) mocked(fn).mockReset();
  mocked(api.findDuplicates).mockResolvedValue([]);
  mocked(api.createRegistration).mockResolvedValue(registration({ id: "rg9" }));
  mocked(api.updateRegistration).mockResolvedValue(registration({ id: "rg2", version: 2 }));
  mocked(api.getRegistration).mockResolvedValue(JOSE);
  mocked(api.listPanelNeighborhoods).mockResolvedValue([ { id: "nb1", name: "Vila Verde", active: true } ]);
  mocked(api.createHousehold).mockResolvedValue(household());
  mocked(api.updateFamily).mockResolvedValue(household({ version: 3 }));
  mocked(api.addFamily).mockResolvedValue(household({ version: 3 }));
  mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser());
  mocked(api.getTerritoryContext).mockResolvedValue(territoryContext());
  // A lista não traz living_conditions (C6).
  const { living_conditions: _omit, ...listed } = household();
  mocked(api.listHouseholds).mockResolvedValue({ households: [ listed ], next_before: null });
  mocked(api.getHousehold).mockResolvedValue(household());
  mocked(api.listRegistrations).mockResolvedValue([ registration(), JOSE ]);
});

const typeIn = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
// Os obrigatórios do §15 que a ficha não tira do paciente (nacionalidade já vem Brasileira).
function fillIdentification() {
  typeIn("Raça/cor", "03");
  typeIn("Município de nascimento (código IBGE, 7 dígitos)", "4106902");
  typeIn("Celular (DDD + número)", "41999990000");
  fireEvent.click(screen.getByLabelText("Não sabe o nome do pai"));
  fireEvent.click(within(screen.getByRole("group", { name: "Quer informar a orientação sexual?" })).getByLabelText("Não"));
  fireEvent.click(within(screen.getByRole("group", { name: "Quer informar a identidade de gênero?" })).getByLabelText("Não"));
  fireEvent.click(screen.getByLabelText("Não está em situação de rua"));
}

async function openHousehold() {
  fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
  await screen.findByText("José das Dores");
}

describe("TerritoryTeam", () => {
  it("abre na primeira microárea; domicílio → famílias → moradores com a situação", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText("Rua das Flores, 120")).not.toBeNull();
    expect(api.listHouseholds).toHaveBeenCalledWith({ microAreaId: "ma1", before: null });
    fireEvent.click(screen.getByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByText("José das Dores")).not.toBeNull();
    expect(api.getHousehold).toHaveBeenCalledWith("hh1");
    expect(api.listRegistrations).toHaveBeenCalledWith({ householdId: "hh1" });
    expect(screen.getByText("sem CPF · CNS *** **** **** 1234")).not.toBeNull();
    expect(screen.getByText("com CPF")).not.toBeNull();
    expect(screen.getByText("vencido (24 meses ou mais)")).not.toBeNull();
    expect(screen.getByText("Responsável: Maria das Dores · 3 pessoas")).not.toBeNull();
    expect(screen.getByText("perto da escola")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null|status_tem_diabetes|nu_comodos/);
  });

  it("família de uma pessoa no singular; mudou-se vira marca", async () => {
    mocked(api.getHousehold).mockResolvedValue(household({ families: [
      family({ members_count: 1, moved_out: true }),
      family({ id: "fa2", responsible: { patient_id: "pa4", display_name: null }, members_count: null })
    ] }));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByText("Responsável: Maria das Dores · 1 pessoa")).not.toBeNull();
    expect(screen.getByText("mudou-se")).not.toBeNull();
    expect(screen.getByText("Responsável: pessoa sem nome no cadastro")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("morador sem perfil e domicílio recusado sem endereço não quebram a tela", async () => {
    const refused = household({ id: "hh2", address: {}, refused: true, families: [] });
    mocked(api.listHouseholds).mockResolvedValue({ households: [ refused ], next_before: null });
    mocked(api.getHousehold).mockResolvedValue(refused);
    mocked(api.listRegistrations).mockResolvedValue([ profilelessRegistration({ household_id: "hh2" }) ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText("recusou o cadastro")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir domicílio sem endereço" }));
    expect(await screen.findByText("sem nome no cadastro")).not.toBeNull();
    expect(screen.getByText("nenhuma família")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("rótulos do dicionário: tipo de logradouro e tipo de imóvel", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText("Rua das Flores, 120")).not.toBeNull();
    expect(screen.getByText("Domicílio")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByText("José das Dores")).not.toBeNull();
    expect(screen.getAllByText("Domicílio").length).toBe(2);
  });

  it("Novo domicílio: a ficha abre, salva, avisa e relê a lista uma vez", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Novo domicílio" }));
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "81020000" } });
    fireEvent.change(screen.getByLabelText("Logradouro"), { target: { value: "das Flores" } });
    fireEvent.change(screen.getByLabelText("Número"), { target: { value: "121" } });
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Bairro (texto)"), { target: { value: "Vila Verde" } });
    fireEvent.change(screen.getByLabelText("Tipo de imóvel"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
    expect(await screen.findByText("Domicílio salvo. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(mocked(api.createHousehold).mock.calls[0][0].micro_area_id).toBe("ma1");
    expect(screen.queryByLabelText("CEP")).toBeNull();
    await waitFor(() => expect(api.listHouseholds).toHaveBeenCalledTimes(2));
  });

  it("detalhe: editar domicílio, nova família (moradores que não respondem por família) e editar família", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    await screen.findByText("José das Dores");
    fireEvent.click(screen.getByRole("button", { name: "Editar domicílio" }));
    expect((screen.getByLabelText("Logradouro") as HTMLInputElement).value).toBe("das Flores");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Nova família" }));
    const options = Array.from((screen.getByLabelText("Responsável") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual([ "— escolha —", "José das Dores" ]);
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar família de Maria das Dores" }));
    expect(screen.getByText("Responsável: Maria das Dores")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar família" }));
    expect(await screen.findByText("Família salva. Nova versão do domicílio enviada ao e-SUS.")).not.toBeNull();
    expect(api.updateFamily).toHaveBeenCalledWith("fa1", { income_band: "3", members_count: 3, living_since: "2019-05", moved_out: false }, 2);
    await waitFor(() => expect(api.getHousehold).toHaveBeenCalledTimes(2));
  });

  it("Adicionar morador: busca de duplicados, pessoa nova na família, aviso e moradores relidos uma vez", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    // Uma família morando: já escolhida; "sem família" também vale.
    const families = screen.getByLabelText("Família") as HTMLSelectElement;
    expect(families.value).toBe("fa1");
    expect(Array.from(families.options).map((o) => o.textContent)).toEqual([ "sem família", "Responsável: Maria das Dores" ]);
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    typeIn("Nome completo", "Ana das Dores");
    typeIn("Data de nascimento", "2026-09-30");
    typeIn("Nome da mãe", "Maria das Dores");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar pessoa sem CPF" }));
    expect((screen.getByLabelText("Nome completo") as HTMLInputElement).value).toBe("Ana das Dores");
    typeIn("Sexo", "female");
    typeIn("Motivo de não ter CPF", "3");
    fillIdentification();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    expect(await screen.findByText("Cadastro salvo. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(mocked(api.createRegistration).mock.calls[0][0]).toEqual(expect.objectContaining({ household_id: "hh1", family_id: "fa1", is_responsible: false,
      new_patient: { full_name: "Ana das Dores", birth_date: "2026-09-30", sex: "female", mother_name: "Maria das Dores", no_cpf_reason: "3" } }));
    expect(screen.queryByLabelText("Família")).toBeNull();
    await waitFor(() => expect(api.listRegistrations).toHaveBeenCalledTimes(2));
  });

  it("Adicionar morador pelo CPF: o responsável da família escolhida entra como responsável; sem família, não", async () => {
    mocked(api.lookupTerritoryPerson).mockResolvedValue({ patient_id: "pa1", citizen_id: null, display_name: "Maria das Dores", registration_id: null });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar Maria das Dores" }));
    fillIdentification();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalledTimes(1));
    expect(mocked(api.createRegistration).mock.calls[0][0]).toEqual(expect.objectContaining({ patient_id: "pa1", household_id: "hh1", family_id: "fa1",
      is_responsible: true }));
    await screen.findByText("Cadastro salvo. Nova versão enviada ao e-SUS.");

    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    typeIn("Família", "");
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar Maria das Dores" }));
    fillIdentification();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalledTimes(2));
    const body = mocked(api.createRegistration).mock.calls[1][0];
    expect(body).toEqual(expect.objectContaining({ household_id: "hh1", is_responsible: false }));
    expect(body).not.toHaveProperty("family_id");
  });

  it("Abrir cadastro de um morador: lê o cadastro e salva a versão nova; Cancelar fecha", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Abrir cadastro de José das Dores" }));
    await waitFor(() => expect(api.getRegistration).toHaveBeenCalledWith("rg2"));
    expect(((await screen.findByLabelText("Nome completo")) as HTMLInputElement).value).toBe("José das Dores");
    expect(screen.queryByRole("button", { name: "Adicionar morador" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    expect(await screen.findByText("Cadastro salvo. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(mocked(api.updateRegistration).mock.calls[0][0]).toBe("rg2");
    expect(mocked(api.updateRegistration).mock.calls[0][2]).toBe(1);
    fireEvent.click(screen.getByRole("button", { name: "Abrir cadastro de Maria das Dores" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expect(screen.queryByRole("button", { name: "Salvar cadastro" })).toBeNull();
  });

  it("Registrar saída de um morador: a ficha fecha e a tela avisa a saída", async () => {
    mocked(api.exitRegistration).mockResolvedValue({ ...JOSE, status: "exited" });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Abrir cadastro de José das Dores" }));
    await screen.findByLabelText("Nome completo");
    fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
    fireEvent.click(screen.getByLabelText("mudou de território"));
    typeIn("Data da saída", "2026-10-20");
    fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(await screen.findByText("Saída registrada. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Salvar cadastro" })).toBeNull();
    expect(api.exitRegistration).toHaveBeenCalledWith("rg2", { reason: "moved", on: "2026-10-20" });
  });

  it("domicílio inativo não recebe morador novo", async () => {
    mocked(api.getHousehold).mockResolvedValue(household({ status: "inactive", families: [] }));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    expect(screen.queryByRole("button", { name: "Adicionar morador" })).toBeNull();
  });

  it("sem Nova família fora do tipo 01 ou com recusa; família que se mudou não se edita", async () => {
    mocked(api.getHousehold).mockResolvedValue(household({ property_type: "2", living_conditions: undefined, families: [] }));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByRole("button", { name: "Editar domicílio" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Nova família" })).toBeNull();
    cleanup();
    mocked(api.getHousehold).mockResolvedValue(household({ refused: true, living_conditions: undefined, families: [] }));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByRole("button", { name: "Editar domicílio" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Nova família" })).toBeNull();
    cleanup();
    mocked(api.getHousehold).mockResolvedValue(household({ families: [ family({ moved_out: true }) ] }));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByText("mudou-se")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Editar família/ })).toBeNull();
  });

  it("só as microáreas em que o profissional cadastra (a de outro ACS não aparece)", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await screen.findByText("Rua das Flores, 120");
    const options = Array.from((screen.getByLabelText("Microárea") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual([ "01 · Vila Verde de cima" ]);
    expect(screen.queryByLabelText("Equipe")).toBeNull();
    expect(api.listHouseholds).toHaveBeenCalledTimes(1);
  });

  it("mais de uma equipe: seletor de equipe; trocar relê a microárea da outra equipe", async () => {
    const base = territoryContext().teams[0];
    mocked(api.getTerritoryContext).mockResolvedValue({ teams: [ base, { ...TEAM_EAP, unit: { id: "u2", name: "UBS Boqueirão" },
      micro_areas: [ { ...microArea({ id: "ma9", code: "07", name: "Boqueirão norte", team: TEAM_EAP }), can_register: true } ] } ] });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await screen.findByText("Rua das Flores, 120");
    fireEvent.change(screen.getByLabelText("Equipe"), { target: { value: "tm2" } });
    expect(await screen.findByRole("option", { name: "07 · Boqueirão norte" })).not.toBeNull();
    expect(api.listHouseholds).toHaveBeenLastCalledWith({ microAreaId: "ma9", before: null });
  });

  it("nenhuma microárea em que cadastra: aviso e nenhuma leitura nominal", async () => {
    const base = territoryContext().teams[0];
    mocked(api.getTerritoryContext).mockResolvedValue({ teams: [ { ...base, micro_areas: base.micro_areas.map((m) => ({ ...m, can_register: false })) } ] });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText("nenhuma microárea em que você cadastre nas suas equipes")).not.toBeNull();
    expect(api.listHouseholds).not.toHaveBeenCalled();
  });

  it("carregar mais repassa o cursor opaco", async () => {
    mocked(api.listHouseholds)
      .mockResolvedValueOnce({ households: [ household() ], next_before: "MjAyNi0wMy0wMlQxMzowMDowMFp8aGgx" })
      .mockResolvedValueOnce({ households: [ household({ id: "hh3", address: { ...household().address, number: null, no_number: true } as api.HouseholdAddress }) ], next_before: null });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await screen.findByText("Rua das Flores, 120");
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Rua das Flores, s/n")).not.toBeNull();
    expect(api.listHouseholds).toHaveBeenLastCalledWith({ microAreaId: "ma1", before: "MjAyNi0wMy0wMlQxMzowMDowMFp8aGgx" });
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("volta à aba e reconecta: lista e detalhe não releem", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    await screen.findByText("José das Dores");
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); onlineManager.setOnline(false); onlineManager.setOnline(true); });
    expect(api.listHouseholds).toHaveBeenCalledTimes(1);
    expect(api.getHousehold).toHaveBeenCalledTimes(1);
    expect(api.listRegistrations).toHaveBeenCalledTimes(1);
    expect(api.getTerritoryContext).toHaveBeenCalledTimes(1);
  });

  it("detalhe recusado pelo api vira frase; Fechar volta só à lista", async () => {
    mocked(api.getHousehold).mockRejectedValue(new api.ApiError(404, { error: "not_found" }, "404"));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    expect(await screen.findByText("não encontrado — recarregue")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(screen.queryByText("não encontrado — recarregue")).toBeNull();
    expect(api.listHouseholds).toHaveBeenCalledTimes(1);
  });

  it("403 feature_disabled vira a frase do interruptor", async () => {
    mocked(api.getTerritoryContext).mockRejectedValue(new api.ApiError(403, { error: "feature_disabled", feature: "territory_registry" }, "403"));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText(TERRITORY_DISABLED)).not.toBeNull();
  });

  it("só o profissional de saúde: o municipal_admin vê o portão e nada é lido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(territoryUser([ "municipal_admin" ]));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText(TERRITORY_NO_ROLE)).not.toBeNull();
    expect(api.getTerritoryContext).not.toHaveBeenCalled();
    expect(api.listHouseholds).not.toHaveBeenCalled();
  });
});
