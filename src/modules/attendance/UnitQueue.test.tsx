import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, listUnitQueue: vi.fn(), callAttendance: vi.fn(), callNext: vi.fn(), closeAttendance: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { fmtTime } from "../../lib/format";
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

function renderQueue(canCare: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<UnitQueue unit={unit} units={[ unit, otherUnit ]} canCare={canCare} />, { wrapper });
}

describe("UnitQueue", () => {
  beforeEach(() => {
    for (const fn of [ api.listUnitQueue, api.callAttendance, api.callNext, api.closeAttendance ]) mocked(fn).mockReset();
    mocked(api.listUnitQueue).mockResolvedValue({ waiting, in_care: inCare });
  });

  it("mostra Aguardando e Em atendimento na ordem da API, com prioridade, origem e chamada", async () => {
    renderQueue(true);

    expect(await screen.findByText("Aguardando")).not.toBeNull();
    expect(screen.getByText("Em atendimento")).not.toBeNull();

    const cpfCells = await screen.findAllByText(/\*\*\*\.\d{3}\.\d{3}-\*\*/);
    expect(cpfCells.map((c) => c.textContent)).toEqual([
      "***.982.247-**", "***.111.222-**", "***.333.444-**"
    ]);

    expect(screen.getByText("1")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
    expect(screen.getByText("3")).not.toBeNull();

    expect(screen.getByText(`Agendamento ${fmtTime(waiting[1].appointment_time)}`)).not.toBeNull();
    expect(screen.getByText(new RegExp(`chamado por dr@cidade\\.gov\\.br às ${fmtTime(inCare[0].called_at)}`)))
      .not.toBeNull();
  });

  describe("profissional (canCare)", () => {
    it("tem 'Chamar próximo' no topo e 'Chamar' em cada linha de Aguardando", async () => {
      renderQueue(true);
      expect(await screen.findByRole("button", { name: "Chamar próximo" })).not.toBeNull();
      expect(await screen.findAllByRole("button", { name: "Chamar" })).toHaveLength(2);
    });

    it("'Chamar próximo' chama callNext e recarrega a fila", async () => {
      mocked(api.callNext).mockResolvedValue({ attendance: { id: "a1" } });
      renderQueue(true);
      fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
      await waitFor(() => expect(api.callNext).toHaveBeenCalledWith("u1"));
    });

    it("'Chamar' numa linha chama callAttendance com o id da linha e a unidade", async () => {
      mocked(api.callAttendance).mockResolvedValue({ attendance: { id: "a1" } });
      renderQueue(true);
      fireEvent.click((await screen.findAllByRole("button", { name: "Chamar" }))[0]);
      await waitFor(() => expect(api.callAttendance).toHaveBeenCalledWith("a1", "u1"));
    });

    it("'Encerrar' em Em atendimento abre o painel com o desfecho, nomeando o atendimento", async () => {
      renderQueue(true);
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      expect(screen.getByText(/\*\*\*\.333\.444-\*\*.*triage-dor/)).not.toBeNull();
      const outcome = screen.getByLabelText("Desfecho") as HTMLSelectElement;
      const options = Array.from(outcome.options).map((o) => o.textContent);
      expect(options).toEqual([ "Atendido e liberado", "Encaminhado", "Retorno" ]);
    });

    it("'Encaminhado' oferece as unidades ativas, incluindo a própria, e uma descrição", async () => {
      renderQueue(true);
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
      const select = screen.getByLabelText("Unidade de destino") as HTMLSelectElement;
      expect(Array.from(select.options).map((o) => o.textContent)).toEqual([ "—", "UBS Centro", "UPA Norte" ]);
      expect(screen.getByLabelText("Descrição")).not.toBeNull();
    });

    it("'Encaminhado' sem destino e sem descrição fica desabilitado", async () => {
      renderQueue(true);
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
      renderQueue(true);

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
      renderQueue(true);
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
      expect(screen.queryByText(/Gera pedido de agendamento/)).toBeNull();
      fireEvent.change(screen.getByLabelText("Unidade de destino"), { target: { value: "u2" } });
      expect(screen.getByText("Gera pedido de agendamento na UPA Norte")).not.toBeNull();
    });

    it("'Retorno' oferece uma nota opcional e mostra 'Gera pedido de agendamento na própria unidade'", async () => {
      renderQueue(true);
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
      renderQueue(true);
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "return" } });
      fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
      await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a3", "return", undefined, undefined));
      expect(await screen.findByText("Pedido de agendamento criado na UBS Centro")).not.toBeNull();
    });

    it("encerrar com 'Atendido e liberado' (sem pedido) não mostra confirmação de pedido", async () => {
      mocked(api.closeAttendance).mockResolvedValue({ attendance: { id: "a3" }, appointmentRequest: null });
      renderQueue(true);
      fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
      fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
      await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a3", "discharged", undefined, undefined));
      expect(screen.queryByText(/Pedido de agendamento criado/)).toBeNull();
    });
  });

  describe("recepção (sem canCare)", () => {
    it("não mostra 'Chamar', 'Chamar próximo' nem 'Encerrar'", async () => {
      renderQueue(false);
      await screen.findByText("Aguardando");
      expect(screen.queryByRole("button", { name: "Chamar próximo" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Chamar" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Encerrar" })).toBeNull();
    });

    it("em Aguardando, vê apenas 'Saiu sem atendimento'", async () => {
      renderQueue(false);
      expect(await screen.findAllByRole("button", { name: "Saiu sem atendimento" })).toHaveLength(2);
    });
  });

  it("'Saiu sem atendimento' aparece para os dois papéis e encerra com 'left'", async () => {
    mocked(api.closeAttendance).mockResolvedValue({ attendance: { id: "a1" }, appointmentRequest: null });
    renderQueue(true);
    fireEvent.click((await screen.findAllByRole("button", { name: "Saiu sem atendimento" }))[0]);
    await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a1", "left", undefined, undefined));
  });

  it("queue_empty em 'Chamar próximo' mostra 'Ninguém aguardando' sem erro parado", async () => {
    mocked(api.callNext).mockRejectedValue(new ApiError(404, { error: "queue_empty" }, "x"));
    mocked(api.listUnitQueue)
      .mockResolvedValueOnce({ waiting, in_care: inCare })
      .mockResolvedValueOnce({ waiting: [], in_care: inCare });
    renderQueue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
    expect(await screen.findByText("Ninguém aguardando")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("erro inesperado em 'Chamar próximo' mostra alerta (não fica em silêncio)", async () => {
    mocked(api.callNext).mockRejectedValue(new ApiError(403, { error: "forbidden" }, "x"));
    renderQueue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
    expect(await screen.findByText("seu papel não permite esta ação")).not.toBeNull();
  });

  it("erro inesperado em 'Chamar' mostra alerta (não fica em silêncio)", async () => {
    mocked(api.callAttendance).mockRejectedValue(new ApiError(422, { error: "wrong_unit" }, "x"));
    renderQueue(true);
    fireEvent.click((await screen.findAllByRole("button", { name: "Chamar" }))[0]);
    expect(await screen.findByText("atendimento de outra unidade")).not.toBeNull();
  });

  it("already_called recarrega a fila sem erro parado, como already_closed hoje", async () => {
    mocked(api.callAttendance).mockRejectedValue(new ApiError(409, { error: "already_called" }, "x"));
    mocked(api.listUnitQueue)
      .mockResolvedValueOnce({ waiting, in_care: inCare })
      .mockResolvedValueOnce({ waiting: [ waiting[1] ], in_care: inCare });
    renderQueue(true);
    fireEvent.click((await screen.findAllByRole("button", { name: "Chamar" }))[0]);
    await waitFor(() => expect(screen.queryByText("***.982.247-**")).toBeNull());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
