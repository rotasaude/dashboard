import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listProfessionals: vi.fn(), listProfessionalConsultations: vi.fn(),
    getAdministrativeConsultation: vi.fn(), getConsultation: vi.fn(), getConsultationOptions: vi.fn(),
    getJustifiedRecord: vi.fn(), getAttendanceRecord: vi.fn(), listMyConsultations: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { ProfessionalConsultations } from "./ProfessionalConsultations";
import { renderWithProviders, sessionWith } from "../test/campaignFixtures";
import { consultationListItem, finalized, options } from "../test/consultationFixtures";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const admin = () => sessionWith([ "municipal_admin" ], { id: "ad1", features: [ "clinical_record" ] });
const pros = [ { id: "p1", user_id: "us1", professional_name: "Dra. Helena Prado", email_address: "h@x.br", links: [] } ];

async function search() {
  renderWithProviders(<ProfessionalConsultations />);
  await screen.findByRole("option", { name: "Dra. Helena Prado" });
  fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "us1" } });
  fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Até"), { target: { value: "2026-10-07" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Buscar consultas" }));
}

describe("Consultas por profissional", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listProfessionals, api.listProfessionalConsultations,
      api.getAdministrativeConsultation, api.getConsultation, api.getConsultationOptions, api.getJustifiedRecord,
      api.getAttendanceRecord, api.listMyConsultations ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue(admin());
    m(api.listProfessionals).mockResolvedValue(pros);
    m(api.listProfessionalConsultations).mockResolvedValue({
      professional: { id: "us1", name: "Dra. Helena Prado" }, consultations: [ consultationListItem() ] });
    m(api.getAdministrativeConsultation).mockResolvedValue(finalized());
    m(api.getConsultationOptions).mockResolvedValue(options());
  });

  it("papel errado: não lista profissionais", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { features: [ "clinical_record" ] }));
    renderWithProviders(<ProfessionalConsultations />);
    expect(await screen.findByText("seu papel não permite ver consultas")).not.toBeNull();
    expect(api.listProfessionals).not.toHaveBeenCalled();
  });

  it("busca com step-up chama a rota com user_id e datas e mostra a lista", async () => {
    await search();
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
    expect(m(api.listProfessionalConsultations).mock.calls[0]).toEqual([ "us1", { from: "2026-10-01", to: "2026-10-07" } ]);
    expect(screen.getByText(/Dra\. Helena Prado/, { selector: "h3, strong, span, p, div" })).not.toBeNull();
  });

  it("abrir mostra o conteúdo sem Imprimir nem Adendo, com aviso; fechar volta", async () => {
    await search();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getByRole("button", { name: /Abrir consulta de/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir consulta" }));
    expect(await screen.findByRole("button", { name: "Fechar consulta" })).not.toBeNull();
    expect(api.getAdministrativeConsultation).toHaveBeenCalledWith("c1");
    expect(screen.queryByRole("button", { name: /Imprimir/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Adendo/ })).toBeNull();
    expect(screen.getByText(/relatório de aberturas/)).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar consulta" }));
    expect(await screen.findByText("Joana Lima")).not.toBeNull();
  });

  it("404 not_found vira frase", async () => {
    m(api.listProfessionalConsultations).mockRejectedValue(new ApiError(404, { error: "not_found" }, "404"));
    await search();
    expect(await screen.findByText("profissional não encontrado nesta cidade")).not.toBeNull();
  });

  it("422 invalid_period vira frase", async () => {
    m(api.listProfessionalConsultations).mockRejectedValue(new ApiError(422, { error: "invalid_period" }, "422"));
    await search();
    expect(await screen.findByText("o período informado não é válido")).not.toBeNull();
  });

  it("admin puro: não lê opções do atendimento e o tipo vem do item da lista", async () => {
    await search();
    await screen.findByText("Joana Lima");
    fireEvent.click(screen.getByRole("button", { name: /Abrir consulta de/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Abrir consulta" }));
    await screen.findByRole("button", { name: "Fechar consulta" });
    expect(screen.getAllByText(/Consulta no dia/).length).toBeGreaterThan(0);
    expect(api.getConsultationOptions).not.toHaveBeenCalled();
  });

  it("admin que também é profissional: usa as opções do atendimento", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(
      sessionWith([ "municipal_admin", "health_professional" ], { id: "ad1", features: [ "clinical_record" ] }));
    renderWithProviders(<ProfessionalConsultations />);
    await screen.findByRole("option", { name: "Dra. Helena Prado" });
    await waitFor(() => expect(api.getConsultationOptions).toHaveBeenCalled());
  });

  it("mudar profissional ou período limpa a lista antiga; nova busca também", async () => {
    await search();
    await screen.findByText("Joana Lima");
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-09-01" } });
    expect(screen.queryByText("Joana Lima")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.queryByText("Joana Lima")).toBeNull();
  });

  it("sem autenticador, o atalho para Segurança chega ao SensitiveAction", async () => {
    m(api.fetchCurrentSession).mockResolvedValue(
      sessionWith([ "municipal_admin" ], { id: "ad1", features: [ "clinical_record" ], mfa_enrolled: false }));
    const go = vi.fn();
    renderWithProviders(<ProfessionalConsultations onGoToSecurity={go} />);
    await screen.findByRole("option", { name: "Dra. Helena Prado" });
    fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "us1" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    fireEvent.click(await screen.findByRole("button", { name: "cadastre seu autenticador" }));
    expect(go).toHaveBeenCalled();
  });

  it("nunca chama as rotas do atendimento nem do prontuário", async () => {
    await search();
    await screen.findByText("Joana Lima");
    await waitFor(() => expect(api.listProfessionalConsultations).toHaveBeenCalled());
    for (const fn of [ api.getConsultation, api.getJustifiedRecord, api.getAttendanceRecord, api.listMyConsultations, api.getConsultationOptions ]) {
      expect(fn).not.toHaveBeenCalled();
    }
  });
});
