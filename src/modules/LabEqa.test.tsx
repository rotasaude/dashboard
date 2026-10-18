// src/modules/LabEqa.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listLabExams: vi.fn(), listEqaRounds: vi.fn(), createEqaRound: vi.fn(),
    uploadEqaReport: vi.fn(), createEqaAnnualReport: vi.fn(), fetchEqaAnnualReport: vi.fn(), getEqaSummary: vi.fn() };
});

import * as api from "../lib/api";
import { LabEqa } from "./LabEqa";
import { renderWithProviders } from "../test/campaignFixtures";
import { GLU_EXAM, NOW21C, eqaAnnualReport, eqaRound, qcContext, qcUser } from "../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listLabExams, api.listEqaRounds, api.createEqaRound, api.uploadEqaReport,
  api.createEqaAnnualReport, api.fetchEqaAnnualReport, api.getEqaSummary ];
const SUMMARY = {
  year: 2026, rows: [ { analyte_key: "glicose", lab_exam_id: "le1", rounds: 3, adequate: 2, inadequate: 1 } ],
  programs: [ { program: "PNCQ", annual_report: true, annual_report_id: "ar1" }, { program: "Controllab", annual_report: false, annual_report_id: null } ]
};
const pdf = () => new File([ "%PDF" ], "relatorio.pdf", { type: "application/pdf" });

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21C));
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_releaser" ]));
  mocked(api.getLabContext).mockResolvedValue(qcContext({ releaser_of: [ "pv9" ], technical_lead_of: [ "pv9" ] }));
  mocked(api.listLabExams).mockResolvedValue([ GLU_EXAM ]);
  mocked(api.listEqaRounds).mockResolvedValue([ eqaRound() ]);
  mocked(api.getEqaSummary).mockResolvedValue(SUMMARY);
  mocked(api.createEqaRound).mockResolvedValue(eqaRound({ id: "er2" }));
  mocked(api.uploadEqaReport).mockResolvedValue("up1");
  mocked(api.createEqaAnnualReport).mockResolvedValue(eqaAnnualReport({ id: "ar2", program: "Controllab" }));
});

async function newRound() {
  renderWithProviders(<LabEqa />);
  fireEvent.click(await screen.findByRole("button", { name: "Nova rodada" }));
  const form = screen.getByRole("region", { name: "Nova rodada do CEQ" });
  await within(form).findByRole("option", { name: "Glicose (Glicose)" });
  fireEvent.change(within(form).getByLabelText("Programa"), { target: { value: "PNCQ" } });
  fireEvent.change(within(form).getByLabelText("Código da rodada"), { target: { value: "2026-04" } });
  fireEvent.change(within(form).getByLabelText("Data da rodada"), { target: { value: "2026-10-10" } });
  const item = within(form).getByRole("group", { name: "Item 1" });
  fireEvent.change(within(item).getByLabelText("Analito"), { target: { value: "le1:glicose" } });
  fireEvent.change(within(item).getByLabelText("Enviado"), { target: { value: "107,0" } });
  fireEvent.change(within(item).getByLabelText("Alvo"), { target: { value: "100,0" } });
  fireEvent.change(within(item).getByLabelText("Limite inferior"), { target: { value: "94,0" } });
  fireEvent.change(within(item).getByLabelText("Limite superior"), { target: { value: "106,0" } });
  return { form, item };
}

describe("LabEqa rodadas", () => {
  it("adequação sugerida; inadequado exige ação; confirma com step-up; corpo sem relatório anual", async () => {
    const { form, item } = await newRound();
    expect((within(item).getByLabelText("Adequação") as HTMLSelectElement).value).toBe("inadequate");
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar rodada" }));
    expect(within(form).getByRole("alert").textContent).toBe("item 1: escreva a ação para o resultado inadequado (ao menos 10 caracteres)");
    expect(screen.queryByRole("button", { name: "Salvar rodada" })).toBeNull();
    fireEvent.change(within(item).getByLabelText("Ação para o inadequado"), { target: { value: "recalibração e nova dosagem do controle" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar rodada" }));
    expect(api.createEqaRound).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Salvar rodada" }));
    await waitFor(() => expect(api.createEqaRound).toHaveBeenCalledWith({
      provider_id: "pv9", program: "PNCQ", round_code: "2026-04", round_date: "2026-10-10",
      items: [ { lab_exam_id: "le1", analyte_key: "glicose", submitted: "107.0", target: "100.0", acceptable_low: "94.0", acceptable_high: "106.0",
        adequacy: "inadequate", action: "recalibração e nova dosagem do controle" } ]
    }));
    expect(await screen.findByText("Rodada registrada.")).not.toBeNull();
    await waitFor(() => expect(api.listEqaRounds).toHaveBeenCalledTimes(2));
  });

  it("409 duplicate_round vira frase", async () => {
    mocked(api.createEqaRound).mockRejectedValueOnce(new api.ApiError(409, { error: "duplicate_round" }, "x"));
    const { form, item } = await newRound();
    fireEvent.change(within(item).getByLabelText("Ação para o inadequado"), { target: { value: "recalibração e nova dosagem do controle" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar rodada" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar rodada" }));
    expect(await screen.findByText("este programa já tem uma rodada com este código neste laboratório")).not.toBeNull();
  });

  it("lista as rodadas do ano pelo ano numérico e mostra a adequação por analito", async () => {
    renderWithProviders(<LabEqa />);
    const rounds = await screen.findByRole("region", { name: "Rodadas" });
    expect(await within(rounds).findByText("1/1 adequados")).not.toBeNull();
    expect(api.listEqaRounds).toHaveBeenCalledWith("pv9", "2026");
    const summary = screen.getByRole("region", { name: "Adequação no ano" });
    expect(await within(summary).findByText("66,7%")).not.toBeNull();
  });

  it("ano malformado não consulta o api", async () => {
    renderWithProviders(<LabEqa />);
    const input = await screen.findByLabelText("Ano");
    await waitFor(() => expect(api.getEqaSummary).toHaveBeenCalledTimes(1));
    fireEvent.change(input, { target: { value: "" } });
    expect(await screen.findByText("ano com 4 dígitos")).not.toBeNull();
    fireEvent.change(input, { target: { value: "1999" } });
    expect(await screen.findByText("ano entre 2000 e 2026")).not.toBeNull();
    expect(api.listEqaRounds).toHaveBeenCalledTimes(1);
    expect(api.getEqaSummary).toHaveBeenCalledTimes(1);
  });
});

describe("LabEqa relatório anual", () => {
  it("mostra por programa se o ano tem relatório e abre o PDF numa janela nova", async () => {
    const win = { opener: {}, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(win as unknown as Window);
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:x") });
    mocked(api.fetchEqaAnnualReport).mockResolvedValue({ blob: new Blob([ "%PDF" ]), filename: null });
    renderWithProviders(<LabEqa />);
    const annual = await screen.findByRole("region", { name: "Relatório anual" });
    expect(await within(annual).findByText("sem relatório neste ano")).not.toBeNull();
    fireEvent.click(within(annual).getByRole("button", { name: "Abrir relatório de PNCQ" }));
    await waitFor(() => expect(api.fetchEqaAnnualReport).toHaveBeenCalledWith("ar1"));
  });

  async function openAnnual() {
    renderWithProviders(<LabEqa />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar relatório anual" }));
    const form = screen.getByRole("region", { name: "Novo relatório anual do CEQ" });
    fireEvent.change(within(form).getByLabelText("Programa do relatório"), { target: { value: "Controllab" } });
    return form;
  }

  it("só PDF; o envio e o registro acontecem na confirmação, com o ano numérico", async () => {
    const form = await openAnnual();
    const input = within(form).getByLabelText("Relatório anual (PDF)");
    fireEvent.change(input, { target: { files: [ new File([ "x" ], "planilha.xlsx", { type: "application/vnd.ms-excel" }) ] } });
    expect(within(form).getByRole("alert").textContent).toBe("o relatório anual precisa ser um PDF");
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e registrar relatório" }));
    expect(within(form).getByRole("alert").textContent).toBe("escolha o arquivo PDF do relatório");
    const file = pdf();
    fireEvent.change(input, { target: { files: [ file ] } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e registrar relatório" }));
    expect(api.uploadEqaReport).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar relatório" }));
    await waitFor(() => expect(api.createEqaAnnualReport).toHaveBeenCalledWith({ provider_id: "pv9", program: "Controllab", year: 2026, upload_id: "up1" }));
    expect(api.uploadEqaReport).toHaveBeenCalledWith(file);
    expect(await screen.findByText("Relatório anual registrado.")).not.toBeNull();
    await waitFor(() => expect(api.getEqaSummary).toHaveBeenCalledTimes(2));
  });

  it("PDF acima de 10 MB é recusado antes do envio", async () => {
    const form = await openAnnual();
    const big = new File([ "x" ], "grande.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 10 * 1024 * 1024 + 1 });
    fireEvent.change(within(form).getByLabelText("Relatório anual (PDF)"), { target: { files: [ big ] } });
    expect(within(form).getByRole("alert").textContent).toBe("o relatório anual pode ter no máximo 10 MB");
  });

  it("409 already_recorded vira frase e a tela relê", async () => {
    mocked(api.createEqaAnnualReport).mockRejectedValueOnce(new api.ApiError(409, { error: "already_recorded" }, "x"));
    const form = await openAnnual();
    fireEvent.change(within(form).getByLabelText("Relatório anual (PDF)"), { target: { files: [ pdf() ] } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e registrar relatório" }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar relatório" }));
    expect(await screen.findByText("este programa já tem relatório anual neste ano")).not.toBeNull();
    await waitFor(() => expect(api.getEqaSummary).toHaveBeenCalledTimes(2));
  });
});

describe("LabEqa correções", () => {
  async function openAnnual2() {
    renderWithProviders(<LabEqa />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar relatório anual" }));
    const form = screen.getByRole("region", { name: "Novo relatório anual do CEQ" });
    fireEvent.change(within(form).getByLabelText("Programa do relatório"), { target: { value: "Controllab" } });
    fireEvent.change(within(form).getByLabelText("Relatório anual (PDF)"), { target: { files: [ pdf() ] } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e registrar relatório" }));
    return form;
  }

  it("registro recusado e nova tentativa na mesma confirmação reaproveita o envio", async () => {
    mocked(api.createEqaAnnualReport).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_program" }, "x"));
    await openAnnual2();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar relatório" }));
    expect(await screen.findByText("programa inválido — use de 1 a 60 caracteres")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar relatório" }));
    await waitFor(() => expect(api.createEqaAnnualReport).toHaveBeenCalledTimes(2));
    expect(api.uploadEqaReport).toHaveBeenCalledTimes(1);
  });

  it("invalid_file zera o envio e a tentativa seguinte reenvia o PDF", async () => {
    mocked(api.createEqaAnnualReport).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_file" }, "x"));
    await openAnnual2();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar relatório" }));
    expect(await screen.findByText("arquivo inválido — envie um PDF")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar relatório" }));
    await waitFor(() => expect(api.createEqaAnnualReport).toHaveBeenCalledTimes(2));
    expect(api.uploadEqaReport).toHaveBeenCalledTimes(2);
  });

  it("admin lê e registra", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ]));
    mocked(api.getLabContext).mockResolvedValue(qcContext());
    await openAnnual2();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar relatório" }));
    await waitFor(() => expect(api.createEqaAnnualReport).toHaveBeenCalledWith({ provider_id: "pv9", program: "Controllab", year: 2026, upload_id: "up1" }));
    expect(api.listEqaRounds).toHaveBeenCalledWith("pv9", "2026");
  });

  it("404 na rodada diz a frase e relê a tela", async () => {
    mocked(api.createEqaRound).mockRejectedValueOnce(new api.ApiError(404, { error: "not_found" }, "x"));
    const { form, item } = await newRound();
    fireEvent.change(within(item).getByLabelText("Ação para o inadequado"), { target: { value: "recalibração e nova dosagem do controle" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar rodada" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar rodada" }));
    expect(await screen.findByText("não encontrado neste laboratório — a tela foi atualizada")).not.toBeNull();
    await waitFor(() => expect(api.listEqaRounds).toHaveBeenCalledTimes(2));
  });

  it("ano inválido: tabelas dizem 'ano inválido' e o formulário do relatório não some", async () => {
    renderWithProviders(<LabEqa />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar relatório anual" }));
    const form = screen.getByRole("region", { name: "Novo relatório anual do CEQ" });
    fireEvent.change(within(form).getByLabelText("Relatório anual (PDF)"), { target: { files: [ pdf() ] } });
    fireEvent.change(screen.getByLabelText("Ano"), { target: { value: "" } });
    expect(screen.getAllByText("ano inválido").length).toBe(3);
    expect(screen.queryByText("nenhuma rodada neste ano")).toBeNull();
    expect(screen.getByRole("region", { name: "Novo relatório anual do CEQ" })).not.toBeNull();
    expect((within(form).getByRole("button", { name: "Revisar e registrar relatório" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("LabEqa papéis", () => {
  it("equipe sem papel de liberador não vê", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ]));
    renderWithProviders(<LabEqa />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
  });
});
