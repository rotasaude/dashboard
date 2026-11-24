// src/modules/ZooObservations.test.tsx
// Observação do agressor (módulo 35b, Task 8; F-35.14): fila sem tutor nem paciente, contato só no clique e só no diálogo,
// desfecho (sadio só a partir de ends_on, eutanasiado só com a eutanásia desta observação) e ligação do animal (uma vez).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getZoonosesDomains: vi.fn(), listObservations: vi.fn(), getObservation: vi.fn(),
    getObservationContact: vi.fn(), closeObservation: vi.fn(), linkObservationAnimal: vi.fn(), searchAnimals: vi.fn(), getAnimal: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ZOONOSES_ERRORS } from "../lib/zoonosesErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { CONTACT, TODAY35B, ZOO_DOMAINS, ZOO_FEATURES, animal, history, observation, zooUser } from "../test/zoonosesFixtures";
import { ZooObservations } from "./ZooObservations";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const MOCKS = [
  api.fetchCurrentSession, api.getZoonosesDomains, api.listObservations, api.getObservation, api.getObservationContact, api.closeObservation,
  api.linkObservationAnimal, api.searchAnimals, api.getAnimal
];
const err = (status: number, body: object) => new ApiError(status, body, "x");
const detail = (o: Partial<api.BiteObservationDetail> = {}): api.BiteObservationDetail => ({
  ...observation(), outcome: null, outcome_on: null, outcome_note: null, closed_by_user_id: null, created_at: "2026-11-15T09:00:00-03:00", ...o
});
const CHIP = "123456789012345";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of MOCKS) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "zoonoses_team" ], ZOO_FEATURES));
  mocked(api.getZoonosesDomains).mockResolvedValue(ZOO_DOMAINS);
  mocked(api.listObservations).mockImplementation(async ({ state }: { state?: string }) => ({ items: state === "open" ? [ observation() ] : [], next_before: null }));
  mocked(api.getObservation).mockResolvedValue(detail());
});

const view = (today = TODAY35B, onGoToShelter?: () => void) => renderWithProviders(<ZooObservations today={today} onGoToShelter={onGoToShelter} />);
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const set = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
async function openDetail(today = TODAY35B, onGoToShelter?: () => void) {
  const r = view(today, onGoToShelter);
  fireEvent.click(await screen.findByRole("button", { name: "Ver observação" }));
  await screen.findByRole("region", { name: "Observação" });
  return r;
}

describe("ZooObservations", () => {
  it("fila: espécie, condição e dias que faltam; nenhum dado do tutor ou do paciente", async () => {
    const { container } = view();
    await screen.findByText("faltam 2 dias");
    expect(screen.getByText("Sadio")).not.toBeNull();
    expect(container.textContent).not.toContain(CONTACT.animal_tutor_name);
    expect(container.textContent).not.toContain("Palmeiras");
    expect(api.getObservation).not.toHaveBeenCalled();
    expect(api.getObservationContact).not.toHaveBeenCalled();
  });

  it("contato: só no clique, só no diálogo, nada no cache; fechar limpa", async () => {
    mocked(api.getObservationContact).mockResolvedValue(CONTACT);
    const { client, container } = await openDetail();
    expect(api.getObservationContact).not.toHaveBeenCalled();
    click("Ver contato do tutor");
    await screen.findByText(CONTACT.animal_tutor_phone!);
    expect(api.getObservationContact).toHaveBeenCalledTimes(1);
    expect(screen.getByText("A leitura fica registrada na trilha. Use o contato só para acompanhar o animal.")).not.toBeNull();
    const keys = JSON.stringify(client.getQueryCache().getAll().map((q) => [ q.queryKey, q.state.data ]));
    expect(keys).not.toContain(CONTACT.animal_tutor_phone);
    expect(keys).not.toContain("João");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(container.textContent).not.toContain(CONTACT.animal_tutor_phone));
    expect(container.textContent).not.toContain("João Silva");
  });

  it("contato disponível sem animal ligado (observação recém-criada)", async () => {
    mocked(api.getObservation).mockResolvedValue(detail({ animal_id: null }));
    mocked(api.getObservationContact).mockResolvedValue(CONTACT);
    await openDetail();
    click("Ver contato do tutor");
    await screen.findByText(CONTACT.animal_tutor_phone!);
    expect(api.getObservationContact).toHaveBeenCalledTimes(1);
  });

  it("dica da eutanásia só com eutanasiado escolhido; animal já ligado mostra a linha de uma vez só", async () => {
    await openDetail();
    expect(screen.getByText("A ligação do animal vale uma vez só e já foi feita.")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Ligar animal" })).toBeNull();
    click("Registrar desfecho");
    expect(screen.queryByText(/registre antes a eutanásia/)).toBeNull();
    set("Desfecho", "euthanized");
    expect(screen.getByText(/registre antes a eutanásia em Canil e gatil/)).not.toBeNull();
  });

  it("sadio antes do último dia: observation_not_finished antes de enviar; no último dia envia", async () => {
    mocked(api.getObservation).mockResolvedValue(detail({ ends_on: "2026-11-25" }));
    mocked(api.closeObservation).mockResolvedValue(detail({ state: "closed", outcome: "healthy" }));
    await openDetail("2026-11-25");
    click("Registrar desfecho");
    set("Desfecho", "healthy");
    set("Data do desfecho", "2026-11-24");
    click("Enviar");
    await screen.findByText(ZOONOSES_ERRORS.observation_not_finished);
    expect(api.closeObservation).not.toHaveBeenCalled();
    set("Data do desfecho", "2026-11-25");
    click("Enviar");
    await waitFor(() => expect(api.closeObservation).toHaveBeenCalledWith("ob1", { outcome: "healthy", outcome_on: "2026-11-25", expected_version: 1 }));
  });

  it("nota de 10 a 500 é recusada, nunca cortada", async () => {
    await openDetail();
    click("Registrar desfecho");
    set("Desfecho", "died");
    set("Data do desfecho", "2026-11-22");
    set("Nota", "curta");
    click("Enviar");
    await waitFor(() => expect(screen.getAllByRole("alert").length).toBeGreaterThan(0));
    expect(api.closeObservation).not.toHaveBeenCalled();
  });

  it("eutanasiado: animal sem estada aberta oferece Dar entrada no canil; com estada, Ir para Canil e gatil", async () => {
    const go = vi.fn();
    mocked(api.getAnimal).mockResolvedValue(history());
    await openDetail(TODAY35B, go);
    click("Registrar desfecho");
    set("Desfecho", "euthanized");
    fireEvent.click(await screen.findByRole("button", { name: "Dar entrada no canil" }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(api.getAnimal).toHaveBeenCalledTimes(1);
  });

  it("eutanasiado com estada aberta: Ir para Canil e gatil", async () => {
    mocked(api.getAnimal).mockResolvedValue(history({ stays: [ { id: "st1", health_unit_id: "uvz1", entry_kind: "collection", entered_on: "2026-11-20", exit_kind: null, exited_on: null, bite_observation_id: null } ] }));
    await openDetail(TODAY35B, vi.fn());
    click("Registrar desfecho");
    set("Desfecho", "euthanized");
    expect(await screen.findByRole("button", { name: "Ir para Canil e gatil" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Dar entrada no canil" })).toBeNull();
  });

  it("eutanasiado: a dica de registrar antes a eutanásia; a recusa do api aparece", async () => {
    mocked(api.closeObservation).mockRejectedValue(err(422, { error: "invalid_request", path: "outcome" }));
    await openDetail();
    click("Registrar desfecho");
    set("Desfecho", "euthanized");
    expect(screen.getByText(/registre antes a eutanásia em Canil e gatil/)).not.toBeNull();
    set("Data do desfecho", "2026-11-22");
    click("Enviar");
    await screen.findByText(ZOONOSES_ERRORS.invalid_request);
    expect(api.closeObservation).toHaveBeenCalledWith("ob1", { outcome: "euthanized", outcome_on: "2026-11-22", expected_version: 1 });
  });

  it("409 observation_changed ao fechar: frase e uma releitura, sem reenviar", async () => {
    mocked(api.closeObservation).mockRejectedValue(err(409, { error: "observation_changed" }));
    await openDetail();
    click("Registrar desfecho");
    set("Desfecho", "died");
    set("Data do desfecho", "2026-11-22");
    click("Enviar");
    await screen.findByText(ZOONOSES_ERRORS.observation_changed);
    await waitFor(() => expect(api.getObservation).toHaveBeenCalledTimes(2));
    expect(api.closeObservation).toHaveBeenCalledTimes(1);
  });

  it("ligar animal: usa o resultado da busca, expected_version, sem getAnimal; também em observação encerrada", async () => {
    mocked(api.getObservation).mockResolvedValue(detail({ animal_id: null, state: "closed", outcome: "died", outcome_on: "2026-11-20" }));
    mocked(api.searchAnimals).mockResolvedValue({ items: [ animal() ], next_before: null });
    mocked(api.linkObservationAnimal).mockResolvedValue(detail());
    await openDetail();
    click("Ligar animal");
    fireEvent.change(await screen.findByLabelText("Número do microchip"), { target: { value: CHIP } });
    click("Buscar");
    fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));
    click("Ligar este animal");
    await waitFor(() => expect(api.linkObservationAnimal).toHaveBeenCalledWith("ob1", { animal_id: "an1", expected_version: 1 }));
    expect(api.getAnimal).not.toHaveBeenCalled();
  });

  it("ligar animal: 409 observation_changed relê uma vez e não reenvia", async () => {
    mocked(api.getObservation).mockResolvedValue(detail({ animal_id: null }));
    mocked(api.searchAnimals).mockResolvedValue({ items: [ animal() ], next_before: null });
    mocked(api.linkObservationAnimal).mockRejectedValue(err(409, { error: "observation_changed" }));
    await openDetail();
    click("Ligar animal");
    fireEvent.change(await screen.findByLabelText("Número do microchip"), { target: { value: CHIP } });
    click("Buscar");
    fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));
    click("Ligar este animal");
    await screen.findByText(ZOONOSES_ERRORS.observation_changed);
    await waitFor(() => expect(api.getObservation).toHaveBeenCalledTimes(2));
    expect(api.linkObservationAnimal).toHaveBeenCalledTimes(1);
  });
});
