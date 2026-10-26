// src/modules/attendance/CheckIn.demographics.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, lookupCheckIn: vi.fn(), checkIn: vi.fn(), searchCheckIn: vi.fn(), checkInByException: vi.fn(),
    completeCitizenNames: vi.fn(), saveVerificationDemographics: vi.fn() };
});

import * as api from "../../lib/api";
import { CheckIn } from "./CheckIn";
import { ADDRESS_FROM_HOUSEHOLD } from "../../lib/demographics";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u7", name: "UPA Boa Vista", kind: "upa" };
const found = {
  citizen: { id: "c2", cpf_masked: "***.982.247-**", phone_masked: "(**) *****-5432", verification_level: "verified" as const, verification_id: "v9",
    race_color_set: false, address_set: false },
  triage: { id: "t2", date: "2026-10-21T10:00:00Z", protocol_name: "triage-respiratoria", priority: 1 }, appointment: null
};

function renderCheckIn(demographicsOn = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<CheckIn unit={unit} onUnitInvalid={vi.fn()} demographicsOn={demographicsOn} />, { wrapper });
}

async function checkInByCode() {
  fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
  fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
  fireEvent.click(await screen.findByRole("button", { name: "Iniciar atendimento" }));
  await screen.findByText("Atendimento iniciado");
}

describe("CheckIn — dados do paciente para o BPA-I (módulo 22)", () => {
  beforeEach(() => {
    for (const fn of [ api.lookupCheckIn, api.checkIn, api.searchCheckIn, api.checkInByException, api.saveVerificationDemographics ]) mocked(fn).mockReset();
    mocked(api.lookupCheckIn).mockResolvedValue(found);
    mocked(api.checkIn).mockResolvedValue({ attendance: { id: "at1" }, verified: false });
    mocked(api.saveVerificationDemographics).mockResolvedValue({ race_color_set: true, address_set: false });
  });

  it("par validado: oferece completar e grava pela validação, só com os campos do paciente", async () => {
    renderCheckIn();
    await checkInByCode();
    const form = screen.getByRole("region", { name: "Completar dados do paciente" });
    expect(within(form).getByRole("note").textContent).toMatch(/ajuda|faturamento/);
    fireEvent.change(within(form).getByLabelText("Raça/cor"), { target: { value: "03" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    await waitFor(() => expect(api.saveVerificationDemographics).toHaveBeenCalledWith("v9", { race_color: "03", ethnicity: "" }));
    expect(await within(form).findByText("Dados do paciente salvos.")).not.toBeNull();
    expect(within(form).queryByLabelText("Raça/cor")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Próximo atendimento" }));
    expect(screen.queryByRole("region", { name: "Completar dados do paciente" })).toBeNull();
  });

  it("check-in que acabou de validar usa a validação nova; 'Agora não' fecha sem gravar", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue({ ...found, citizen: { ...found.citizen, verification_level: "declared" as const, verification_id: null, race_color_set: false, address_set: false } });
    mocked(api.checkIn).mockResolvedValue({ attendance: { id: "at2" }, verified: true, verification_id: "v10" });
    renderCheckIn();
    await checkInByCode();
    const form = screen.getByRole("region", { name: "Completar dados do paciente" });
    fireEvent.change(within(form).getByLabelText("Raça/cor"), { target: { value: "01" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    await waitFor(() => expect(api.saveVerificationDemographics).toHaveBeenCalledWith("v10", { race_color: "01", ethnicity: "" }));
    cleanup();
    renderCheckIn();
    await checkInByCode();
    fireEvent.click(screen.getByRole("button", { name: "Agora não" }));
    expect(screen.queryByRole("region", { name: "Completar dados do paciente" })).toBeNull();
    expect(api.saveVerificationDemographics).toHaveBeenCalledTimes(1);
  });

  it("sem o interruptor, sem validação conhecida, flags ausentes ou já completo: nenhum formulário", async () => {
    const REGION = { name: "Completar dados do paciente" };
    renderCheckIn(false);
    await checkInByCode();
    expect(screen.queryByRole("region", REGION)).toBeNull();
    cleanup();
    mocked(api.lookupCheckIn).mockResolvedValue({ ...found, citizen: { ...found.citizen, verification_level: "declared" as const, verification_id: null } });
    renderCheckIn();
    await checkInByCode();
    expect(screen.queryByRole("region", REGION)).toBeNull();
    cleanup();
    // api antigo: sem as flags = comportamento atual
    const { race_color_set: _r, address_set: _a, ...old } = found.citizen;
    mocked(api.lookupCheckIn).mockResolvedValue({ ...found, citizen: old });
    renderCheckIn();
    await checkInByCode();
    expect(screen.queryByRole("region", REGION)).toBeNull();
    cleanup();
    // já completo
    mocked(api.lookupCheckIn).mockResolvedValue({ ...found, citizen: { ...found.citizen, race_color_set: true, address_set: true } });
    renderCheckIn();
    await checkInByCode();
    expect(screen.queryByRole("region", REGION)).toBeNull();
  });

  it("só falta o endereço: o formulário diz o que falta", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue({ ...found, citizen: { ...found.citizen, race_color_set: true } });
    renderCheckIn();
    await checkInByCode();
    const form = screen.getByRole("region", { name: "Completar dados do paciente" });
    expect(within(form).getByRole("note").textContent).toMatch(/Falta: CEP e endereço/);
  });

  it("endereço do cadastro domiciliar: sem campos de endereço; só a raça/cor falta ou nenhum formulário", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue({ ...found, citizen: { ...found.citizen, address_from_household: true } });
    renderCheckIn();
    await checkInByCode();
    const form = screen.getByRole("region", { name: "Completar dados do paciente" });
    expect(within(form).queryByLabelText("CEP")).toBeNull();
    expect(within(form).getByText(ADDRESS_FROM_HOUSEHOLD)).not.toBeNull();
    expect(within(form).getByRole("note").textContent).toMatch(/^Falta: raça\/cor\./);
    cleanup();
    // Raça/cor já gravada: o endereço que falta é do domicílio, nada a completar aqui.
    mocked(api.lookupCheckIn).mockResolvedValue({ ...found, citizen: { ...found.citizen, race_color_set: true, address_from_household: true } });
    renderCheckIn();
    await checkInByCode();
    expect(screen.queryByRole("region", { name: "Completar dados do paciente" })).toBeNull();
  });

  async function exceptionCheckIn() {
    mocked(api.searchCheckIn).mockResolvedValue({
      triages: [ { id: "t1", date: "2026-10-21T10:00:00Z", protocol_name: "triage-respiratoria", priority: 2 } ], appointments: []
    });
    renderCheckIn();
    fireEvent.click(screen.getByRole("button", { name: "Cidadão sem o código" }));
    fireEvent.change(screen.getByLabelText("CPF do cidadão (exceção)"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar triagens" }));
    fireEvent.click(await screen.findByText("triage-respiratoria"));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento perdido" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await screen.findByText("Atendimento iniciado");
  }

  it("exceção com verification_id: oferece o formulário e grava pela validação", async () => {
    mocked(api.checkInByException).mockResolvedValue({ attendance: { id: "at3" }, verification_id: "v11" });
    await exceptionCheckIn();
    const form = screen.getByRole("region", { name: "Completar dados do paciente" });
    fireEvent.change(within(form).getByLabelText("Raça/cor"), { target: { value: "02" } });
    fireEvent.click(within(form).getByRole("button", { name: "Salvar dados do paciente" }));
    await waitFor(() => expect(api.saveVerificationDemographics).toHaveBeenCalledWith("v11", { race_color: "02", ethnicity: "" }));
  });

  it("exceção com par só declarado (verification_id null) ou sem o interruptor: sem formulário", async () => {
    mocked(api.checkInByException).mockResolvedValue({ attendance: { id: "at3" }, verification_id: null });
    await exceptionCheckIn();
    expect(screen.queryByRole("region", { name: "Completar dados do paciente" })).toBeNull();
    cleanup();
    mocked(api.checkInByException).mockResolvedValue({ attendance: { id: "at4" }, verification_id: "v11" });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CheckIn unit={unit} onUnitInvalid={vi.fn()} demographicsOn={false} /></QueryClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Cidadão sem o código" }));
    fireEvent.change(screen.getByLabelText("CPF do cidadão (exceção)"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar triagens" }));
    fireEvent.click(await screen.findByText("triage-respiratoria"));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento perdido" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await screen.findByText("Atendimento iniciado");
    expect(screen.queryByRole("region", { name: "Completar dados do paciente" })).toBeNull();
  });
});
