import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(),
    startConsultation: vi.fn(), getConsultation: vi.fn(), getConsultationProblems: vi.fn(), listExamOrders: vi.fn(), listExternalResults: vi.fn() };
});
vi.mock("./ConsultationEditor", () => ({ ConsultationEditor: () => <span>editor</span> }));

import * as api from "../../lib/api";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { consultation, options, problem, record } from "../../test/consultationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

describe("ConsultationWorkspace — aba Exames (módulo 21a)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getAttendanceRecord, api.getConsultationOptions, api.startConsultation,
      api.getConsultationProblems, api.listExamOrders, api.listExternalResults ]) mocked(fn).mockReset();
    mocked(api.getAttendanceRecord).mockResolvedValue(record());
    mocked(api.getConsultationOptions).mockResolvedValue(options());
    mocked(api.startConsultation).mockResolvedValue(consultation());
    mocked(api.getConsultationProblems).mockResolvedValue([ problem() ]);
    mocked(api.listExamOrders).mockResolvedValue({ orders: [], next_before: null });
    mocked(api.listExternalResults).mockResolvedValue([]);
  });

  it("exam_tracking ligado: a aba Exames existe", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record", "exam_tracking" ] }));
    renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={() => undefined} onFinalized={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    expect(await screen.findByRole("tab", { name: "Exames" })).not.toBeNull();
  });

  it("exam_tracking desligado: painel idêntico ao de hoje, sem aba nem leitura de exames", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record" ] }));
    renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={() => undefined} onFinalized={() => undefined} />);
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    await screen.findByText("editor");
    expect(screen.queryByRole("tab", { name: "Exames" })).toBeNull();
    expect(api.listExamOrders).not.toHaveBeenCalled();
  });
});
