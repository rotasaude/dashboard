// src/modules/TerritoryTeam.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getTerritoryContext: vi.fn(), listHouseholds: vi.fn(), getHousehold: vi.fn(), listRegistrations: vi.fn(),
    createHousehold: vi.fn(), updateHousehold: vi.fn(), addFamily: vi.fn(), updateFamily: vi.fn(), listPanelNeighborhoods: vi.fn(),
    findDuplicates: vi.fn(), lookupTerritoryPerson: vi.fn(), createRegistration: vi.fn(), updateRegistration: vi.fn(), getRegistration: vi.fn(), exitRegistration: vi.fn(),
    replaceResponsible: vi.fn() };
});

import * as api from "../lib/api";
import { TerritoryTeam } from "./TerritoryTeam";

import { DUPLICATE_SUSPECTED_TEXT, IDENTITY_REVIEW_TEXT, STALE_TEXT, TERRITORY_DISABLED, TERRITORY_NO_ROLE } from "../lib/territoryRegistry";
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
    api.createRegistration, api.updateRegistration, api.getRegistration, api.exitRegistration, api.replaceResponsible ]) mocked(fn).mockReset();
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

  it("coluna Família dos moradores: responsável, família de <responsável> e sem família (PROVA-5)", async () => {
    const SEM = registration({ id: "rg8", is_responsible: false, family_id: null,
      patient: { ...JOSE.patient, id: "pa8", display_name: "Davi Souza", full_name: "Davi Souza" } });
    // Família que a tela não conhece (lida antes de uma gravação): "membro", nunca vazio.
    const OUTRA = registration({ id: "rg9", is_responsible: false, family_id: "fa9",
      patient: { ...JOSE.patient, id: "pa9", display_name: "Lia Alves", full_name: "Lia Alves" } });
    mocked(api.listRegistrations).mockResolvedValue([ registration(), JOSE, SEM, OUTRA ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    const residents = screen.getByRole("region", { name: "Moradores" });
    expect(within(residents).getByText("responsável")).not.toBeNull();
    expect(within(residents).getByText("família de Maria das Dores")).not.toBeNull();
    expect(within(residents).getByText("sem família")).not.toBeNull();
    expect(within(residents).getByText("membro")).not.toBeNull();
  });

  it("morador com a identidade atualizada no posto: a marca 'revisar e salvar' na lista (L24)", async () => {
    mocked(api.listRegistrations).mockResolvedValue([ registration(), { ...JOSE, identity_review_pending: true } ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    const residents = screen.getByRole("region", { name: "Moradores" });
    expect(within(residents).getAllByText(IDENTITY_REVIEW_TEXT).length).toBe(1);
  });

  it("peças abertas fora da tela (celular): o detalhe e cada bloco de edição rolam até o título e o focam", async () => {
    const scroll = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scroll;
    try {
      renderWithProviders(<TerritoryTeam today={TODAY24} />);
      await openHousehold();
      const active = () => document.activeElement as HTMLElement;
      expect(active().tagName).toBe("H2");
      expect(active().textContent).toBe("Rua das Flores, 120");
      expect(active().tabIndex).toBe(-1);
      expect(scroll).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Editar domicílio" }));
      expect(active().textContent).toBe("Editar domicílio");
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      fireEvent.click(screen.getByRole("button", { name: "Abrir cadastro de José das Dores" }));
      expect(active().textContent).toBe("Cadastro de José das Dores");
      fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
      fireEvent.click(screen.getByRole("button", { name: "Nova família" }));
      expect(active().textContent).toBe("Nova família");
      fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
      fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
      expect(active().textContent).toBe("Adicionar morador");
      expect(scroll).toHaveBeenCalledTimes(5);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
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
    expect(await screen.findByText("pessoa sem nome no cadastro")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Abrir cadastro de pessoa sem nome no cadastro" })).not.toBeNull();
    expect(screen.getByText("nenhuma família")).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it("apartamentos do mesmo número: o complemento entra no endereço (lista, botão e título)", async () => {
    const base = household();
    const apt = (id: string, complement: string) => household({ id, address: { ...base.address, complement } as api.HouseholdAddress });
    mocked(api.listHouseholds).mockResolvedValue({ households: [ apt("hh1", "apto 12"), apt("hh2", "apto 21") ], next_before: null });
    mocked(api.getHousehold).mockResolvedValue(apt("hh2", "apto 21"));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    expect(await screen.findByText("Rua das Flores, 120 · apto 12")).not.toBeNull();
    expect(screen.getByText("Rua das Flores, 120 · apto 21")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir Rua das Flores, 120 · apto 21" }));
    await screen.findByText("José das Dores");
    expect(api.getHousehold).toHaveBeenCalledWith("hh2");
    expect(screen.getAllByText("Rua das Flores, 120 · apto 21").length).toBe(2);
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
    // A resposta é o domicílio inteiro: entra no cache (sem reler o domicílio); moradores e lista releem (L28: o responsável pode ter mudado).
    await waitFor(() => expect(api.listRegistrations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.listHouseholds).toHaveBeenCalledTimes(2));
    expect(api.getHousehold).toHaveBeenCalledTimes(1);
  });

  it("salvar o domicílio usa a resposta (versão nova) sem reler o domicílio; só a lista relê", async () => {
    const saved = household({ address: { ...household().address, number: "130" } as api.HouseholdAddress, version: 3 });
    mocked(api.updateHousehold).mockResolvedValue(saved);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Editar domicílio" }));
    typeIn("Número", "130");
    fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
    expect(await screen.findByText("Domicílio salvo. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Rua das Flores, 130" })).not.toBeNull();
    await waitFor(() => expect(api.listHouseholds).toHaveBeenCalledTimes(2));
    expect(api.getHousehold).toHaveBeenCalledTimes(1);
    // Reabrir já usa a versão 3 (sem 409 por versão velha).
    fireEvent.click(screen.getByRole("button", { name: "Editar domicílio" }));
    fireEvent.click(screen.getByRole("button", { name: "Salvar domicílio" }));
    await waitFor(() => expect(api.updateHousehold).toHaveBeenCalledTimes(2));
    expect(mocked(api.updateHousehold).mock.calls[1][2]).toBe(3);
  });

  it("Adicionar morador: busca de duplicados, pessoa nova na família, aviso e moradores relidos uma vez", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    typeIn("Nome completo", "Ana das Dores");
    typeIn("Data de nascimento", "2026-09-30");
    typeIn("Nome da mãe", "Maria das Dores");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar pessoa sem CPF" }));
    // Nome, nascimento e mãe são os buscados: só leitura (I1).
    expect(screen.queryByLabelText("Nome completo")).toBeNull();
    expect(screen.getByText("Ana das Dores")).not.toBeNull();
    // Uma família morando: já escolhida na ficha; "sem família" também vale.
    const families = screen.getByLabelText("Família") as HTMLSelectElement;
    expect(families.value).toBe("fa1");
    expect(Array.from(families.options).map((o) => o.textContent)).toEqual([ "sem família", "Responsável: Maria das Dores" ]);
    typeIn("Sexo", "female");
    typeIn("Motivo de não ter CPF", "3");
    fillIdentification();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    expect(await screen.findByText("Cadastro salvo. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(mocked(api.createRegistration).mock.calls[0][0]).toEqual(expect.objectContaining({ household_id: "hh1", family_id: "fa1", is_responsible: false,
      duplicates_reviewed: true,
      new_patient: { full_name: "Ana das Dores", birth_date: "2026-09-30", sex: "female", mother_name: "Maria das Dores", no_cpf_reason: "3" } }));
    expect(screen.queryByLabelText("Família")).toBeNull();
    await waitFor(() => expect(api.listRegistrations).toHaveBeenCalledTimes(2));
  });

  it("sem CPF, 'Corrigir (refaz a busca)' volta à busca com os valores; só cria depois de buscar de novo (I1)", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    typeIn("Nome completo", "Ana das Dores");
    typeIn("Data de nascimento", "2026-09-30");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar pessoa sem CPF" }));
    fireEvent.click(screen.getByRole("button", { name: "Corrigir (refaz a busca)" }));
    expect((screen.getByLabelText("Nome completo") as HTMLInputElement).value).toBe("Ana das Dores");
    expect(screen.queryByRole("button", { name: "Criar pessoa sem CPF" })).toBeNull();
    typeIn("Nome completo", "Ana Maria das Dores");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Criar pessoa sem CPF" }));
    expect(screen.getByText("Ana Maria das Dores")).not.toBeNull();
    expect(api.findDuplicates).toHaveBeenCalledTimes(2);
  });

  it("pessoa nova com CPF e 409 duplicate_suspected: volta à busca com a frase e os candidatos; 'é esta pessoa' segue pelo paciente (L28)", async () => {
    mocked(api.lookupTerritoryPerson).mockRejectedValue(new api.ApiError(404, { error: "person_not_found" }, "404"));
    mocked(api.createRegistration).mockRejectedValueOnce(new api.ApiError(409, { error: "duplicate_suspected" }, "409"));
    mocked(api.findDuplicates).mockResolvedValue([ { patient_id: "pa7", display_name: "Rita de Souza", birth_date: "1990-01-10", has_cpf: false, registration_id: null } ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    typeIn("Nome completo", "Rita de Souza");
    typeIn("Data de nascimento", "1990-01-10");
    typeIn("Sexo", "female");
    fillIdentification();
    fireEvent.click(screen.getByLabelText("Não sabe o nome da mãe"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    expect(await screen.findByText("Rita de Souza · nascido em 10/01/1990 · sem CPF")).not.toBeNull();
    expect(screen.getByText(DUPLICATE_SUSPECTED_TEXT)).not.toBeNull();
    // A busca volta acima da ficha (fora da tela no celular): o bloco é revelado de novo.
    expect((document.activeElement as HTMLElement).textContent).toBe("Adicionar morador");
    fireEvent.click(screen.getByRole("button", { name: "É esta pessoa" }));
    // Candidato sem CPF: o CPF digitado vem em "Informar CPF" e vai na raiz.
    expect((screen.getByLabelText("Informar CPF") as HTMLInputElement).value).toBe("529.982.247-25");
    fillIdentification();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalledTimes(2));
    const body = mocked(api.createRegistration).mock.calls[1][0];
    expect(body).toEqual(expect.objectContaining({ patient_id: "pa7", household_id: "hh1", cpf: "52998224725" }));
    expect(body).not.toHaveProperty("new_patient");
    expect(body).not.toHaveProperty("duplicates_reviewed");
  });

  it("Adicionar morador sem CPF, candidato com cadastro ativo (L29): abre o cadastro dele, sem ficha nova", async () => {
    mocked(api.findDuplicates).mockResolvedValue([
      { patient_id: "pa2", display_name: "José das Dores", birth_date: "2026-09-30", has_cpf: false, registration_id: "rg2" }
    ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    typeIn("Nome completo", "José das Dores");
    typeIn("Data de nascimento", "2026-09-30");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Já tem cadastro — abrir" }));
    // O mesmo caminho do "Abrir cadastro" do 409: lê o cadastro e edita a versão gravada.
    expect(await screen.findByRole("form", { name: "Atualizar cadastro individual" })).not.toBeNull();
    expect(api.getRegistration).toHaveBeenCalledWith("rg2");
    expect(screen.queryByRole("form", { name: "Novo cadastro individual" })).toBeNull();
    expect((screen.getByLabelText("Nome completo") as HTMLInputElement).value).toBe("José das Dores");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    expect(await screen.findByText("Cadastro salvo. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(mocked(api.updateRegistration).mock.calls[0][0]).toBe("rg2");
    expect(api.createRegistration).not.toHaveBeenCalled();
  });

  it("'Já tem cadastro — abrir' abre o painel como a linha do morador: título 'Cadastro de <nome>' com o foco (PROVA-6)", async () => {
    mocked(api.findDuplicates).mockResolvedValue([
      { patient_id: "pa2", display_name: "José das Dores", birth_date: "2026-09-30", has_cpf: false, registration_id: "rg2" }
    ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    typeIn("Nome completo", "José das Dores");
    typeIn("Data de nascimento", "2026-09-30");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    fireEvent.click(await screen.findByRole("button", { name: "Já tem cadastro — abrir" }));
    const active = document.activeElement as HTMLElement;
    expect(active.tagName).toBe("STRONG");
    expect(active.textContent).toBe("Cadastro de José das Dores");
    expect(screen.queryByText("Adicionar morador", { selector: "strong" })).toBeNull();
    expect(await screen.findByRole("form", { name: "Atualizar cadastro individual" })).not.toBeNull();
  });

  it("volta do 409 com CPF → 'Já tem cadastro — abrir' num candidato sem CPF: 'Informar CPF' vem preenchido e o PATCH leva o CPF (I2)", async () => {
    mocked(api.lookupTerritoryPerson).mockRejectedValue(new api.ApiError(404, { error: "person_not_found" }, "404"));
    mocked(api.createRegistration).mockRejectedValueOnce(new api.ApiError(409, { error: "duplicate_suspected" }, "409"));
    mocked(api.findDuplicates).mockResolvedValue([
      { patient_id: "pa2", display_name: "José das Dores", birth_date: "2026-09-30", has_cpf: false, registration_id: "rg2" }
    ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar pessoa nova com este CPF" }));
    typeIn("Nome completo", "José das Dores");
    typeIn("Data de nascimento", "2026-09-30");
    typeIn("Sexo", "male");
    fillIdentification();
    fireEvent.click(screen.getByLabelText("Não sabe o nome da mãe"));
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    fireEvent.click(await screen.findByRole("button", { name: "Já tem cadastro — abrir" }));
    // O cadastro aberto (José, sem CPF) recebe o CPF digitado, visível e editável.
    expect(((await screen.findByLabelText("Informar CPF")) as HTMLInputElement).value).toBe("529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    await waitFor(() => expect(api.updateRegistration).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateRegistration).mock.calls[0][0]).toBe("rg2");
    expect(mocked(api.updateRegistration).mock.calls[0][1]).toEqual(expect.objectContaining({ cpf: "52998224725" }));
    expect(api.createRegistration).toHaveBeenCalledTimes(1);
  });

  it("Adicionar morador sem CPF, candidato sem cadastro: 'É esta pessoa' abre a ficha nova (como antes)", async () => {
    mocked(api.findDuplicates).mockResolvedValue([
      { patient_id: "pa7", display_name: "Rita de Souza", birth_date: "1990-01-10", has_cpf: false, registration_id: null }
    ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    fireEvent.click(screen.getByLabelText("Não tem CPF"));
    typeIn("Nome completo", "Rita de Souza");
    typeIn("Data de nascimento", "1990-01-10");
    fireEvent.click(screen.getByRole("button", { name: "Buscar possíveis duplicados" }));
    expect(await screen.findByText("Rita de Souza · nascido em 10/01/1990 · sem CPF")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Já tem cadastro — abrir" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "É esta pessoa" }));
    expect(screen.getByRole("form", { name: "Novo cadastro individual" })).not.toBeNull();
    expect(api.getRegistration).not.toHaveBeenCalled();
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
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar Maria das Dores" }));
    typeIn("Família", "");
    fillIdentification();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    await waitFor(() => expect(api.createRegistration).toHaveBeenCalledTimes(2));
    const body = mocked(api.createRegistration).mock.calls[1][0];
    expect(body).toEqual(expect.objectContaining({ household_id: "hh1", is_responsible: false }));
    expect(body).not.toHaveProperty("family_id");
  });

  it("responsável cadastrado antes da família: Abrir cadastro já escolhe a família dele e salva como responsável (I2)", async () => {
    mocked(api.getHousehold).mockResolvedValue(household({ families: [ family(), family({ id: "fa2", responsible: { patient_id: "pa2", display_name: "José das Dores" },
      members_count: 1 }) ] }));
    mocked(api.getRegistration).mockResolvedValue({ ...JOSE, family_id: null, is_responsible: false });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Abrir cadastro de José das Dores" }));
    const families = (await screen.findByLabelText("Família")) as HTMLSelectElement;
    expect(families.value).toBe("fa2");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    await waitFor(() => expect(api.updateRegistration).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateRegistration).mock.calls[0][1]).toEqual(expect.objectContaining({ household_id: "hh1", family_id: "fa2", is_responsible: true }));
    // Outra família escolhida: não é o responsável dela.
    fireEvent.click(await screen.findByRole("button", { name: "Abrir cadastro de José das Dores" }));
    await screen.findByLabelText("Família");
    typeIn("Família", "fa1");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    await waitFor(() => expect(api.updateRegistration).toHaveBeenCalledTimes(2));
    expect(mocked(api.updateRegistration).mock.calls[1][1]).toEqual(expect.objectContaining({ family_id: "fa1", is_responsible: false }));
  });

  it("Adicionar morador → Atualizar quem mora em outro domicílio: a ficha avisa onde mora hoje e que salvar muda (I3)", async () => {
    const elsewhere = household({ id: "hh9", micro_area: { id: "ma1", code: "01" },
      address: { ...household().address, street: "das Palmeiras", number: "45" } as api.HouseholdAddress });
    mocked(api.lookupTerritoryPerson).mockResolvedValue({ patient_id: "pa2", citizen_id: null, display_name: "José das Dores", registration_id: "rg2" });
    mocked(api.getRegistration).mockResolvedValue({ ...JOSE, household_id: "hh9", family_id: "fa9", is_responsible: true });
    mocked(api.getHousehold).mockImplementation(async (id: string) => (id === "hh9" ? elsewhere : household()));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Atualizar o cadastro de José das Dores" }));
    expect(await screen.findByText("Mora hoje em 01 · Rua das Palmeiras, 45; salvar muda o cadastro para este domicílio.")).not.toBeNull();
    // Família deste domicílio: a única morando (não é responsável dela).
    expect((screen.getByLabelText("Família") as HTMLSelectElement).value).toBe("fa1");
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    await waitFor(() => expect(api.updateRegistration).toHaveBeenCalledTimes(1));
    expect(mocked(api.updateRegistration).mock.calls[0][1]).toEqual(expect.objectContaining({ household_id: "hh1", family_id: "fa1", is_responsible: false }));
  });

  it("Adicionar morador → Atualizar cadastro fora de área: o aviso diz que salvar o põe neste domicílio (I3)", async () => {
    mocked(api.lookupTerritoryPerson).mockResolvedValue({ patient_id: "pa2", citizen_id: null, display_name: "José das Dores", registration_id: "rg2" });
    mocked(api.getRegistration).mockResolvedValue({ ...JOSE, household_id: null, family_id: null, is_responsible: false, micro_area: null });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Atualizar o cadastro de José das Dores" }));
    expect(await screen.findByText("Hoje o cadastro está fora de área (sem domicílio), na equipe ESF Vila Verde; salvar muda o cadastro para este domicílio."))
      .not.toBeNull();
    expect(api.getHousehold).toHaveBeenCalledTimes(1);
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

  it("Adicionar morador → 409 already_registered → Abrir cadastro → saída: a tela avisa a saída, não 'Cadastro salvo' (m6)", async () => {
    mocked(api.lookupTerritoryPerson).mockResolvedValue({ patient_id: "pa2", citizen_id: null, display_name: "José das Dores", registration_id: null });
    mocked(api.createRegistration).mockRejectedValue(new api.ApiError(409, { error: "already_registered", registration_id: "rg2" }, "409"));
    mocked(api.exitRegistration).mockResolvedValue({ ...JOSE, status: "exited" });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Adicionar morador" }));
    typeIn("CPF", "529.982.247-25");
    fireEvent.click(screen.getByRole("button", { name: "Buscar pelo CPF" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar José das Dores" }));
    fillIdentification();
    fireEvent.click(screen.getByRole("button", { name: "Salvar cadastro" }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir cadastro" }));
    await screen.findByRole("form", { name: "Atualizar cadastro individual" });
    fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
    fireEvent.click(screen.getByLabelText("mudou de território"));
    typeIn("Data da saída", "2026-10-20");
    fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(await screen.findByText("Saída registrada. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(screen.queryByText("Cadastro salvo. Nova versão enviada ao e-SUS.")).toBeNull();
  });

  it("saída do responsável pelo detalhe: o domicílio relê e a marca e 'Trocar responsável' aparecem sem fechar o detalhe (I1)", async () => {
    mocked(api.getHousehold).mockResolvedValueOnce(household())
      .mockResolvedValue(household({ families: [ family({ responsible_exited: true }) ] }));
    mocked(api.getRegistration).mockResolvedValue(registration());
    mocked(api.exitRegistration).mockResolvedValue(registration({ status: "exited" }));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    expect(screen.queryByText("Responsável saiu — escolha o novo responsável")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Abrir cadastro de Maria das Dores" }));
    await screen.findByRole("form", { name: "Atualizar cadastro individual" });
    fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
    fireEvent.click(screen.getByLabelText("óbito"));
    typeIn("Data da saída", "2026-10-20");
    typeIn("Data do óbito", "2026-10-19");
    fireEvent.click(screen.getByRole("button", { name: "Registrar saída" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar saída" }));
    expect(await screen.findByText("Saída registrada. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(await screen.findByText("Responsável saiu — escolha o novo responsável")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Trocar responsável da família de Maria das Dores" })).not.toBeNull();
    expect(api.getHousehold).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Rua das Flores, 120" })).not.toBeNull();
  });

  it("Inativar domicílio: só sem família morando; a confirmação explica; PATCH com status e o domicílio como está", async () => {
    const moved = household({ families: [ family({ moved_out: true }) ] });
    mocked(api.getHousehold).mockResolvedValue(moved);
    mocked(api.updateHousehold).mockResolvedValue({ ...moved, status: "inactive", version: 3 });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Inativar domicílio" }));
    const confirm = screen.getByRole("group", { name: "Inativar domicílio" });
    expect(confirm.textContent).toMatch(/ficha domiciliar vai ao e-SUS como inativa/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar inativação" }));
    expect(await screen.findByText("Domicílio inativado. Nova versão enviada ao e-SUS.")).not.toBeNull();
    const { micro_area, address, property_type, living_conditions, contact_phone, refused } = moved;
    expect(api.updateHousehold).toHaveBeenCalledWith("hh1", { micro_area_id: micro_area.id, address, property_type, living_conditions, contact_phone,
      refused, status: "inactive" }, 2);
    // A resposta (inativo) entra na tela: sem morador nem família novos; Reativar no lugar.
    expect(screen.getByText("inativo")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Adicionar morador" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Nova família" })).toBeNull();
    expect(screen.getByRole("button", { name: "Reativar domicílio" })).not.toBeNull();
    expect(api.getHousehold).toHaveBeenCalledTimes(1);
  });

  it("com família morando não há Inativar; Reativar volta como ativo; Cancelar não envia", async () => {
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    expect(screen.queryByRole("button", { name: "Inativar domicílio" })).toBeNull();
    cleanup();
    const inactive = household({ status: "inactive", families: [] });
    mocked(api.getHousehold).mockResolvedValue(inactive);
    mocked(api.updateHousehold).mockResolvedValue({ ...inactive, status: "active", version: 3 });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Reativar domicílio" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Reativar domicílio" })).getByRole("button", { name: "Cancelar" }));
    expect(api.updateHousehold).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Reativar domicílio" }));
    const confirm = screen.getByRole("group", { name: "Reativar domicílio" });
    expect(confirm.textContent).toMatch(/volta ao e-SUS como ativa/);
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar reativação" }));
    expect(await screen.findByText("Domicílio reativado. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(mocked(api.updateHousehold).mock.calls[0][1]).toEqual(expect.objectContaining({ status: "active" }));
    expect(screen.getByRole("button", { name: "Adicionar morador" })).not.toBeNull();
  });

  it("inativar recusado pelo api (família ainda morando, 409 de versão): frase; versão velha pede Recarregar", async () => {
    mocked(api.getHousehold).mockResolvedValue(household({ families: [] }));
    mocked(api.updateHousehold).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_household", path: "status" }, "422"));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Inativar domicílio" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar inativação" }));
    expect(await screen.findByText("o domicílio ainda tem famílias morando — registre a mudança delas antes de inativar")).not.toBeNull();
    mocked(api.updateHousehold).mockRejectedValueOnce(new api.ApiError(409, { error: "stale_version" }, "409"));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar inativação" }));
    expect(await screen.findByText(STALE_TEXT)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(api.getHousehold).toHaveBeenCalledTimes(2));
  });

  // PROVA-2 (L29): a responsável Maria saiu; José e Rita moram na família dela, Lia em outra família, Davi sem família.
  const EXITED = household({ families: [ family({ responsible_exited: true }),
    family({ id: "fa2", responsible: { patient_id: "pa5", display_name: "Pedro Alves" }, members_count: 1 }) ] });
  const RITA = registration({ id: "rg5", is_responsible: false, status: "refused", refused: true,
    patient: { ...JOSE.patient, id: "pa6", display_name: "Rita das Dores", full_name: "Rita das Dores" } });
  const LIA = registration({ id: "rg6", is_responsible: false, family_id: "fa2",
    patient: { ...JOSE.patient, id: "pa7", display_name: "Lia Alves", full_name: "Lia Alves" } });
  const DAVI = registration({ id: "rg7", is_responsible: false, family_id: null,
    patient: { ...JOSE.patient, id: "pa8", display_name: "Davi Souza", full_name: "Davi Souza" } });
  // Saiu (o api não devia listar, mas a tela não confia): fica fora da escolha.
  const CARLA = registration({ id: "rg10", is_responsible: false, status: "exited",
    exit: { reason: "moved", on: "2026-10-20", death_on: null, death_certificate: null },
    patient: { ...JOSE.patient, id: "pa10", display_name: "Carla das Dores", full_name: "Carla das Dores" } });
  const REPLACED = household({ version: 3, families: [ family({ moved_out: true }),
    family({ id: "fa2", responsible: { patient_id: "pa5", display_name: "Pedro Alves" }, members_count: 1 }),
    family({ id: "fa3", responsible: { patient_id: "pa2", display_name: "José das Dores" }, members_count: 2 }) ] });
  const NO_CANDIDATE = "nenhum morador desta família com cadastro ativo — cadastre o novo responsável antes";
  const EFFECT = "Nasce uma família nova com José das Dores como responsável; os moradores passam para ela e a família antiga fica encerrada. " +
    "O parentesco de cada morador precisa ser informado de novo.";

  async function openReplace() {
    mocked(api.getHousehold).mockResolvedValue(EXITED);
    mocked(api.listRegistrations).mockResolvedValue([ registration(), JOSE, RITA, LIA, DAVI, CARLA ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    fireEvent.click(screen.getByRole("button", { name: "Trocar responsável da família de Maria das Dores" }));
  }

  it("responsável que saiu: a marca e 'Trocar responsável' só nessa família; sem a marca, nada de troca", async () => {
    mocked(api.getHousehold).mockResolvedValue(EXITED);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    expect(screen.getAllByText("Responsável saiu — escolha o novo responsável")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Trocar responsável da família de Maria das Dores" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Trocar responsável da família de Pedro Alves" })).toBeNull();
    cleanup();
    // Família em mudança nunca oferece troca (o api manda false, mas a tela não confia).
    mocked(api.getHousehold).mockResolvedValue(household({ families: [ family({ moved_out: true, responsible_exited: true }) ] }));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await openHousehold();
    expect(screen.queryByText("Responsável saiu — escolha o novo responsável")).toBeNull();
    expect(screen.queryByRole("button", { name: /Trocar responsável/ })).toBeNull();
  });

  it("Trocar responsável: só moradores com cadastro ativo da família, sem quem saiu; confirma o efeito; corpo exato; a resposta entra e avisa", async () => {
    mocked(api.replaceResponsible).mockResolvedValue(REPLACED);
    await openReplace();
    const select = screen.getByLabelText("Novo responsável") as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual([ "— escolha —", "José das Dores", "Rita das Dores" ]);
    // Sem escolha, não segue.
    fireEvent.click(screen.getByRole("button", { name: "Trocar responsável" }));
    expect(screen.queryByRole("group", { name: "Confirmar troca de responsável" })).toBeNull();
    expect(document.activeElement).toBe(select);
    fireEvent.change(select, { target: { value: "pa2" } });
    fireEvent.click(screen.getByRole("button", { name: "Trocar responsável" }));
    const confirm = screen.getByRole("group", { name: "Confirmar troca de responsável" });
    expect(confirm.textContent).toContain(EFFECT);
    // O botão que tinha o foco sumiu: o foco vai para o título da confirmação, nunca para o body.
    expect((document.activeElement as HTMLElement).tagName).toBe("STRONG");
    expect((document.activeElement as HTMLElement).textContent).toBe("Confirmar troca de responsável");
    expect(api.replaceResponsible).not.toHaveBeenCalled();
    fireEvent.click(within(confirm).getByRole("button", { name: "Confirmar troca" }));
    expect(await screen.findByText("Responsável trocado. Nova versão enviada ao e-SUS.")).not.toBeNull();
    expect(api.replaceResponsible).toHaveBeenCalledWith("fa1", "pa2", 2);
    expect((document.activeElement as HTMLElement).textContent).toBe("Responsável trocado. Nova versão enviada ao e-SUS.");
    // A resposta (versão 3) entra sem reler o domicílio: família antiga mudou-se, a nova com José; moradores e lista releem.
    expect(screen.getByText("Responsável: José das Dores · 2 pessoas")).not.toBeNull();
    expect(screen.queryByText("Responsável saiu — escolha o novo responsável")).toBeNull();
    expect(api.getHousehold).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.listRegistrations).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api.listHouseholds).toHaveBeenCalledTimes(2));
  });

  it("Trocar responsável: Voltar e Cancelar não enviam; sem morador da família, a tela explica", async () => {
    await openReplace();
    fireEvent.change(screen.getByLabelText("Novo responsável"), { target: { value: "pa2" } });
    fireEvent.click(screen.getByRole("button", { name: "Trocar responsável" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Confirmar troca de responsável" })).getByRole("button", { name: "Voltar" }));
    expect((screen.getByLabelText("Novo responsável") as HTMLSelectElement).value).toBe("pa2");
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.queryByLabelText("Novo responsável")).toBeNull();
    expect(api.replaceResponsible).not.toHaveBeenCalled();
    cleanup();
    mocked(api.getHousehold).mockResolvedValue(EXITED);
    mocked(api.listRegistrations).mockResolvedValue([ LIA, DAVI ]);
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trocar responsável da família de Maria das Dores" }));
    expect(await screen.findByText(NO_CANDIDATE)).not.toBeNull();
  });

  it("Trocar responsável: 409 stale_version pede Recarregar; 422 invalid_family com path foca o campo ou diz a frase", async () => {
    mocked(api.replaceResponsible).mockRejectedValueOnce(new api.ApiError(409, { error: "stale_version" }, "409"));
    await openReplace();
    fireEvent.change(screen.getByLabelText("Novo responsável"), { target: { value: "pa2" } });
    fireEvent.click(screen.getByRole("button", { name: "Trocar responsável" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar troca" }));
    expect(await screen.findByText(STALE_TEXT)).not.toBeNull();
    expect((document.activeElement as HTMLElement).textContent).toBe(STALE_TEXT);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
    await waitFor(() => expect(api.getHousehold).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText("Novo responsável")).toBeNull();

    mocked(api.replaceResponsible).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_family", path: "responsible.patient_id" }, "422"));
    fireEvent.click(await screen.findByRole("button", { name: "Trocar responsável da família de Maria das Dores" }));
    fireEvent.change(screen.getByLabelText("Novo responsável"), { target: { value: "pa6" } });
    fireEvent.click(screen.getByRole("button", { name: "Trocar responsável" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar troca" }));
    expect(await screen.findByText("confira o campo destacado")).not.toBeNull();
    const select = screen.getByLabelText("Novo responsável");
    expect(document.activeElement).toBe(select);
    expect(select.getAttribute("aria-invalid")).toBe("true");

    // Recusa sem campo na tela: o foco vai para a frase.
    mocked(api.replaceResponsible).mockRejectedValueOnce(new api.ApiError(403, { error: "out_of_scope" }, "403"));
    fireEvent.click(screen.getByRole("button", { name: "Trocar responsável" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar troca" }));
    expect(await screen.findByText("esta microárea não é da sua equipe")).not.toBeNull();
    expect((document.activeElement as HTMLElement).textContent).toBe("esta microárea não é da sua equipe");

    // moved_out e version: a frase (com o foco) e "Recarregar", que relê o domicílio e fecha (m2).
    const reloadsWith = async (path: string, text: string) => {
      mocked(api.replaceResponsible).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_family", path }, "422"));
      const reads = mocked(api.getHousehold).mock.calls.length;
      fireEvent.click(screen.getByRole("button", { name: "Trocar responsável" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar troca" }));
      expect(await screen.findByText(text)).not.toBeNull();
      expect((document.activeElement as HTMLElement).textContent).toBe(text);
      fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
      await waitFor(() => expect(api.getHousehold).toHaveBeenCalledTimes(reads + 1));
      expect(screen.queryByLabelText("Novo responsável")).toBeNull();
    };
    await reloadsWith("moved_out", "esta família já se mudou — recarregue o domicílio");
    fireEvent.click(await screen.findByRole("button", { name: "Trocar responsável da família de Maria das Dores" }));
    fireEvent.change(screen.getByLabelText("Novo responsável"), { target: { value: "pa2" } });
    await reloadsWith("version", "a versão do domicílio não confere — recarregue o domicílio");
  });

  it("Trocar responsável enquanto os moradores carregam ou se a leitura falha: nunca 'nenhum morador… cadastre antes' (m1)", async () => {
    mocked(api.getHousehold).mockResolvedValue(EXITED);
    mocked(api.listRegistrations).mockReturnValue(new Promise(() => {}));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trocar responsável da família de Maria das Dores" }));
    const box = () => screen.getByText("Trocar responsável", { selector: "strong" }).parentElement as HTMLElement;
    expect(within(box()).getByText("carregando…")).not.toBeNull();
    expect(screen.queryByText(NO_CANDIDATE)).toBeNull();
    expect(screen.queryByLabelText("Novo responsável")).toBeNull();
    cleanup();
    mocked(api.listRegistrations).mockRejectedValue(new api.ApiError(403, { error: "out_of_scope" }, "403"));
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Rua das Flores, 120" }));
    fireEvent.click(await screen.findByRole("button", { name: "Trocar responsável da família de Maria das Dores" }));
    expect(await within(box()).findByText("esta microárea não é da sua equipe")).not.toBeNull();
    expect(screen.queryByText(NO_CANDIDATE)).toBeNull();
    expect(screen.queryByRole("button", { name: "Trocar responsável" })).toBeNull();
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

  it("equipe sem nome no CNES: 'equipe sem nome', nunca 'null'", async () => {
    const base = territoryContext().teams[0];
    mocked(api.getTerritoryContext).mockResolvedValue({ teams: [ { ...base, name: null }, { ...TEAM_EAP, unit: { id: "u2", name: "UBS Boqueirão" },
      micro_areas: [ { ...microArea({ id: "ma9", code: "07", name: "Boqueirão norte", team: TEAM_EAP }), can_register: true } ] } ] });
    renderWithProviders(<TerritoryTeam today={TODAY24} />);
    await screen.findByText("Rua das Flores, 120");
    expect(screen.getByRole("option", { name: "equipe sem nome · INE 0001234567 · UBS Vila Verde" })).not.toBeNull();
    expect(document.body.textContent).not.toMatch(/null/);
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
