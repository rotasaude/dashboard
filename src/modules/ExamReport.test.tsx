// src/modules/ExamReport.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getExamReport: vi.fn(), fetchExamReportCsv: vi.fn(), listEnabledProviders: vi.fn() };
});

import * as api from "../lib/api";
import { ExamReport } from "./ExamReport";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW21, examUser } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ROW = { provider: { id: "pv1", name: "Laboratório Simulado" }, authorized: 12, collected: 10, resulted_on_time: 8, resulted_late: 1, pending: 3 };
let downloads: string[];

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("ExamReport", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW21));
    for (const fn of [ api.fetchCurrentSession, api.getExamReport, api.fetchExamReportCsv, api.listEnabledProviders ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "municipal_admin" ]));
    mocked(api.getExamReport).mockResolvedValue([ ROW ]);
    mocked(api.listEnabledProviders).mockResolvedValue([ { id: "pv1", name: "Laboratório Simulado" } ]);
    mocked(api.fetchExamReportCsv).mockResolvedValue({ blob: new Blob([ "short_code\n" ], { type: "text/csv" }), filename: null });
    downloads = [];
    Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:csv-1") });
    Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
  });

  it("mês da cidade e todos os prestadores por padrão; filtros vão para a consulta", async () => {
    renderWithProviders(<ExamReport />);
    const panel = await screen.findByRole("region", { name: "Conferência por prestador" });
    const row = (await within(panel).findAllByRole("row"))[1];
    expect([ "12", "10", "8", "1", "3" ].every((n) => within(row).queryByText(n) !== null)).toBe(true);
    expect(api.getExamReport).toHaveBeenCalledWith("2026-10", null);
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    await waitFor(() => expect(api.getExamReport).toHaveBeenLastCalledWith("2026-10", "pv1"));
    fireEvent.change(within(panel).getByLabelText("Mês"), { target: { value: "2026-09" } });
    await waitFor(() => expect(api.getExamReport).toHaveBeenLastCalledWith("2026-09", "pv1"));
  });

  it("baixa o CSV detalhado com nome pelo mês", async () => {
    renderWithProviders(<ExamReport />);
    const panel = await screen.findByRole("region", { name: "Conferência por prestador" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Baixar CSV detalhado" }));
    await waitFor(() => expect(api.fetchExamReportCsv).toHaveBeenCalledWith("2026-10", null, true));
    await waitFor(() => expect(downloads).toEqual([ "conferencia-exames-2026-10-detalhado.csv" ]));
    expect(within(panel).getByText("O CSV detalhado traz só o código do exame, o SIGTAP e as datas — nenhum dado do paciente.")).not.toBeNull();
  });

  it("regulador vê; recepção não", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "exam_regulator" ]));
    renderWithProviders(<ExamReport />);
    expect(await screen.findByRole("region", { name: "Conferência por prestador" })).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "citizen_verifier" ]));
    mocked(api.getExamReport).mockClear();
    renderWithProviders(<ExamReport />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.getExamReport).not.toHaveBeenCalled();
  });

  it("usa sempre o nome montado pela tela, ignorando o nome enviado pelo api", async () => {
    mocked(api.fetchExamReportCsv).mockResolvedValue({ blob: new Blob([ "short_code\n" ], { type: "text/csv" }), filename: "conferencia-exames-2026-10.csv" });
    renderWithProviders(<ExamReport />);
    const panel = await screen.findByRole("region", { name: "Conferência por prestador" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Baixar CSV detalhado" }));
    await waitFor(() => expect(downloads).toEqual([ "conferencia-exames-2026-10-detalhado.csv" ]));
    fireEvent.click(within(panel).getByRole("button", { name: "Baixar CSV" }));
    await waitFor(() => expect(downloads).toEqual([ "conferencia-exames-2026-10-detalhado.csv", "conferencia-exames-2026-10.csv" ]));
  });

  it("libera o endereço do arquivo 60 s depois do download", async () => {
    let deliver!: (f: { blob: Blob; filename: null }) => void;
    mocked(api.fetchExamReportCsv).mockReturnValue(new Promise((r) => { deliver = r; }));
    renderWithProviders(<ExamReport />);
    const panel = await screen.findByRole("region", { name: "Conferência por prestador" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Baixar CSV" }));
    vi.useRealTimers(); // useFakeTimers não reinstala se já há relógio falso
    vi.useFakeTimers({ toFake: [ "Date", "setTimeout", "clearTimeout" ] });
    vi.setSystemTime(new Date(NOW21));
    deliver({ blob: new Blob([ "short_code\n" ], { type: "text/csv" }), filename: null });
    // Só microtarefas (vi.waitFor avançaria o relógio falso).
    await act(async () => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); });
    expect(downloads).toEqual([ "conferencia-exames-2026-10.csv" ]);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(59_999);
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:csv-1");
  });

  it("download em andamento: novo clique (mesmo no outro botão) não baixa de novo", async () => {
    let deliver!: (f: { blob: Blob; filename: null }) => void;
    mocked(api.fetchExamReportCsv).mockReturnValue(new Promise((r) => { deliver = r; }));
    renderWithProviders(<ExamReport />);
    const panel = await screen.findByRole("region", { name: "Conferência por prestador" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Baixar CSV" }));
    fireEvent.click(within(panel).getByRole("button", { name: /^Baixar CSV detalhado/ }));
    fireEvent.click(within(panel).getByRole("button", { name: /^Baixar CSV( …)?$/ }));
    expect(api.fetchExamReportCsv).toHaveBeenCalledTimes(1);
    deliver({ blob: new Blob([ "short_code\n" ], { type: "text/csv" }), filename: null });
    await waitFor(() => expect(downloads).toEqual([ "conferencia-exames-2026-10.csv" ]));
    expect(api.fetchExamReportCsv).toHaveBeenCalledTimes(1);
  });
});
