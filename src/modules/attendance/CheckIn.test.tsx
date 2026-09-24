import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, lookupCheckIn: vi.fn(), checkIn: vi.fn(), searchCheckInTriages: vi.fn(), checkInByException: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { CheckIn } from "./CheckIn";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function renderCheckIn(onUnitInvalid = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<CheckIn unit={unit} onUnitInvalid={onUnitInvalid} />, { wrapper });
  return onUnitInvalid;
}

const foundDeclared = {
  citizen: { id: "c1", cpf_masked: "***.982.247-**", phone_masked: "(**) *****-5432", verification_level: "declared" as const },
  triage: { id: "t1", date: "2026-09-21T10:00:00Z", protocol_name: "triage-respiratoria", priority: 2 }
};

const foundVerified = {
  citizen: { id: "c2", cpf_masked: "***.982.247-**", phone_masked: "(**) *****-5432", verification_level: "verified" as const },
  triage: { id: "t2", date: "2026-09-21T10:00:00Z", protocol_name: "triage-respiratoria", priority: 1 }
};

describe("CheckIn", () => {
  beforeEach(() => {
    for (const fn of [ api.lookupCheckIn, api.checkIn, api.searchCheckInTriages, api.checkInByException ]) mocked(fn).mockReset();
  });

  it("busca exige CPF válido e código de 6 dígitos", async () => {
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "11111111111" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("CPF inválido")).not.toBeNull();
    expect(api.lookupCheckIn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("informe o código de 6 dígitos")).not.toBeNull();
    expect(api.lookupCheckIn).not.toHaveBeenCalled();
  });

  it("cartão mostra CPF e celular mascarados, data, protocolo e prioridade", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByText("***.982.247-**")).not.toBeNull();
    expect(screen.getByText("(**) *****-5432")).not.toBeNull();
    expect(screen.getByText("triage-respiratoria")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
  });

  it("para declarado, mostra a caixa de conferência e manda documentChecked conforme marcada", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    mocked(api.checkIn).mockResolvedValue({ attendance: { id: "a1" }, verified: false });
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(await screen.findByLabelText("Conferi o documento com foto e o CPF confere")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(api.checkIn).toHaveBeenCalledWith("529.982.247-25", "123456", "u1", false));

    mocked(api.checkIn).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Próximo atendimento" }));
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByLabelText("Conferi o documento com foto e o CPF confere");
    fireEvent.click(screen.getByLabelText("Conferi o documento com foto e o CPF confere"));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(api.checkIn).toHaveBeenCalledWith("529.982.247-25", "123456", "u1", true));
  });

  it("confirmação mostra Atendimento iniciado e cadastro validado quando verified, e Próximo atendimento limpa", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundVerified);
    mocked(api.checkIn).mockResolvedValue({ attendance: { id: "a1" }, verified: true });
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("triage-respiratoria");
    expect(screen.queryByLabelText("Conferi o documento com foto e o CPF confere")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    expect(await screen.findByText("Atendimento iniciado")).not.toBeNull();
    expect(screen.getByText("cadastro validado")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Próximo atendimento" }));
    expect((screen.getByLabelText("CPF") as HTMLInputElement).value).toBe("");
  });

  it("already_checked_in mostra a unidade e a hora", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    mocked(api.checkIn).mockRejectedValue(
      new ApiError(409, { error: "already_checked_in", unit_name: "UBS Norte", checked_in_at: "2026-09-24T09:00:00Z" }, "x")
    );
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("triage-respiratoria");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    expect(await screen.findByText(/já está em atendimento em UBS Norte desde/)).not.toBeNull();
  });

  it("invalid_unit chama onUnitInvalid para voltar à escolha", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    mocked(api.checkIn).mockRejectedValue(new ApiError(422, { error: "invalid_unit" }, "x"));
    const onUnitInvalid = renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código do cidadão"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await screen.findByText("triage-respiratoria");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(onUnitInvalid).toHaveBeenCalled());
  });

  it("exceção: busca por CPF, escolhe triagem, motivo com 10+ caracteres habilita Iniciar atendimento", async () => {
    mocked(api.searchCheckInTriages).mockResolvedValue([
      { id: "t1", date: "2026-09-21T10:00:00Z", protocol_name: "triage-respiratoria", priority: 2 }
    ]);
    mocked(api.checkInByException).mockResolvedValue({ attendance: { id: "a1" } });
    renderCheckIn();
    fireEvent.click(screen.getByRole("button", { name: "Cidadão sem o código" }));
    fireEvent.change(screen.getByLabelText("CPF"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar triagens" }));
    expect(await screen.findByText("triage-respiratoria")).not.toBeNull();
    fireEvent.click(screen.getByText("triage-respiratoria"));
    const start = screen.getByRole("button", { name: "Iniciar atendimento" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    expect((screen.getByRole("button", { name: "Iniciar atendimento" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento perdido" } });
    expect((screen.getByRole("button", { name: "Iniciar atendimento" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(api.checkInByException).toHaveBeenCalledWith("529.982.247-25", "t1", "u1", "documento perdido"));
  });
});
