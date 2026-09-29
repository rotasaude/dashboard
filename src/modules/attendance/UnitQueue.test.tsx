import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), listUnitQueue: vi.fn(), callAttendance: vi.fn(), callNext: vi.fn(),
    closeAttendance: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { UnitQueue } from "./UnitQueue";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const otherUnit = { id: "u2", name: "UPA Norte", kind: "upa" };

const waiting = [
  {
    id: "a1", cpf_masked: "***.982.247-**", checked_in_at: "2026-09-25T09:00:00Z",
    protocol_name: "triage-respiratoria", priority: 1, source: "triage" as const,
    appointment_time: null, called_at: null, called_by_name: null
  },
  {
    id: "a2", cpf_masked: "***.111.222-**", checked_in_at: "2026-09-25T09:10:00Z",
    protocol_name: null, priority: 2, source: "appointment" as const,
    appointment_time: "2026-09-25T13:00:00Z", called_at: null, called_by_name: null
  }
];

const inCare = [
  {
    id: "a3", cpf_masked: "***.333.444-**", checked_in_at: "2026-09-25T08:00:00Z",
    protocol_name: "triage-dor", priority: 3, source: "triage" as const,
    appointment_time: null, called_at: "2026-09-25T12:00:00Z", called_by_name: "dr@cidade.gov.br"
  }
];

function renderQueue(props: {
  canCare: boolean; careBlocked?: string | null; onClinicalRefused?(): void; units?: api.HealthUnit[]
}) {
  const { units = [ unit, otherUnit ], ...rest } = props;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<UnitQueue unit={unit} units={units} {...rest} />, { wrapper });
  return { client };
}

function session() {
  return { id: "u1", email_address: "dr@cidade.gov.br", operator: false, mfa_enrolled: true, mfa_verified_at: null,
    memberships: [ { municipality_id: "m1", municipality_name: "Curitiba", municipality_uf: "PR", role: "health_professional" } ] };
}

describe("UnitQueue", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listUnitQueue, api.callAttendance, api.callNext, api.closeAttendance ]) {
      mocked(fn).mockReset();
    }
    mocked(api.fetchCurrentSession).mockResolvedValue(session());
    mocked(api.listUnitQueue).mockResolvedValue({ waiting, in_care: inCare });
  });

  it("mostra Aguardando e Em atendimento na ordem da API, com prioridade, origem e chamada", async () => {
    renderQueue({ canCare: true });

    expect(await screen.findByText("Aguardando")).not.toBeNull();
    expect(screen.getByText("Em atendimento")).not.toBeNull();

    const cpfCells = await screen.findAllByText(/\*\*\*\.\d{3}\.\d{3}-\*\*/);
    expect(cpfCells.map((c) => c.textContent)).toEqual([
      "***.982.247-**", "***.111.222-**", "***.333.444-**"
    ]);

    expect(screen.getByText("1")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
    expect(screen.getByText("3")).not.toBeNull();

    // hh:mm no fuso da cidade (13:00Z e 12:00Z → 10:00 e 09:00), sem segundos.
    expect(screen.getByText("Agendamento 10:00")).not.toBeNull();
    expect(screen.getByText("chamado por dr@cidade.gov.br às 09:00")).not.toBeNull();
  });

  describe("profissional (canCare)", () => {
    describe("unidade de referência (módulo 11)", () => {
      const hospital = { id: "u3", name: "Hospital Sul", kind: "hospital" };
      const withRefs = (ids: string[]) => mocked(api.listUnitQueue).mockResolvedValue({
        waiting, in_care: [ { ...inCare[0], reference_unit_ids: ids } ]
      });

      it("pré-seleciona a primeira de referência por nome e as sobe com a etiqueta", async () => {
        withRefs([ "u2", "u3" ]);
        renderQueue({ canCare: true, units: [ unit, otherUnit, hospital ] });
        fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
        fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
        const select = screen.getByLabelText("Unidade de destino") as HTMLSelectElement;
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual([
          "—", "Hospital Sul · referência", "UPA Norte · referência", "UBS Centro"
        ]);
        expect(select.value).toBe("u3");
        expect(screen.getByText("Gera pedido de agendamento na Hospital Sul")).not.toBeNull();
      });

      it("confirma com a pré-seleção sem o profissional mexer", async () => {
        withRefs([ "u2" ]);
        mocked(api.closeAttendance).mockResolvedValue({ attendance: { id: "a3" },
          appointmentRequest: { id: "r1", kind: "referral", target_unit_name: "UPA Norte", status: "open" } });
        renderQueue({ canCare: true });
        fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
        fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
        fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
        await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a3", "referred", "u2", undefined));
      });

      it("o profissional troca para '—' e a pré-seleção não volta", async () => {
        withRefs([ "u2" ]);
        renderQueue({ canCare: true });
        fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
        fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
        fireEvent.change(screen.getByLabelText("Unidade de destino"), { target: { value: "" } });
        expect((screen.getByLabelText("Unidade de destino") as HTMLSelectElement).value).toBe("");
        expect((screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement).disabled).toBe(true);
      });

      it("pré-seleção não vaza para outro desfecho", async () => {
        withRefs([ "u2" ]);
        mocked(api.closeAttendance).mockResolvedValue({ attendance: { id: "a3" }, appointmentRequest: null });
        renderQueue({ canCare: true });
        fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
        fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
        await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a3", "discharged", undefined, undefined));
      });

      it("referência só = a própria unidade: nada pré-selecionado e sem etiqueta", async () => {
        withRefs([ "u1" ]);
        renderQueue({ canCare: true });
        fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
        fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
        const select = screen.getByLabelText("Unidade de destino") as HTMLSelectElement;
        expect(select.value).toBe("");
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual([ "—", "UBS Centro", "UPA Norte" ]);
        expect(screen.queryByText(/Gera pedido de agendamento/)).toBeNull();
      });

      it("referência que não está entre as ativas é ignorada", async () => {
        withRefs([ "desativada" ]);
        renderQueue({ canCare: true });
        fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
        fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
        const select = screen.getByLabelText("Unidade de destino") as HTMLSelectElement;
        expect(select.value).toBe("");
        expect(Array.from(select.options).map((o) => o.textContent)).toEqual([ "—", "UBS Centro", "UPA Norte" ]);
      });
    });

    it("tem 'Chamar próximo' no topo e 'Chamar' em cada linha de Aguardando", async () => {
      renderQueue({ canCare: true });
      expect(await screen.findByRole("button", { name: "Chamar próximo" })).not.toBeNull();
      expect(await screen.findAllByRole("button", { name: "Chamar" })).toHaveLength(2);
    });

    it("'Chamar próximo' chama callNext e recarrega a fila", async () => {
      mocked(api.callNext).mockResolvedValue({ attendance: { id: "a1" } });
      renderQueue({ canCare: true });
      fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
      await waitFor(() => expect(api.callNext).toHaveBeenCalledWith("u1"));
    });

    it("'Chamar' numa linha chama callAttendance com o id da linha e a unidade", async () => {
      mocked(api.callAttendance).mockResolvedValue({ attendance: { id: "a1" } });
      renderQueue({ canCare: true });
      fireEvent.click((await screen.findAllByRole("button", { name: "Chamar" }))[0]);
      await waitFor(() => expect(api.callAttendance).toHaveBeenCalledWith("a1", "u1"));
    });

    it("'Encerrar' em Em atendimento abre o painel com o desfecho, nomeando o atendimento", async () => {
      renderQueue({ canCare: true });
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      expect(screen.getByText(/\*\*\*\.333\.444-\*\*.*triage-dor/)).not.toBeNull();
      const outcome = screen.getByLabelText("Desfecho") as HTMLSelectElement;
      const options = Array.from(outcome.options).map((o) => o.textContent);
      expect(options).toEqual([ "Atendido e liberado", "Encaminhado", "Retorno" ]);
    });

    it("'Encaminhado' oferece as unidades ativas, incluindo a própria, e uma descrição", async () => {
      renderQueue({ canCare: true });
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
      const select = screen.getByLabelText("Unidade de destino") as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([ "—", "UBS Centro", "UPA Norte" ]);
      expect(screen.getByLabelText("Descrição")).not.toBeNull();
    });

    it("'Encaminhado' sem destino e sem descrição fica desabilitado", async () => {
      renderQueue({ canCare: true });
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
      const confirm = screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement;
      expect(confirm.disabled).toBe(true);
      fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "encaminhado para avaliação" } });
      expect((screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement).disabled).toBe(false);
    });

    it("trocar de linha sem confirmar reseta as escolhas e troca o cabeçalho do painel", async () => {
      const secondInCare = {
        id: "a4", cpf_masked: "***.555.666-**", checked_in_at: "2026-09-25T08:30:00Z",
        protocol_name: "triage-febre", priority: 2, source: "triage" as const,
        appointment_time: null, called_at: "2026-09-25T12:15:00Z", called_by_name: "dr2@cidade.gov.br"
      };
      mocked(api.listUnitQueue).mockResolvedValue({ waiting, in_care: [ inCare[0], secondInCare ] });
      renderQueue({ canCare: true });

      const encerrarButtons = await screen.findAllByRole("button", { name: "Encerrar" });
      fireEvent.click(encerrarButtons[0]);
      expect(screen.getByText(/\*\*\*\.333\.444-\*\*.*triage-dor/)).not.toBeNull();
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
      fireEvent.change(screen.getByLabelText("Unidade de destino"), { target: { value: "u2" } });
      expect(screen.getByLabelText("Unidade de destino")).not.toBeNull();

      fireEvent.click(screen.getAllByRole("button", { name: "Encerrar" })[1]);
      expect(screen.getByText(/\*\*\*\.555\.666-\*\*.*triage-febre/)).not.toBeNull();
      expect((screen.getByLabelText("Desfecho") as HTMLSelectElement).value).toBe("discharged");
      expect(screen.queryByLabelText("Unidade de destino")).toBeNull();
      expect(screen.queryByText("Gera pedido de agendamento na UPA Norte")).toBeNull();
    });

    it("com unidade no encaminhamento, mostra 'Gera pedido de agendamento na unidade'", async () => {
      renderQueue({ canCare: true });
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
      expect(screen.queryByText(/Gera pedido de agendamento/)).toBeNull();
      fireEvent.change(screen.getByLabelText("Unidade de destino"), { target: { value: "u2" } });
      expect(screen.getByText("Gera pedido de agendamento na UPA Norte")).not.toBeNull();
    });

    it("'Retorno' oferece uma nota opcional e mostra 'Gera pedido de agendamento na própria unidade'", async () => {
      renderQueue({ canCare: true });
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "return" } });
      expect(screen.getByLabelText("Nota (opcional)")).not.toBeNull();
      expect(screen.getByText("Gera pedido de agendamento na UBS Centro")).not.toBeNull();
    });

    it("encerrar com pedido mostra a confirmação 'Pedido de agendamento criado na unidade'", async () => {
      mocked(api.closeAttendance).mockResolvedValue({
        attendance: { id: "a3" },
        appointmentRequest: { id: "r1", kind: "return", target_unit_name: "UBS Centro", status: "open" }
      });
      renderQueue({ canCare: true });
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "return" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
      await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a3", "return", undefined, undefined));
      expect(await screen.findByText("Pedido de agendamento criado na UBS Centro")).not.toBeNull();
    });

    it("encerrar com pedido invalida os Pedidos de qualquer unidade (prefixo unitRequests)", async () => {
      mocked(api.closeAttendance).mockResolvedValue({
        attendance: { id: "a3" },
        appointmentRequest: { id: "r1", kind: "return", target_unit_name: "UBS Centro", status: "open" }
      });
      const { client } = renderQueue({ canCare: true });
      // Semeia como se o painel Pedidos (desta unidade e de outra) já tivesse carregado.
      client.setQueryData([ "unitRequests", "u1" ], []);
      client.setQueryData([ "unitRequests", "u2" ], []);
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "return" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
      await waitFor(() => expect(client.getQueryState([ "unitRequests", "u1" ])?.isInvalidated).toBe(true));
      expect(client.getQueryState([ "unitRequests", "u2" ])?.isInvalidated).toBe(true);
    });

    it("encerrar sem pedido não invalida os Pedidos", async () => {
      mocked(api.closeAttendance).mockResolvedValue({ attendance: { id: "a3" }, appointmentRequest: null });
      const { client } = renderQueue({ canCare: true });
      client.setQueryData([ "unitRequests", "u1" ], []);
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
      await waitFor(() => expect(api.closeAttendance).toHaveBeenCalled());
      // o painel fecha no onDone — depois disso, nada mais invalida.
      await waitFor(() => expect(screen.queryByText("Encerrar atendimento")).toBeNull());
      expect(client.getQueryState([ "unitRequests", "u1" ])?.isInvalidated).toBe(false);
    });

    it("encerrar com 'Atendido e liberado' (sem pedido) não mostra confirmação de pedido", async () => {
      mocked(api.closeAttendance).mockResolvedValue({ attendance: { id: "a3" }, appointmentRequest: null });
      renderQueue({ canCare: true });
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
      await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a3", "discharged", undefined, undefined));
      expect(screen.queryByText(/Pedido de agendamento criado/)).toBeNull();
    });
  });

  describe("recepção (sem canCare)", () => {
    it("não mostra 'Chamar', 'Chamar próximo' nem 'Encerrar'", async () => {
      renderQueue({ canCare: false });
      await screen.findByText("Aguardando");
      expect(screen.queryByRole("button", { name: "Chamar próximo" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Chamar" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Encerrar" })).toBeNull();
    });

    it("em Aguardando, vê apenas 'Saiu sem atendimento'", async () => {
      renderQueue({ canCare: false });
      expect(await screen.findAllByRole("button", { name: "Saiu sem atendimento" })).toHaveLength(2);
    });
  });

  it("'Saiu sem atendimento' aparece para os dois papéis e encerra com 'left'", async () => {
    mocked(api.closeAttendance).mockResolvedValue({ attendance: { id: "a1" }, appointmentRequest: null });
    renderQueue({ canCare: true });
    fireEvent.click((await screen.findAllByRole("button", { name: "Saiu sem atendimento" }))[0]);
    await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a1", "left", undefined, undefined));
  });

  it("queue_empty em 'Chamar próximo' mostra 'Ninguém aguardando' sem erro parado", async () => {
    mocked(api.callNext).mockRejectedValue(new ApiError(404, { error: "queue_empty" }, "x"));
    mocked(api.listUnitQueue)
      .mockResolvedValueOnce({ waiting, in_care: inCare })
      .mockResolvedValueOnce({ waiting: [], in_care: inCare });
    renderQueue({ canCare: true });
    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
    expect(await screen.findByText("Ninguém aguardando")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("erro inesperado em 'Chamar próximo' mostra alerta (não fica em silêncio)", async () => {
    mocked(api.callNext).mockRejectedValue(new ApiError(403, { error: "forbidden" }, "x"));
    renderQueue({ canCare: true });
    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
    expect(await screen.findByText("seu papel não permite esta ação")).not.toBeNull();
  });

  it("erro inesperado em 'Chamar' mostra alerta (não fica em silêncio)", async () => {
    mocked(api.callAttendance).mockRejectedValue(new ApiError(422, { error: "wrong_unit" }, "x"));
    renderQueue({ canCare: true });
    fireEvent.click((await screen.findAllByRole("button", { name: "Chamar" }))[0]);
    expect(await screen.findByText("atendimento de outra unidade")).not.toBeNull();
  });

  it("careBlocked: esconde chamar e desfecho, mostra a mensagem, mantém 'Saiu sem atendimento'", async () => {
    renderQueue({ canCare: false, careBlocked: "Você não tem vínculo com esta unidade" });
    expect(await screen.findByText("Você não tem vínculo com esta unidade")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Chamar próximo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Chamar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Encerrar" })).toBeNull();
    expect(await screen.findAllByRole("button", { name: "Saiu sem atendimento" })).toHaveLength(2);
  });

  it("403 missing_link ao chamar: mensagem nomeada e avisa a tela para reler o vínculo", async () => {
    const onClinicalRefused = vi.fn();
    mocked(api.callNext).mockRejectedValue(new ApiError(403, { error: "missing_link" }, "x"));
    renderQueue({ canCare: true, onClinicalRefused });
    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
    expect(await screen.findByText("Você não tem vínculo com esta unidade")).toBeTruthy();
    expect(onClinicalRefused).toHaveBeenCalled();
  });

  it("403 missing_link com careBlocked já ativo: a mensagem não repete no alerta", async () => {
    const message = "Você não tem vínculo com esta unidade";
    const onClinicalRefused = vi.fn();
    mocked(api.callNext).mockRejectedValue(new ApiError(403, { error: "missing_link" }, "x"));
    renderQueue({ canCare: true, careBlocked: message, onClinicalRefused });
    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
    await waitFor(() => expect(onClinicalRefused).toHaveBeenCalled());
    expect(await screen.findAllByText(message)).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("403 missing_role ao chamar: além de onClinicalRefused, recarrega a sessão (o papel foi revogado)", async () => {
    const onClinicalRefused = vi.fn();
    mocked(api.callNext).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    renderQueue({ canCare: true, onClinicalRefused });
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
    await waitFor(() => expect(onClinicalRefused).toHaveBeenCalled());
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalledTimes(2));
  });

  it("already_called recarrega a fila sem erro parado, como already_closed hoje", async () => {
    mocked(api.callAttendance).mockRejectedValue(new ApiError(409, { error: "already_called" }, "x"));
    mocked(api.listUnitQueue)
      .mockResolvedValueOnce({ waiting, in_care: inCare })
      .mockResolvedValueOnce({ waiting: [ waiting[1] ], in_care: inCare });
    renderQueue({ canCare: true });
    fireEvent.click((await screen.findAllByRole("button", { name: "Chamar" }))[0]);
    await waitFor(() => expect(screen.queryByText("***.982.247-**")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
