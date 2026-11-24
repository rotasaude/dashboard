// src/modules/ZooAnimals.test.tsx
// Animais do centro de zoonoses (módulo 35b, Task 5; F-35.11): busca (microchip e registro direto, sem cache; tutor e domicílio
// pela pessoa), cadastro com tutor, comunitário ou tutor não identificado, domicílio só pela pessoa (Q25), histórico, edição com
// `expected_version` e a mudança de situação (Q31, estada aberta).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getZoonosesDomains: vi.fn(), searchAnimals: vi.fn(), lookupZooPerson: vi.fn(), createAnimal: vi.fn(),
    getAnimal: vi.fn(), updateAnimal: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ANIMAL_STAY_OPEN, ZOONOSES_ERRORS } from "../lib/zoonosesErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { PERSON, TODAY35B, ZOO_DOMAINS, animal, history, zooUser } from "../test/zoonosesFixtures";
import { ZooAnimals } from "./ZooAnimals";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const CPF = "52998224725";
const CHIP = "985112003456789";
const OTHER: api.ZooPerson = { patient: { id: "pt2", display_name: "J. P." }, household: { id: "h2", address_short: "R. do Sol, 3" } };

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getZoonosesDomains, api.searchAnimals, api.lookupZooPerson, api.createAnimal, api.getAnimal, api.updateAnimal ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(zooUser());
  mocked(api.getZoonosesDomains).mockResolvedValue(ZOO_DOMAINS);
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const set = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const view = () => renderWithProviders(<ZooAnimals today={TODAY35B} />);

async function lookupTutor(person = PERSON) {
  mocked(api.lookupZooPerson).mockResolvedValueOnce(person);
  set("Tutor — CPF ou CNS", CPF);
  click("Buscar pessoa");
  await screen.findByText(person.patient.display_name!);
}
async function newForm() {
  view();
  fireEvent.click(await screen.findByRole("button", { name: "Cadastrar animal" }));
  await screen.findByRole("form", { name: "Cadastrar animal" });
  set("Espécie", "dog");
  set("Sexo", "male");
}
const submitNew = () => click(/^Cadastrar animal$/);

describe("busca", () => {
  it("busca por microchip: corpo, um resultado, nada no cache", async () => {
    mocked(api.searchAnimals).mockResolvedValue({ items: [ animal() ], next_before: null });
    mocked(api.getAnimal).mockResolvedValue(history());
    const { client } = view();
    fireEvent.change(await screen.findByLabelText("Número do microchip"), { target: { value: CHIP } });
    click("Buscar");
    fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));
    expect(api.searchAnimals).toHaveBeenCalledTimes(1);
    expect(api.searchAnimals).toHaveBeenCalledWith({ microchip: CHIP });
    expect(await screen.findByText("com microchip")).not.toBeNull();
    expect(JSON.stringify(client.getQueryCache().getAll().map((q) => q.queryKey))).not.toContain(CHIP);
  });
  it("microchip com menos de 15 dígitos não vai ao api", async () => {
    view();
    fireEvent.change(await screen.findByLabelText("Número do microchip"), { target: { value: "123" } });
    click("Buscar");
    expect(await screen.findByText("microchip: 15 dígitos, sem espaço")).not.toBeNull();
    expect(api.searchAnimals).not.toHaveBeenCalled();
  });
  it("nada achado: a frase", async () => {
    mocked(api.searchAnimals).mockResolvedValue({ items: [], next_before: null });
    view();
    fireEvent.change(await screen.findByLabelText("Número do microchip"), { target: { value: CHIP } });
    click("Buscar");
    expect(await screen.findByText("nenhum animal com este dado")).not.toBeNull();
  });
  it("busca por tutor: CPF no corpo do person_lookup; a lista não mostra o tutor", async () => {
    mocked(api.lookupZooPerson).mockResolvedValue(PERSON);
    mocked(api.searchAnimals).mockResolvedValue({ items: [ animal({ name: "Thor" }) ], next_before: null });
    view();
    fireEvent.click(await screen.findByRole("tab", { name: "Tutor" }));
    set("Tutor — CPF ou CNS", CPF);
    click("Buscar pessoa");
    const list = await screen.findByRole("list", { name: "Animais encontrados" });
    expect(api.lookupZooPerson).toHaveBeenCalledWith({ cpf: CPF });
    expect(api.searchAnimals).toHaveBeenCalledWith({ tutor_patient_id: "pt1" });
    expect(within(list).getByText(/Thor/)).not.toBeNull();
    expect(within(list).queryByText(/M\. S\./)).toBeNull();
  });
  it("busca por domicílio: o da pessoa buscada; sem domicílio diz a frase e não busca", async () => {
    mocked(api.lookupZooPerson).mockResolvedValueOnce(PERSON).mockResolvedValueOnce({ ...PERSON, household: null });
    mocked(api.searchAnimals).mockResolvedValue({ items: [ animal() ], next_before: null });
    view();
    fireEvent.click(await screen.findByRole("tab", { name: "Domicílio" }));
    set(/CPF ou CNS/, CPF);
    click("Buscar pessoa");
    await screen.findByRole("list", { name: "Animais encontrados" });
    expect(api.searchAnimals).toHaveBeenCalledWith({ household_id: "h1" });
    click("Trocar");
    mocked(api.searchAnimals).mockClear();
    set(/CPF ou CNS/, CPF);
    click("Buscar pessoa");
    expect((await screen.findAllByText("esta pessoa não tem domicílio no cadastro individual")).length).toBeGreaterThan(0);
    expect(api.searchAnimals).not.toHaveBeenCalled();
  });
  it("pessoa não achada: a frase", async () => {
    mocked(api.lookupZooPerson).mockResolvedValue(null);
    view();
    fireEvent.click(await screen.findByRole("tab", { name: "Tutor" }));
    set(/CPF ou CNS/, CPF);
    click("Buscar pessoa");
    expect(await screen.findByText("ninguém com este documento no cadastro")).not.toBeNull();
  });
});

describe("cadastro", () => {
  it("cadastro com tutor: corpo com tutor_patient_id e community false; o nome digitado não vai", async () => {
    mocked(api.createAnimal).mockResolvedValue(animal());
    mocked(api.getAnimal).mockResolvedValue(history());
    await newForm();
    set("Nome", "Thor");
    set("Porte", "medium");
    set(/^Microchip/, CHIP);
    await lookupTutor();
    submitNew();
    await waitFor(() => expect(api.createAnimal).toHaveBeenCalledTimes(1));
    expect(api.createAnimal).toHaveBeenCalledWith({
      species: "dog", name: "Thor", sex: "male", size: "medium", microchip: CHIP, tutor_patient_id: "pt1", community: false
    });
  });
  it("domicílio vem da pessoa buscada: o do tutor ou o de outro morador, que não vira tutor (Q25)", async () => {
    mocked(api.createAnimal).mockResolvedValue(animal());
    mocked(api.getAnimal).mockResolvedValue(history());
    await newForm();
    await lookupTutor();
    fireEvent.click(screen.getByLabelText("Usar o domicílio do tutor (R. das Flores, 10)"));
    submitNew();
    await waitFor(() => expect(api.createAnimal).toHaveBeenCalledTimes(1));
    expect(api.createAnimal).toHaveBeenLastCalledWith({ species: "dog", sex: "male", tutor_patient_id: "pt1", household_id: "h1", community: false });
    cleanup();
    mocked(api.createAnimal).mockClear();
    await newForm();
    await lookupTutor();
    fireEvent.click(screen.getByLabelText("Buscar o domicílio por outro morador"));
    mocked(api.lookupZooPerson).mockResolvedValueOnce(OTHER);
    set("Outro morador — CPF ou CNS", CPF);
    click("Buscar pessoa");
    await screen.findByText("R. do Sol, 3");
    submitNew();
    await waitFor(() => expect(api.createAnimal).toHaveBeenCalledTimes(1));
    expect(api.createAnimal).toHaveBeenLastCalledWith({ species: "dog", sex: "male", tutor_patient_id: "pt1", household_id: "h2", community: false });
  });
  it("sem tutor e sem comunitário vale (tutor não identificado, Q22)", async () => {
    mocked(api.createAnimal).mockResolvedValue(animal({ has_tutor: false }));
    mocked(api.getAnimal).mockResolvedValue(history({ tutor: null, has_tutor: false }));
    await newForm();
    submitNew();
    await waitFor(() => expect(api.createAnimal).toHaveBeenCalledTimes(1));
    expect(api.createAnimal).toHaveBeenCalledWith({ species: "dog", sex: "male", community: false });
  });
  it("sem espécie: recusa antes de enviar", async () => {
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Cadastrar animal" }));
    await screen.findByRole("form", { name: "Cadastrar animal" });
    submitNew();
    expect(await screen.findByText("escolha a espécie")).not.toBeNull();
    expect(api.createAnimal).not.toHaveBeenCalled();
  });
  it("microchip repetido: 422 microchip_taken no campo, formulário fica", async () => {
    mocked(api.createAnimal).mockRejectedValue(new ApiError(422, { error: "microchip_taken", path: "microchip" }, "x"));
    await newForm();
    set(/^Microchip/, CHIP);
    submitNew();
    expect(await screen.findByText(ZOONOSES_ERRORS.microchip_taken)).not.toBeNull();
    expect(screen.getByRole("form", { name: "Cadastrar animal" })).not.toBeNull();
    expect((screen.getByLabelText(/^Microchip/) as HTMLInputElement).value).toBe(CHIP);
  });
  it("comunitário limpa o tutor e vice-versa", async () => {
    mocked(api.createAnimal).mockResolvedValue(animal());
    mocked(api.getAnimal).mockResolvedValue(history());
    await newForm();
    await lookupTutor();
    fireEvent.click(screen.getByLabelText("Comunitário (ninguém responde pelo animal)"));
    expect(screen.queryByText("M. S.")).toBeNull();
    expect((screen.getByLabelText("Comunitário (ninguém responde pelo animal)") as HTMLInputElement).checked).toBe(true);
    await lookupTutor();
    expect((screen.getByLabelText("Comunitário (ninguém responde pelo animal)") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByLabelText("Comunitário (ninguém responde pelo animal)"));
    submitNew();
    await waitFor(() => expect(api.createAnimal).toHaveBeenCalledTimes(1));
    expect(api.createAnimal).toHaveBeenCalledWith({ species: "dog", sex: "male", community: true });
  });
});

async function openHistory(h = history()) {
  mocked(api.searchAnimals).mockResolvedValue({ items: [ animal() ], next_before: null });
  mocked(api.getAnimal).mockResolvedValue(h);
  view();
  fireEvent.change(await screen.findByLabelText("Número do microchip"), { target: { value: CHIP } });
  click("Buscar");
  fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));
  await screen.findByLabelText("Animal Thor");
}

describe("histórico", () => {
  it("lê uma vez, tutor só pelo display_name, sem o número do microchip", async () => {
    await openHistory(history({
      vaccinations: [
        { id: "v1", vaccinated_on: "2026-11-10", modality: "house", campaign_id: "cp1", vector_product_id: "pz1", adverse_event: false, cancelled: true }
      ]
    }));
    expect(api.getAnimal).toHaveBeenCalledTimes(1);
    expect(screen.getByText("M. S.")).not.toBeNull();
    expect(screen.getByText("com microchip")).not.toBeNull();
    expect(screen.getByText(/anulada/)).not.toBeNull();
    expect(document.body.textContent).not.toContain(CHIP);
  });
  it("animal em situação final: só leitura, sem Editar", async () => {
    await openHistory(history({ status: "deceased" }));
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.getByText("Situação final: o cadastro não muda mais.")).not.toBeNull();
  });
});

describe("edição", () => {
  it("manda só o que mudou, com expected_version, e relê depois", async () => {
    await openHistory(history({ version: 3 }));
    click("Editar");
    await screen.findByRole("form", { name: "Editar animal" });
    set("Nome", "Rex");
    mocked(api.updateAnimal).mockResolvedValue(animal({ name: "Rex", version: 4 }));
    click("Salvar alterações");
    await waitFor(() => expect(api.updateAnimal).toHaveBeenCalledTimes(1));
    expect(api.updateAnimal).toHaveBeenCalledWith("an1", { name: "Rex", expected_version: 3 });
    await waitFor(() => expect(api.getAnimal).toHaveBeenCalledTimes(2));
  });
  it("apagar campos preenchidos manda null só neles; vazios que continuam vazios não vão", async () => {
    await openHistory(history({ version: 3, name: "Thor", coat: "caramelo", breed: "SRD", size: "medium", birth_estimate_on: "2023-05-01" }));
    click("Editar");
    await screen.findByRole("form", { name: "Editar animal" });
    set("Nome", "");
    set("Pelagem", "");
    set("Raça", "");
    set("Porte", "");
    set("Mês de nascimento (estimado)", "");
    mocked(api.updateAnimal).mockResolvedValue(animal());
    click("Salvar alterações");
    await waitFor(() => expect(api.updateAnimal).toHaveBeenCalledTimes(1));
    expect(api.updateAnimal).toHaveBeenCalledWith("an1", { name: null, coat: null, breed: null, size: null, birth_estimate_on: null, expected_version: 3 });
  });
  it("campos que já eram vazios e seguem vazios não vão", async () => {
    await openHistory(history({ version: 3, coat: null, breed: null, size: null, birth_estimate_on: null }));
    click("Editar");
    await screen.findByRole("form", { name: "Editar animal" });
    set("Nome", "Rex");
    mocked(api.updateAnimal).mockResolvedValue(animal());
    click("Salvar alterações");
    await waitFor(() => expect(api.updateAnimal).toHaveBeenCalledTimes(1));
    expect(api.updateAnimal).toHaveBeenCalledWith("an1", { name: "Rex", expected_version: 3 });
  });
  it("duplo envio manda uma vez só", async () => {
    await openHistory(history({ version: 3 }));
    click("Editar");
    await screen.findByRole("form", { name: "Editar animal" });
    set("Nome", "Rex");
    let release: (a: api.Animal) => void = () => {};
    mocked(api.updateAnimal).mockReturnValue(new Promise((r) => { release = r; }));
    click("Salvar alterações");
    click("Salvar alterações");
    release(animal());
    await waitFor(() => expect(api.getAnimal).toHaveBeenCalledTimes(2));
    expect(api.updateAnimal).toHaveBeenCalledTimes(1);
  });
  it("edição: de tutor para comunitário (tutor null) e de comunitário para tutor", async () => {
    await openHistory(history({ version: 3 }));
    click("Editar");
    await screen.findByRole("form", { name: "Editar animal" });
    fireEvent.click(screen.getByLabelText("Comunitário (ninguém responde pelo animal)"));
    mocked(api.updateAnimal).mockResolvedValue(animal({ community: true, has_tutor: false }));
    click("Salvar alterações");
    await waitFor(() => expect(api.updateAnimal).toHaveBeenCalledTimes(1));
    expect(api.updateAnimal).toHaveBeenLastCalledWith("an1", { tutor_patient_id: null, community: true, expected_version: 3 });
    cleanup();
    mocked(api.updateAnimal).mockClear();
    await openHistory(history({ version: 4, tutor: null, has_tutor: false, community: true }));
    click("Editar");
    await screen.findByRole("form", { name: "Editar animal" });
    await lookupTutor();
    mocked(api.updateAnimal).mockResolvedValue(animal());
    click("Salvar alterações");
    await waitFor(() => expect(api.updateAnimal).toHaveBeenCalledTimes(1));
    expect(api.updateAnimal).toHaveBeenLastCalledWith("an1", { tutor_patient_id: "pt1", community: false, expected_version: 4 });
  });
  it("sem mudança: não envia", async () => {
    await openHistory();
    click("Editar");
    await screen.findByRole("form", { name: "Editar animal" });
    click("Salvar alterações");
    expect(await screen.findByText("nada mudou")).not.toBeNull();
    expect(api.updateAnimal).not.toHaveBeenCalled();
  });
  it("409 animal_changed diz a frase e relê uma vez, sem reenviar", async () => {
    await openHistory();
    click("Editar");
    await screen.findByRole("form", { name: "Editar animal" });
    set("Nome", "Rex");
    mocked(api.updateAnimal).mockRejectedValue(new ApiError(409, { error: "animal_changed" }, "x"));
    click("Salvar alterações");
    expect((await screen.findAllByText(ZOONOSES_ERRORS.animal_changed)).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.getAnimal).toHaveBeenCalledTimes(2));
    expect(api.updateAnimal).toHaveBeenCalledTimes(1);
  });
});

describe("situação", () => {
  async function toStatus(h = history({ version: 3, created_at: "2026-10-01T09:00:00-03:00" })) {
    await openHistory(h);
    click("Editar");
    await screen.findByLabelText("Mudar situação");
  }
  it("ativo → óbito com data; só as situações seguintes; confirmação; depois o animal fica só leitura", async () => {
    await toStatus();
    const options = Array.from((screen.getByLabelText("Nova situação") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual([ "Escolha", "Desaparecido", "Transferido", "Óbito" ]);
    set("Nova situação", "deceased");
    set("Data da mudança", "2026-11-20");
    mocked(api.updateAnimal).mockResolvedValue(animal({ status: "deceased", version: 4 }));
    mocked(api.getAnimal).mockResolvedValue(history({ status: "deceased", version: 4 }));
    click("Mudar situação");
    expect(screen.getByText("Confirmar? A situação não volta a ativo.")).not.toBeNull();
    click("Confirmar");
    await waitFor(() => expect(api.updateAnimal).toHaveBeenCalledTimes(1));
    expect(api.updateAnimal).toHaveBeenCalledWith("an1", { status: "deceased", status_on: "2026-11-20", expected_version: 3 });
    expect(await screen.findByText("Situação final: o cadastro não muda mais.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });
  it("sem mexer na data: status_on não vai", async () => {
    await toStatus();
    set("Nova situação", "missing");
    mocked(api.updateAnimal).mockResolvedValue(animal({ status: "missing" }));
    click("Mudar situação");
    click("Confirmar");
    await waitFor(() => expect(api.updateAnimal).toHaveBeenCalledTimes(1));
    expect(api.updateAnimal).toHaveBeenCalledWith("an1", { status: "missing", expected_version: 3 });
  });
  it("desaparecido oferece voltar a ativo e óbito", async () => {
    await toStatus(history({ status: "missing", version: 3 }));
    const options = Array.from((screen.getByLabelText("Nova situação") as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options).toEqual([ "Escolha", "Ativo", "Óbito" ]);
  });
  it("estada aberta no canil: controle desabilitado com a frase, nada enviado", async () => {
    await toStatus(history({
      version: 3, stays: [ { id: "s1", health_unit_id: "u1", entry_kind: "collection", entered_on: "2026-11-20", exit_kind: null, exited_on: null, bite_observation_id: null } ]
    }));
    expect((screen.getByLabelText("Nova situação") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(ANIMAL_STAY_OPEN)).not.toBeNull();
    expect(api.updateAnimal).not.toHaveBeenCalled();
  });
  it("409 invalid_transition no status: a frase do canil, sem releitura", async () => {
    await toStatus();
    set("Nova situação", "missing");
    mocked(api.updateAnimal).mockRejectedValue(new ApiError(409, { error: "invalid_transition", path: "status" }, "x"));
    click("Mudar situação");
    click("Confirmar");
    expect(await screen.findByText(ANIMAL_STAY_OPEN)).not.toBeNull();
    expect(api.getAnimal).toHaveBeenCalledTimes(1);
  });
  it("409 animal_not_active: a frase e uma releitura", async () => {
    await toStatus();
    set("Nova situação", "missing");
    mocked(api.updateAnimal).mockRejectedValue(new ApiError(409, { error: "animal_not_active" }, "x"));
    click("Mudar situação");
    click("Confirmar");
    expect((await screen.findAllByText(ZOONOSES_ERRORS.animal_not_active)).length).toBeGreaterThan(0);
    await waitFor(() => expect(api.getAnimal).toHaveBeenCalledTimes(2));
    expect(api.updateAnimal).toHaveBeenCalledTimes(1);
  });
});
