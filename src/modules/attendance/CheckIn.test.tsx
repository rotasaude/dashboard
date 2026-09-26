import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, lookupCheckIn: vi.fn(), checkIn: vi.fn(), searchCheckIn: vi.fn(), checkInByException: vi.fn()
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
  return { onUnitInvalid, client };
}

const foundDeclared = {
  citizen: { id: "c1", cpf_masked: "***.982.247-**", phone_masked: "(**) *****-5432", verification_level: "declared" as const },
  triage: { id: "t1", date: "2026-09-21T10:00:00Z", protocol_name: "triage-respiratoria", priority: 2 },
  appointment: null
};

const foundVerified = {
  citizen: { id: "c2", cpf_masked: "***.982.247-**", phone_masked: "(**) *****-5432", verification_level: "verified" as const },
  triage: { id: "t2", date: "2026-09-21T10:00:00Z", protocol_name: "triage-respiratoria", priority: 1 },
  appointment: null
};

const foundAppointment = {
  citizen: { id: "c3", cpf_masked: "***.982.247-**", phone_masked: "(**) *****-5432", verification_level: "verified" as const },
  triage: null,
  appointment: {
    id: "ap1", scheduled_at: "2026-09-25T13:00:00Z", kind: "return" as const,
    unit_name: "UBS Centro", protocol_name: "triage-respiratoria", priority: 2
  }
};

describe("CheckIn", () => {
  beforeEach(() => {
    for (const fn of [ api.lookupCheckIn, api.checkIn, api.searchCheckIn, api.checkInByException ]) mocked(fn).mockReset();
  });

  it("busca exige CPF válido e código de 6 dígitos", async () => {
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "11111111111" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    expect(await screen.findByText("CPF inválido")).not.toBeNull();
    expect(api.lookupCheckIn).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    expect(await screen.findByText("informe o código de 6 dígitos")).not.toBeNull();
    expect(api.lookupCheckIn).not.toHaveBeenCalled();
  });

  it("o lookup envia unit.id", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    await waitFor(() => expect(api.lookupCheckIn).toHaveBeenCalledWith("529.982.247-25", "123456", "u1"));
  });

  it("cartão mostra CPF e celular mascarados, nível, data, protocolo e prioridade", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    expect(await screen.findByText("***.982.247-**")).not.toBeNull();
    expect(screen.getByText("(**) *****-5432")).not.toBeNull();
    expect(screen.getByText("declarado")).not.toBeNull();
    expect(screen.getByText("triage-respiratoria")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
  });

  it("cartão mostra o agendamento com hora, tipo e prioridade quando vier appointment", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundAppointment);
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    expect(await screen.findByText(/Agendamento \d{2}:\d{2} · Retorno/)).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
  });

  it("cartão mostra encaminhamento quando o kind do agendamento é referral", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue({
      ...foundAppointment,
      appointment: { ...foundAppointment.appointment, kind: "referral" as const }
    });
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    expect(await screen.findByText(/Agendamento \d{2}:\d{2} · Encaminhamento/)).not.toBeNull();
  });

  it("para declarado, mostra a caixa de conferência e manda documentChecked conforme marcada", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    mocked(api.checkIn).mockResolvedValue({ attendance: { id: "a1" }, verified: false });
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    expect(await screen.findByLabelText("Conferi o documento com foto e o CPF confere")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(api.checkIn).toHaveBeenCalledWith("529.982.247-25", "123456", "u1", false));

    mocked(api.checkIn).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Próximo atendimento" }));
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    await screen.findByLabelText("Conferi o documento com foto e o CPF confere");
    fireEvent.click(screen.getByLabelText("Conferi o documento com foto e o CPF confere"));
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(api.checkIn).toHaveBeenCalledWith("529.982.247-25", "123456", "u1", true));
  });

  it("confirmação mostra Atendimento iniciado e cadastro validado quando verified, e Próximo atendimento limpa", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundVerified);
    mocked(api.checkIn).mockResolvedValue({ attendance: { id: "a1" }, verified: true });
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    await screen.findByText("triage-respiratoria");
    expect(screen.queryByLabelText("Conferi o documento com foto e o CPF confere")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    expect(await screen.findByText("Atendimento iniciado")).not.toBeNull();
    expect(screen.getByText("cadastro validado")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Próximo atendimento" }));
    expect((screen.getByLabelText("CPF do cidadão (check-in)") as HTMLInputElement).value).toBe("");
  });

  it("already_checked_in mostra a unidade e a hora", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    mocked(api.checkIn).mockRejectedValue(
      new ApiError(409, { error: "already_checked_in", unit_name: "UBS Norte", checked_in_at: "2026-09-24T09:00:00Z" }, "x")
    );
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    await screen.findByText("triage-respiratoria");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    expect(await screen.findByText(/já está em atendimento em UBS Norte desde/)).not.toBeNull();
  });

  it("invalid_unit chama onUnitInvalid para voltar à escolha", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    mocked(api.checkIn).mockRejectedValue(new ApiError(422, { error: "invalid_unit" }, "x"));
    const { onUnitInvalid } = renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    await screen.findByText("triage-respiratoria");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(onUnitInvalid).toHaveBeenCalled());
  });

  it("wrong_unit no lookup mostra a unidade certa", async () => {
    mocked(api.lookupCheckIn).mockRejectedValue(new ApiError(422, { error: "wrong_unit", unit_name: "UPA Norte" }, "x"));
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    expect(await screen.findByText("Este agendamento é na UPA Norte")).not.toBeNull();
  });

  it("not_today no lookup avisa que o agendamento não é para hoje", async () => {
    mocked(api.lookupCheckIn).mockRejectedValue(new ApiError(422, { error: "not_today" }, "x"));
    renderCheckIn();
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    expect(await screen.findByText("Este agendamento não é para hoje")).not.toBeNull();
  });

  it("exceção: lista primeiro os agendamentos de hoje e depois as triagens; motivo com 10+ caracteres habilita, e a escolha envia triageId ou appointmentId", async () => {
    mocked(api.searchCheckIn).mockResolvedValue({
      triages: [ { id: "t1", date: "2026-09-21T10:00:00Z", protocol_name: "triage-respiratoria", priority: 2 } ],
      appointments: [
        { id: "ap1", scheduled_at: "2026-09-25T13:00:00Z", kind: "return", unit_name: "UBS Centro", protocol_name: "protocolo-agendamento", priority: 1 }
      ]
    });
    mocked(api.checkInByException).mockResolvedValue({ attendance: { id: "a1" } });
    renderCheckIn();
    fireEvent.click(screen.getByRole("button", { name: "Cidadão sem o código" }));
    fireEvent.change(screen.getByLabelText("CPF do cidadão (exceção)"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar triagens" }));

    const rows = await screen.findAllByRole("row");
    // primeira linha de dados é o agendamento, a segunda a triagem (a linha 0 é o cabeçalho, se houver)
    const dataRows = rows.filter((r) => r.textContent?.includes("Agendamento") || r.textContent?.includes("triage-respiratoria"));
    expect(dataRows[0].textContent).toMatch(/Agendamento \d{2}:\d{2}/);
    expect(dataRows[1].textContent).toContain("triage-respiratoria");

    fireEvent.click(screen.getByText(/Agendamento \d{2}:\d{2}/));
    const start = screen.getByRole("button", { name: "Iniciar atendimento" }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    expect((screen.getByRole("button", { name: "Iniciar atendimento" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento perdido" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(api.checkInByException).toHaveBeenCalledWith(
      "529.982.247-25", { appointmentId: "ap1" }, "u1", "documento perdido"
    ));

    mocked(api.checkInByException).mockClear();
    fireEvent.click(screen.getByRole("button", { name: "Próximo atendimento" }));
    fireEvent.change(screen.getByLabelText("CPF do cidadão (exceção)"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar triagens" }));
    await screen.findByText("triage-respiratoria");
    fireEvent.click(screen.getByText("triage-respiratoria"));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento perdido" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    await waitFor(() => expect(api.checkInByException).toHaveBeenCalledWith(
      "529.982.247-25", { triageId: "t1" }, "u1", "documento perdido"
    ));
  });

  it("check-in por código sempre invalida a fila; quando é de um agendamento, também invalida agenda e pedidos", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundAppointment);
    mocked(api.checkIn).mockResolvedValue({ attendance: { id: "a1" }, verified: true });
    const { client } = renderCheckIn();
    // As três queries só existem no cache (e por isso são invalidáveis) se
    // algum painel (UnitQueue/Agenda/Requests) já as tiver consultado antes
    // — aqui simulamos isso semeando o cache, como se os painéis já tivessem
    // carregado.
    client.setQueryData([ "unitQueue", "u1" ], { waiting: [], in_care: [] });
    client.setQueryData([ "unitAgenda", "u1" ], []);
    client.setQueryData([ "unitRequests", "u1" ], []);

    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    await screen.findByText(/Agendamento \d{2}:\d{2} · Retorno/);
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));

    await waitFor(() => expect(client.getQueryState([ "unitQueue", "u1" ])?.isInvalidated).toBe(true));
    expect(client.getQueryState([ "unitAgenda", "u1" ])?.isInvalidated).toBe(true);
    expect(client.getQueryState([ "unitRequests", "u1" ])?.isInvalidated).toBe(true);
  });

  it("check-in de triagem (sem agendamento) invalida a fila mas não agenda nem pedidos", async () => {
    mocked(api.lookupCheckIn).mockResolvedValue(foundDeclared);
    mocked(api.checkIn).mockResolvedValue({ attendance: { id: "a1" }, verified: false });
    const { client } = renderCheckIn();
    client.setQueryData([ "unitQueue", "u1" ], { waiting: [], in_care: [] });
    client.setQueryData([ "unitAgenda", "u1" ], []);
    client.setQueryData([ "unitRequests", "u1" ], []);

    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    await screen.findByLabelText("Conferi o documento com foto e o CPF confere");
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));

    await waitFor(() => expect(client.getQueryState([ "unitQueue", "u1" ])?.isInvalidated).toBe(true));
    expect(client.getQueryState([ "unitAgenda", "u1" ])?.isInvalidated).toBe(false);
    expect(client.getQueryState([ "unitRequests", "u1" ])?.isInvalidated).toBe(false);
  });

  it("check-in por exceção de um agendamento também invalida a fila, a agenda e os pedidos", async () => {
    mocked(api.searchCheckIn).mockResolvedValue({
      triages: [],
      appointments: [
        { id: "ap1", scheduled_at: "2026-09-25T13:00:00Z", kind: "return", unit_name: "UBS Centro", protocol_name: "protocolo-agendamento", priority: 1 }
      ]
    });
    mocked(api.checkInByException).mockResolvedValue({ attendance: { id: "a1" } });
    const { client } = renderCheckIn();
    client.setQueryData([ "unitQueue", "u1" ], { waiting: [], in_care: [] });
    client.setQueryData([ "unitAgenda", "u1" ], []);
    client.setQueryData([ "unitRequests", "u1" ], []);

    fireEvent.click(screen.getByRole("button", { name: "Cidadão sem o código" }));
    fireEvent.change(screen.getByLabelText("CPF do cidadão (exceção)"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar triagens" }));
    fireEvent.click(await screen.findByText(/Agendamento \d{2}:\d{2}/));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento perdido" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));

    await waitFor(() => expect(client.getQueryState([ "unitQueue", "u1" ])?.isInvalidated).toBe(true));
    expect(client.getQueryState([ "unitAgenda", "u1" ])?.isInvalidated).toBe(true);
    expect(client.getQueryState([ "unitRequests", "u1" ])?.isInvalidated).toBe(true);
  });
});
