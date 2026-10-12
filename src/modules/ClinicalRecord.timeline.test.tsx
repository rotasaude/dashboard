import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), openClinicalRecord: vi.fn(), getJustifiedRecord: vi.fn(),
    getConsultationOptions: vi.fn(), listOpenings: vi.fn(), getTimeline: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ClinicalRecord } from "./ClinicalRecord";
import { OPENING_ENDED } from "../lib/clinicalRecord";
import { TIMELINE_KEY } from "../lib/timeline";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { NOW19, opening, options, record } from "../test/consultationFixtures";
import { APPOINTMENT, page } from "../test/timelineFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const expiresAt = () => new Date(Date.parse(NOW19) + 30 * 60_000).toISOString();

async function openFor(cpf = "52998224725") {
  fireEvent.change(await screen.findByLabelText("CPF do paciente"), { target: { value: cpf } });
  fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "continuity_of_care" } });
  fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
}

describe("Prontuário — linha do tempo pela abertura justificada (módulo 20)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date", "setInterval", "clearInterval" ] });
    vi.setSystemTime(new Date(NOW19));
    for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.openClinicalRecord, api.getJustifiedRecord,
      api.getConsultationOptions, api.listOpenings, api.getTimeline ]) m(fn).mockReset();
    m(api.getConsultationOptions).mockResolvedValue(options());
    m(api.listOpenings).mockResolvedValue([]);
    m(api.getJustifiedRecord).mockResolvedValue(record({ access: "justified" }));
    m(api.getTimeline).mockResolvedValue(page({ person: { display_name: "Joana Lima", partial: true, patient_id: null } }));
  });

  it("modo integrado: a abertura justificada abre só a linha do tempo", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline" ] }));
    m(api.openClinicalRecord).mockResolvedValue(opening({ patient_id: null, expires_at: expiresAt() }));
    renderWithProviders(<ClinicalRecord />);
    await openFor();
    fireEvent.click(screen.getByRole("button", { name: "Abrir linha do tempo" }));
    expect(await screen.findByText("Linha do tempo de Joana Lima")).not.toBeNull();
    expect(api.getTimeline).toHaveBeenCalledWith({ openingId: "op1" }, { kinds: [], from: "", to: "" }, null);
    expect(api.getJustifiedRecord).not.toHaveBeenCalled();
    expect(screen.getByText("Abertura justificada · expira em 30:00")).not.toBeNull();
    expect(screen.getByRole("note", { name: "histórico parcial" })).not.toBeNull();
  });

  it("a abertura acaba: a linha do tempo sai da tela e do cache", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline" ] }));
    m(api.openClinicalRecord).mockResolvedValue(opening({ patient_id: null, expires_at: expiresAt() }));
    const { client } = renderWithProviders(<ClinicalRecord />);
    await openFor();
    fireEvent.click(screen.getByRole("button", { name: "Abrir linha do tempo" }));
    expect(await screen.findByText(APPOINTMENT.title)).not.toBeNull();
    act(() => { vi.advanceTimersByTime(30 * 60_000 + 1000); });
    expect(screen.getByText(OPENING_ENDED)).not.toBeNull();
    expect(screen.queryByText(APPOINTMENT.title)).toBeNull();
    expect(client.getQueryCache().findAll({ queryKey: [ TIMELINE_KEY ] })).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Nova abertura" }));
    expect(screen.getByLabelText("CPF do paciente")).not.toBeNull();
  });

  it("403 opening_required na linha do tempo encerra a abertura", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline" ] }));
    m(api.openClinicalRecord).mockResolvedValue(opening({ patient_id: null, expires_at: expiresAt() }));
    m(api.getTimeline).mockRejectedValue(new ApiError(403, { error: "opening_required" }, "403"));
    renderWithProviders(<ClinicalRecord />);
    await openFor();
    fireEvent.click(screen.getByRole("button", { name: "Abrir linha do tempo" }));
    expect(await screen.findByText(OPENING_ENDED)).not.toBeNull();
  });

  it("CPF sem par validado (patient_not_found no modo integrado): a frase da linha do tempo, sem abrir", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { id: "us1", features: [ "patient_timeline" ] }));
    m(api.openClinicalRecord).mockRejectedValue(new ApiError(404, { error: "patient_not_found" }, "404"));
    renderWithProviders(<ClinicalRecord />);
    await openFor();
    fireEvent.click(screen.getByRole("button", { name: "Abrir linha do tempo" }));
    expect(await screen.findByText(
      "nenhum cadastro validado com este CPF — a linha do tempo só existe para quem validou o cadastro na unidade")).not.toBeNull();
    expect(api.getTimeline).not.toHaveBeenCalled();
  });

  it("modo record: o prontuário justificado ganha a aba, lida pela abertura", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], {
      id: "us1", features: [ "clinical_record", "patient_timeline" ]
    }));
    m(api.openClinicalRecord).mockResolvedValue(opening({ expires_at: expiresAt() }));
    renderWithProviders(<ClinicalRecord />);
    await openFor();
    fireEvent.click(screen.getByRole("button", { name: "Abrir prontuário" }));
    fireEvent.click(await screen.findByRole("tab", { name: "Linha do tempo" }));
    await waitFor(() => expect(api.getTimeline).toHaveBeenCalledWith({ openingId: "op1" }, { kinds: [], from: "", to: "" }, null));
    expect(api.getJustifiedRecord).toHaveBeenCalledWith("pa1");
  });

  it("sem nenhum dos dois interruptores, ou admin só com a linha do tempo: nada abre", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ]));
    renderWithProviders(<ClinicalRecord />);
    expect(await screen.findByText("o prontuário está desligado nesta cidade")).not.toBeNull();
    cleanup();
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ], { features: [ "patient_timeline" ] }));
    renderWithProviders(<ClinicalRecord />);
    expect(await screen.findByText("seu papel não permite abrir o prontuário")).not.toBeNull();
    expect(api.listOpenings).not.toHaveBeenCalled();
  });
});
