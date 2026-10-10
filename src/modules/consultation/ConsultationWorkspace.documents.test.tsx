// src/modules/consultation/ConsultationWorkspace.documents.test.tsx
// Módulo 19c: o encaixe dos documentos na consulta (medicamentos ao lado dos
// problemas e, na Task 6, a aba Documentos). Os componentes novos são dublês:
// o comportamento deles tem teste próprio.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { useState } from "react";
import type { Consultation } from "../../lib/api";

// Montagens do editor: trocar de aba não pode remontá-lo (o autosave perderia o digitado).
const editorMounts = vi.hoisted(() => ({ n: 0 }));

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(),
    startConsultation: vi.fn(), getConsultation: vi.fn() };
});
vi.mock("./ConsultationEditor", () => ({
  ConsultationEditor: function EditorDouble(p: { consultation: Consultation; onFinalized(c: Consultation): void }) {
    useState(() => { editorMounts.n += 1; return 0; });
    const [ text, setText ] = useState("");
    return (
      <div>
        <span>{`editor ${p.consultation.id}`}</span>
        <label>Anotação (dublê)<input value={text} onChange={(e) => setText(e.target.value)} /></label>
        <button type="button" onClick={() => p.onFinalized({ ...p.consultation, status: "finalized" })}>finalizar (dublê)</button>
      </div>
    );
  }
}));
vi.mock("../documents/ConsultationDocuments", () => ({
  ConsultationDocuments: (p: { consultationId: string; issue?: { cboCode: string; unitId?: string } }) => (
    <span>{`documentos ${p.consultationId} · ${p.issue ? `emissão ${p.issue.cboCode} ${p.issue.unitId}` : "só lista"}`}</span>
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

  it("abas Consulta e Documentos depois de iniciar; o rascunho fica montado (e com o digitado) ao trocar de aba", async () => {
    editorMounts.n = 0;
    renderIt();
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    expect(screen.queryByRole("tab", { name: "Documentos" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar consulta" }));
    fireEvent.change(await screen.findByLabelText("Anotação (dublê)"), { target: { value: "dor lombar há 3 dias" } });
    fireEvent.click(screen.getByRole("tab", { name: "Documentos" }));
    expect(screen.getByText("documentos cs1 · emissão 225142 u1")).not.toBeNull();
    expect(screen.getByText("editor cs1").closest("[hidden]")).not.toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "Consulta" }));
    expect(screen.getByText("editor cs1").closest("[hidden]")).toBeNull();
    expect(screen.queryByText(/^documentos cs1/)).toBeNull();
    expect((screen.getByLabelText("Anotação (dublê)") as HTMLInputElement).value).toBe("dor lombar há 3 dias");
    expect(editorMounts.n).toBe(1);
  });

  it("consulta de outra autora: Documentos só com a lista", async () => {
    mocked(api.startConsultation).mockResolvedValue(consultation({ author: { id: "us9", name: "Dr. Outro" } }));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Documentos" }));
    expect(screen.getByText("documentos cs1 · só lista")).not.toBeNull();
  });

  it("sem clinical_documents: sem abas", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "health_professional" ], { features: [ "clinical_record" ] }));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    expect(await screen.findByText("editor cs1")).not.toBeNull();
    expect(screen.queryByRole("tab")).toBeNull();
  });
});
