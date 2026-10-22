// src/modules/billing/ProceduresPanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listProcedures: vi.fn(), recordProcedure: vi.fn(), cancelProcedure: vi.fn(), searchBillingSigtap: vi.fn() };
});

import * as api from "../../lib/api";
import { ProceduresPanel } from "./ProceduresPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { SUTURE, TODAY22, UPA, billingUser, procedure } from "../../test/billingFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listProcedures, api.recordProcedure, api.cancelProcedure, api.searchBillingSigtap ];
afterEach(cleanup);
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "health_professional" ], { id: "us1" }));
  mocked(api.listProcedures).mockResolvedValue({ procedures: [ procedure() ], next_before: null });
  mocked(api.searchBillingSigtap).mockResolvedValue([ SUTURE ]);
  mocked(api.recordProcedure).mockResolvedValue(procedure({
    id: "pp2", sigtap_code: SUTURE.code, label: SUTURE.name, billable: false, blocking_reasons: [ "cid_required" ]
  }));
});

async function register(panel: HTMLElement) {
  fireEvent.click(within(panel).getByRole("button", { name: "Registrar procedimento" }));
  const form = within(panel).getByRole("region", { name: "Registrar procedimento" });
  fireEvent.change(within(form).getByLabelText("Procedimento (SIGTAP)"), { target: { value: "sutura" } });
  fireEvent.click(await within(form).findByRole("button", { name: /^0401010066 — / }));
  fireEvent.click(within(form).getByRole("button", { name: "Registrar procedimento" }));
}

describe("ProceduresPanel", () => {
  it("lista do atendimento e registro com o id da consulta; 201 não faturável diz o motivo e relê", async () => {
    renderWithProviders(<ProceduresPanel unit={UPA} attendanceId="a1" consultationId="cs1" patientId="pa1" today={TODAY22} searchDelayMs={0} />);
    const panel = screen.getByRole("region", { name: "Procedimentos realizados" });
    expect(await within(panel).findByText("faturável · BPA-I")).not.toBeNull();
    expect(api.listProcedures).toHaveBeenCalledWith({ attendanceId: "a1" });
    await register(panel);
    await waitFor(() => expect(api.recordProcedure).toHaveBeenCalledWith({
      establishment: { type: "health_unit", id: "u7" }, performed_on: TODAY22, sigtap_code: "0401010066", quantity: 1,
      character: "elective", patient_id: "pa1", attendance_id: "a1", consultation_id: "cs1"
    }));
    expect((await within(panel).findByRole("status")).textContent).toBe(
      "Procedimento registrado — não faturável — o procedimento exige CID-10. O registro vale; o faturamento confere de novo no fechamento."
    );
    await waitFor(() => expect(api.listProcedures).toHaveBeenCalledTimes(2));
    expect(within(panel).queryByRole("region", { name: "Registrar procedimento" })).toBeNull();
  });

  it("modo integrado (sem consulta nem paciente): vai só o atendimento", async () => {
    renderWithProviders(<ProceduresPanel unit={UPA} attendanceId="a3" today={TODAY22} searchDelayMs={0} />);
    const panel = screen.getByRole("region", { name: "Procedimentos realizados" });
    await within(panel).findByText("faturável · BPA-I");
    await register(panel);
    await waitFor(() => expect(api.recordProcedure).toHaveBeenCalledWith({
      establishment: { type: "health_unit", id: "u7" }, performed_on: TODAY22, sigtap_code: "0401010066", quantity: 1,
      character: "elective", attendance_id: "a3"
    }));
  });

  it("cancelar: só o próprio, com motivo; 409 already_exported relê e diz por quê", async () => {
    mocked(api.listProcedures).mockResolvedValue({ procedures: [
      procedure({ id: "pp1" }),
      procedure({ id: "pp3", professional: { user_id: "us9", name: "Dr. Caio Mendes", cbo_code: "225125" } })
    ], next_before: null });
    renderWithProviders(<ProceduresPanel unit={UPA} attendanceId="a1" today={TODAY22} />);
    const panel = screen.getByRole("region", { name: "Procedimentos realizados" });
    await waitFor(() => expect(within(panel).getAllByRole("button", { name: "Cancelar procedimento" })).toHaveLength(1));
    fireEvent.click(within(panel).getByRole("button", { name: "Cancelar procedimento" }));
    const form = within(panel).getByRole("region", { name: "Cancelar 0301060061" });
    fireEvent.change(within(form).getByLabelText("Motivo do cancelamento"), { target: { value: "errado" } });
    fireEvent.click(within(form).getByRole("button", { name: "Confirmar cancelamento" }));
    expect(within(form).getByRole("alert").textContent).toBe("motivo com pelo menos 10 caracteres");
    expect(api.cancelProcedure).not.toHaveBeenCalled();
    mocked(api.cancelProcedure).mockRejectedValueOnce(new api.ApiError(409, { error: "already_exported" }, "x"));
    fireEvent.change(within(form).getByLabelText("Motivo do cancelamento"), { target: { value: "lançado no paciente errado" } });
    // o ActionButton fica ocupado até a microtarefa do primeiro clique terminar
    fireEvent.click(await within(form).findByRole("button", { name: "Confirmar cancelamento" }));
    expect((await within(form).findByRole("alert")).textContent).toBe(
      "este procedimento já está no arquivo de uma competência fechada — para cancelar, o faturista reabre a competência"
    );
    expect(api.cancelProcedure).toHaveBeenCalledWith("pp1", "lançado no paciente errado");
    await waitFor(() => expect(api.listProcedures).toHaveBeenCalledTimes(2));
  });

  it("cancelado com sucesso: frase e lista relida; cancelado não oferece cancelar de novo", async () => {
    mocked(api.cancelProcedure).mockResolvedValue(procedure({ status: "cancelled" }));
    renderWithProviders(<ProceduresPanel unit={UPA} attendanceId="a1" today={TODAY22} />);
    const panel = screen.getByRole("region", { name: "Procedimentos realizados" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Cancelar procedimento" }));
    fireEvent.change(within(panel).getByLabelText("Motivo do cancelamento"), { target: { value: "lançado no paciente errado" } });
    mocked(api.listProcedures).mockResolvedValue({ procedures: [ procedure({ status: "cancelled", cancel_reason: "lançado no paciente errado" }) ], next_before: null });
    fireEvent.click(within(panel).getByRole("button", { name: "Confirmar cancelamento" }));
    expect((await within(panel).findByRole("status")).textContent).toBe("Procedimento 0301060061 cancelado.");
    expect(await within(panel).findByText("cancelado")).not.toBeNull();
    expect(within(panel).queryByRole("button", { name: "Cancelar procedimento" })).toBeNull();
  });

  it("interruptor desligado no meio: a frase do faturamento desligado", async () => {
    mocked(api.listProcedures).mockRejectedValue(new api.ApiError(403, { error: "feature_disabled", feature: "procedure_billing" }, "x"));
    renderWithProviders(<ProceduresPanel unit={UPA} attendanceId="a1" today={TODAY22} />);
    expect((await screen.findByRole("alert")).textContent).toBe("o faturamento de procedimentos está desligado nesta cidade");
  });
});
