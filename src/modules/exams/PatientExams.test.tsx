// src/modules/exams/PatientExams.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listExamOrders: vi.fn(), listExternalResults: vi.fn(), getExamOrder: vi.fn(),
    listExamCatalog: vi.fn(), recordExternalResult: vi.fn(), uploadExamFile: vi.fn(), fetchExamPdf: vi.fn() };
});

import * as api from "../../lib/api";
import { PatientExams } from "./PatientExams";
import { renderWithProviders } from "../../test/campaignFixtures";
import { HBA1C_ENTRY, HEMOGRAM_ENTRY, NOW21, TODAY21, examOrder, examResult, examUser, pdfFile } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listExamOrders, api.listExternalResults, api.getExamOrder, api.listExamCatalog,
  api.recordExternalResult, api.uploadExamFile, api.fetchExamPdf ];

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("PatientExams", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW21));
    for (const fn of ALL) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser());
    mocked(api.listExamOrders).mockResolvedValue({
      orders: [ examOrder({ status: "collected", priority: "urgent", overdue: { stage: "result", due_on: "2026-10-11", days_late: 2 } }) ],
      next_before: "cur1"
    });
    mocked(api.listExternalResults).mockResolvedValue([ { ...examResult({ id: "ex1", origin: "external", laboratory_name: "Lab Particular" }),
      sigtap_code: "0202010503", label: "Dosagem de hemoglobina glicosilada" } ]);
    mocked(api.listExamCatalog).mockResolvedValue([ HEMOGRAM_ENTRY, HBA1C_ENTRY ]);
    mocked(api.uploadExamFile).mockResolvedValue("up9");
    mocked(api.recordExternalResult).mockResolvedValue(examResult({ id: "ex2", origin: "external" }));
  });

  it("lista os exames do paciente com situação, prioridade e atraso; Carregar mais usa o cursor", async () => {
    renderWithProviders(<PatientExams patientId="pa1" />);
    const section = await screen.findByRole("region", { name: "Exames do paciente" });
    await within(section).findByText("coletado");
    expect(within(section).getByText("urgente")).not.toBeNull();
    expect(within(section).getByText("resultado · 2 dias de atraso")).not.toBeNull();
    expect(api.listExamOrders).toHaveBeenCalledWith({ patientId: "pa1", before: null });
    mocked(api.listExamOrders).mockResolvedValueOnce({ orders: [ examOrder({ id: "eo2", label: "Urina tipo I" }) ], next_before: null });
    fireEvent.click(within(section).getByRole("button", { name: "Carregar mais" }));
    await within(section).findByText("Urina tipo I");
    expect(api.listExamOrders).toHaveBeenLastCalledWith({ patientId: "pa1", before: "cur1" });
    expect(within(section).queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("resultados externos aparecem com laboratório e data", async () => {
    renderWithProviders(<PatientExams patientId="pa1" />);
    const ext = await screen.findByRole("region", { name: "Resultados externos" });
    await within(ext).findByText("Lab Particular");
    expect(within(ext).getByText("12/10/2026")).not.toBeNull();
  });

  it("registra resultado externo com a consulta em curso", async () => {
    renderWithProviders(<PatientExams patientId="pa1" consultationId="c9" />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar resultado externo" }));
    const box = screen.getByRole("region", { name: "Resultado externo" });
    fireEvent.change(await within(box).findByLabelText("Exame"), { target: { value: "0202010503" } });
    const form = within(box).getByRole("form", { name: "Registrar resultado externo" });
    fireEvent.change(within(form).getByLabelText("Laudo (PDF, até 10 MB)"), { target: { files: [ pdfFile() ] } });
    await within(form).findByText("anexado: laudo.pdf");
    fireEvent.change(within(form).getByLabelText("Laboratório"), { target: { value: "Lab Particular" } });
    fireEvent.change(within(form).getByLabelText("HbA1c (%)"), { target: { value: "7,8" } });
    fireEvent.click(within(form).getByRole("button", { name: "Registrar resultado externo" }));
    await waitFor(() => expect(api.recordExternalResult).toHaveBeenCalledWith({
      patient_id: "pa1", sigtap_code: "0202010503", released_on: TODAY21, laboratory_name: "Lab Particular", upload_id: "up9",
      values: [ { key: "hba1c", value: "7,8" } ], consultation_id: "c9"
    }));
    expect((await screen.findByText("Resultado externo registrado.")).getAttribute("role")).toBe("status");
    expect(screen.queryByRole("region", { name: "Resultado externo" })).toBeNull();
  });

  it("Abrir mostra o exame", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder());
    renderWithProviders(<PatientExams patientId="pa1" />);
    fireEvent.click(await screen.findByRole("button", { name: "Abrir Hemograma completo" }));
    expect(await screen.findByRole("region", { name: "Exame Hemograma completo" })).not.toBeNull();
  });

  it("sem papel de profissional: não lê nem mostra resultados externos", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "citizen_verifier" ]));
    renderWithProviders(<PatientExams patientId="pa1" />);
    await screen.findByRole("region", { name: "Exames do paciente" });
    await screen.findByText("coletado");
    expect(screen.queryByRole("region", { name: "Resultados externos" })).toBeNull();
    expect(api.listExternalResults).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Registrar resultado externo" })).not.toBeNull();
  });

  it("leitura recusada fora de contexto mostra a frase, não quebra", async () => {
    mocked(api.listExamOrders).mockRejectedValue(new api.ApiError(403, { error: "out_of_context" }, "forbidden"));
    renderWithProviders(<PatientExams patientId="pa1" />);
    expect((await screen.findByText("esta pessoa não está em atendimento com você")).getAttribute("role")).toBe("alert");
  });
});
