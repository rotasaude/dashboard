// src/modules/consultation/ConsultationWorkspace.documents.test.tsx
// Módulo 19c: o encaixe dos documentos na consulta (medicamentos ao lado dos
// problemas e, na Task 6, a aba Documentos). Os componentes novos são dublês:
// o comportamento deles tem teste próprio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { Consultation } from "../../lib/api";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(),
    startConsultation: vi.fn(), getConsultation: vi.fn() };
});
vi.mock("./ConsultationEditor", () => ({
  ConsultationEditor: (p: { consultation: Consultation; onFinalized(c: Consultation): void }) => (
    <div>
      <span>{`editor ${p.consultation.id}`}</span>
      <button type="button" onClick={() => p.onFinalized({ ...p.consultation, status: "finalized" })}>finalizar (dublê)</button>
    </div>
  )
}));
vi.mock("./ConsultationView", () => ({
  ConsultationView: (p: { consultation: Consultation }) => <span>{`consulta finalizada ${p.consultation.id}`}</span>,
  ConsultationLoader: (p: { id: string }) => <span>{`consulta anterior ${p.id}`}</span>
}));
vi.mock("./MedicationsBlock", () => ({
  MedicationsBlock: (p: { patientId: string; draftConsultationId: string | null; unitId?: string }) => (
    <span>{`medicamentos ${p.patientId} · ${p.draftConsultationId ? `rascunho ${p.draftConsultationId}` : "sem consulta"} · ${p.unitId}`}</span>
  )
}));

import * as api from "../../lib/api";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders } from "../../test/campaignFixtures";
import { consultation, options, record } from "../../test/consultationFixtures";
import { docUser } from "../../test/documentFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function renderIt() {
  renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={vi.fn()} onFinalized={vi.fn()} />);
}

describe("ConsultationWorkspace — documentos clínicos (19c)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getAttendanceRecord, api.getConsultationOptions, api.startConsultation, api.getConsultation ]) {
      mocked(fn).mockReset();
    }
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser());
    mocked(api.getAttendanceRecord).mockResolvedValue(record());
    mocked(api.getConsultationOptions).mockResolvedValue(options());
    mocked(api.startConsultation).mockResolvedValue(consultation());
  });

  it("os medicamentos aparecem ao lado dos problemas; mudar só com a consulta em rascunho", async () => {
    renderIt();
    expect(await screen.findByText("medicamentos pa1 · sem consulta · u1")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar consulta" }));
    expect(await screen.findByText("medicamentos pa1 · rascunho cs1 · u1")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "finalizar (dublê)" }));
    expect(await screen.findByText("medicamentos pa1 · sem consulta · u1")).not.toBeNull();
  });

  it("sem clinical_documents na sessão, nada novo aparece", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "health_professional" ], { features: [ "clinical_record" ] }));
    renderIt();
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    expect(screen.queryByText(/^medicamentos /)).toBeNull();
  });
});
