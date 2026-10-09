// src/modules/consultation/ConsultationWorkspace.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { Consultation } from "../../lib/api";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getAttendanceRecord: vi.fn(), getConsultationOptions: vi.fn(),
    startConsultation: vi.fn(), getConsultation: vi.fn() };
});
vi.mock("./ConsultationEditor", () => ({
  ConsultationEditor: (p: { consultation: Consultation; onFinalized(c: Consultation): void; onLocked(m: string): void }) => (
    <div>
      <span>{`editor ${p.consultation.id}`}</span>
      <button type="button" onClick={() => p.onFinalized({ ...p.consultation, status: "finalized" })}>finalizar (dublê)</button>
      <button type="button" onClick={() => p.onLocked("esta consulta já foi finalizada — a tela foi atualizada")}>travar (dublê)</button>
    </div>
  )
}));
vi.mock("./ConsultationView", () => ({
  ConsultationView: (p: { consultation: Consultation; canAddendum: boolean; onAddendumAdded(a: unknown): void }) => (
    <div>
      <span>{`consulta finalizada ${p.consultation.id} · adendo ${p.canAddendum ? "sim" : "não"}`}</span>
      <span>{`adendos: ${p.consultation.addenda.map((a) => a.id).join(",")}`}</span>
      <button type="button" onClick={() => p.onAddendumAdded({ id: "ad9", author_name: "Enf. Lúcia Prado",
        created_at: "2026-10-07T11:00:00-03:00", reason: "correção do plano", text: "Retorno.", changes: null })}>adendo (dublê)</button>
    </div>
  ),
  ConsultationLoader: (p: { id: string }) => <span>{`consulta anterior ${p.id}`}</span>
}));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ConsultationWorkspace } from "./ConsultationWorkspace";
import { renderWithProviders, sessionWith } from "../../test/campaignFixtures";
import { consultation, finalized, options, record } from "../../test/consultationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function renderIt() {
  const onFinalized = vi.fn();
  renderWithProviders(<ConsultationWorkspace attendanceId="a1" unit={unit} units={[ unit ]} onClose={vi.fn()} onFinalized={onFinalized} />);
  return { onFinalized };
}

describe("ConsultationWorkspace", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.getAttendanceRecord, api.getConsultationOptions, api.startConsultation, api.getConsultation ]) {
      mocked(fn).mockReset();
    }
    mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record" ] }));
    mocked(api.getAttendanceRecord).mockResolvedValue(record());
    mocked(api.getConsultationOptions).mockResolvedValue(options());
    mocked(api.startConsultation).mockResolvedValue(consultation());
  });

  it("mostra o paciente e inicia a consulta", async () => {
    renderIt();
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    expect(api.getAttendanceRecord).toHaveBeenCalledWith("a1");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar consulta" }));
    expect(await screen.findByText("editor cs1")).not.toBeNull();
    expect(api.startConsultation).toHaveBeenCalledWith("a1");
  });

  it("já iniciada: retoma o rascunho em vez de mostrar erro", async () => {
    mocked(api.startConsultation).mockRejectedValue(new ApiError(409, { error: "already_exists", consultation_id: "cs1" }, "409"));
    mocked(api.getConsultation).mockResolvedValue(consultation({ subjective: "Refere sede." }));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    expect(await screen.findByText("editor cs1")).not.toBeNull();
    expect(api.getConsultation).toHaveBeenCalledWith("cs1");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("cadastro não validado: diz a frase e não oferece iniciar", async () => {
    mocked(api.getAttendanceRecord).mockRejectedValue(new ApiError(409, { error: "citizen_not_verified" }, "409"));
    renderIt();
    expect((await screen.findByRole("alert")).textContent).toBe(
      "o cadastro desta pessoa não foi validado no balcão — a consulta exige a validação presencial; encerre o atendimento só com o desfecho");
    expect(screen.queryByRole("button", { name: "Iniciar consulta" })).toBeNull();
  });

  it("finalizada: leitura com adendo da autora, e avisa a fila", async () => {
    const { onFinalized } = renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    fireEvent.click(await screen.findByRole("button", { name: "finalizar (dublê)" }));
    expect(await screen.findByText("consulta finalizada cs1 · adendo sim")).not.toBeNull();
    expect(onFinalized).toHaveBeenCalled();
  });

  it("adendo registrado entra na consulta sem relê-la (o api recusa a releitura depois do atendimento)", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    fireEvent.click(await screen.findByRole("button", { name: "finalizar (dublê)" }));
    fireEvent.click(await screen.findByRole("button", { name: "adendo (dublê)" }));
    expect(await screen.findByText("adendos: ad9")).not.toBeNull();
    expect(api.getConsultation).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("travou (outra aba finalizou): relê a consulta e avisa", async () => {
    mocked(api.getConsultation).mockResolvedValue(finalized());
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar consulta" }));
    fireEvent.click(await screen.findByRole("button", { name: "travar (dublê)" }));
    expect(await screen.findByText("consulta finalizada cs1 · adendo sim")).not.toBeNull();
    expect(screen.getByRole("status").textContent).toBe("esta consulta já foi finalizada — a tela foi atualizada");
  });

  it("abre uma consulta anterior pelo painel do paciente", async () => {
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Abrir consulta de 10/09/2026, 14:30" }));
    expect(screen.getByText("consulta anterior cs0")).not.toBeNull();
  });
});
