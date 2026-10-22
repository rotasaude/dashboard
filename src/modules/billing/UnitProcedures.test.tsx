import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), lookupBillingPatient: vi.fn(), listProcedures: vi.fn(), recordProcedure: vi.fn(), searchBillingSigtap: vi.fn() };
});

import * as api from "../../lib/api";
import { UnitProcedures } from "./UnitProcedures";
import { renderWithProviders } from "../../test/campaignFixtures";
import { PATIENT, TODAY22, UPA, URGENCY, billingUser, procedure } from "../../test/billingFixtures";
import { VALID_CPF } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.lookupBillingPatient, api.listProcedures, api.recordProcedure, api.searchBillingSigtap ];
afterEach(cleanup);
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "health_professional" ], { id: "us1" }));
  mocked(api.lookupBillingPatient).mockResolvedValue(PATIENT);
  mocked(api.listProcedures).mockResolvedValue({ procedures: [ procedure({ source: "manual", source_ref: null }) ], next_before: null });
  mocked(api.searchBillingSigtap).mockResolvedValue([ URGENCY ]);
  mocked(api.recordProcedure).mockResolvedValue(procedure({ id: "pp9", performed_on: "2026-10-20" }));
});

async function findPatient() {
  const panel = await screen.findByRole("region", { name: "Procedimento avulso" });
  fireEvent.change(within(panel).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
  fireEvent.click(within(panel).getByRole("button", { name: "Buscar paciente" }));
  await within(panel).findByText("Paciente: Joana Lima · CPF ***.982.247-**");
  return panel;
}

describe("UnitProcedures", () => {
  it("acha o paciente pelo CPF (no corpo), lista os próprios e registra com data editável e sem atendimento", async () => {
    renderWithProviders(<UnitProcedures unit={UPA} today={TODAY22} searchDelayMs={0} />);
    expect(api.listProcedures).not.toHaveBeenCalled();
    const panel = await findPatient();
    expect(api.lookupBillingPatient).toHaveBeenCalledWith(VALID_CPF);
    await waitFor(() => expect(api.listProcedures).toHaveBeenCalledWith({ patientId: "pa1" }));
    expect(await within(panel).findByText("faturável · BPA-I")).not.toBeNull();
    fireEvent.click(within(panel).getByRole("button", { name: "Registrar procedimento" }));
    const form = within(panel).getByRole("region", { name: "Registrar procedimento" });
    fireEvent.change(within(form).getByLabelText("Data do procedimento"), { target: { value: "2026-10-20" } });
    fireEvent.change(within(form).getByLabelText("Procedimento (SIGTAP)"), { target: { value: "urgencia" } });
    fireEvent.click(await within(form).findByRole("button", { name: /^0301060061 — / }));
    fireEvent.click(within(form).getByRole("button", { name: "Registrar procedimento" }));
    await waitFor(() => expect(api.recordProcedure).toHaveBeenCalledWith({
      establishment: { type: "health_unit", id: "u7" }, performed_on: "2026-10-20", sigtap_code: "0301060061", quantity: 1,
      character: "elective", patient_id: "pa1"
    }));
    expect((await within(panel).findByRole("status")).textContent).toBe("Procedimento registrado — faturável.");
    await waitFor(() => expect(api.listProcedures).toHaveBeenCalledTimes(2));
  });

  it("CPF inválido não busca; 404 patient_not_found vira frase; trocar paciente limpa a lista", async () => {
    renderWithProviders(<UnitProcedures unit={UPA} today={TODAY22} searchDelayMs={0} />);
    const panel = await screen.findByRole("region", { name: "Procedimento avulso" });
    fireEvent.change(within(panel).getByLabelText("CPF do paciente"), { target: { value: "111.111.111-11" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Buscar paciente" }));
    expect(within(panel).getByRole("alert").textContent).toBe("CPF inválido");
    expect(api.lookupBillingPatient).not.toHaveBeenCalled();
    mocked(api.lookupBillingPatient).mockRejectedValueOnce(new api.ApiError(404, { error: "patient_not_found" }, "x"));
    fireEvent.change(within(panel).getByLabelText("CPF do paciente"), { target: { value: VALID_CPF } });
    fireEvent.click(within(panel).getByRole("button", { name: "Buscar paciente" }));
    expect((await within(panel).findByRole("alert")).textContent).toBe("paciente não encontrado — confira o CPF");
    fireEvent.click(within(panel).getByRole("button", { name: "Buscar paciente" }));
    await within(panel).findByText("Paciente: Joana Lima · CPF ***.982.247-**");
    fireEvent.click(within(panel).getByRole("button", { name: "Trocar paciente" }));
    expect(within(panel).queryByText("faturável · BPA-I")).toBeNull();
    expect(within(panel).queryByRole("button", { name: "Registrar procedimento" })).toBeNull();
  });
});
