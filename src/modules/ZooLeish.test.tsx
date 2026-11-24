// src/modules/ZooLeish.test.tsx
// Leishmaniose do centro de zoonoses (módulo 35b, Task 10; F-35.15): inquéritos (com a sugestão do api), coleta e sorologia,
// desfecho do cão reagente e coleiras a trocar. Formas do api JÁ pronto (api-shapes.md), não as do plano: o api decide o
// `target_dogs`, a etiqueta, a prevalência e a troca da coleira; a tela só mostra e não envia o que já sabe que será recusado.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getZoonosesDomains: vi.fn(), getZooParameters: vi.fn(), listLeishSurveys: vi.fn(),
    getLeishSurvey: vi.fn(), suggestLeishSurvey: vi.fn(), createLeishSurvey: vi.fn(), updateLeishSurvey: vi.fn(), openLeishSurvey: vi.fn(),
    closeLeishSurvey: vi.fn(), listLeishTests: vi.fn(), collectLeishTest: vi.fn(), updateLeishTest: vi.fn(), recordLeishOutcome: vi.fn(),
    placeCollar: vi.fn(), removeCollar: vi.fn(), listDueCollars: vi.fn(), listCityBlocks: vi.fn(), listPanelNeighborhoods: vi.fn(),
    searchAnimals: vi.fn(), getAnimal: vi.fn(), lookupZooPerson: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError, type CityBlock, type LeishSurveyDetail } from "../lib/api";
import { focusBelowMinText, sampleCensusText } from "../lib/zoonoses";
import { ZOONOSES_ERRORS } from "../lib/zoonosesErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import {
  TODAY35B, ZOO_DOMAINS, ZOO_PARAMS, animal, collar, dueCollar, euthanasia, history, leishTest, survey, zooUser
} from "../test/zoonosesFixtures";
import { ZooLeish } from "./ZooLeish";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const MOCKS = [
  api.fetchCurrentSession, api.getZoonosesDomains, api.getZooParameters, api.listLeishSurveys, api.getLeishSurvey, api.suggestLeishSurvey,
  api.createLeishSurvey, api.updateLeishSurvey, api.openLeishSurvey, api.closeLeishSurvey, api.listLeishTests, api.collectLeishTest,
  api.updateLeishTest, api.recordLeishOutcome, api.placeCollar, api.removeCollar, api.listDueCollars, api.listCityBlocks,
  api.listPanelNeighborhoods, api.searchAnimals, api.getAnimal, api.lookupZooPerson
];
const PARAMS = { version: 2, values: ZOO_PARAMS, created_at: null };
const block = (id: string, number: string): CityBlock => ({
  id, neighborhood: { id: "nb1", name: "Centro" }, number, active: true, neighbor_ids: [], households_count: 10, version: 1
});
const BLOCKS = [ block("cb1", "1"), block("cb2", "2"), block("cb3", "3"), block("cb4", "4") ];
const detail = (o: Partial<LeishSurveyDetail> = {}): LeishSurveyDetail => ({
  ...survey(), household_ids: [ "h1", "h2" ], dog_population_suggested: 900, prevalence: { examined: 40, reactive: 3, prevalence: 7.5 }, ...o
});
const conflict = (error: string, status = 409, path?: string) => new ApiError(status, { error, ...(path ? { path } : {}) }, error);

afterEach(cleanup);
beforeEach(() => {
  for (const fn of MOCKS) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(zooUser());
  mocked(api.getZoonosesDomains).mockResolvedValue(ZOO_DOMAINS);
  mocked(api.getZooParameters).mockResolvedValue(PARAMS);
  mocked(api.listLeishSurveys).mockResolvedValue([ survey({ stage: "open" }) ]);
  mocked(api.getLeishSurvey).mockResolvedValue(detail({ stage: "open" }));
  mocked(api.listLeishTests).mockResolvedValue({ items: [], next_before: null });
  mocked(api.listDueCollars).mockResolvedValue([]);
  mocked(api.listPanelNeighborhoods).mockResolvedValue([ { id: "nb1", name: "Centro", active: true } ]);
  mocked(api.listCityBlocks).mockResolvedValue(BLOCKS);
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const set = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const coordinator = () => mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "endemic_coordinator" ]));
const tab = async (name: string) => fireEvent.click(await screen.findByRole("tab", { name }));
const settle = () => new Promise((r) => setTimeout(r, 30));
function view(props: { onGoToShelter?(): void } = {}) {
  return renderWithProviders(<ZooLeish today={TODAY35B} {...props} />);
}
async function pickAnimal(a = animal()) {
  mocked(api.searchAnimals).mockResolvedValue({ items: [ a ], next_before: null });
  fireEvent.change(await screen.findByLabelText("Número do microchip"), { target: { value: "985112003456789" } });
  click("Buscar");
  fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));
}

describe("inquéritos", () => {
  it("equipe lê a lista, mas não vê Novo inquérito nem as ações da coordenação", async () => {
    view();
    expect(await screen.findByText("Inquérito Centro")).not.toBeNull();
    for (const n of [ "Novo inquérito", "Editar", "Abrir inquérito", "Encerrar inquérito" ]) {
      expect(screen.queryByRole("button", { name: n })).toBeNull();
    }
  });

  it("amostra: a sugestão do api enche quarteirões e população; depois de salvar o rascunho, o target_dogs e a população sugerida do api", async () => {
    coordinator();
    mocked(api.listLeishSurveys).mockResolvedValue([]);
    mocked(api.suggestLeishSurvey).mockResolvedValue({ city_block_ids: [ "cb1", "cb2" ], dog_population_suggested: 900, target_dogs: 388, below_focus_min: false });
    const saved = detail({ id: "sv9", target_dogs: 390, dog_population: 905, dog_population_suggested: 912 });
    mocked(api.createLeishSurvey).mockResolvedValue(saved);
    mocked(api.getLeishSurvey).mockResolvedValue(saved);
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Novo inquérito" }));
    await screen.findByRole("option", { name: "Amostral" });
    await screen.findByRole("option", { name: "Centro" });
    set("Nome", "Inquérito Centro");
    set("Tipo", "sample");
    set("Bairro", "nb1");
    await screen.findByLabelText("Quarteirão 1");
    click("Sugerir quarteirões");
    await waitFor(() => expect(api.suggestLeishSurvey).toHaveBeenCalledWith({ kind: "sample", neighborhood_id: "nb1" }));
    expect(await screen.findByText(/cães a examinar: 388/)).not.toBeNull();
    expect((screen.getByLabelText("População de cães") as HTMLInputElement).value).toBe("900");
    expect((screen.getByLabelText("Quarteirão 1") as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Quarteirão 3") as HTMLInputElement).checked).toBe(false);
    set("População de cães", "905");
    set("Início", "2026-11-23");
    set("Fim", "2026-12-04");
    click("Salvar rascunho");
    await waitFor(() => expect(api.createLeishSurvey).toHaveBeenCalledTimes(1));
    const body = mocked(api.createLeishSurvey).mock.calls[0][0];
    expect(body).toEqual({
      name: "Inquérito Centro", kind: "sample", neighborhood_id: "nb1", dog_population: 905, starts_on: "2026-11-23", ends_on: "2026-12-04",
      city_block_ids: [ "cb1", "cb2" ]
    });
    expect("target_dogs" in body).toBe(false);
    expect(await screen.findByText("cães a examinar: 390")).not.toBeNull();
    expect(screen.getByText("população sugerida pelo cadastro: 912 cães")).not.toBeNull();
  });

  it("foco: o quarteirão central e os anéis vão à sugestão; os quarteirões sugeridos ficam marcados e o foco abaixo do mínimo avisa", async () => {
    coordinator();
    mocked(api.listLeishSurveys).mockResolvedValue([]);
    mocked(api.suggestLeishSurvey).mockResolvedValue({ city_block_ids: [ "cb1", "cb2", "cb3" ], dog_population_suggested: 60, target_dogs: 60, below_focus_min: true });
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Novo inquérito" }));
    await screen.findByRole("option", { name: "Foco" });
    await screen.findByRole("option", { name: "Centro" });
    set("Tipo", "focus");
    set("Bairro", "nb1");
    await screen.findByRole("option", { name: "Quarteirão 2" });
    click("Sugerir quarteirões");
    expect(await screen.findByText("escolha o quarteirão central")).not.toBeNull();
    expect(api.suggestLeishSurvey).not.toHaveBeenCalled();
    set("Quarteirão central", "cb2");
    expect(screen.getByLabelText("Anéis em volta do central (o sistema amplia os anéis até o mínimo de cães)")).not.toBeNull();
    expect(screen.getByRole("form", { name: /inquérito/i }).textContent).not.toMatch(/\bapi\b/);
    click("Sugerir quarteirões");
    await waitFor(() => expect(api.suggestLeishSurvey).toHaveBeenCalledWith({ kind: "focus", neighborhood_id: "nb1", center_city_block_id: "cb2", rings: 1 }));
    expect(await screen.findByText(focusBelowMinText(100))).not.toBeNull();
    for (const n of [ "1", "2", "3" ]) expect((screen.getByLabelText(`Quarteirão ${n}`) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText("Quarteirão 4") as HTMLInputElement).checked).toBe(false);
  });

  it("detalhe: a prevalência do api (nula → —) e a amostra abaixo de 500 cães vira censo", async () => {
    mocked(api.getLeishSurvey).mockResolvedValue(detail({
      stage: "open", dog_population: 320, target_dogs: 320, prevalence: { examined: 0, reactive: 0, prevalence: null }
    }));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Ver inquérito" }));
    const box = await screen.findByRole("region", { name: "Inquérito selecionado" });
    expect(await within(box).findByText(sampleCensusText(500))).not.toBeNull();
    expect(within(box).getByText("cães a examinar: 320")).not.toBeNull();
    expect(within(box).getByText("prevalência: —")).not.toBeNull();
  });

  it("abrir o rascunho manda expected_version; 409 survey_changed relê uma vez e não reenvia", async () => {
    coordinator();
    mocked(api.listLeishSurveys).mockResolvedValue([ survey({ version: 4 }) ]);
    mocked(api.openLeishSurvey).mockRejectedValue(conflict("survey_changed"));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir inquérito" }));
    click("Confirmar");
    expect(await screen.findByText(ZOONOSES_ERRORS.survey_changed)).not.toBeNull();
    expect(api.openLeishSurvey).toHaveBeenCalledWith("sv1", 4);
    await waitFor(() => expect(api.listLeishSurveys).toHaveBeenCalledTimes(2));
    await settle();
    expect(api.listLeishSurveys).toHaveBeenCalledTimes(2);
    expect(api.openLeishSurvey).toHaveBeenCalledTimes(1);
  });

  it("editar o rascunho manda só o que mudou com expected_version; 409 survey_changed relê uma vez e não reenvia", async () => {
    coordinator();
    mocked(api.listLeishSurveys).mockResolvedValue([ survey({ version: 2 }) ]);
    mocked(api.updateLeishSurvey).mockRejectedValue(conflict("survey_changed"));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await screen.findByRole("form", { name: "Editar inquérito" });
    expect((await screen.findByLabelText("Quarteirão 1") as HTMLInputElement).checked).toBe(true);
    click("Salvar rascunho");
    expect(await screen.findByText("nada mudou")).not.toBeNull();
    expect(api.updateLeishSurvey).not.toHaveBeenCalled();
    set("Nome", "Inquérito Centro 2");
    click("Salvar rascunho");
    expect(await screen.findByText(ZOONOSES_ERRORS.survey_changed)).not.toBeNull();
    expect(api.updateLeishSurvey).toHaveBeenCalledWith("sv1", { name: "Inquérito Centro 2", expected_version: 2 });
    expect(screen.queryByRole("form", { name: "Editar inquérito" })).toBeNull();
    await waitFor(() => expect(api.listLeishSurveys).toHaveBeenCalledTimes(2));
    await settle();
    expect(api.listLeishSurveys).toHaveBeenCalledTimes(2);
    expect(api.updateLeishSurvey).toHaveBeenCalledTimes(1);
  });

  it("encerrar o inquérito aberto manda expected_version e relê a lista", async () => {
    coordinator();
    mocked(api.listLeishSurveys).mockResolvedValue([ survey({ stage: "open", version: 5 }) ]);
    mocked(api.closeLeishSurvey).mockResolvedValue(detail({ stage: "closed", version: 6 }));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar inquérito" }));
    click("Confirmar");
    expect(await screen.findByText("Inquérito encerrado.")).not.toBeNull();
    expect(api.closeLeishSurvey).toHaveBeenCalledTimes(1);
    expect(api.closeLeishSurvey).toHaveBeenCalledWith("sv1", 5);
    await waitFor(() => expect(api.listLeishSurveys).toHaveBeenCalledTimes(2));
  });
});

describe("exames", () => {
  it("coleta no inquérito aberto: cão ativo e a etiqueta do api em destaque", async () => {
    mocked(api.collectLeishTest).mockResolvedValue(leishTest({ label: "LV-2026-0A1B2C-0042", dpp_result: null, dpp_on: null }));
    view();
    await tab("Exames");
    fireEvent.click(await screen.findByRole("button", { name: "Nova coleta" }));
    await screen.findAllByRole("option", { name: "Inquérito Centro" });
    set("Inquérito", "sv1");
    await pickAnimal();
    click("Registrar coleta");
    await waitFor(() => expect(api.collectLeishTest).toHaveBeenCalledTimes(1));
    expect(api.collectLeishTest).toHaveBeenCalledWith({ animal_id: "an1", collected_on: TODAY35B, leish_survey_id: "sv1" });
    expect(await screen.findByText("Etiqueta: LV-2026-0A1B2C-0042")).not.toBeNull();
  });

  it("duplo clique em Registrar coleta: um envio só", async () => {
    let resolve: (t: ReturnType<typeof leishTest>) => void = () => undefined;
    mocked(api.collectLeishTest).mockReturnValue(new Promise((r) => { resolve = r; }));
    view();
    await tab("Exames");
    fireEvent.click(await screen.findByRole("button", { name: "Nova coleta" }));
    await pickAnimal();
    click("Registrar coleta");
    click("Registrar coleta");
    await settle();
    expect(api.collectLeishTest).toHaveBeenCalledTimes(1);
    resolve(leishTest({ label: "LV-2026-AVUL-0007", leish_survey_id: null }));
    expect(await screen.findByText("Etiqueta: LV-2026-AVUL-0007")).not.toBeNull();
    expect(api.collectLeishTest).toHaveBeenCalledTimes(1);
  });

  it("DPP corrigido para não reagente com ELISA gravado: o 422 elisa_without_reactive_dpp do api aparece no topo", async () => {
    mocked(api.listLeishTests).mockResolvedValue({ items: [ leishTest({ version: 2, elisa_result: "reactive", elisa_on: TODAY35B }) ], next_before: null });
    mocked(api.updateLeishTest).mockRejectedValue(conflict("elisa_without_reactive_dpp", 422, "elisa_result"));
    view();
    await tab("Exames");
    fireEvent.click(await screen.findByRole("button", { name: "Lançar resultado" }));
    set("Resultado do TR-DPP", "non_reactive");
    expect(screen.queryByLabelText("Resultado do ELISA")).toBeNull();
    click("Salvar resultado");
    await waitFor(() => expect(api.updateLeishTest).toHaveBeenCalledTimes(1));
    expect(api.updateLeishTest).toHaveBeenCalledWith("lt1", { dpp_result: "non_reactive", expected_version: 2 });
    await waitFor(() => {
      const alerts = screen.queryAllByRole("alert").map((n) => n.textContent);
      expect(alerts).toContain(ZOONOSES_ERRORS.elisa_without_reactive_dpp);
    });
  });

  it("coleta em gato: recusa no animal antes de enviar; 409 animal_not_active cai no animal sem reler", async () => {
    view();
    await tab("Exames");
    fireEvent.click(await screen.findByRole("button", { name: "Nova coleta" }));
    await pickAnimal(animal({ species: "cat" }));
    click("Registrar coleta");
    expect(await screen.findByText(ZOONOSES_ERRORS.animal_not_dog)).not.toBeNull();
    expect(api.collectLeishTest).not.toHaveBeenCalled();
    click("Trocar animal");
    mocked(api.collectLeishTest).mockRejectedValue(conflict("animal_not_active"));
    await pickAnimal();
    click("Registrar coleta");
    expect(await screen.findByText(ZOONOSES_ERRORS.animal_not_active)).not.toBeNull();
    await settle();
    expect(api.listLeishTests).toHaveBeenCalledTimes(1);
  });

  it("ELISA sem DPP reagente não aparece; com DPP reagente, o 422 elisa_without_reactive_dpp cai na linha", async () => {
    mocked(api.listLeishTests).mockResolvedValue({
      items: [ leishTest({ id: "lt1", label: "LV-2026-0A1B2C-0001", dpp_result: null, dpp_on: null }), leishTest({ id: "lt2", label: "LV-2026-0A1B2C-0002" }) ],
      next_before: null
    });
    mocked(api.updateLeishTest).mockRejectedValue(conflict("elisa_without_reactive_dpp", 422, "elisa_result"));
    view();
    await tab("Exames");
    await screen.findByText("LV-2026-0A1B2C-0001");
    fireEvent.click(screen.getAllByRole("button", { name: "Lançar resultado" })[0]);
    await screen.findByRole("form", { name: "Resultado LV-2026-0A1B2C-0001" });
    expect(screen.queryByLabelText("Resultado do ELISA")).toBeNull();
    expect(screen.getByText(ZOONOSES_ERRORS.elisa_without_reactive_dpp)).not.toBeNull();
    click("Cancelar");
    fireEvent.click(screen.getAllByRole("button", { name: "Lançar resultado" })[1]);
    await screen.findByRole("form", { name: "Resultado LV-2026-0A1B2C-0002" });
    set("Resultado do ELISA", "reactive");
    set("Data do ELISA", TODAY35B);
    click("Salvar resultado");
    await waitFor(() => expect(api.updateLeishTest).toHaveBeenCalledTimes(1));
    expect(api.updateLeishTest).toHaveBeenCalledWith("lt2", { elisa_result: "reactive", elisa_on: TODAY35B, expected_version: 1 });
    const alertText = (await screen.findAllByRole("alert")).map((n) => n.textContent);
    expect(alertText).toContain(ZOONOSES_ERRORS.elisa_without_reactive_dpp);
  });

  it("ELISA sem data: recusa na tela; correção com 409 test_changed relê uma vez e não reenvia", async () => {
    mocked(api.listLeishTests).mockResolvedValue({ items: [ leishTest({ version: 3 }) ], next_before: null });
    mocked(api.updateLeishTest).mockRejectedValue(conflict("test_changed"));
    view();
    await tab("Exames");
    fireEvent.click(await screen.findByRole("button", { name: "Lançar resultado" }));
    set("Resultado do ELISA", "non_reactive");
    click("Salvar resultado");
    expect(await screen.findByText("o resultado e a data do ELISA vão juntos")).not.toBeNull();
    expect(api.updateLeishTest).not.toHaveBeenCalled();
    set("Data do ELISA", TODAY35B);
    click("Salvar resultado");
    expect(await screen.findByText(ZOONOSES_ERRORS.test_changed)).not.toBeNull();
    expect(api.updateLeishTest).toHaveBeenCalledWith("lt1", { elisa_result: "non_reactive", elisa_on: TODAY35B, expected_version: 3 });
    await waitFor(() => expect(api.listLeishTests).toHaveBeenCalledTimes(2));
    await settle();
    expect(api.listLeishTests).toHaveBeenCalledTimes(2);
    expect(api.updateLeishTest).toHaveBeenCalledTimes(1);
  });

  it("exame com desfecho não oferece correção do resultado", async () => {
    mocked(api.listLeishTests).mockResolvedValue({
      items: [ leishTest({ elisa_result: "reactive", elisa_on: TODAY35B, outcome: { id: "lo1", decision: "tutor_treatment", decided_on: TODAY35B } }) ],
      next_before: null
    });
    view();
    await tab("Exames");
    expect(await screen.findByText("Tratamento pelo tutor")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Lançar resultado" })).toBeNull();
  });
});

describe("desfecho pendente", () => {
  const reactive = leishTest({ id: "lt1", label: "LV-2026-0A1B2C-0001", elisa_result: "reactive", elisa_on: TODAY35B });

  it("lista só o cão reagente (DPP e ELISA), sem tutor", async () => {
    mocked(api.listLeishTests).mockResolvedValue({
      items: [ reactive, leishTest({ id: "lt2", label: "LV-2026-0A1B2C-0002", elisa_result: "non_reactive", elisa_on: TODAY35B }) ], next_before: null
    });
    view();
    await tab("Desfecho pendente");
    expect(await screen.findByText("LV-2026-0A1B2C-0001")).not.toBeNull();
    expect(api.listLeishTests).toHaveBeenCalledWith({ pending: "outcome", before: null });
    expect(screen.queryByText("LV-2026-0A1B2C-0002")).toBeNull();
    expect(screen.queryByText(/M\. S\./)).toBeNull();
  });

  it("eutanásia manda o euthanasia_id da eutanásia do animal, lida do histórico", async () => {
    mocked(api.listLeishTests).mockResolvedValue({ items: [ reactive ], next_before: null });
    mocked(api.getAnimal).mockResolvedValue(history({ euthanasia: { ...euthanasia(), id: "eu7" } }));
    mocked(api.recordLeishOutcome).mockResolvedValue({
      id: "lo1", leish_test_id: "lt1", animal_id: "an1", decision: "euthanasia", decided_on: TODAY35B, euthanasia_id: "eu7", created_at: "2026-11-23T10:00:00-03:00"
    });
    view();
    await tab("Desfecho pendente");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar desfecho" }));
    await screen.findByRole("option", { name: "Eutanásia" });
    expect(api.getAnimal).not.toHaveBeenCalled();
    set("Decisão", "euthanasia");
    expect(await screen.findByText("eutanásia de 23/11/2026")).not.toBeNull();
    click("Salvar desfecho");
    await waitFor(() => expect(api.recordLeishOutcome).toHaveBeenCalledTimes(1));
    expect(api.recordLeishOutcome).toHaveBeenCalledWith({ leish_test_id: "lt1", decision: "euthanasia", decided_on: TODAY35B, euthanasia_id: "eu7" });
    expect(api.getAnimal).toHaveBeenCalledWith("an1");
    expect(await screen.findByText("Desfecho registrado.")).not.toBeNull();
  });

  it("eutanásia com estada aberta: leva ao Canil e gatil, sem oferecer nova entrada", async () => {
    const go = vi.fn();
    mocked(api.listLeishTests).mockResolvedValue({ items: [ reactive ], next_before: null });
    mocked(api.getAnimal).mockResolvedValue(history({ stays: [ { id: "st1", health_unit_id: "uvz1", entry_kind: "collection", entered_on: "2026-11-20", exit_kind: null, exited_on: null, bite_observation_id: null } ] }));
    view({ onGoToShelter: go });
    await tab("Desfecho pendente");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar desfecho" }));
    await screen.findByRole("option", { name: "Eutanásia" });
    set("Decisão", "euthanasia");
    fireEvent.click(await screen.findByRole("button", { name: "Ir para Canil e gatil" }));
    expect(go).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Dar entrada no canil" })).toBeNull();
  });

  it("eutanásia sem eutanásia gravada: recusa antes e leva a Canil e gatil", async () => {
    const go = vi.fn();
    mocked(api.listLeishTests).mockResolvedValue({ items: [ reactive ], next_before: null });
    mocked(api.getAnimal).mockResolvedValue(history());
    view({ onGoToShelter: go });
    await tab("Desfecho pendente");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar desfecho" }));
    await screen.findByRole("option", { name: "Eutanásia" });
    set("Decisão", "euthanasia");
    fireEvent.click(await screen.findByRole("button", { name: "Dar entrada no canil" }));
    expect(go).toHaveBeenCalledTimes(1);
    click("Salvar desfecho");
    expect(await screen.findByText("registre antes a eutanásia do animal")).not.toBeNull();
    expect(api.recordLeishOutcome).not.toHaveBeenCalled();
  });

  it("recusa do tutor em cão sem tutor: recusa antes de enviar e nem lê o animal", async () => {
    mocked(api.listLeishTests).mockResolvedValue({ items: [ { ...reactive, animal: { id: "an1", has_tutor: false } } ], next_before: null });
    view();
    await tab("Desfecho pendente");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar desfecho" }));
    await screen.findByRole("option", { name: "Recusa do tutor" });
    set("Decisão", "refused");
    click("Salvar desfecho");
    expect(await screen.findByText("o animal precisa de tutor para esta ação")).not.toBeNull();
    expect(api.recordLeishOutcome).not.toHaveBeenCalled();
    expect(api.getAnimal).not.toHaveBeenCalled();
  });

  it("segundo desfecho do mesmo exame: 409 invalid_transition relê a fila uma vez", async () => {
    mocked(api.listLeishTests).mockResolvedValue({ items: [ reactive ], next_before: null });
    mocked(api.recordLeishOutcome).mockRejectedValue(conflict("invalid_transition", 409, "status"));
    view();
    await tab("Desfecho pendente");
    fireEvent.click(await screen.findByRole("button", { name: "Registrar desfecho" }));
    await screen.findByRole("option", { name: "Tratamento pelo tutor" });
    set("Decisão", "tutor_treatment");
    click("Salvar desfecho");
    expect(await screen.findByText(ZOONOSES_ERRORS.invalid_transition)).not.toBeNull();
    await waitFor(() => expect(api.listLeishTests).toHaveBeenCalledTimes(2));
    await settle();
    expect(api.listLeishTests).toHaveBeenCalledTimes(2);
    expect(api.recordLeishOutcome).toHaveBeenCalledTimes(1);
  });
});

describe("coleiras a trocar", () => {
  it("mostra o nome do animal (ou Cão sem nome) e o vencimento sem ler animal; o nome abre o histórico", async () => {
    mocked(api.listDueCollars).mockResolvedValue([
      dueCollar(), dueCollar({ id: "co9", animal_id: "an9", animal: { id: "an9", name: null, species: "dog" }, due_on: "2026-12-01" })
    ]);
    mocked(api.getAnimal).mockResolvedValue(history());
    view();
    await tab("Coleiras a trocar");
    expect(await screen.findByRole("button", { name: "Thor" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Cão sem nome" })).not.toBeNull();
    expect(screen.getByText("01/12/2026")).not.toBeNull();
    expect(screen.queryByText(/cão #/)).toBeNull();
    await settle();
    expect(api.getAnimal).not.toHaveBeenCalled();
    click("Thor");
    expect(await screen.findByRole("article", { name: "Animal Thor" })).not.toBeNull();
    expect(api.getAnimal).toHaveBeenCalledTimes(1);
    expect(api.getAnimal).toHaveBeenCalledWith("an1");
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
  });

  it("lista as que vencem; trocar avisa que a coleira ativa sai como trocada e manda o produto de coleira", async () => {
    mocked(api.listDueCollars).mockResolvedValue([ dueCollar() ]);
    mocked(api.placeCollar).mockResolvedValue(collar({ id: "co2", placed_on: TODAY35B, due_on: "2027-05-23" }));
    view();
    await tab("Coleiras a trocar");
    expect(await screen.findByText("20/11/2026")).not.toBeNull();
    expect(screen.getByText("Coleira deltametrina 4%")).not.toBeNull();
    click("Trocar coleira");
    expect(await screen.findByText(/a coleira ativa sai como trocada/)).not.toBeNull();
    click("Colocar coleira");
    await waitFor(() => expect(api.placeCollar).toHaveBeenCalledTimes(1));
    expect(api.placeCollar).toHaveBeenCalledWith({ animal_id: "an1", vector_product_id: "pz2", placed_on: TODAY35B });
    expect(await screen.findByText("Coleira colocada; vence em 23/05/2027.")).not.toBeNull();
    await waitFor(() => expect(api.listDueCollars).toHaveBeenCalledTimes(2));
  });

  it("coleira nova num cão buscado: avisa a troca; gato é recusado antes de enviar", async () => {
    view();
    await tab("Coleiras a trocar");
    fireEvent.click(await screen.findByRole("button", { name: "Nova coleira" }));
    expect(await screen.findByText(/a coleira ativa sai como trocada/)).not.toBeNull();
    await pickAnimal(animal({ species: "cat" }));
    click("Colocar coleira");
    expect(await screen.findByText(ZOONOSES_ERRORS.animal_not_dog)).not.toBeNull();
    expect(api.placeCollar).not.toHaveBeenCalled();
  });

  it("retirar: só perdida, óbito e outro; 409 collar_changed relê uma vez e não reenvia", async () => {
    mocked(api.listDueCollars).mockResolvedValue([ dueCollar() ]);
    mocked(api.removeCollar).mockRejectedValue(conflict("collar_changed"));
    view();
    await tab("Coleiras a trocar");
    fireEvent.click(await screen.findByRole("button", { name: "Retirar" }));
    const options = within(screen.getByLabelText("Motivo da retirada")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options.filter((v) => v !== "")).toEqual([ "lost", "death", "other" ]);
    set("Motivo da retirada", "lost");
    click("Confirmar retirada");
    expect(await screen.findByText(ZOONOSES_ERRORS.collar_changed)).not.toBeNull();
    expect(api.removeCollar).toHaveBeenCalledWith("co1", { reason: "lost", removed_on: TODAY35B });
    await waitFor(() => expect(api.listDueCollars).toHaveBeenCalledTimes(2));
    await settle();
    expect(api.listDueCollars).toHaveBeenCalledTimes(2);
    expect(api.removeCollar).toHaveBeenCalledTimes(1);
  });
});
