// src/modules/consultation/ConsultationWorkspace.procedures.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(),
    startConsultation: vi.fn(), getConsultation: vi.fn(), getConsultationProblems: vi.fn() };
});
vi.mock("./ConsultationEditor", () => ({ ConsultationEditor: () => <span>editor (dublê)</span> }));
vi.mock("../billing/ProceduresPanel", () => ({
  ProceduresPanel: (p: { attendanceId: string; consultationId?: string | null; patientId?: string | null; unit: { id: string } }) =>
    <span>{`procedimentos ${p.unit.id} ${p.attendanceId} ${p.consultationId ?? "sem consulta"} ${p.patientId ?? "sem paciente"}`}</span>
}));

import * as api from "../../lib/api";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { consultation, options, problem, record } from "../../test/consultationFixtures";
import { UBS, UPA } from "../../test/billingFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

describe("ConsultationWorkspace — procedimentos (módulo 22)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getAttendanceRecord, api.getConsultationOptions, api.startConsultation, api.getConsultationProblems ]) mocked(fn).mockReset();
    mocked(api.getAttendanceRecord).mockResolvedValue(record());
    mocked(api.getConsultationOptions).mockResolvedValue(options());
    mocked(api.startConsultation).mockResolvedValue(consultation());
    mocked(api.getConsultationProblems).mockResolvedValue([ problem() ]);
  });

  const open = (unit: api.HealthUnit) => renderWithProviders(
    <ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={() => undefined} onFinalized={() => undefined} />
  );

  it("UPA com procedure_billing: o painel aparece antes de iniciar e, depois, leva a consulta", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record", "procedure_billing" ] }));
    open(UPA);
    expect(await screen.findByText("procedimentos u7 a1 sem consulta pa1")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar consulta" }));
    expect(await screen.findByText("procedimentos u7 a1 cs1 pa1")).not.toBeNull();
  });

  it("UBS ou sem o interruptor: sem o painel", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record", "procedure_billing" ] }));
    open(UBS);
    await screen.findByRole("button", { name: "Iniciar consulta" });
    expect(screen.queryByText(/^procedimentos /)).toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record" ] }));
    open(UPA);
    await screen.findByRole("button", { name: "Iniciar consulta" });
    expect(screen.queryByText(/^procedimentos /)).toBeNull();
  });
});
