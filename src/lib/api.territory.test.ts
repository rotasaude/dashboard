// Cliente do cadastro territorial (módulo 24a; contrato §3–§6, §14 L1–L25).
// As formas são as do api REAL (apps/api, mod24a): pessoa por CPF sem
// envelope, família com responsible.patient_id, códigos de tipo de imóvel e
// renda como texto, saída com death_on, contagem com missing_identifier.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addFamily, countRegistryStatus, createHousehold, createMicroArea, createRegistration, exitRegistration, findDuplicates, getHousehold,
  getRegistration, getTerritoryContext, listHouseholds, listMicroAreas, listRegistrations, listRegistryStatus, listTerritoryAdminTeams,
  lookupTerritoryPerson, TERRITORY_PAGE_SIZE, updateFamily, updateHousehold, updateMicroArea, updateRegistration
} from "./api";
import type { HouseholdInput, RegistrationInput } from "./api";
import { household, personRow, profilelessRegistration, registration, territoryContext, territoryUser } from "../test/territoryFixtures";

function ok(body: unknown): Promise<Response> {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } }));
}

const SENSITIVE = /cpf|cns|name|nome|mother|birth|nasc|health|saude|street|rua|refus|living|moradia|\d{11}/i;
const CURSOR = "patient:3f1c2a9e-7b4d-4e2a-9c1f-0a1b2c3d4e5f";

describe("cliente do cadastro territorial (contrato §3–§6)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(() => ok({})); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => vi.unstubAllGlobals());

  const urlOf = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]), "http://curitiba.localhost");
  const initOf = (i = 0) => (fetchMock.mock.calls[i][1] ?? {}) as RequestInit;
  const headersOf = (i = 0) => initOf(i).headers as Record<string, string>;
  const bodyOf = (i = 0) => JSON.parse(String(initOf(i).body));

  it("microáreas: equipes do admin e lista por equipe em envelope; escrita com JSON", async () => {
    fetchMock
      .mockImplementationOnce(() => ok({ teams: [ { id: "tm1" } ] }))
      .mockImplementationOnce(() => ok({ micro_areas: [ { id: "ma1" } ] }))
      .mockImplementationOnce(() => ok({ id: "ma2" }))
      .mockImplementationOnce(() => ok({ id: "ma2" }))
      .mockImplementationOnce(() => ok({ id: "ma2" }));
    expect(await listTerritoryAdminTeams()).toEqual([ { id: "tm1" } ]);
    expect(urlOf(0).pathname).toBe("/territory/admin/teams");
    expect(await listMicroAreas("tm1")).toEqual([ { id: "ma1" } ]);
    expect(urlOf(1).pathname + urlOf(1).search).toBe("/territory/admin/micro_areas?team_id=tm1");
    expect(await createMicroArea({ team_id: "tm1", code: "02", name: "Vila Verde de baixo", acs_professional_id: "pr9" })).toEqual({ id: "ma2" });
    expect(urlOf(2).pathname).toBe("/territory/admin/micro_areas");
    expect(initOf(2).method).toBe("POST");
    expect(headersOf(2)["Content-Type"]).toBe("application/json");
    expect(bodyOf(2)).toEqual({ team_id: "tm1", code: "02", name: "Vila Verde de baixo", acs_professional_id: "pr9" });
    await updateMicroArea("ma2", { active: false });
    expect(urlOf(3).pathname).toBe("/territory/admin/micro_areas/ma2");
    expect(initOf(3).method).toBe("PATCH");
    expect(bodyOf(3)).toEqual({ active: false });
    // null tira o ACS (contrato §3): o null vai no corpo, não some.
    await updateMicroArea("ma2", { acs_professional_id: null });
    expect(bodyOf(4)).toEqual({ acs_professional_id: null });
  });

  it("listas sem envelope viram vazias (api antigo ou corpo vazio)", async () => {
    expect(await listTerritoryAdminTeams()).toEqual([]);
    expect(await listMicroAreas("tm1")).toEqual([]);
    expect(await listHouseholds({ microAreaId: "ma1" })).toEqual({ households: [], next_before: null });
    expect(await findDuplicates({ full_name: "Maria da Silva", birth_date: "1960-02-01" })).toEqual([]);
    expect(await listRegistrations({ householdId: "hh1" })).toEqual([]);
    expect(await listRegistryStatus({ teamId: "tm1" })).toEqual({ people: [], next_before: null });
    expect(await countRegistryStatus("tm1")).toEqual({ valid: 0, due_soon: 0, expired: 0, missing: 0, missing_identifier: 0 });
  });

  it("contexto do profissional (L2); ausente vira vazio", async () => {
    fetchMock.mockImplementationOnce(() => ok({ teams: [ { id: "tm1", micro_areas: [] } ] })).mockImplementationOnce(() => ok({}));
    expect(await getTerritoryContext()).toEqual({ teams: [ { id: "tm1", micro_areas: [] } ] });
    expect(urlOf(0).pathname).toBe("/territory/teams");
    expect(await getTerritoryContext()).toEqual({ teams: [] });
  });

  it("domicílios: lista paginada só com ids e cursor opaco; versão esperada no corpo; família com responsible", async () => {
    fetchMock
      .mockImplementationOnce(() => ok({ households: [], next_before: "MjAyNi0xMC0yM3xoaDE" }))
      .mockImplementationOnce(() => ok({ id: "hh1" }))
      .mockImplementationOnce(() => ok({ id: "hh1" }))
      .mockImplementationOnce(() => ok({ id: "hh1" }))
      .mockImplementationOnce(() => ok({ id: "hh1" }))
      .mockImplementationOnce(() => ok({ id: "hh1" }))
      .mockImplementationOnce(() => ok({ households: [], next_before: null }));
    expect(await listHouseholds({ microAreaId: "ma1", before: "MjAyNi0wOS0wMXxoaDA" }))
      .toEqual({ households: [], next_before: "MjAyNi0xMC0yM3xoaDE" });
    expect(urlOf(0).pathname + urlOf(0).search).toBe(`/territory/households?micro_area_id=ma1&before=MjAyNi0wOS0wMXxoaDA&limit=${TERRITORY_PAGE_SIZE}`);
    expect(await getHousehold("hh1")).toEqual({ id: "hh1" });
    expect(urlOf(1).pathname).toBe("/territory/households/hh1");
    const input: HouseholdInput = {
      micro_area_id: "ma1",
      address: { zip: "81020000", street_type: "081", street: "das Flores", number: "120", no_number: false, complement: null,
        neighborhood_id: "nb1", district: null, reference: null },
      property_type: "1", living_conditions: { localizacao: 83, situacao_moradia_posse_terra: 75, nu_comodos: 4 },
      contact_phone: "41999990000", refused: false
    };
    await createHousehold(input);
    expect(urlOf(2).pathname).toBe("/territory/households");
    expect(initOf(2).method).toBe("POST");
    expect(bodyOf(2)).toEqual(input);
    await updateHousehold("hh1", { ...input, status: "inactive" }, 3);
    expect(urlOf(3).pathname).toBe("/territory/households/hh1");
    expect(initOf(3).method).toBe("PATCH");
    expect(bodyOf(3)).toEqual({ ...input, status: "inactive", version: 3 });
    await addFamily("hh1", { responsible: { patient_id: "pa1" }, income_band: "3", members_count: 4, living_since: "2019-05" }, 3);
    expect(urlOf(4).pathname).toBe("/territory/households/hh1/families");
    expect(initOf(4).method).toBe("POST");
    expect(bodyOf(4)).toEqual({ responsible: { patient_id: "pa1" }, income_band: "3", members_count: 4, living_since: "2019-05", version: 3 });
    // O responsável nunca muda: a edição não o manda.
    await updateFamily("fa1", { income_band: null, members_count: null, living_since: null, moved_out: true }, 4);
    expect(urlOf(5).pathname).toBe("/territory/families/fa1");
    expect(initOf(5).method).toBe("PATCH");
    expect(bodyOf(5)).toEqual({ income_band: null, members_count: null, living_since: null, moved_out: true, version: 4 });
    // Primeira página: sem before.
    await listHouseholds({ microAreaId: "ma1", before: null });
    expect(urlOf(6).search).toBe(`?micro_area_id=ma1&limit=${TERRITORY_PAGE_SIZE}`);
    for (let i = 0; i < 7; i++) expect(urlOf(i).search).not.toMatch(SENSITIVE);
  });

  it("duplicados e busca por CPF: tudo no corpo de um POST; a pessoa vem sem envelope (L3)", async () => {
    const person = { patient_id: "pa1", citizen_id: null, display_name: "Maria das Dores", registration_id: "rg1" };
    fetchMock
      .mockImplementationOnce(() => ok({ candidates: [ { patient_id: "pa7", display_name: "Maria da Silva", birth_date: "1960-02-01", has_cpf: false, registration_id: "rg7" } ] }))
      .mockImplementationOnce(() => ok(person));
    expect(await findDuplicates({ full_name: "Maria da Silva", birth_date: "1960-02-01", mother_name: "Ana da Silva" }))
      .toEqual([ { patient_id: "pa7", display_name: "Maria da Silva", birth_date: "1960-02-01", has_cpf: false, registration_id: "rg7" } ]);
    expect(urlOf(0).pathname + urlOf(0).search).toBe("/territory/patients/duplicates");
    expect(initOf(0).method).toBe("POST");
    expect(bodyOf(0)).toEqual({ full_name: "Maria da Silva", birth_date: "1960-02-01", mother_name: "Ana da Silva" });
    expect(await lookupTerritoryPerson("52998224725")).toEqual(person);
    expect(urlOf(1).pathname + urlOf(1).search).toBe("/territory/person_lookup");
    expect(initOf(1).method).toBe("POST");
    expect(bodyOf(1)).toEqual({ cpf: "52998224725" });
  });

  it("cadastro individual: criar, atualizar com versão, saída, leitura e lista só com ids na URL", async () => {
    fetchMock.mockImplementation(() => ok({ id: "rg1", registrations: [ { id: "rg1" } ] }));
    const input: RegistrationInput = {
      new_patient: { full_name: "José Souza", birth_date: "2026-09-30", sex: "male", mother_name: "Rita Souza", no_cpf_reason: "3" },
      patient_demographics: { race_color: "03", ethnicity: null },
      household_id: "hh1", family_id: "fa1", is_responsible: false,
      identification: { nacionalidade_cidadao: 1, codigo_ibge_municipio_nascimento: "4106902", pais_nascimento: 31, desconhece_nome_pai: true },
      sociodemographic: { status_deseja_informar_orientacao_sexual: false, status_deseja_informar_identidade_genero: false },
      health_conditions: { status_tem_diabetes: false }, street_situation: { status_situacao_rua: false }, refused: false
    };
    await createRegistration(input);
    expect(urlOf(0).pathname).toBe("/territory/registrations");
    expect(initOf(0).method).toBe("POST");
    expect(bodyOf(0)).toEqual(input);
    // Paciente existente: identidade digitada em `patient`, CPF e CNS na raiz.
    await updateRegistration("rg1", { patient: { full_name: "Maria das Dores", mother_name: null }, cpf: "52998224725",
      sociodemographic: {}, health_conditions: {} }, 2);
    expect(urlOf(1).pathname).toBe("/territory/registrations/rg1");
    expect(initOf(1).method).toBe("PATCH");
    expect(bodyOf(1)).toEqual({ patient: { full_name: "Maria das Dores", mother_name: null }, cpf: "52998224725",
      sociodemographic: {}, health_conditions: {}, version: 2 });
    await exitRegistration("rg1", { reason: "death", on: "2026-10-21", death_on: "2026-10-20", death_certificate: "123456789" });
    expect(urlOf(2).pathname).toBe("/territory/registrations/rg1/exit");
    expect(initOf(2).method).toBe("POST");
    expect(bodyOf(2)).toEqual({ reason: "death", on: "2026-10-21", death_on: "2026-10-20", death_certificate: "123456789" });
    await getRegistration("rg1");
    expect(urlOf(3).pathname).toBe("/territory/registrations/rg1");
    expect(await listRegistrations({ householdId: "hh1" })).toEqual([ { id: "rg1" } ]);
    expect(urlOf(4).pathname + urlOf(4).search).toBe("/territory/registrations?household_id=hh1");
    await listRegistrations({ patientId: "pa1" });
    expect(urlOf(5).search).toBe("?patient_id=pa1");
    await exitRegistration("rg1", { reason: "moved", on: "2026-10-21" });
    expect(bodyOf(6)).toEqual({ reason: "moved", on: "2026-10-21" });
    for (let i = 0; i < 7; i++) expect(urlOf(i).search).not.toMatch(SENSITIVE);
  });

  it("validade: lista com filtros e cursor; contagem sem trilha, com missing_identifier (L19)", async () => {
    const counts = { valid: 120, due_soon: 8, expired: 31, missing: 44, missing_identifier: 5 };
    fetchMock
      .mockImplementationOnce(() => ok({ people: [], next_before: null }))
      .mockImplementationOnce(() => ok({ people: [], next_before: null }))
      .mockImplementationOnce(() => ok(counts))
      .mockImplementationOnce(() => ok(counts));
    expect(await listRegistryStatus({ teamId: "tm1", microAreaId: "ma1", status: "missing_identifier", before: null }))
      .toEqual({ people: [], next_before: null });
    expect(urlOf(0).pathname + urlOf(0).search)
      .toBe(`/territory/registry_status?team_id=tm1&micro_area_id=ma1&status=missing_identifier&limit=${TERRITORY_PAGE_SIZE}`);
    await listRegistryStatus({ teamId: "tm1", status: "expired", before: CURSOR });
    expect(urlOf(1).searchParams.get("before")).toBe(CURSOR);
    expect(urlOf(1).searchParams.get("micro_area_id")).toBeNull();
    expect(await countRegistryStatus("tm1")).toEqual(counts);
    expect(urlOf(2).pathname + urlOf(2).search).toBe("/territory/registry_status/count?team_id=tm1");
    await countRegistryStatus("tm1", "ma1");
    expect(urlOf(3).search).toBe("?team_id=tm1&micro_area_id=ma1");
    for (let i = 0; i < 4; i++) expect(urlOf(i).search).not.toMatch(SENSITIVE);
  });
});

describe("dados de teste do cadastro territorial (formas do api real)", () => {
  it("domicílio: endereço com as chaves do TerritoryRegistry::Address; tipo de imóvel e renda como texto", () => {
    const hh = household();
    expect(Object.keys(hh.address).sort())
      .toEqual([ "complement", "district", "neighborhood_id", "no_number", "number", "reference", "street", "street_type", "zip" ]);
    expect(hh.property_type).toBe("1");
    expect(hh.families[0].income_band).toBe("3");
    expect(hh.families[0].responsible.patient_id).toBe("pa1");
  });

  it("cadastro: sexo em texto, identity_locked, demografia e revisão de identidade", () => {
    const rg = registration();
    expect(rg.patient.sex).toBe("female");
    expect(rg.patient.identity_locked).toBe(true);
    expect(rg.patient_demographics).toEqual({ race_color: "03", ethnicity: null });
    expect(rg.identity_review_pending).toBe(false);
    expect(rg.team.id).toBe("tm1");
    expect(personRow().identity_review_pending).toBe(false);
  });

  it("paciente sem perfil (par validado sem nome, nascimento e sexo): os campos chegam nulos", () => {
    const p = profilelessRegistration().patient;
    expect([ p.display_name, p.full_name, p.birth_date, p.sex ]).toEqual([ null, null, null, null ]);
    expect(p.has_cpf).toBe(true);
  });

  it("new_patient não aceita patient, cpf nem cns no mesmo corpo (o api recusa)", () => {
    const np = { full_name: "José Souza", birth_date: "2026-09-30", sex: "male" as const, no_cpf_reason: "3" };
    // @ts-expect-error — cpf na raiz só para paciente existente
    const withCpf: RegistrationInput = { new_patient: np, cpf: "52998224725", team_id: "tm1" };
    // @ts-expect-error — identidade digitada só para paciente existente
    const withPatient: RegistrationInput = { new_patient: np, patient: { full_name: "José Souza" }, team_id: "tm1" };
    const existing: RegistrationInput = { patient_id: "pa1", cpf: "52998224725", cns: null, team_id: "tm1" };
    expect([ withCpf, withPatient, existing ].length).toBe(3);
  });

  it("sessão e contexto: interruptor ligado e microárea de outro ACS sem gravação", () => {
    expect(territoryUser().features).toEqual([ "clinical_record", "territory_registry" ]);
    const areas = territoryContext().teams[0].micro_areas;
    expect(areas.map((a) => [ a.id, a.can_register ])).toEqual([ [ "ma1", true ], [ "ma2", false ] ]);
  });
});
