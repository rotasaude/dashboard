// src/modules/ZooReports.test.tsx
// Relatórios de zoonoses (módulo 35b, Task 12; F-35.17): os seis, para a equipe e o municipal_admin; filtros (campanha no semanal,
// período nos outros, inquérito opcional no leish); "Ver" só no clique; contagem suprimida "< 5" (a soma é do api); CSV com o nome do api.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getZoonosesReport: vi.fn(), fetchZoonosesReportFile: vi.fn(), listRabiesCampaigns: vi.fn(),
    listLeishSurveys: vi.fn()
  };
});
vi.mock("./lab/saveFile", () => ({ saveFile: vi.fn() }));

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY35B, campaign, survey, zooReport, zooUser } from "../test/zoonosesFixtures";
import { saveFile } from "./lab/saveFile";
import { ZooReports } from "./ZooReports";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const MOCKS = [ api.fetchCurrentSession, api.getZoonosesReport, api.fetchZoonosesReportFile, api.listRabiesCampaigns, api.listLeishSurveys ];
const TITLES = [
  "Vacinação antirrábica por semana", "Doses por modalidade e espécie", "Demandas por subtipo", "Observações por desfecho",
  "Leishmaniose por inquérito", "Canil e gatil"
];
const DEMANDS = zooReport({
  name: "demands",
  columns: [ { key: "subtype", label: "Subtipo", kind: "text" }, { key: "count", label: "Demandas", kind: "count" } ],
  rows: [ { subtype: "Escorpião", count: { suppressed: true } }, { subtype: "Carrapato", count: 12 } ]
});

afterEach(cleanup);
beforeEach(() => {
  for (const fn of MOCKS) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(zooUser());
  mocked(api.getZoonosesReport).mockResolvedValue(DEMANDS);
  mocked(api.listRabiesCampaigns).mockResolvedValue([ campaign(), campaign({ id: "cp0", name: "Campanha 2025", starts_on: "2025-10-01", stage: "closed" }) ]);
  mocked(api.listLeishSurveys).mockResolvedValue([ survey() ]);
  vi.mocked(saveFile).mockReset();
});

const view = () => renderWithProviders(<ZooReports today={TODAY35B} />);
const pick = async (title: string) => {
  const select = await screen.findByLabelText("Relatório");
  fireEvent.change(select, { target: { value: (within(select).getByRole("option", { name: title }) as HTMLOptionElement).value } });
};
const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const set = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

describe("escolha do relatório", () => {
  it.each([ [ "equipe", [ "zoonoses_team" ] ], [ "municipal_admin", [ "municipal_admin" ] ] ])("os seis títulos para %s", async (_who, roles) => {
    mocked(api.fetchCurrentSession).mockResolvedValue(zooUser(roles));
    view();
    const select = await screen.findByLabelText("Relatório");
    const names = within(select).getAllByRole("option").map((o) => o.textContent);
    expect(names).toEqual([ "Escolha o relatório", ...TITLES ]);
  });

  it("nada é lido antes do Ver", async () => {
    view();
    await pick("Demandas por subtipo");
    await screen.findByRole("button", { name: "Ver" });
    expect(api.getZoonosesReport).not.toHaveBeenCalled();
    expect(api.fetchZoonosesReportFile).not.toHaveBeenCalled();
    expect(api.listRabiesCampaigns).not.toHaveBeenCalled();
    expect(api.listLeishSurveys).not.toHaveBeenCalled();
  });
});

describe("período", () => {
  it("demands com o padrão dos últimos 30 dias; contagem suprimida aparece \"< 5\" e nada é somado", async () => {
    view();
    await pick("Demandas por subtipo");
    click("Ver");
    await screen.findByText("Escorpião");
    expect(api.getZoonosesReport).toHaveBeenCalledTimes(1);
    expect(api.getZoonosesReport).toHaveBeenCalledWith("demands", { from: "2026-10-25", to: TODAY35B });
    expect(screen.getByText("< 5")).not.toBeNull();
    expect(screen.getByText("12")).not.toBeNull();
    expect(screen.queryByText("17")).toBeNull();
  });

  it("período de 367 dias recusa antes de chamar o api", async () => {
    view();
    await pick("Demandas por subtipo");
    set("De", "2025-11-21");
    click("Ver");
    expect((await screen.findByRole("alert")).textContent).toBe("o período vai até 366 dias");
    expect(api.getZoonosesReport).not.toHaveBeenCalled();
  });

  it("data final antes da inicial recusa antes de chamar o api", async () => {
    view();
    await pick("Observações por desfecho");
    set("Até", "2026-10-01");
    click("Ver");
    expect((await screen.findByRole("alert")).textContent).toBe("a data final vem antes da inicial");
    expect(api.getZoonosesReport).not.toHaveBeenCalled();
  });

  it("422 invalid_request com path from aparece no filtro", async () => {
    mocked(api.getZoonosesReport).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "from" }, "x"));
    view();
    await pick("Canil e gatil");
    click("Ver");
    const msg = await screen.findByText("data inicial recusada pelo servidor");
    expect(msg.getAttribute("role")).toBe("alert");
    expect(screen.getByLabelText("De").getAttribute("aria-describedby")).toBe(msg.id);
  });

  it("alterar o filtro esconde o resultado anterior", async () => {
    view();
    await pick("Demandas por subtipo");
    click("Ver");
    await screen.findByText("Escorpião");
    set("De", "2026-11-01");
    expect(screen.queryByText("Escorpião")).toBeNull();
  });
});

describe("campanha e inquérito", () => {
  it("rabies_weekly: a campanha escolhida vira o período (início até hoje) e o campaign_id", async () => {
    mocked(api.getZoonosesReport).mockResolvedValue(zooReport({ name: "rabies_weekly" }));
    view();
    await pick("Vacinação antirrábica por semana");
    expect(screen.queryByLabelText("De")).toBeNull();
    click("Ver");
    expect((await screen.findByRole("alert")).textContent).toBe("escolha a campanha");
    expect(api.getZoonosesReport).not.toHaveBeenCalled();
    await screen.findByRole("option", { name: /Campanha antirrábica 2026/ });
    set("Campanha", "cp1");
    click("Ver");
    await screen.findByText("Posto fixo");
    expect(api.getZoonosesReport).toHaveBeenCalledWith("rabies_weekly", { from: "2026-10-05", to: TODAY35B, campaign_id: "cp1" });
  });

  it("rabies_weekly: a observação do api aparece e a chave after_planned_end não vira coluna", async () => {
    mocked(api.getZoonosesReport).mockResolvedValue(zooReport({
      name: "rabies_weekly", columns: [ { key: "epi_week", label: "Semana", kind: "text" }, { key: "remark", label: "Observação", kind: "text" } ],
      rows: [ { epi_week: "2026-47", remark: "após o fim previsto da campanha", after_planned_end: true } ]
    }));
    view();
    await pick("Vacinação antirrábica por semana");
    await screen.findByRole("option", { name: /Campanha antirrábica 2026/ });
    set("Campanha", "cp1");
    click("Ver");
    await screen.findByText("2026-47");
    expect(screen.getAllByText("após o fim previsto da campanha").length).toBeGreaterThan(0);
    expect(screen.queryByText("true")).toBeNull();
  });

  it("rabies_weekly de campanha antiga: o início é limitado a 365 dias atrás", async () => {
    mocked(api.getZoonosesReport).mockResolvedValue(zooReport({ name: "rabies_weekly" }));
    view();
    await pick("Vacinação antirrábica por semana");
    await screen.findByRole("option", { name: /Campanha 2025/ });
    set("Campanha", "cp0");
    click("Ver");
    await waitFor(() => expect(api.getZoonosesReport).toHaveBeenCalledTimes(1));
    expect(api.getZoonosesReport).toHaveBeenCalledWith("rabies_weekly", { from: "2025-11-23", to: TODAY35B, campaign_id: "cp0" });
  });

  it("leish: o inquérito é opcional e vai como survey_id quando escolhido", async () => {
    mocked(api.getZoonosesReport).mockResolvedValue(zooReport({ name: "leish" }));
    view();
    await pick("Leishmaniose por inquérito");
    await screen.findByRole("option", { name: /Inquérito Centro/ });
    click("Ver");
    await waitFor(() => expect(api.getZoonosesReport).toHaveBeenCalledTimes(1));
    expect(api.getZoonosesReport).toHaveBeenLastCalledWith("leish", { from: "2026-10-25", to: TODAY35B });
    set("Inquérito", "sv1");
    click("Ver");
    await waitFor(() => expect(api.getZoonosesReport).toHaveBeenCalledTimes(2));
    expect(api.getZoonosesReport).toHaveBeenLastCalledWith("leish", { from: "2026-10-25", to: TODAY35B, survey_id: "sv1" });
  });
});

describe("CSV", () => {
  it("baixa com o nome do api, sem ler o relatório", async () => {
    const file = { blob: new Blob([ "x" ]), filename: "demands-2026-11-23.csv" };
    mocked(api.fetchZoonosesReportFile).mockResolvedValue(file);
    view();
    await pick("Demandas por subtipo");
    click("Baixar CSV");
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    expect(api.fetchZoonosesReportFile).toHaveBeenCalledWith("demands", { from: "2026-10-25", to: TODAY35B });
    expect(saveFile).toHaveBeenCalledWith(file, "demands-2026-11-23.csv");
    expect(api.getZoonosesReport).not.toHaveBeenCalled();
  });

  it("sem nome no cabeçalho usa relatório-data; recusa do api aparece na tela", async () => {
    mocked(api.fetchZoonosesReportFile).mockResolvedValueOnce({ blob: new Blob([ "x" ]), filename: null });
    view();
    await pick("Canil e gatil");
    click("Baixar CSV");
    await waitFor(() => expect(saveFile).toHaveBeenCalledWith(expect.anything(), "shelter-2026-11-23.csv"));
    mocked(api.fetchZoonosesReportFile).mockRejectedValueOnce(new ApiError(403, { error: "missing_role" }, "x"));
    click("Baixar CSV");
    expect((await screen.findByRole("alert")).textContent).toBe("seu papel não permite esta ação");
  });
});
