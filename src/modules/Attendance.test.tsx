import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), lookupCitizen: vi.fn(), verifyCitizen: vi.fn(),
    listVerifications: vi.fn(), revokeVerification: vi.fn(),
    listActiveUnits: vi.fn(), listAllUnits: vi.fn(), createUnit: vi.fn(), updateUnit: vi.fn(), setUnitActive: vi.fn(),
    listUnitQueue: vi.fn(), callAttendance: vi.fn(), callNext: vi.fn(), closeAttendance: vi.fn(),
    lookupCheckIn: vi.fn(), checkIn: vi.fn(), searchCheckIn: vi.fn(), checkInByException: vi.fn(),
    listUnitRequests: vi.fn(), scheduleRequest: vi.fn(), dismissRequest: vi.fn(), listUnitAgenda: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { currentUnitKey } from "../lib/attendance";
import { Attendance } from "./Attendance";

afterEach(() => { cleanup(); localStorage.clear(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function session(role: string): api.SessionUser {
  return {
    id: "u1", email_address: "a@cidade.gov.br", operator: false, mfa_enrolled: true,
    mfa_verified_at: null,
    memberships: [ { municipality_id: "m1", municipality_name: "Curitiba", municipality_uf: "PR", role } ]
  };
}

function renderAttendance() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<Attendance />, { wrapper });
}

const found = {
  citizen: {
    id: "c1", cpf_masked: "***.982.247-**", phone_masked: "(**) *****-5432",
    created_at: "2026-09-20T10:00:00Z", verification_level: "declared" as const
  },
  triages: [ { date: "2026-09-21T10:00:00Z", protocol_name: "triage-respiratoria" } ]
};

describe("Attendance", () => {
  beforeEach(() => {
    for (const fn of [
      api.fetchCurrentSession, api.lookupCitizen, api.verifyCitizen, api.listVerifications, api.revokeVerification,
      api.listActiveUnits, api.listAllUnits, api.createUnit, api.updateUnit, api.setUnitActive,
      api.listUnitQueue, api.callAttendance, api.callNext, api.closeAttendance,
      api.lookupCheckIn, api.checkIn, api.searchCheckIn, api.checkInByException,
      api.listUnitRequests, api.scheduleRequest, api.dismissRequest, api.listUnitAgenda
    ]) {
      mocked(fn).mockReset();
    }
    mocked(api.fetchCurrentSession).mockResolvedValue(session("citizen_verifier"));
    mocked(api.listActiveUnits).mockResolvedValue([]);
    mocked(api.listAllUnits).mockResolvedValue([]);
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: [] });
    mocked(api.listUnitRequests).mockResolvedValue([]);
    mocked(api.listUnitAgenda).mockResolvedValue([]);
  });

  it("busca, exige a caixa do documento e valida", async () => {
    mocked(api.lookupCitizen).mockResolvedValue(found);
    mocked(api.verifyCitizen).mockResolvedValue(undefined);
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF do cidadão (validação)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de validação"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar validação" }));
    expect(await screen.findByText("(**) *****-5432")).not.toBeNull();
    expect(screen.getByText("triage-respiratoria")).not.toBeNull();
    const validate = screen.getByRole("button", { name: "Validar cadastro" }) as HTMLButtonElement;
    expect(validate.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Conferi o documento com foto e o CPF confere"));
    fireEvent.click(validate);
    await waitFor(() => expect(api.verifyCitizen).toHaveBeenCalledWith("529.982.247-25", "123456"));
    expect(await screen.findByText("Cadastro validado")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Próximo atendimento" }));
    expect((screen.getByLabelText("CPF do cidadão (validação)") as HTMLInputElement).value).toBe("");
  });

  it("CPF inválido não chega à API", async () => {
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF do cidadão (validação)"), { target: { value: "11111111111" } });
    fireEvent.change(screen.getByLabelText("Código de validação"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar validação" }));
    expect(await screen.findByText("CPF inválido")).not.toBeNull();
    expect(api.lookupCitizen).not.toHaveBeenCalled();
  });

  it("código em branco ou parcial não chega à API", async () => {
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF do cidadão (validação)"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar validação" }));
    expect(await screen.findByText("informe o código de 6 dígitos")).not.toBeNull();
    expect(api.lookupCitizen).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Código de validação"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar validação" }));
    expect(await screen.findByText("informe o código de 6 dígitos")).not.toBeNull();
    expect(api.lookupCitizen).not.toHaveBeenCalled();
  });

  it("mostra a frase do erro do balcão", async () => {
    mocked(api.lookupCitizen).mockRejectedValue(new ApiError(422, { error: "code_exhausted" }, "x"));
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF do cidadão (validação)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de validação"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar validação" }));
    expect(await screen.findByText("tentativas esgotadas — peça ao cidadão para gerar outro código")).not.toBeNull();
  });

  it("o histórico de validações só aparece para o admin, e desfazer exige motivo", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session("municipal_admin"));
    mocked(api.listVerifications).mockResolvedValue([
      {
        id: "v1", verified_at: "2026-09-24T10:00:00Z", verified_by: "atendente@cidade.gov.br",
        phone_masked: "(**) *****-5432", active: true, revoked_at: null, revoked_by: null, revoke_reason: null
      }
    ]);
    mocked(api.revokeVerification).mockResolvedValue(undefined);
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF do histórico"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver histórico" }));
    fireEvent.click(await screen.findByRole("button", { name: "Desfazer" }));
    const confirm = screen.getByRole("button", { name: "Confirmar desfazer" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento de outra pessoa" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.revokeVerification).toHaveBeenCalledWith("v1", "documento de outra pessoa"));
  });

  it("mostra o Nível em português", async () => {
    mocked(api.lookupCitizen).mockResolvedValue(found);
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF do cidadão (validação)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de validação"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar validação" }));
    expect(await screen.findByText("declarado")).not.toBeNull();
    expect(screen.queryByText("declared")).toBeNull();
  });

  it("uma nova busca limpa as linhas antigas antes de trazer as novas", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session("municipal_admin"));
    mocked(api.listVerifications).mockResolvedValueOnce([
      {
        id: "v1", verified_at: "2026-09-24T10:00:00Z", verified_by: "atendente@cidade.gov.br",
        phone_masked: "(**) *****-5432", active: true, revoked_at: null, revoked_by: null, revoke_reason: null
      }
    ]);
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF do histórico"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver histórico" }));
    expect(await screen.findByText("atendente@cidade.gov.br")).not.toBeNull();

    let resolveSecond: (rows: api.VerificationRow[]) => void = () => {};
    mocked(api.listVerifications).mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    fireEvent.change(screen.getByLabelText("CPF do histórico"), { target: { value: "11144477735" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver histórico" }));
    expect(screen.queryByText("atendente@cidade.gov.br")).toBeNull();
    resolveSecond([]);
    expect(await screen.findByText("nenhuma validação para este CPF")).not.toBeNull();
  });

  it("depois de desfazer, recarrega com o CPF que trouxe as linhas atuais, não o do campo" , async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session("municipal_admin"));
    mocked(api.listVerifications).mockResolvedValue([
      {
        id: "v1", verified_at: "2026-09-24T10:00:00Z", verified_by: "atendente@cidade.gov.br",
        phone_masked: "(**) *****-5432", active: true, revoked_at: null, revoked_by: null, revoke_reason: null
      }
    ]);
    mocked(api.revokeVerification).mockResolvedValue(undefined);
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF do histórico"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Ver histórico" }));
    await screen.findByRole("button", { name: "Desfazer" });

    fireEvent.change(screen.getByLabelText("CPF do histórico"), { target: { value: "11144477735" } });
    fireEvent.click(screen.getByRole("button", { name: "Desfazer" }));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento de outra pessoa" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar desfazer" }));
    await waitFor(() => expect(api.revokeVerification).toHaveBeenCalledWith("v1", "documento de outra pessoa"));
    await waitFor(() => expect(mocked(api.listVerifications).mock.calls.at(-1)?.[0]).toBe("529.982.247-25"));
  });

  it("atendente não vê o histórico", async () => {
    renderAttendance();
    await screen.findByLabelText("CPF do cidadão (validação)");
    expect(screen.queryByLabelText("CPF do histórico")).toBeNull();
  });

  it("com unidade escolhida, o check-in e o balcão de validação têm rótulos e botões distintos", async () => {
    const unit = { id: "un1", name: "UBS Centro", kind: "ubs" };
    localStorage.setItem(currentUnitKey("u1"), unit.id);
    mocked(api.listActiveUnits).mockResolvedValue([ unit ]);
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: [] });
    renderAttendance();

    expect(await screen.findByLabelText("CPF do cidadão (check-in)")).not.toBeNull();
    expect(screen.getByLabelText("Código de check-in")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Buscar check-in" })).not.toBeNull();

    expect(screen.getByLabelText("CPF do cidadão (validação)")).not.toBeNull();
    expect(screen.getByLabelText("Código de validação")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Buscar validação" })).not.toBeNull();
  });

  it("profissional de saúde vê a unidade e a fila, mas não check-in nem balcão", async () => {
    const unit = { id: "un1", name: "UBS Centro", kind: "ubs" };
    mocked(api.fetchCurrentSession).mockResolvedValue(session("health_professional"));
    localStorage.setItem(currentUnitKey("u1"), unit.id);
    mocked(api.listActiveUnits).mockResolvedValue([ unit ]);
    renderAttendance();

    expect(await screen.findByRole("button", { name: "Chamar próximo" })).not.toBeNull();
    expect(screen.queryByLabelText("CPF do cidadão (check-in)")).toBeNull();
    expect(screen.queryByLabelText("CPF do cidadão (validação)")).toBeNull();
    expect(screen.queryByText("Pedidos de agendamento")).toBeNull();
    expect(screen.queryByText("Agenda do dia")).toBeNull();
  });

  it("recepção (canVerify) vê Pedidos e Agenda do dia; profissional sem esse papel não vê", async () => {
    const unit = { id: "un1", name: "UBS Centro", kind: "ubs" };
    localStorage.setItem(currentUnitKey("u1"), unit.id);
    mocked(api.listActiveUnits).mockResolvedValue([ unit ]);
    renderAttendance();
    expect(await screen.findByText("Pedidos de agendamento")).not.toBeNull();
    expect(screen.getByText("Agenda do dia")).not.toBeNull();
  });

  it("recepção continua vendo check-in e balcão, além da fila", async () => {
    const unit = { id: "un1", name: "UBS Centro", kind: "ubs" };
    localStorage.setItem(currentUnitKey("u1"), unit.id);
    mocked(api.listActiveUnits).mockResolvedValue([ unit ]);
    renderAttendance();

    expect(await screen.findByLabelText("CPF do cidadão (check-in)")).not.toBeNull();
    expect(screen.getByLabelText("CPF do cidadão (validação)")).not.toBeNull();
    expect(await screen.findByText("Ninguém aguardando")).not.toBeNull();
  });
});
