import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), lookupCitizen: vi.fn(), verifyCitizen: vi.fn(),
    listVerifications: vi.fn(), revokeVerification: vi.fn()
  };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { Attendance } from "./Attendance";

afterEach(cleanup);
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
    for (const fn of [ api.fetchCurrentSession, api.lookupCitizen, api.verifyCitizen, api.listVerifications, api.revokeVerification ]) {
      mocked(fn).mockReset();
    }
    mocked(api.fetchCurrentSession).mockResolvedValue(session("citizen_verifier"));
  });

  it("busca, exige a caixa do documento e valida", async () => {
    mocked(api.lookupCitizen).mockResolvedValue(found);
    mocked(api.verifyCitizen).mockResolvedValue(undefined);
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("(**) *****-5432")).not.toBeNull();
    expect(screen.getByText("triage-respiratoria")).not.toBeNull();
    const validate = screen.getByRole("button", { name: "Validar cadastro" }) as HTMLButtonElement;
    expect(validate.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("Conferi o documento com foto e o CPF confere"));
    fireEvent.click(validate);
    await waitFor(() => expect(api.verifyCitizen).toHaveBeenCalledWith("529.982.247-25", "123456"));
    expect(await screen.findByText("Cadastro validado")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Próximo atendimento" }));
    expect((screen.getByLabelText("CPF") as HTMLInputElement).value).toBe("");
  });

  it("CPF inválido não chega à API", async () => {
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "11111111111" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("CPF inválido")).not.toBeNull();
    expect(api.lookupCitizen).not.toHaveBeenCalled();
  });

  it("mostra a frase do erro do balcão", async () => {
    mocked(api.lookupCitizen).mockRejectedValue(new ApiError(422, { error: "code_exhausted" }, "x"));
    renderAttendance();
    fireEvent.change(await screen.findByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
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

  it("atendente não vê o histórico", async () => {
    renderAttendance();
    await screen.findByLabelText("CPF");
    expect(screen.queryByLabelText("CPF do histórico")).toBeNull();
  });
});
