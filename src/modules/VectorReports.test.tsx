// src/modules/VectorReports.test.tsx
// "Relatórios de endemias" (módulo 35a, Task 17; F-35.9; contrato §10; Q22, Q28, Q31): cada papel vê só os relatórios que lê
// (ReportsController#readable?), os seletores de ciclo e de levantamento leem as listas da Q31 só ao escolher o relatório, os
// filtros são recusados no campo (antes e depois do api), o período vai até 366 dias, a contagem suprimida aparece "< 5", o CSV
// de todos e o PDF só do LIRAa saem com o nome do api (sem pessoa). Nenhuma leitura antes do "Ver"; contagens exatas.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), getVectorReport: vi.fn(), fetchVectorReportFile: vi.fn(), listCycles: vi.fn(),
    listLiraaSurveys: vi.fn(), listPanelNeighborhoods: vi.fn(), getVectorDiseases: vi.fn()
  };
});
vi.mock("./lab/saveFile", () => ({ saveFile: vi.fn() }));

import * as api from "../lib/api";
import { ApiError, type VectorCycle, type VectorReportName } from "../lib/api";
import { VC_NO_ROLE, vectorRoles } from "../lib/vectorControl";
import { saveFile } from "./lab/saveFile";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY35, liraaSurvey, report, vcUser } from "../test/vectorControlFixtures";
import {
  PERIOD_TOO_LONG, PICK_CYCLE, PICK_SURVEY, REPORTS_FOR, REPORT_TITLES, TO_BEFORE_FROM, VectorReports
} from "./VectorReports";

const ALL = [ api.fetchCurrentSession, api.getVectorReport, api.fetchVectorReportFile, api.listCycles, api.listLiraaSurveys,
  api.listPanelNeighborhoods, api.getVectorDiseases, saveFile ];
const SEVEN = [ "Situação dos imóveis por ciclo", "Pontos estratégicos", "Produção dos agentes", "Consumo de produtos",
  "Ovitrampas (IPO, IDO, IDV)", "LIRAa", "Bloqueios" ];
const cycle = (o: Partial<VectorCycle> = {}): VectorCycle => ({ id: "cy1", year: 2026, number: 6, starts_on: "2026-11-01", ends_on: "2026-11-30", ...o });
const BLOCKS_REPORT = report({
  name: "blocks",
  columns: [
    { key: "status", label: "Status", kind: "text" }, { key: "blocks", label: "Bloqueios", kind: "count" },
    { key: "cases", label: "Casos", kind: "count" }, { key: "hours_to_confirmation", label: "Horas até a confirmação (média)", kind: "decimal" },
    { key: "cycles", label: "Ciclos", kind: "count" }
  ],
  rows: [
    { status: "Proposto", blocks: 1, cases: { suppressed: true }, hours_to_confirmation: null, cycles: 0 },
    { status: "Ativo", blocks: 2, cases: 7, hours_to_confirmation: "12.5", cycles: 3 }
  ],
  notes: [ "Casos de 1 a 4 saem suprimidos." ]
});
const csvFile = (filename: string | null) => ({ blob: new Blob([ "a;b" ], { type: "text/csv" }), filename });

afterEach(() => { cleanup(); window.localStorage.clear(); window.sessionStorage.clear(); });
beforeEach(() => {
  for (const f of ALL) vi.mocked(f as ReturnType<typeof vi.fn>).mockReset();
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "endemic_coordinator" ]));
  vi.mocked(api.listCycles).mockResolvedValue([ cycle(), cycle({ id: "cy2", number: 7, starts_on: "2026-12-01", ends_on: "2026-12-26" }) ]);
  vi.mocked(api.listLiraaSurveys).mockResolvedValue([ liraaSurvey({ status: "closed" }) ]);
  vi.mocked(api.listPanelNeighborhoods).mockResolvedValue([
    { id: "nb2", name: "Vila Nova", active: true }, { id: "nb1", name: "Centro", active: true }, { id: "nb3", name: "Antigo", active: false }
  ]);
  vi.mocked(api.getVectorReport).mockResolvedValue(report());
  vi.mocked(api.fetchVectorReportFile).mockImplementation(async (name, _f, format) => csvFile(`${name}-2026-11-16.${format}`));
});

const mount = () => renderWithProviders(<VectorReports today={TODAY35} />);
const tick = () => new Promise((r) => setTimeout(r, 20));
const picker = () => screen.findByLabelText("Relatório") as Promise<HTMLSelectElement>;
const optionsOf = (s: HTMLSelectElement) => Array.from(s.options).filter((o) => o.value !== "").map((o) => o.textContent);
async function choose(name: VectorReportName) {
  fireEvent.change(await picker(), { target: { value: name } });
  return within(await screen.findByRole("region", { name: REPORT_TITLES[name] }));
}
const noRead = () => {
  for (const f of [ api.getVectorReport, api.fetchVectorReportFile, api.listCycles, api.listLiraaSurveys, api.listPanelNeighborhoods, api.getVectorDiseases ]) {
    expect(f).not.toHaveBeenCalled();
  }
};
async function pickCycle(r: ReturnType<typeof within>, id = "cy1") {
  await waitFor(() => expect(r.getByRole("option", { name: /^Ciclo 6\/2026/ })).not.toBeNull());
  fireEvent.change(r.getByLabelText("Ciclo"), { target: { value: id } });
}
async function pickSurvey(r: ReturnType<typeof within>) {
  await waitFor(() => expect(r.getByRole("option", { name: /^LIRAa novembro/ })).not.toBeNull());
  fireEvent.change(r.getByLabelText("Levantamento"), { target: { value: "s1" } });
}
const period = (r: ReturnType<typeof within>, from: string, to: string) => {
  fireEvent.change(r.getByLabelText("De"), { target: { value: from } });
  fireEvent.change(r.getByLabelText("Até"), { target: { value: to } });
};

describe("REPORTS_FOR", () => {
  it("coordenação e admin, os sete na ordem do api; laboratório, ovitraps e liraa (Q28); os outros, nenhum", () => {
    const all: VectorReportName[] = [ "situations", "strategic_points", "production", "consumption", "ovitraps", "liraa", "blocks" ];
    expect(REPORTS_FOR(vectorRoles(vcUser([ "endemic_coordinator" ])))).toEqual(all);
    expect(REPORTS_FOR(vectorRoles(vcUser([ "municipal_admin" ])))).toEqual(all);
    expect(REPORTS_FOR(vectorRoles(vcUser([ "vector_lab" ])))).toEqual([ "ovitraps", "liraa" ]);
    expect(REPORTS_FOR(vectorRoles(vcUser([ "health_professional" ])))).toEqual([]);
    expect(all.map((n) => REPORT_TITLES[n])).toEqual(SEVEN);
  });
});

describe("VectorReports", () => {
  it("coordenação vê os sete; nenhuma leitura ao abrir a tela", async () => {
    mount();
    expect(optionsOf(await picker())).toEqual(SEVEN);
    await tick();
    noRead();
  });

  it("laboratório só \"Ovitrampas\" e \"LIRAa\"; o profissional nem a escolha, sem leitura", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "vector_lab" ]));
    mount();
    expect(optionsOf(await picker())).toEqual([ "Ovitrampas (IPO, IDO, IDV)", "LIRAa" ]);
    cleanup();
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "health_professional" ]));
    mount();
    expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
    expect(screen.queryByLabelText("Relatório")).toBeNull();
    await tick();
    noRead();
  });

  it("situations com ciclo e dois bairros chama getVectorReport(\"situations\", { cycle_id: \"cy1\", neighborhood_ids: [ \"nb1\", \"nb2\" ] }) só no \"Ver\"", async () => {
    mount();
    const r = await choose("situations");
    await pickCycle(r);
    await waitFor(() => expect(r.getByLabelText("Centro")).not.toBeNull());
    fireEvent.click(r.getByLabelText("Centro"));
    fireEvent.click(r.getByLabelText("Vila Nova"));
    expect(r.getByLabelText("Antigo (inativo)")).not.toBeNull();
    await tick();
    expect(api.getVectorReport).not.toHaveBeenCalled();
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    expect(await r.findByText("R (residencial)")).not.toBeNull();
    expect(r.getByText("8,3")).not.toBeNull();
    await tick();
    // Duplo clique: uma leitura; bairros na ordem da lista por nome; o ano do ciclo é o do api (Q22).
    expect(api.getVectorReport).toHaveBeenCalledTimes(1);
    expect(api.getVectorReport).toHaveBeenCalledWith("situations", { cycle_id: "cy1", neighborhood_ids: [ "nb1", "nb2" ] });
    expect(api.listCycles).toHaveBeenCalledTimes(1);
    expect(api.listCycles).toHaveBeenCalledWith(2026);
    expect(api.listPanelNeighborhoods).toHaveBeenCalledTimes(1);
    expect(api.listLiraaSurveys).not.toHaveBeenCalled();
    expect(api.fetchVectorReportFile).not.toHaveBeenCalled();
    expect(r.getByRole("option", { name: "Ciclo 6/2026 · 01/11/2026 a 30/11/2026" })).not.toBeNull();
    // "Ver" de novo, com os mesmos filtros, relê uma vez (ação explícita); mudar o filtro esconde o resultado velho.
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    await waitFor(() => expect(api.getVectorReport).toHaveBeenCalledTimes(2));
    fireEvent.click(r.getByLabelText("Vila Nova"));
    expect(r.queryByText("R (residencial)")).toBeNull();
    await tick();
    expect(api.getVectorReport).toHaveBeenCalledTimes(2);
  });

  it("Q31: os seletores leem as listas de quem lê o relatório — admin ciclo e levantamento, laboratório só levantamento", async () => {
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "municipal_admin" ]));
    mount();
    expect(optionsOf(await picker())).toEqual(SEVEN);
    const sp = await choose("strategic_points");
    await pickCycle(sp);
    const lr = await choose("liraa");
    await pickSurvey(lr);
    fireEvent.click(lr.getByRole("button", { name: "Ver" }));
    await waitFor(() => expect(api.getVectorReport).toHaveBeenCalledWith("liraa", { survey_id: "s1" }));
    expect(lr.getByRole("option", { name: "LIRAa novembro · 23/11/2026 a 27/11/2026 · fechado" })).not.toBeNull();
    // Voltar ao relatório anterior não relê a lista (a tela fica montada) e mantém o ciclo escolhido.
    await choose("strategic_points");
    await tick();
    expect((sp.getByLabelText("Ciclo") as HTMLSelectElement).value).toBe("cy1");
    expect(api.listCycles).toHaveBeenCalledTimes(1);
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(1);
    expect(api.listPanelNeighborhoods).not.toHaveBeenCalled();
    expect(api.getVectorReport).toHaveBeenCalledTimes(1);
    cleanup();

    for (const f of ALL.slice(1)) vi.mocked(f as ReturnType<typeof vi.fn>).mockClear();
    vi.mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "vector_lab" ]));
    mount();
    const lab = await choose("liraa");
    await pickSurvey(lab);
    await choose("ovitraps");
    await tick();
    expect(api.listLiraaSurveys).toHaveBeenCalledTimes(1);
    expect(api.listPanelNeighborhoods).toHaveBeenCalledTimes(1);
    expect(api.listCycles).not.toHaveBeenCalled();
    expect(api.getVectorReport).not.toHaveBeenCalled();
  });

  it("filtros recusados no campo: sem ciclo, sem levantamento, e o 422 do api com path no campo dele", async () => {
    mount();
    const r = await choose("situations");
    await waitFor(() => expect(r.getByRole("option", { name: /^Ciclo 6\/2026/ })).not.toBeNull());
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    fireEvent.click(r.getByRole("button", { name: "Baixar CSV" }));
    expect(r.getByRole("alert").textContent).toBe(PICK_CYCLE);
    const lr = await choose("liraa");
    await waitFor(() => expect(lr.getByRole("option", { name: /^LIRAa novembro/ })).not.toBeNull());
    fireEvent.click(lr.getByRole("button", { name: "Ver" }));
    expect(lr.getByRole("alert").textContent).toBe(PICK_SURVEY);
    await tick();
    expect(api.getVectorReport).not.toHaveBeenCalled();
    expect(api.fetchVectorReportFile).not.toHaveBeenCalled();

    // O ciclo sumiu entre a lista e o clique: 422 path cycle_id, a frase ao lado do ciclo.
    await choose("situations");
    vi.mocked(api.getVectorReport).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "cycle_id" }, "x"));
    await pickCycle(r);
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    const cycleError = await r.findByRole("alert");
    expect(cycleError.id).toBe("vc-report-situations-cycle_id-error");
    expect(r.getByLabelText("Ciclo").getAttribute("aria-describedby")).toBe(cycleError.id);
    // Bairro que sumiu: 422 path neighborhood_ids[1], no grupo dos bairros (o CSV também).
    vi.mocked(api.fetchVectorReportFile).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "neighborhood_ids[1]" }, "x"));
    fireEvent.click(r.getByLabelText("Centro"));
    fireEvent.click(r.getByLabelText("Vila Nova"));
    fireEvent.click(r.getByRole("button", { name: "Baixar CSV" }));
    expect((await r.findByRole("alert")).id).toBe("vc-report-situations-neighborhood_ids-error");
    expect(saveFile).not.toHaveBeenCalled();
    expect(api.getVectorReport).toHaveBeenCalledTimes(1);
    expect(api.fetchVectorReportFile).toHaveBeenCalledTimes(1);
  });

  it("período: fim antes do início e mais de 366 dias recusados no campo; 366 dias e um dia só passam; o 422 path to no fim", async () => {
    mount();
    const r = await choose("blocks");
    period(r, "2026-11-10", "2026-11-09");
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    expect(r.getByRole("alert").textContent).toBe(TO_BEFORE_FROM);
    period(r, "2025-11-15", "2026-11-16");
    fireEvent.click(r.getByRole("button", { name: "Baixar CSV" }));
    expect(r.getByRole("alert").textContent).toBe(PERIOD_TOO_LONG);
    expect(r.getByRole("alert").id).toBe("vc-report-blocks-to-error");
    await tick();
    expect(api.getVectorReport).not.toHaveBeenCalled();
    expect(api.fetchVectorReportFile).not.toHaveBeenCalled();
    // 2025-11-16..2026-11-16: 366 dias contando os dois; o limite do api (MAX_DAYS = 366).
    period(r, "2025-11-16", "2026-11-16");
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    await waitFor(() => expect(api.getVectorReport).toHaveBeenCalledWith("blocks", { from: "2025-11-16", to: "2026-11-16" }));
    period(r, "2026-11-16", "2026-11-16");
    vi.mocked(api.getVectorReport).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "to" }, "x"));
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    expect((await r.findByRole("alert")).id).toBe("vc-report-blocks-to-error");
    expect(api.getVectorReport).toHaveBeenCalledTimes(2);
    expect(api.getVectorReport).toHaveBeenLastCalledWith("blocks", { from: "2026-11-16", to: "2026-11-16" });
  });

  it("contagem { suppressed: true } aparece \"< 5\", nunca 0, e sem linha de total; as notas abaixo", async () => {
    vi.mocked(api.getVectorReport).mockResolvedValue(BLOCKS_REPORT);
    mount();
    const r = await choose("blocks");
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    const t = within(await r.findByRole("table", { name: "Bloqueios" }));
    expect(t.getByText("< 5")).not.toBeNull();
    expect(t.getByText("12,5")).not.toBeNull();
    expect(t.getAllByText("—").length).toBe(1);
    expect(t.queryByText("Total")).toBeNull();
    // Nenhuma célula soma: as contagens são as do api (1, 2, 7, 0, 3) e mais nada.
    expect(t.queryByText("8")).toBeNull();
    expect(r.getByText("Casos de 1 a 4 saem suprimidos.")).not.toBeNull();
    // O bloqueio não mostra doença (Reports#blocks): os nomes da Q38 não são lidos.
    expect(api.getVectorDiseases).not.toHaveBeenCalled();
    expect(api.getVectorReport).toHaveBeenCalledWith("blocks", { from: "2026-11-01", to: "2026-11-16" });
  });

  it("LIRAa provisório mostra \"provisório\"; ovitrampas manda as semanas do intervalo e só os bairros marcados", async () => {
    vi.mocked(api.getVectorReport).mockResolvedValueOnce(report({ name: "liraa", provisional: true, notes: [ "Provisório: há amostra sem resultado de laboratório." ] }));
    mount();
    const lr = await choose("liraa");
    await pickSurvey(lr);
    fireEvent.click(lr.getByRole("button", { name: "Ver" }));
    expect(await lr.findByText("provisório")).not.toBeNull();
    expect(lr.getByText("Provisório: há amostra sem resultado de laboratório.")).not.toBeNull();

    const ov = await choose("ovitraps");
    expect((ov.getByLabelText("Semana inicial (AAAA-SS)") as HTMLInputElement).value).toBe("2026-45");
    fireEvent.change(ov.getByLabelText("Semana inicial (AAAA-SS)"), { target: { value: "2026-43" } });
    fireEvent.click(ov.getByRole("button", { name: "Ver" }));
    await waitFor(() => expect(api.getVectorReport).toHaveBeenLastCalledWith("ovitraps", { epi_weeks: [ "2026-43", "2026-44", "2026-45" ] }));
    fireEvent.change(ov.getByLabelText("Semana final (AAAA-SS)"), { target: { value: "2026-48" } });
    fireEvent.click(ov.getByRole("button", { name: "Ver" }));
    expect(ov.getByRole("alert").textContent).toBe("semana final: semana no futuro");
    expect(api.getVectorReport).toHaveBeenCalledTimes(2);
  });

  it("CSV de cada relatório baixa com o nome do api; PDF só no LIRAa", async () => {
    mount();
    const names: VectorReportName[] = [ "situations", "strategic_points", "production", "consumption", "ovitraps", "liraa", "blocks" ];
    for (const name of names) {
      const r = await choose(name);
      if (name === "situations" || name === "strategic_points") await pickCycle(r);
      if (name === "liraa") await pickSurvey(r);
      if (name === "liraa") expect(r.getByRole("button", { name: "Baixar PDF" })).not.toBeNull();
      else expect(r.queryByRole("button", { name: "Baixar PDF" })).toBeNull();
      fireEvent.click(r.getByRole("button", { name: "Baixar CSV" }));
      await waitFor(() => expect(saveFile).toHaveBeenLastCalledWith(expect.anything(), `${name}-2026-11-16.csv`));
    }
    expect(vi.mocked(api.fetchVectorReportFile).mock.calls).toEqual([
      [ "situations", { cycle_id: "cy1" }, "csv" ], [ "strategic_points", { cycle_id: "cy1" }, "csv" ],
      [ "production", { from: "2026-11-01", to: "2026-11-16" }, "csv" ], [ "consumption", { from: "2026-11-01", to: "2026-11-16" }, "csv" ],
      [ "ovitraps", { epi_weeks: [ "2026-45" ] }, "csv" ], [ "liraa", { survey_id: "s1" }, "csv" ], [ "blocks", { from: "2026-11-01", to: "2026-11-16" }, "csv" ]
    ]);
    const lr = await choose("liraa");
    vi.mocked(api.fetchVectorReportFile).mockResolvedValueOnce({ blob: new Blob([ "%PDF" ], { type: "application/pdf" }), filename: "liraa-2026-11-16.pdf" });
    fireEvent.click(lr.getByRole("button", { name: "Baixar PDF" }));
    fireEvent.click(lr.getByRole("button", { name: "Baixar PDF" }));
    await waitFor(() => expect(saveFile).toHaveBeenLastCalledWith(expect.anything(), "liraa-2026-11-16.pdf"));
    await tick();
    expect(api.fetchVectorReportFile).toHaveBeenCalledTimes(8);
    expect(api.fetchVectorReportFile).toHaveBeenLastCalledWith("liraa", { survey_id: "s1" }, "pdf");
    expect(saveFile).toHaveBeenCalledTimes(8);
    expect(api.getVectorReport).not.toHaveBeenCalled();
  });

  it("download sem nome do api: \"<relatório>-<data>.<formato>\", sem pessoa; nada em URL ou storage; falha no aviso", async () => {
    vi.mocked(api.fetchVectorReportFile).mockResolvedValueOnce(csvFile(null));
    vi.mocked(api.getVectorReport).mockResolvedValue(report({
      name: "production", columns: [ { key: "professional", label: "Agente", kind: "text" }, { key: "households", label: "Imóveis", kind: "count" } ],
      rows: [ { professional: "Joana Silva", households: 14 } ]
    }));
    const href = window.location.href;
    mount();
    const r = await choose("production");
    fireEvent.click(r.getByRole("button", { name: "Ver" }));
    expect(await r.findByText("Joana Silva")).not.toBeNull();
    fireEvent.click(r.getByRole("button", { name: "Baixar CSV" }));
    await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
    const name = vi.mocked(saveFile).mock.calls[0][1];
    expect(name).toBe("production-2026-11-16.csv");
    expect(name).not.toMatch(/joana|silva/i);
    expect(window.location.href).toBe(href);
    expect(window.localStorage.length + window.sessionStorage.length).toBe(0);

    vi.mocked(api.fetchVectorReportFile).mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.click(r.getByRole("button", { name: "Baixar CSV" }));
    expect((await r.findByRole("alert")).textContent).not.toBe("");
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(api.fetchVectorReportFile).toHaveBeenCalledTimes(2);
    expect(api.getVectorReport).toHaveBeenCalledTimes(1);
  });
});
