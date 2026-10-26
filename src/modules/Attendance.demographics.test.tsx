// src/modules/Attendance.demographics.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), lookupCitizen: vi.fn(), verifyCitizen: vi.fn(), listActiveUnits: vi.fn(),
    listUnassignedRequests: vi.fn(), getMyProfessional: vi.fn(), listPendingErasures: vi.fn()
  };
});

import * as api from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { Attendance } from "./Attendance";
import { ADDRESS_FROM_HOUSEHOLD } from "../lib/demographics";

afterEach(() => { cleanup(); localStorage.clear(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const found = {
  citizen: { id: "c1", cpf_masked: "***.982.247-**", phone_masked: "(**) *****-5432", created_at: "2026-09-20T10:00:00Z", verification_level: "declared" as const },
  triages: []
};
const PROFILE = { birth_date: "1990-05-10", sex: "female", gender_identity: null, full_name: "Rosa Lima" };

function session(features: string[]): api.SessionUser {
  return { id: "u1", email_address: "a@cidade.gov.br", operator: false, mfa_enrolled: true, mfa_verified_at: null, features,
    memberships: [ { city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role: "citizen_verifier" } ] };
}

function renderAttendance() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<Attendance onNavigate={vi.fn()} />, { wrapper });
}

async function fillValidation() {
  fireEvent.change(await screen.findByLabelText("CPF do cidadão (validação)"), { target: { value: "52998224725" } });
  fireEvent.change(screen.getByLabelText("Código de validação"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar validação" }));
  await screen.findByText("(**) *****-5432");
  fireEvent.click(screen.getByLabelText("Conferi o documento com foto e o CPF confere"));
  fireEvent.change(screen.getByLabelText("Data de nascimento (documento)"), { target: { value: "1990-05-10" } });
  fireEvent.change(screen.getByLabelText("Sexo (documento)"), { target: { value: "female" } });
  fireEvent.change(screen.getByLabelText("Nome completo (documento)"), { target: { value: "Rosa Lima" } });
}

describe("Attendance — dados do paciente na validação (módulo 22)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.lookupCitizen, api.verifyCitizen, api.listActiveUnits, api.listUnassignedRequests,
      api.getMyProfessional, api.listPendingErasures ]) mocked(fn).mockReset();
    mocked(api.lookupCitizen).mockResolvedValue(found);
    mocked(api.verifyCitizen).mockResolvedValue(undefined);
    mocked(api.listActiveUnits).mockResolvedValue([]);
    mocked(api.listUnassignedRequests).mockResolvedValue([]);
    mocked(api.getMyProfessional).mockResolvedValue(null);
    mocked(api.listPendingErasures).mockResolvedValue([]);
  });

  it("com procedure_billing: campos opcionais com incentivo; preenchidos vão planos no corpo da validação", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session([ "procedure_billing" ]));
    renderAttendance();
    await fillValidation();
    expect(screen.getByRole("group", { name: "dados do paciente para o faturamento" })).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Raça/cor"), { target: { value: "05" } });
    const validate = screen.getByRole("button", { name: "Validar cadastro" }) as HTMLButtonElement;
    expect(validate.disabled).toBe(true);
    expect(screen.getByText("para indígena, informe a etnia: código de 4 dígitos da tabela do DATASUS")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Etnia (código)"), { target: { value: "0001" } });
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "80010-000" } });
    fireEvent.change(screen.getByLabelText("Logradouro"), { target: { value: "RUA XV DE NOVEMBRO" } });
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "CENTRO" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar cadastro" }));
    await waitFor(() => expect(api.verifyCitizen).toHaveBeenCalledWith("529.982.247-25", "123456", PROFILE, {
      race_color: "05", ethnicity: "0001", address_zip: "80010000", address_street: "RUA XV DE NOVEMBRO", address_number: "SN",
      address_district: "CENTRO"
    }));
  });

  it("vazios não mudam a chamada de hoje; sem o interruptor, nem aparecem", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session([ "procedure_billing" ]));
    renderAttendance();
    await fillValidation();
    fireEvent.click(screen.getByRole("button", { name: "Validar cadastro" }));
    await waitFor(() => expect(api.verifyCitizen).toHaveBeenCalledWith("529.982.247-25", "123456", PROFILE));
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(session([]));
    renderAttendance();
    await fillValidation();
    expect(screen.queryByLabelText("Raça/cor")).toBeNull();
  });

  it("endereço do cadastro domiciliar (lookup, L26): sem campos de endereço antes do formulário; só a raça/cor vai", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session([ "procedure_billing" ]));
    mocked(api.lookupCitizen).mockResolvedValue({ ...found, citizen: { ...found.citizen, race_color_set: false, address_set: true,
      address_from_household: true } });
    renderAttendance();
    await fillValidation();
    expect(screen.queryByLabelText("CEP")).toBeNull();
    expect(screen.getByText(ADDRESS_FROM_HOUSEHOLD)).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Raça/cor"), { target: { value: "03" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar cadastro" }));
    await waitFor(() => expect(api.verifyCitizen).toHaveBeenCalledWith("529.982.247-25", "123456", PROFILE, { race_color: "03", ethnicity: "" }));
  });

  it("422 address_from_household (reserva): a frase, o endereço trava e a nova tentativa vai sem endereço", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session([ "procedure_billing" ]));
    mocked(api.verifyCitizen).mockRejectedValueOnce(new api.ApiError(422, { error: "address_from_household", field: "address_zip" }, "x"));
    renderAttendance();
    await fillValidation();
    fireEvent.change(screen.getByLabelText("Raça/cor"), { target: { value: "03" } });
    fireEvent.change(screen.getByLabelText("CEP"), { target: { value: "80010-000" } });
    fireEvent.change(screen.getByLabelText("Logradouro"), { target: { value: "RUA XV DE NOVEMBRO" } });
    fireEvent.change(screen.getByLabelText("Bairro"), { target: { value: "CENTRO" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar cadastro" }));
    expect((await screen.findByRole("alert")).textContent).toBe(ADDRESS_FROM_HOUSEHOLD);
    expect(screen.queryByLabelText("CEP")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Validar cadastro" }));
    await waitFor(() => expect(api.verifyCitizen).toHaveBeenLastCalledWith("529.982.247-25", "123456", PROFILE, { race_color: "03", ethnicity: "" }));
  });

  it("recusa dos dados do paciente na validação vira a frase do campo, nunca o genérico", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session([ "procedure_billing" ]));
    mocked(api.verifyCitizen).mockRejectedValue(new api.ApiError(422, { error: "invalid_ethnicity", field: "ethnicity" }, "x"));
    renderAttendance();
    await fillValidation();
    fireEvent.change(screen.getByLabelText("Raça/cor"), { target: { value: "03" } });
    fireEvent.click(screen.getByRole("button", { name: "Validar cadastro" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("para indígena, informe a etnia: código de 4 dígitos da tabela do DATASUS");
    expect(api.verifyCitizen).toHaveBeenCalledWith("529.982.247-25", "123456", PROFILE, { race_color: "03", ethnicity: "" });
  });
});
