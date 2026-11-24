// src/modules/ZooShelter.test.tsx
// Canil e gatil do centro de zoonoses (módulo 35b, Task 11; F-35.16): estadas abertas, entrada (cadastrado e sem cadastro),
// saída (adotante, devolução), castração e eutanásia com step-up pelo veterinário logado. Formas do api JÁ pronto (api-shapes.md):
// as estadas não trazem nome nem tutor; a unidade vem da rota de unidades (não há `shelter_units`).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getZoonosesDomains: vi.fn(), listActiveUnits: vi.fn(), getMyProfessional: vi.fn(),
    listShelterStays: vi.fn(), enterShelter: vi.fn(), exitShelter: vi.fn(), recordNeutering: vi.fn(), recordEuthanasia: vi.fn(),
    getAnimal: vi.fn(), searchAnimals: vi.fn(), lookupZooPerson: vi.fn(), listObservations: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError, type ShelterStayPage } from "../lib/api";
import { ZOO_NOT_VET } from "../lib/zoonoses";
import { ZOONOSES_ERRORS } from "../lib/zoonosesErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { PERSON, TODAY35B, ZOO_DOMAINS, animal, euthanasia, history, observation, stay, vetProfessional, zooUser } from "../test/zoonosesFixtures";
import { ZooShelter } from "./ZooShelter";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const MOCKS = [
  api.fetchCurrentSession, api.getZoonosesDomains, api.listActiveUnits, api.getMyProfessional, api.listShelterStays, api.enterShelter,
  api.exitShelter, api.recordNeutering, api.recordEuthanasia, api.getAnimal, api.searchAnimals, api.lookupZooPerson, api.listObservations
];
const page = (items = [ stay() ], open = items.length): ShelterStayPage => ({ items, next_before: null, occupancy: [ { health_unit_id: "uvz1", open_stays: open } ] });
const apiError = (status: number, error: string, path?: string) => new ApiError(status, { error, ...(path ? { path } : {}) }, error);
const MICROCHIP = "985112003456789";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of MOCKS) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(zooUser());
  mocked(api.getZoonosesDomains).mockResolvedValue(ZOO_DOMAINS);
  mocked(api.getMyProfessional).mockResolvedValue(vetProfessional());
  mocked(api.listShelterStays).mockResolvedValue(page());
  mocked(api.getAnimal).mockResolvedValue(history());
  mocked(api.listObservations).mockResolvedValue({ items: [], next_before: null });
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const set = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const view = () => renderWithProviders(<ZooShelter today={TODAY35B} />);
const open = async () => {
  const r = view();
  fireEvent.click(await screen.findByRole("button", { name: "Abrir animal" }));
  await screen.findByRole("article");
  return r;
};
const settle = () => new Promise((r) => setTimeout(r, 30));
const staysCalls = () => mocked(api.listShelterStays).mock.calls.length;
const animalCalls = () => mocked(api.getAnimal).mock.calls.length;

describe("estadas abertas", () => {
  it("lista a unidade de vigilância ambiental com a contagem e sem tutor, nome nem microchip", async () => {
    view();
    expect(await screen.findByText("UVZ Central")).not.toBeNull();
    // A unidade vem dos domínios; /attendance/units é fechado à equipe de zoonoses.
    expect(api.listActiveUnits).not.toHaveBeenCalled();
    expect(await screen.findByText("1 animal no canil")).not.toBeNull();
    expect(screen.getByText("Thor")).not.toBeNull();
    expect(screen.queryByText(/#an1/)).toBeNull();
    expect(mocked(api.listShelterStays).mock.calls[0][0]).toEqual({ open: true, healthUnitId: "uvz1", before: null });
  });

  it("a aba Saídas lê as estadas da unidade e mostra só as fechadas", async () => {
    mocked(api.listShelterStays).mockResolvedValue(page([
      stay({ id: "st1" }), stay({ id: "st2", animal_id: "bb222222-x", animal: { id: "bb222222-x", name: null, species: "dog" }, exit_kind: "adopted", exited_on: "2026-11-22" })
    ], 1));
    view();
    fireEvent.click(await screen.findByRole("tab", { name: "Saídas" }));
    expect(await screen.findByText("Adoção em 22/11/2026")).not.toBeNull();
    expect(screen.getByText("Cão sem nome")).not.toBeNull();
    expect(screen.queryByText("Thor")).toBeNull();
    await waitFor(() => expect(mocked(api.listShelterStays).mock.calls.some(([q]) => q.open === false)).toBe(true));
  });

  it("sem unidade de vigilância ambiental ativa: a frase", async () => {
    mocked(api.getZoonosesDomains).mockResolvedValue({ ...ZOO_DOMAINS, units: [] });
    view();
    expect(await screen.findByText("nenhuma unidade de vigilância ambiental ativa")).not.toBeNull();
  });
});

describe("eutanásia", () => {
  it("eutanásia: step-up, um envio, recusas do não veterinário e da duplicidade, só leitura depois", async () => {
    let finish: (e: ReturnType<typeof euthanasia>) => void = () => undefined;
    mocked(api.recordEuthanasia).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    await open();
    click("Registrar eutanásia");
    // O veterinário logado, não um campo.
    expect(screen.getByText("Dra. Ana Lima · CRMV-PR 12345")).not.toBeNull();
    click("Revisar eutanásia");
    expect(await screen.findByText("escolha o motivo")).not.toBeNull();
    expect(screen.getByText("marque ao menos uma base legal")).not.toBeNull();
    set("Motivo", "leishmaniasis");
    set("Nota do motivo", "curto");
    fireEvent.click(screen.getByLabelText("Resolução CFMV nº 1.000/2012"));
    click("Revisar eutanásia");
    expect(await screen.findByText(/pelo menos 10|10 a 1000|mínimo/i)).not.toBeNull();
    expect(api.recordEuthanasia).not.toHaveBeenCalled();
    set("Nota do motivo", "Cão reagente, tutor recusou o tratamento.");
    click("Revisar eutanásia");
    expect(await screen.findByText("A eutanásia não se edita nem se apaga. O animal passa a morto na data informada.")).not.toBeNull();
    expect(api.recordEuthanasia).not.toHaveBeenCalled();

    // A releitura nunca chega: o 201 sozinho já deixa a tela só para leitura.
    mocked(api.getAnimal).mockReturnValue(new Promise(() => undefined));
    const confirm = screen.getByRole("button", { name: "Registrar eutanásia" });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.recordEuthanasia).toHaveBeenCalledTimes(1));
    expect(mocked(api.recordEuthanasia).mock.calls[0][0]).toEqual({
      animal_id: "an1", performed_on: TODAY35B, reason: "leishmaniasis", reason_note: "Cão reagente, tutor recusou o tratamento.",
      legal_basis: [ "cfmv_1000_2012" ], shelter_stay_id: "st1"
    });
    finish(euthanasia());
    // Depois do 201: o resumo só para leitura e nenhum botão de registrar (sem esperar a releitura).
    const summary = await screen.findByLabelText("Eutanásia registrada");
    expect(screen.queryByRole("button", { name: /Registrar eutanásia/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar castração" })).toBeNull();
    expect(within(summary).getByText(/Dra\. Ana Lima \(CRMV-PR 12345\)/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar eutanásia/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revisar eutanásia" })).toBeNull();
    expect(screen.getByText("Óbito")).not.toBeNull();
    await settle();
    expect(api.recordEuthanasia).toHaveBeenCalledTimes(1);
  });

  it("eutanásia: observação aberta do animal e 403 veterinarian_required: a frase e uma releitura, sem reenvio", async () => {
    mocked(api.getAnimal).mockResolvedValue(history({
      observations: [ { id: "ob1", exposure_on: "2026-11-15", ends_on: "2026-11-25", place: "shelter", state: "open", outcome: null, outcome_on: null } ]
    }));
    mocked(api.recordEuthanasia).mockRejectedValue(apiError(403, "veterinarian_required"));
    await open();
    click("Registrar eutanásia");
    set("Motivo", "rabies_suspect");
    set("Nota do motivo", "Sinais neurológicos progressivos.");
    fireEvent.click(screen.getByLabelText("Lei nº 14.228/2021"));
    click("Revisar eutanásia");
    const before = animalCalls();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar eutanásia" }));
    expect(await screen.findByText(ZOONOSES_ERRORS.veterinarian_required)).not.toBeNull();
    expect(mocked(api.recordEuthanasia).mock.calls[0][0]).toMatchObject({ bite_observation_id: "ob1", legal_basis: [ "law_14228_2021" ] });
    await waitFor(() => expect(animalCalls()).toBe(before + 1));
    await settle();
    expect(api.recordEuthanasia).toHaveBeenCalledTimes(1);
    expect(animalCalls()).toBe(before + 1);
  });

  it("eutanásia: 409 already_euthanized → a frase, uma releitura e o histórico só para leitura", async () => {
    mocked(api.recordEuthanasia).mockRejectedValue(apiError(409, "already_euthanized"));
    await open();
    click("Registrar eutanásia");
    set("Motivo", "leishmaniasis");
    set("Nota do motivo", "Cão reagente, tutor recusou o tratamento.");
    fireEvent.click(screen.getByLabelText("Resolução CFMV nº 1.000/2012"));
    click("Revisar eutanásia");
    mocked(api.getAnimal).mockResolvedValue(history({ status: "deceased", euthanasia: euthanasia() }));
    const before = animalCalls();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar eutanásia" }));
    expect(await screen.findByText(ZOONOSES_ERRORS.already_euthanized)).not.toBeNull();
    expect(await screen.findByLabelText("Eutanásia registrada")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Registrar eutanásia/ })).toBeNull();
    await settle();
    expect(api.recordEuthanasia).toHaveBeenCalledTimes(1);
    expect(animalCalls()).toBe(before + 1);
  });

  it("usuário da equipe sem perfil de veterinário: sem castração nem eutanásia e a frase", async () => {
    mocked(api.getMyProfessional).mockResolvedValue(null);
    await open();
    expect(await screen.findByText(ZOO_NOT_VET)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar castração" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar eutanásia" })).toBeNull();
    // A saída segue aberta à equipe.
    expect(screen.getByRole("button", { name: "Registrar saída" })).not.toBeNull();
  });

  it("perfil de veterinário sem o papel da equipe nem entra na tela", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "municipal_admin" ]));
    view();
    expect(await screen.findByText("seu papel não permite usar o centro de zoonoses")).not.toBeNull();
    expect(api.listShelterStays).not.toHaveBeenCalled();
  });
});

describe("castração", () => {
  it("castração marca castrado e não oferece desfazer", async () => {
    mocked(api.recordNeutering).mockResolvedValue({
      id: "ne1", animal_id: "an1", performed_on: TODAY35B, shelter_stay_id: "st1", veterinarian: { name: "Dra. Ana Lima", crmv: "CRMV-PR 12345" }, created_at: "x"
    });
    await open();
    click("Registrar castração");
    mocked(api.getAnimal).mockReturnValue(new Promise(() => undefined));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar castração" }));
    await waitFor(() => expect(api.recordNeutering).toHaveBeenCalledTimes(1));
    expect(api.recordNeutering).toHaveBeenCalledWith({ animal_id: "an1", performed_on: TODAY35B, shelter_stay_id: "st1" });
    expect(await screen.findByText("Castração registrada.")).not.toBeNull();
    // Sem esperar a releitura: castrado e sem o botão.
    expect(await screen.findByText("castrado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar castração" })).toBeNull();
    expect(screen.queryByRole("button", { name: /desfazer|reverter|anular/i })).toBeNull();
  });

  it("animal já castrado não oferece a castração", async () => {
    mocked(api.getAnimal).mockResolvedValue(history({ neutered: true }));
    await open();
    expect(await screen.findByText("castrado")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar castração" })).toBeNull();
    expect(screen.getByRole("button", { name: "Registrar eutanásia" })).not.toBeNull();
  });
});

describe("entrada", () => {
  it("entrada sem cadastro cria o animal sem tutor; segunda entrada → 409 stay_already_open relê uma vez", async () => {
    mocked(api.enterShelter).mockRejectedValueOnce(apiError(409, "stay_already_open", "animal_id"));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar entrada" }));
    fireEvent.click(screen.getByRole("tab", { name: "Animal sem cadastro" }));
    click("Registrar entrada");
    expect(await screen.findByText("escolha a espécie")).not.toBeNull();
    expect(screen.getByText("escolha o tipo de entrada")).not.toBeNull();
    expect(api.enterShelter).not.toHaveBeenCalled();
    set("Espécie", "dog");
    set("Sexo", "male");
    set("Porte", "medium");
    set("Pelagem", "caramelo");
    set("Tipo de entrada", "collection");
    const before = staysCalls();
    click("Registrar entrada");
    await waitFor(() => expect(api.enterShelter).toHaveBeenCalledTimes(1));
    const sent = mocked(api.enterShelter).mock.calls[0][0];
    expect(sent).toEqual({
      health_unit_id: "uvz1", entry_kind: "collection", entered_on: TODAY35B,
      new_animal: { species: "dog", sex: "male", size: "medium", coat: "caramelo", community: false }
    });
    expect(JSON.stringify(sent)).not.toMatch(/tutor|household/);
    expect(await screen.findByText(ZOONOSES_ERRORS.stay_already_open)).not.toBeNull();
    await waitFor(() => expect(staysCalls()).toBe(before + 1));
    await settle();
    expect(api.enterShelter).toHaveBeenCalledTimes(1);
    expect(staysCalls()).toBe(before + 1);
    expect(screen.queryByRole("form", { name: "Entrada no canil" })).toBeNull();
  });

  it("entrada por observação exige escolher uma observação aberta; sem o microchip no cache", async () => {
    mocked(api.listObservations).mockResolvedValue({
      items: [ observation({ id: "ob1", animal_id: null, species: "dog" }), observation({ id: "ob2", animal_id: "zz9", species: "cat" }) ], next_before: null
    });
    mocked(api.searchAnimals).mockResolvedValue({ items: [ animal() ], next_before: null });
    mocked(api.enterShelter).mockResolvedValue({ ...stay({ id: "st9", entry_kind: "observation", bite_observation_id: "ob1" }), animal: animal() });
    const { client } = view();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar entrada" }));
    set("Número do microchip", MICROCHIP);
    click("Buscar");
    fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));
    set("Tipo de entrada", "observation");
    await screen.findByLabelText("Observação aberta");
    // A observação que já tem outro animal não é oferecida.
    await waitFor(() => expect(within(screen.getByLabelText("Observação aberta")).getAllByRole("option")).toHaveLength(2));
    expect(screen.getByText("A observação passa a correr no canil.")).not.toBeNull();
    click("Registrar entrada");
    expect(await screen.findByText("escolha a observação aberta")).not.toBeNull();
    expect(api.enterShelter).not.toHaveBeenCalled();
    set("Observação aberta", "ob1");
    click("Registrar entrada");
    await waitFor(() => expect(api.enterShelter).toHaveBeenCalledTimes(1));
    expect(mocked(api.enterShelter).mock.calls[0][0]).toEqual({
      health_unit_id: "uvz1", entry_kind: "observation", entered_on: TODAY35B, animal_id: "an1", bite_observation_id: "ob1"
    });
    expect(await screen.findByText("Entrada registrada.")).not.toBeNull();
    // Nada do microchip nas chaves do cache.
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.queryKey))).not.toContain(MICROCHIP);
  });
});

describe("saída", () => {
  it("saída adotado exige o adotante; devolvido sem tutor recusa antes", async () => {
    mocked(api.getAnimal).mockResolvedValue(history({ has_tutor: false, tutor: null }));
    mocked(api.lookupZooPerson).mockResolvedValue(PERSON);
    mocked(api.exitShelter).mockResolvedValue(stay({ exit_kind: "adopted", exited_on: TODAY35B, version: 2 }));
    await open();
    click("Registrar saída");
    set("Tipo de saída", "returned");
    click("Registrar saída");
    expect(await screen.findByText("o animal precisa de tutor para esta ação")).not.toBeNull();
    expect(api.exitShelter).not.toHaveBeenCalled();

    set("Tipo de saída", "adopted");
    click("Registrar saída");
    expect(await screen.findByText("escolha o adotante")).not.toBeNull();
    expect(api.exitShelter).not.toHaveBeenCalled();
    set(/Adotante — CPF ou CNS/, "52998224725");
    click("Buscar pessoa");
    expect(await screen.findByText("M. S.")).not.toBeNull();
    click("Registrar saída");
    await waitFor(() => expect(api.exitShelter).toHaveBeenCalledTimes(1));
    expect(api.exitShelter).toHaveBeenCalledWith("st1", { exit_kind: "adopted", exited_on: TODAY35B, adopter_patient_id: "pt1", expected_version: 1 });
    expect(await screen.findByText("Saída registrada.")).not.toBeNull();
  });

  it("saída por eutanásia exige a eutanásia gravada antes", async () => {
    await open();
    click("Registrar saída");
    set("Tipo de saída", "euthanasia");
    click("Registrar saída");
    expect(await screen.findByText("registre antes a eutanásia do animal")).not.toBeNull();
    expect(api.exitShelter).not.toHaveBeenCalled();
  });

  it("409 stay_changed → a frase e uma releitura, nenhum reenvio", async () => {
    mocked(api.exitShelter).mockRejectedValue(apiError(409, "stay_changed"));
    await open();
    click("Registrar saída");
    set("Tipo de saída", "returned");
    const before = staysCalls();
    click("Registrar saída");
    expect(await screen.findByText(ZOONOSES_ERRORS.stay_changed)).not.toBeNull();
    await waitFor(() => expect(staysCalls()).toBe(before + 1));
    await settle();
    expect(api.exitShelter).toHaveBeenCalledTimes(1);
    expect(api.exitShelter).toHaveBeenCalledWith("st1", { exit_kind: "returned", exited_on: TODAY35B, expected_version: 1 });
    expect(staysCalls()).toBe(before + 1);
  });
});
