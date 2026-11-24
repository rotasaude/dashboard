// src/modules/ZooCampaigns.test.tsx
// Campanhas e vacinação do centro de zoonoses (módulo 35b, Task 6; F-35.12): campanha (criar, editar, abrir, encerrar), dose no
// posto fixo e na rotina, anulação e resultado semanal. Formas do api JÁ pronto (api-shapes.md), não as do plano.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getZoonosesDomains: vi.fn(), getZooParameters: vi.fn(), listRabiesCampaigns: vi.fn(),
    createRabiesCampaign: vi.fn(), updateRabiesCampaign: vi.fn(), openRabiesCampaign: vi.fn(), closeRabiesCampaign: vi.fn(),
    listVaccinations: vi.fn(), recordVaccination: vi.fn(), cancelVaccination: vi.fn(), getZoonosesReport: vi.fn(),
    fetchZoonosesReportFile: vi.fn(), searchAnimals: vi.fn(), getAnimal: vi.fn(), listActiveUnits: vi.fn(), lookupZooPerson: vi.fn()
  };
});
vi.mock("./lab/saveFile", () => ({ saveFile: vi.fn() }));

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ZOONOSES_ERRORS } from "../lib/zoonosesErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY35B, ZOO_DOMAINS, ZOO_PARAMS, animal, campaign, history, vaccination, zooUser } from "../test/zoonosesFixtures";
import { saveFile } from "./lab/saveFile";
import { ZooCampaigns } from "./ZooCampaigns";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const EATAV = "Notifique o evento adverso no formulário do Ministério da Saúde (EATAV).";
const MOCKS = [
  api.fetchCurrentSession, api.getZoonosesDomains, api.getZooParameters, api.listRabiesCampaigns, api.createRabiesCampaign,
  api.updateRabiesCampaign, api.openRabiesCampaign, api.closeRabiesCampaign, api.listVaccinations, api.recordVaccination,
  api.cancelVaccination, api.getZoonosesReport, api.fetchZoonosesReportFile, api.searchAnimals, api.getAnimal, api.listActiveUnits,
  api.lookupZooPerson
];
const PARAMS = { version: 2, values: ZOO_PARAMS, created_at: null };

afterEach(cleanup);
beforeEach(() => {
  for (const fn of MOCKS) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(zooUser());
  mocked(api.getZoonosesDomains).mockResolvedValue(ZOO_DOMAINS);
  mocked(api.getZooParameters).mockResolvedValue(PARAMS);
  mocked(api.listRabiesCampaigns).mockResolvedValue([ campaign() ]);
  mocked(api.listVaccinations).mockResolvedValue({ items: [], next_before: null });
  vi.mocked(saveFile).mockReset();
});

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const set = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const view = () => renderWithProviders(<ZooCampaigns today={TODAY35B} />);
const coordinator = () => mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "endemic_coordinator" ]));
const form = (name: string) => screen.findByRole("form", { name });

async function fixedPostForm() {
  view();
  await form("Registrar dose");
  await screen.findByRole("option", { name: "UVZ Norte" });
  expect(api.listActiveUnits).not.toHaveBeenCalled();
  await screen.findByRole("option", { name: "Posto fixo" });
}
async function pickAnimal() {
  mocked(api.searchAnimals).mockResolvedValue({ items: [ animal() ], next_before: null });
  mocked(api.getAnimal).mockResolvedValue(history());
  fireEvent.change(screen.getByLabelText("Número do microchip"), { target: { value: "985112003456789" } });
  click("Buscar");
  fireEvent.click(await screen.findByRole("button", { name: "Abrir" }));
  await screen.findByText(/Thor/);
}

describe("dose", () => {
  it("posto fixo sem cadastro: só a espécie; nenhum campo de nome ou tutor", async () => {
    mocked(api.recordVaccination).mockResolvedValue(vaccination({ modality: "fixed_post", animal_id: null, species: "cat" }));
    await fixedPostForm();
    expect(screen.queryByLabelText(/nome|tutor/i)).toBeNull();
    set("Espécie", "cat");
    set("Unidade", "u1");
    click("Registrar dose");
    await waitFor(() => expect(api.recordVaccination).toHaveBeenCalledTimes(1));
    expect(api.recordVaccination).toHaveBeenCalledWith({
      modality: "fixed_post", species: "cat", campaign_id: "cp1", vaccinated_on: TODAY35B, health_unit_id: "u1", vector_product_id: "pz1",
      adverse_event: false
    });
  });

  it("posto fixo sem espécie nem animal: recusa na tela, nada enviado", async () => {
    await fixedPostForm();
    click("Registrar dose");
    expect(await screen.findByText("escolha a espécie: cão ou gato")).not.toBeNull();
    expect(api.recordVaccination).not.toHaveBeenCalled();
  });

  it("rotina: sem a chave campaign_id e animal cadastrado, mesmo com campanha aberta", async () => {
    mocked(api.recordVaccination).mockResolvedValue(vaccination({ modality: "routine", campaign_id: null }));
    await fixedPostForm();
    set("Modalidade", "routine");
    await pickAnimal();
    set("Unidade", "u1");
    click("Registrar dose");
    await waitFor(() => expect(api.recordVaccination).toHaveBeenCalledTimes(1));
    const body = mocked(api.recordVaccination).mock.calls[0][0];
    expect(body).toEqual({ modality: "routine", animal_id: "an1", vaccinated_on: TODAY35B, health_unit_id: "u1", vector_product_id: "pz1", adverse_event: false });
    expect("campaign_id" in body).toBe(false);
    expect(api.getAnimal).not.toHaveBeenCalled();
  });

  it("sem nenhuma campanha: a rotina continua registrável e listável", async () => {
    mocked(api.listRabiesCampaigns).mockResolvedValue([]);
    mocked(api.listVaccinations).mockResolvedValue({ items: [ vaccination({ modality: "routine", campaign_id: null }) ], next_before: null });
    view();
    await form("Registrar dose");
    expect(await screen.findByText("Doses de rotina")).not.toBeNull();
    expect(api.listVaccinations).toHaveBeenCalledWith({ modality: "routine", before: null });
    expect(await screen.findByText("com cadastro")).not.toBeNull();
  });

  it("Q43: o formulário de dose oferece as unidades de vacinação dos domínios, UBS inclusive", async () => {
    await fixedPostForm();
    const names = within(screen.getByLabelText("Unidade")).getAllByRole("option").map((o) => o.textContent);
    expect(names).toContain("UBS Jardim Botânico");
    set("Modalidade", "fixed_post");
    set("Espécie", "dog");
    set("Unidade", "ubs7");
    expect((screen.getByLabelText("Unidade") as HTMLSelectElement).value).toBe("ubs7");
  });

  it("Q43: a lista de doses mostra o nome da unidade de vacinação; id fora da lista é \"outra unidade\", nunca o id cru", async () => {
    mocked(api.listVaccinations).mockResolvedValue({ items: [
      vaccination({ id: "v1", modality: "fixed_post", health_unit_id: "ubs7" }),
      vaccination({ id: "v2", modality: "fixed_post", health_unit_id: "unidade-desconhecida-9" })
    ], next_before: null });
    view();
    const table = await screen.findByRole("table", { name: "Doses" });
    await within(table).findByText("UBS Jardim Botânico");
    expect(within(table).getByText("outra unidade")).not.toBeNull();
    expect(table.textContent).not.toMatch(/unidade-desconhecida-9/);
  });

  it("casa a casa: sem a visita domiciliar ligada a modalidade nem é oferecida", async () => {
    await fixedPostForm();
    const options = within(screen.getByLabelText("Modalidade")).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual([ "fixed_post", "routine" ]);
  });

  it("casa a casa com a visita domiciliar: leva a campanha e o animal, sem household_id nem unidade", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "zoonoses_team" ], [ "clinical_record", "territory_registry", "zoonoses", "home_visits" ]));
    mocked(api.recordVaccination).mockResolvedValue(vaccination());
    await fixedPostForm();
    set("Modalidade", "house");
    await pickAnimal();
    expect(screen.queryByLabelText("Unidade")).toBeNull();
    click("Registrar dose");
    await waitFor(() => expect(api.recordVaccination).toHaveBeenCalledTimes(1));
    expect(api.recordVaccination).toHaveBeenCalledWith({
      modality: "house", animal_id: "an1", campaign_id: "cp1", vaccinated_on: TODAY35B, vector_product_id: "pz1", adverse_event: false
    });
  });

  it("evento adverso mostra o lembrete do EATAV e pede a nota", async () => {
    mocked(api.recordVaccination).mockResolvedValue(vaccination({ modality: "fixed_post", animal_id: null, adverse_event: true, reminder: EATAV }));
    await fixedPostForm();
    expect(screen.queryByText(EATAV)).toBeNull();
    fireEvent.click(screen.getByLabelText("Evento adverso"));
    expect(screen.getByText(EATAV)).not.toBeNull();
    set("Espécie", "dog");
    set("Nota do evento adverso", "curta");
    click("Registrar dose");
    expect(await screen.findByText("escreva de 10 a 500 caracteres")).not.toBeNull();
    expect(api.recordVaccination).not.toHaveBeenCalled();
    set("Nota do evento adverso", "inchaço no local da aplicação");
    click("Registrar dose");
    await waitFor(() => expect(api.recordVaccination).toHaveBeenCalledTimes(1));
    expect(mocked(api.recordVaccination).mock.calls[0][0]).toMatchObject({ adverse_event: true, adverse_note: "inchaço no local da aplicação" });
    expect(await screen.findByText(EATAV)).not.toBeNull();
  });

  it("segunda dose: 422 already_vaccinated_in_campaign no animal; o formulário fica", async () => {
    mocked(api.recordVaccination).mockRejectedValue(new ApiError(422, { error: "already_vaccinated_in_campaign" }, "x"));
    await fixedPostForm();
    click("Informar animal cadastrado");
    await pickAnimal();
    set("Unidade", "u1");
    click("Registrar dose");
    expect(await screen.findByText(ZOONOSES_ERRORS.already_vaccinated_in_campaign)).not.toBeNull();
    expect(api.recordVaccination).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("form", { name: "Registrar dose" })).not.toBeNull();
    expect(screen.getByText(/Thor/)).not.toBeNull();
    expect(api.listRabiesCampaigns).toHaveBeenCalledTimes(1);
  });

  it("falta de saldo não recusa: a dose fica e a frase da conciliação aparece", async () => {
    mocked(api.recordVaccination).mockResolvedValue(vaccination({ modality: "fixed_post", animal_id: null, stock_lot_id: null }));
    await fixedPostForm();
    set("Espécie", "dog");
    click("Registrar dose");
    expect(await screen.findByText("dose registrada; faltou saldo no local — a coordenação concilia em Faltas de insumo de campo")).not.toBeNull();
  });
});

describe("campanhas", () => {
  it("a coordenação cria: nome, período e metas sugeridas pela estimativa e pela cobertura", async () => {
    coordinator();
    mocked(api.getZooParameters).mockResolvedValue({ ...PARAMS, values: { ...ZOO_PARAMS, dog_population_estimate: 1001, cat_population_estimate: 333 } });
    mocked(api.listRabiesCampaigns).mockResolvedValue([]);
    mocked(api.createRabiesCampaign).mockResolvedValue(campaign({ stage: "planned" }));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Nova campanha" }));
    expect(await screen.findByText("sugestão: 801 cães e 266 gatos (estimativa × cobertura de 80%)")).not.toBeNull();
    set("Nome", "Campanha 2026");
    set("Início", "2026-11-24");
    set("Fim", "2026-12-23");
    expect((screen.getByLabelText("Meta de cães") as HTMLInputElement).value).toBe("801");
    click("Salvar campanha");
    await waitFor(() => expect(api.createRabiesCampaign).toHaveBeenCalledTimes(1));
    expect(api.createRabiesCampaign).toHaveBeenCalledWith({ name: "Campanha 2026", starts_on: "2026-11-24", ends_on: "2026-12-23", goal_dogs: 801, goal_cats: 266 });
  });

  it("sem estimativa não há sugestão, e a meta é pedida", async () => {
    coordinator();
    mocked(api.listRabiesCampaigns).mockResolvedValue([]);
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Nova campanha" }));
    await form("Nova campanha");
    expect(screen.queryByText(/sugestão:/)).toBeNull();
    set("Nome", "Campanha 2026");
    set("Início", "2026-12-23");
    set("Fim", "2026-11-24");
    click("Salvar campanha");
    expect(await screen.findByText("o início não pode ser depois do fim")).not.toBeNull();
    expect(screen.getAllByText("informe a meta (número inteiro, 0 ou mais)").length).toBe(2);
    expect(api.createRabiesCampaign).not.toHaveBeenCalled();
  });

  it("editar só na planejada: manda o que mudou com expected_version; 409 relê uma vez", async () => {
    coordinator();
    mocked(api.listRabiesCampaigns).mockResolvedValue([ campaign({ stage: "planned", version: 4 }) ]);
    mocked(api.updateRabiesCampaign).mockRejectedValue(new ApiError(409, { error: "campaign_changed" }, "x"));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Editar" }));
    await form("Editar campanha");
    set("Meta de cães", "900");
    click("Salvar campanha");
    expect(await screen.findByText(ZOONOSES_ERRORS.campaign_changed)).not.toBeNull();
    expect(api.updateRabiesCampaign).toHaveBeenCalledWith("cp1", { goal_dogs: 900, expected_version: 4 });
    expect(api.updateRabiesCampaign).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(api.listRabiesCampaigns).toHaveBeenCalledTimes(2));
  });

  it("campanha aberta não oferece Editar; abrir só na planejada", async () => {
    coordinator();
    mocked(api.listRabiesCampaigns).mockResolvedValue([ campaign() ]);
    view();
    await screen.findByText("Campanha antirrábica 2026");
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Abrir campanha" })).toBeNull();
    expect(screen.getByRole("button", { name: "Encerrar campanha" })).not.toBeNull();
  });

  it("abrir com outra aberta: 409 campaign_already_open relê uma vez e não reenvia", async () => {
    coordinator();
    mocked(api.listRabiesCampaigns).mockResolvedValue([ campaign({ id: "cp2", name: "Campanha nova", stage: "planned" }) ]);
    mocked(api.openRabiesCampaign).mockRejectedValue(new ApiError(409, { error: "campaign_already_open" }, "x"));
    view();
    await screen.findByText("Campanha nova");
    click("Abrir campanha");
    click("Confirmar");
    expect(await screen.findByText(ZOONOSES_ERRORS.campaign_already_open)).not.toBeNull();
    expect(api.openRabiesCampaign).toHaveBeenCalledTimes(1);
    expect(api.openRabiesCampaign).toHaveBeenCalledWith("cp2");
    await waitFor(() => expect(api.listRabiesCampaigns).toHaveBeenCalledTimes(2));
    await new Promise((r) => setTimeout(r, 30));
    expect(api.openRabiesCampaign).toHaveBeenCalledTimes(1);
    expect(api.listRabiesCampaigns).toHaveBeenCalledTimes(2);
  });

  it("encerrar: confirma, envia uma vez e relê", async () => {
    coordinator();
    mocked(api.closeRabiesCampaign).mockResolvedValue(campaign({ stage: "closed" }));
    view();
    await screen.findByText("Campanha antirrábica 2026");
    click("Encerrar campanha");
    click("Confirmar");
    await waitFor(() => expect(api.closeRabiesCampaign).toHaveBeenCalledWith("cp1"));
    await waitFor(() => expect(api.listRabiesCampaigns).toHaveBeenCalledTimes(2));
  });
});

describe("anulação", () => {
  it("motivo 10–500; estorna e marca a dose", async () => {
    mocked(api.listVaccinations)
      .mockResolvedValueOnce({ items: [ vaccination() ], next_before: null })
      .mockResolvedValue({ items: [ vaccination({ cancelled: true, cancelled_at: "2026-11-23T10:00:00-03:00" }) ], next_before: null });
    mocked(api.cancelVaccination).mockResolvedValue(vaccination({ cancelled: true }));
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Anular" }));
    set("Motivo da anulação", "curto");
    click("Confirmar anulação");
    expect(await screen.findByText("escreva de 10 a 500 caracteres")).not.toBeNull();
    expect(api.cancelVaccination).not.toHaveBeenCalled();
    set("Motivo da anulação", "dose registrada no animal errado");
    click("Confirmar anulação");
    await waitFor(() => expect(api.cancelVaccination).toHaveBeenCalledWith("v1", "dose registrada no animal errado"));
    expect(await screen.findByText("anulada")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Anular" })).toBeNull();
  });

  it("a equipe não anula a dose de outra pessoa; a coordenação anula", async () => {
    mocked(api.listVaccinations).mockResolvedValue({ items: [ vaccination({ recorded_by_user_id: "outra" }) ], next_before: null });
    view();
    await screen.findByText("com cadastro");
    expect(screen.queryByRole("button", { name: "Anular" })).toBeNull();
    cleanup();
    coordinator();
    view();
    expect(await screen.findByRole("button", { name: "Anular" })).not.toBeNull();
  });
});

describe("resultado semanal", () => {
  const weekly = {
    name: "rabies_weekly" as const,
    columns: [
      { key: "epi_week", label: "Semana epidemiológica", kind: "text" as const }, { key: "dogs", label: "Cães na semana", kind: "count" as const },
      { key: "dog_coverage", label: "Cobertura de cães sobre a meta %", kind: "percent" as const },
      { key: "dog_coverage_estimate", label: "Cobertura de cães sobre a estimativa %", kind: "percent" as const },
      { key: "remark", label: "Observação", kind: "text" as const }
    ],
    rows: [
      { epi_week: "2026-47", dogs: 12, dog_coverage: "5.0", dog_coverage_estimate: null, after_planned_end: false, remark: null },
      { epi_week: "2026-49", dogs: 3, dog_coverage: "5.4", dog_coverage_estimate: "4.2", after_planned_end: true, remark: null }
    ],
    notes: [ "Campanha: Campanha antirrábica 2026." ]
  };

  it("só no clique; as duas coberturas; semana depois do fim marcada; CSV com o nome do api", async () => {
    mocked(api.getZoonosesReport).mockResolvedValue(weekly);
    mocked(api.fetchZoonosesReportFile).mockResolvedValue({ blob: new Blob([ "x" ]), filename: "rabies_weekly-2026-11-23.csv" });
    view();
    await screen.findByText("Campanha antirrábica 2026");
    expect(api.getZoonosesReport).not.toHaveBeenCalled();
    click("Ver resultado semanal");
    const table = await screen.findByRole("table", { name: "Resultado semanal" });
    expect(api.getZoonosesReport).toHaveBeenCalledTimes(1);
    expect(api.getZoonosesReport).toHaveBeenCalledWith("rabies_weekly", { from: "2026-10-05", to: TODAY35B, campaign_id: "cp1" });
    expect(within(table).getByText("Cobertura de cães sobre a meta %")).not.toBeNull();
    expect(within(table).getByText("Cobertura de cães sobre a estimativa %")).not.toBeNull();
    expect(within(table).getByText("5,0")).not.toBeNull();
    expect(within(table).getByText("4,2")).not.toBeNull();
    expect(within(table).getAllByText("—").length).toBeGreaterThan(0);
    expect(within(table).getAllByText("após o fim previsto da campanha").length).toBe(1);
    click("Baixar CSV");
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(vi.mocked(saveFile).mock.calls[0][1]).toBe("rabies_weekly-2026-11-23.csv");
    expect(api.fetchZoonosesReportFile).toHaveBeenCalledWith("rabies_weekly", { from: "2026-10-05", to: TODAY35B, campaign_id: "cp1" });
  });

  it("o período do relatório não passa de 366 dias", async () => {
    mocked(api.listRabiesCampaigns).mockResolvedValue([ campaign({ starts_on: "2025-01-01" }) ]);
    mocked(api.getZoonosesReport).mockResolvedValue(weekly);
    view();
    await screen.findByText("Campanha antirrábica 2026");
    click("Ver resultado semanal");
    await screen.findByRole("table", { name: "Resultado semanal" });
    expect(api.getZoonosesReport).toHaveBeenCalledWith("rabies_weekly", { from: "2025-11-23", to: TODAY35B, campaign_id: "cp1" });
  });
});

describe("administração", () => {
  it("admin lê campanhas e resultado, sem botões de escrita nem dose", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser([ "municipal_admin" ]));
    mocked(api.getZoonosesReport).mockResolvedValue({ name: "rabies_weekly", columns: [ { key: "epi_week", label: "Semana", kind: "text" } ], rows: [ { epi_week: "2026-47" } ] });
    view();
    await screen.findByText("Campanha antirrábica 2026");
    for (const n of [ "Nova campanha", "Editar", "Abrir campanha", "Encerrar campanha", "Registrar dose", "Anular" ]) {
      expect(screen.queryByRole("button", { name: n })).toBeNull();
    }
    expect(screen.queryByRole("form", { name: "Registrar dose" })).toBeNull();
    expect(api.listVaccinations).not.toHaveBeenCalled();
    click("Ver resultado semanal");
    expect(await screen.findByText("2026-47")).not.toBeNull();
  });
});
