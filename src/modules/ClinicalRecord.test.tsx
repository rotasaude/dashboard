import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(), openClinicalRecord: vi.fn(), getJustifiedRecord: vi.fn(),
    getConsultationOptions: vi.fn(), listOpenings: vi.fn(), listMemberships: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ClinicalRecord } from "./ClinicalRecord";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { NOW19, opening, options, record } from "../test/consultationFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const pro = () => sessionWith([ "health_professional" ], { id: "us1", features: [ "clinical_record" ] });

describe("Prontuário fora do atendimento", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.openClinicalRecord, api.getJustifiedRecord,
      api.getConsultationOptions, api.listOpenings, api.listMemberships ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue(pro());
    m(api.openClinicalRecord).mockResolvedValue(opening({ expires_at: new Date(Date.parse(NOW19) + 30 * 60_000).toISOString() }));
    m(api.getJustifiedRecord).mockResolvedValue(record({ access: "justified" }));
    m(api.getConsultationOptions).mockResolvedValue(options());
    m(api.listOpenings).mockResolvedValue([]);
    m(api.listMemberships).mockResolvedValue([]);
  });

  it("interruptor desligado: diz e não oferece nada", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ]));
    renderWithProviders(<ClinicalRecord />);
    expect(await screen.findByText("o prontuário está desligado nesta cidade")).not.toBeNull();
    expect(screen.queryByLabelText("CPF do paciente")).toBeNull();
  });

  it("recepção não abre prontuário", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "citizen_verifier" ], { features: [ "clinical_record" ] }));
    renderWithProviders(<ClinicalRecord />);
    expect(await screen.findByText("seu papel não permite abrir o prontuário")).not.toBeNull();
    expect(api.getJustifiedRecord).not.toHaveBeenCalled();
  });

  it("CPF, motivo e step-up abrem a leitura marcada como abertura justificada", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW19));
    renderWithProviders(<ClinicalRecord />);
    fireEvent.change(await screen.findByLabelText("CPF do paciente"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "active_search" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    const confirm = screen.getByRole("region", { name: "Confirmar abertura justificada" });
    expect(confirm.textContent).toContain("CPF 529.982.247-25 · Busca ativa");
    fireEvent.click(screen.getByRole("button", { name: "Abrir prontuário" }));
    await waitFor(() => expect(api.openClinicalRecord).toHaveBeenCalledWith({ cpf: "529.982.247-25", reason_code: "active_search" }));
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    expect(api.getJustifiedRecord).toHaveBeenCalledWith("pa1");
    expect(screen.getByText("Abertura justificada · expira em 30:00")).not.toBeNull();
  });

  it("'Outro motivo' sem descrição não continua", async () => {
    renderWithProviders(<ClinicalRecord />);
    fireEvent.change(await screen.findByLabelText("CPF do paciente"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "other" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    expect(screen.getByRole("alert").textContent).toBe("em 'Outro motivo', descreva com pelo menos 10 caracteres");
    expect(screen.queryByRole("region", { name: "Confirmar abertura justificada" })).toBeNull();
  });

  it("CPF sem prontuário: a frase aparece na confirmação", async () => {
    m(api.openClinicalRecord).mockRejectedValue(new ApiError(404, { error: "patient_not_found" }, "404"));
    renderWithProviders(<ClinicalRecord />);
    fireEvent.change(await screen.findByLabelText("CPF do paciente"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "case_review" } });
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    fireEvent.click(screen.getByRole("button", { name: "Abrir prontuário" }));
    expect(await screen.findByText("nenhum prontuário para este CPF — o prontuário nasce na primeira consulta de um cadastro validado"))
      .not.toBeNull();
  });

  it("o municipal_admin vê o relatório, sem o formulário de abertura", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "municipal_admin" ], { features: [ "clinical_record" ] }));
    renderWithProviders(<ClinicalRecord />);
    expect(await screen.findByRole("region", { name: "Aberturas fora de contexto" })).not.toBeNull();
    expect(screen.queryByLabelText("CPF do paciente")).toBeNull();
  });

  it("o profissional não vê o relatório", async () => {
    renderWithProviders(<ClinicalRecord />);
    await screen.findByLabelText("CPF do paciente");
    expect(screen.queryByRole("region", { name: "Aberturas fora de contexto" })).toBeNull();
    expect(api.listOpenings).not.toHaveBeenCalled();
  });
});
