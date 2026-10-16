// src/modules/LabReports.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listExamProviders: vi.fn(), getLabProduction: vi.fn(), getLabRejections: vi.fn(),
    getLabTurnaround: vi.fn(), fetchLabReportCsv: vi.fn() };
});

import * as api from "../lib/api";
import { LabReports, fmtCents } from "./LabReports";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW21B, labContext, labUser } from "../test/labFixtures";
import { examProvider } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
let downloads: string[];

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

beforeEach(() => {
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21B));
  for (const fn of [ api.fetchCurrentSession, api.getLabContext, api.listExamProviders, api.getLabProduction, api.getLabRejections, api.getLabTurnaround, api.fetchLabReportCsv ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "municipal_admin" ]));
  mocked(api.getLabContext).mockResolvedValue(labContext());
  mocked(api.listExamProviders).mockResolvedValue([ examProvider({ id: "pv9", name: "Laboratório Municipal", uses_municipal_lab: true }), examProvider({ id: "pv2", name: "Credenciado", uses_municipal_lab: false }) ]);
  mocked(api.getLabProduction).mockResolvedValue({
    rows: [ { origin_unit: { id: "u1", name: "UBS Centro" }, sigtap_code: "0202010473", exam_name: "Glicose", sector: "bioquimica",
      releaser: { id: "us7", name: "Bia Farmacêutica" }, quantity: 120, sigtap_value_cents: 22800 } ],
    total_quantity: 120, total_value_cents: 22800
  });
  mocked(api.getLabRejections).mockResolvedValue([ { reason: { id: "rr1", name: "hemolisada" }, origin_unit: { id: "u1", name: "UBS Centro" }, count: 4 } ]);
  mocked(api.getLabTurnaround).mockResolvedValue([ { sigtap_code: "0202010473", exam_name: "Glicose", on_time: 110, late: 6, pending: 4 } ]);
  mocked(api.fetchLabReportCsv).mockResolvedValue({ blob: new Blob([ "a\n" ], { type: "text/csv" }), filename: "x.csv" });
  downloads = [];
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:csv") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
});

describe("LabReports", () => {
  it("mês da cidade e todos os laboratórios; produção com quantidade e valor SIGTAP", async () => {
    renderWithProviders(<LabReports />);
    const prod = await screen.findByRole("region", { name: "Produção" });
    expect(await within(prod).findByText("Bia Farmacêutica")).not.toBeNull();
    // A linha e o total mostram o mesmo valor.
    expect(within(prod).getAllByText("R$ 228,00", { exact: false }).length).toBe(2);
    expect(api.getLabProduction).toHaveBeenCalledWith({ providerId: null, month: "2026-10" });
    fireEvent.change(screen.getByLabelText("Laboratório"), { target: { value: "pv9" } });
    await waitFor(() => expect(api.getLabTurnaround).toHaveBeenLastCalledWith({ providerId: "pv9", month: "2026-10" }));
  });

  it("rejeição e prazo", async () => {
    renderWithProviders(<LabReports />);
    const rej = await screen.findByRole("region", { name: "Rejeições" });
    expect(await within(rej).findByText("hemolisada")).not.toBeNull();
    const tat = screen.getByRole("region", { name: "Prazo de entrega" });
    expect(await within(tat).findByText("110")).not.toBeNull();
  });

  it("CSV de cada relatório com o nome montado pela tela", async () => {
    renderWithProviders(<LabReports />);
    const rej = await screen.findByRole("region", { name: "Rejeições" });
    fireEvent.click(within(rej).getByRole("button", { name: "Baixar CSV" }));
    await waitFor(() => expect(api.fetchLabReportCsv).toHaveBeenCalledWith("rejections", { providerId: null, month: "2026-10" }));
    await waitFor(() => expect(downloads).toEqual([ "laboratorio-rejeicoes-2026-10.csv" ]));
  });

  it("a equipe do laboratório não vê os relatórios", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    renderWithProviders(<LabReports />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.getLabProduction).not.toHaveBeenCalled();
  });

  it("mostra a janela do mês e nunca manda dado de paciente na consulta", async () => {
    renderWithProviders(<LabReports />);
    await screen.findByRole("region", { name: "Produção" });
    expect(screen.getByLabelText("Mês")).toHaveProperty("value", "2026-10");
    expect(JSON.stringify(mocked(api.getLabProduction).mock.calls)).not.toMatch(/cpf|patient/i);
  });

  it("administrador vê só prestadores do laboratório municipal", async () => {
    renderWithProviders(<LabReports />);
    await screen.findByRole("region", { name: "Produção" });
    const sel = await screen.findByLabelText("Laboratório");
    await waitFor(() => expect(within(sel).queryByText("Laboratório Municipal")).not.toBeNull());
    expect(within(sel).queryByText("Credenciado")).toBeNull();
    expect(api.getLabContext).not.toHaveBeenCalled();
  });

  it("liberador vê só os laboratórios em que libera", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_releaser" ]));
    mocked(api.getLabContext).mockResolvedValue(labContext({
      labs: [ { id: "pv9", name: "Laboratório Municipal" }, { id: "pv3", name: "Outro" } ], releaser_of: [ "pv9" ]
    }));
    renderWithProviders(<LabReports />);
    const sel = await screen.findByLabelText("Laboratório");
    await waitFor(() => expect(within(sel).queryByText("Laboratório Municipal")).not.toBeNull());
    expect(within(sel).queryByText("Outro")).toBeNull();
    expect(api.listExamProviders).not.toHaveBeenCalled();
  });

  it("sem laboratório: estado vazio aponta para o catálogo e não consulta relatório", async () => {
    mocked(api.listExamProviders).mockResolvedValue([ examProvider({ id: "pv2", uses_municipal_lab: false }) ]);
    renderWithProviders(<LabReports />);
    expect(await screen.findByText("nenhum laboratório municipal para reportar")).not.toBeNull();
    expect(screen.getByText(/Exames → Catálogo e prestadores/)).not.toBeNull();
    expect(api.getLabProduction).not.toHaveBeenCalled();
  });

  it("falha do CSV mostra a mensagem do código", async () => {
    mocked(api.fetchLabReportCsv).mockRejectedValue(new Error("boom"));
    renderWithProviders(<LabReports />);
    const rej = await screen.findByRole("region", { name: "Rejeições" });
    fireEvent.click(within(rej).getByRole("button", { name: "Baixar CSV" }));
    expect((await screen.findAllByRole("alert")).length).toBeGreaterThan(0);
    expect(downloads).toEqual([]);
  });

  it("mês apagado pede o mês e não consulta", async () => {
    renderWithProviders(<LabReports />);
    await screen.findByRole("region", { name: "Produção" });
    mocked(api.getLabProduction).mockClear();
    fireEvent.change(screen.getByLabelText("Mês"), { target: { value: "" } });
    expect((await screen.findByRole("alert")).textContent).toBe("escolha o mês");
    expect(api.getLabProduction).not.toHaveBeenCalled();
  });

  it("valor em reais", () => {
    expect(fmtCents(22800).replace(/\s/g, " ")).toBe("R$ 228,00");
    expect(fmtCents(123456789).replace(/\s/g, " ")).toBe("R$ 1.234.567,89");
    expect(fmtCents(5).replace(/\s/g, " ")).toBe("R$ 0,05");
    expect(fmtCents(0).replace(/\s/g, " ")).toBe("R$ 0,00");
  });
});
