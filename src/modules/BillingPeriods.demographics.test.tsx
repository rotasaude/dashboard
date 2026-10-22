import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listBillingPeriods: vi.fn(), getPeriodPending: vi.fn(), updatePatientDemographics: vi.fn() };
});

import * as api from "../lib/api";
import { BillingPeriods } from "./BillingPeriods";
import { renderWithProviders } from "../test/campaignFixtures";
import { TODAY22, billingUser, pending, period } from "../test/billingFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ROSA = pending({
  procedure_id: "pp8", fix: "patient", reasons: [ "missing_race_color", "missing_address" ], patient: { id: "pa3", display_name: "Rosa Lima" }
});
const NO_ID = pending({ procedure_id: "pp9", fix: "patient", reasons: [ "missing_patient_id" ], patient: { id: "pa4", display_name: "Caio Souza" } });
afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.listBillingPeriods, api.getPeriodPending, api.updatePatientDemographics ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "billing_clerk" ]));
  mocked(api.listBillingPeriods).mockResolvedValue([ period() ]);
  mocked(api.getPeriodPending).mockResolvedValue([ ROSA, NO_ID ]);
  mocked(api.updatePatientDemographics).mockResolvedValue(undefined);
});

async function openPending() {
  renderWithProviders(<BillingPeriods today={TODAY22} />);
  fireEvent.click(await screen.findByRole("button", { name: "Pendências" }));
  const box = await screen.findByRole("region", { name: "Pendências de 09/2026 · UPA Boa Vista" });
  await within(box).findByText("Cadastro do paciente · 2");
  return box;
}

describe("Pendência do faturista — dados do paciente (módulo 22, D-U1)", () => {
  it("raça/cor e endereço: completa pelo faturamento e a lista de pendências é relida", async () => {
    const box = await openPending();
    expect(within(box).getAllByRole("button", { name: "Completar dados" })).toHaveLength(1);
    fireEvent.click(within(box).getByRole("button", { name: "Completar dados" }));
    const form = within(box).getByRole("region", { name: "Completar dados de Rosa Lima" });
    expect(within(form).getByRole("note").textContent).toMatch(/^Falta: raça\/cor; CEP e endereço\./);
    fireEvent.change(within(form).getByLabelText("Raça/cor"), { target: { value: "05" } });
    fireEvent.change(within(form).getByLabelText("CEP"), { target: { value: "80010-000" } });
    fireEvent.change(within(form).getByLabelText("Logradouro"), { target: { value: "RUA XV DE NOVEMBRO" } });
    fireEvent.change(within(form).getByLabelText("Número"), { target: { value: "100" } });
    fireEvent.change(within(form).getByLabelText("Bairro"), { target: { value: "CENTRO" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    expect(within(form).getByRole("alert").textContent).toBe("para indígena, informe a etnia: código de 4 dígitos da tabela do DATASUS");
    fireEvent.change(within(form).getByLabelText("Etnia (código)"), { target: { value: "0001" } });
    mocked(api.getPeriodPending).mockResolvedValue([ NO_ID ]);
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    await waitFor(() => expect(api.updatePatientDemographics).toHaveBeenCalledWith("pa3", {
      race_color: "05", ethnicity: "0001", address_zip: "80010000", address_street: "RUA XV DE NOVEMBRO", address_number: "100",
      address_district: "CENTRO"
    }));
    expect((await within(box).findByRole("status")).textContent).toBe("Dados de Rosa Lima salvos; as pendências foram conferidas de novo.");
    await waitFor(() => expect(api.getPeriodPending).toHaveBeenCalledTimes(2));
    expect(await within(box).findByText("Cadastro do paciente · 1")).not.toBeNull();
    expect(within(box).queryByText("Rosa Lima")).toBeNull();
  });

  it("422 invalid_zip vira frase e nada é relido; o admin não corrige", async () => {
    mocked(api.updatePatientDemographics).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_zip" }, "x"));
    const box = await openPending();
    fireEvent.click(within(box).getByRole("button", { name: "Completar dados" }));
    const form = within(box).getByRole("region", { name: "Completar dados de Rosa Lima" });
    fireEvent.change(within(form).getByLabelText("Raça/cor"), { target: { value: "03" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("CEP inválido — confira os 8 dígitos");
    expect(api.getPeriodPending).toHaveBeenCalledTimes(1);
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(billingUser([ "municipal_admin" ]));
    const adminBox = await openPending();
    expect(within(adminBox).queryByRole("button", { name: "Completar dados" })).toBeNull();
  });
});
