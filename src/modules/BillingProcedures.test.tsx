// src/modules/BillingProcedures.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listBillingEstablishments: vi.fn(), listProcedures: vi.fn(), cancelProcedure: vi.fn(),
    lookupBillingPatient: vi.fn() };
});

import * as api from "../lib/api";
import { BillingProcedures } from "./BillingProcedures";
import { BILLING_DISABLED, BILLING_NO_ROLE } from "../lib/billing";
import { renderWithProviders } from "../test/campaignFixtures";
import { GLUCOSE, LAB_EST, PATIENT, TODAY22, UPA_EST, billingUser, procedure } from "../test/billingFixtures";
import { VALID_CPF } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listBillingEstablishments, api.listProcedures, api.cancelProcedure, api.lookupBillingPatient ];
const LAB_ROW = procedure({
  id: "pp4", source: "lab_report", source_ref: { type: "lab_report_item", id: "it7" }, establishment: LAB_EST, billable: false, blocking_reasons: [ "missing_professional_cns" ],
  professional: { user_id: "us5", name: "Bia Farmacêutica", cbo_code: "221205" }, sigtap_code: GLUCOSE.code, label: GLUCOSE.name, instrument: "bpa_c"
});
afterEach(cleanup);
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "billing_clerk" ]));
  mocked(api.listBillingEstablishments).mockResolvedValue([ UPA_EST, LAB_EST ]);
  mocked(api.listProcedures).mockResolvedValue({ procedures: [ procedure(), LAB_ROW ], next_before: "c1" });
  mocked(api.lookupBillingPatient).mockResolvedValue(PATIENT);
});

describe("BillingProcedures", () => {
  it("abre na competência corrente; filtra por estabelecimento, crítica e motivo; só códigos na consulta", async () => {
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    expect(await screen.findByText("0202010473 — DOSAGEM DE GLICOSE")).not.toBeNull();
    expect(api.listProcedures).toHaveBeenLastCalledWith({ competence: "202610", before: null });
    expect(screen.getByText("laboratório municipal")).not.toBeNull();
    // Na opção do filtro e na linha do procedimento.
    await waitFor(() => expect(screen.getAllByText("Laboratório Municipal · CNES 7654321")).toHaveLength(2));
    expect(screen.getByText("Bia Farmacêutica · CBO 221205")).not.toBeNull();
    expect(screen.getByText("não faturável — profissional sem CNS no cadastro")).not.toBeNull();
    expect(screen.queryByLabelText("Motivo")).toBeNull();
    fireEvent.change(await screen.findByLabelText("Estabelecimento"), { target: { value: "lab_provider:pv9" } });
    fireEvent.change(screen.getByLabelText("Competência"), { target: { value: "202609" } });
    fireEvent.change(screen.getByLabelText("Crítica"), { target: { value: "false" } });
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "missing_professional_cns" } });
    expect(api.listProcedures).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(api.listProcedures).toHaveBeenLastCalledWith({
      establishmentType: "lab_provider", establishmentId: "pv9", competence: "202609", billable: false, reason: "missing_professional_cns", before: null
    }));
    fireEvent.click(screen.getByRole("button", { name: "Limpar filtros" }));
    await waitFor(() => expect(api.listProcedures).toHaveBeenLastCalledWith({ competence: "202610", before: null }));
  });

  it("Carregar mais usa o cursor e junta as páginas", async () => {
    mocked(api.listProcedures)
      .mockResolvedValueOnce({ procedures: [ procedure() ], next_before: "c1" })
      .mockResolvedValueOnce({ procedures: [ LAB_ROW ], next_before: null });
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("0202010473 — DOSAGEM DE GLICOSE")).not.toBeNull();
    expect(api.listProcedures).toHaveBeenLastCalledWith({ competence: "202610", before: "c1" });
    expect(screen.getByText("0301060061 — ATENDIMENTO DE URGENCIA EM ATENCAO ESPECIALIZADA")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Carregar mais" })).toBeNull();
  });

  it("filtro por paciente: CPF no corpo da busca; na lista, só o id", async () => {
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    await screen.findByText("0202010473 — DOSAGEM DE GLICOSE");
    const filters = screen.getByRole("group", { name: "filtros dos procedimentos" });
    fireEvent.change(within(filters).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
    fireEvent.click(within(filters).getByRole("button", { name: "Buscar paciente" }));
    await within(filters).findByText("Paciente: Joana Lima · CPF ***.982.247-**");
    fireEvent.click(screen.getByRole("button", { name: "Filtrar" }));
    await waitFor(() => expect(api.listProcedures).toHaveBeenLastCalledWith({ competence: "202610", patientId: "pa1", before: null }));
    expect(api.lookupBillingPatient).toHaveBeenCalledWith(VALID_CPF);
  });

  it("faturista cancela qualquer procedimento; o admin só lê", async () => {
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    await screen.findByText("0202010473 — DOSAGEM DE GLICOSE");
    expect(screen.getAllByRole("button", { name: "Cancelar procedimento" })).toHaveLength(2);
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "municipal_admin" ]));
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    await screen.findByText("0202010473 — DOSAGEM DE GLICOSE");
    expect(screen.queryByRole("button", { name: "Cancelar procedimento" })).toBeNull();
  });

  it("sem o interruptor ou sem papel: estado vazio e nenhuma leitura", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "billing_clerk" ], { features: [] }));
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    expect(await screen.findByText(BILLING_DISABLED)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "health_professional" ]));
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    expect(await screen.findByText(BILLING_NO_ROLE)).not.toBeNull();
    expect(api.listProcedures).not.toHaveBeenCalled();
    expect(api.listBillingEstablishments).not.toHaveBeenCalled();
  });

  it("lista vazia e recusa da lista", async () => {
    mocked(api.listProcedures).mockResolvedValueOnce({ procedures: [], next_before: null });
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    expect(await screen.findByText("nenhum procedimento registrado")).not.toBeNull();
    cleanup();
    mocked(api.listProcedures).mockRejectedValueOnce(new api.ApiError(403, { error: "missing_role" }, "x"));
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    expect((await screen.findByRole("alert")).textContent).toBe("seu papel não permite esta ação no faturamento");
  });

  it("só o faturista vê o lançamento manual", async () => {
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    expect(await screen.findByRole("button", { name: "Lançamento manual" })).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "municipal_admin" ]));
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    await screen.findByText("0202010473 — DOSAGEM DE GLICOSE");
    expect(screen.queryByRole("button", { name: "Lançamento manual" })).toBeNull();
  });

  it("E19: uma ação relê só a 1ª página (uma trilha); foco e rede não releem", async () => {
    mocked(api.listProcedures)
      .mockResolvedValueOnce({ procedures: [ procedure() ], next_before: "c1" })
      .mockResolvedValueOnce({ procedures: [ LAB_ROW ], next_before: null })
      .mockResolvedValue({ procedures: [ procedure(), LAB_ROW ], next_before: "c2" });
    mocked(api.cancelProcedure).mockResolvedValue({ ...procedure(), status: "cancelled" });
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    await screen.findByText("0202010473 — DOSAGEM DE GLICOSE");
    expect(api.listProcedures).toHaveBeenCalledTimes(2);
    act(() => { focusManager.setFocused(false); focusManager.setFocused(true); });
    act(() => { onlineManager.setOnline(false); onlineManager.setOnline(true); });
    await new Promise((r) => setTimeout(r, 20));
    expect(api.listProcedures).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getAllByRole("button", { name: "Cancelar procedimento" })[0]);
    fireEvent.change(screen.getByLabelText("Motivo do cancelamento"), { target: { value: "registrado em duplicidade" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" }));
    await screen.findByText(/cancelado\./);
    await waitFor(() => expect(api.listProcedures).toHaveBeenCalledTimes(3));
    await new Promise((r) => setTimeout(r, 20));
    expect(api.listProcedures).toHaveBeenCalledTimes(3);
    expect(api.listProcedures).toHaveBeenLastCalledWith({ competence: "202610", before: null });
    act(() => { focusManager.setFocused(undefined); });
  });

  it("invalid_cursor no Carregar mais: avisa e recomeça da 1ª página", async () => {
    mocked(api.listProcedures)
      .mockResolvedValueOnce({ procedures: [ procedure() ], next_before: "c1" })
      .mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_cursor" }, "x"))
      .mockResolvedValue({ procedures: [ procedure() ], next_before: null });
    renderWithProviders(<BillingProcedures today={TODAY22} />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("a lista mudou enquanto você rolava — a tela foi atualizada")).not.toBeNull();
    await waitFor(() => expect(api.listProcedures).toHaveBeenCalledTimes(3));
    expect(api.listProcedures).toHaveBeenLastCalledWith({ competence: "202610", before: null });
  });
});
