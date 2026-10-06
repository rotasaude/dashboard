import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, listUnitRequests: vi.fn(), scheduleRequest: vi.fn(), dismissRequest: vi.fn(), getRequest: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { Requests } from "./Requests";
import { expectFrozenNotice } from "../../test/frozenNotice";
import { appointmentView, requestRow } from "../../test/schedulingFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function renderRequests() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<Requests unit={unit} />, { wrapper });
}

const rows: api.RequestRow[] = [
  requestRow({ id: "r1" }),
  requestRow({ id: "r2", kind: "referral", origin_unit_name: "UPA Norte", cpf_masked: "***.111.222-**", note: null,
    reopened_reason: "expired", priority: "priority", due_on: "2026-10-01", overdue: true }),
  requestRow({ id: "r3", kind: "triage", origin: "triage", origin_unit_name: null, cpf_masked: "***.333.444-**", note: null,
    reopened_reason: "no_show", reschedule_requested: true, reschedule_reason_code: "work", preferred_period: "morning",
    reschedule_count: 1, needs_reschedule: true })
];

describe("Requests", () => {
  beforeEach(() => {
    for (const fn of [ api.listUnitRequests, api.scheduleRequest, api.dismissRequest, api.getRequest ]) mocked(fn).mockReset();
  });

  it("lista na ordem do api, com pedido, atendimento, prazo, prioridade, nota e marcas", async () => {
    mocked(api.listUnitRequests).mockResolvedValue(rows);
    renderRequests();
    const cpfs = (await screen.findAllByText(/\*\*\*\.\d{3}\.\d{3}-\*\*/)).map((n) => n.textContent);
    expect(cpfs).toEqual([ "***.982.247-**", "***.111.222-**", "***.333.444-**" ]);
    expect(screen.getByText("Retorno")).not.toBeNull();
    expect(screen.getByText("Encaminhado de UPA Norte")).not.toBeNull();
    expect(screen.getByText("Triagem")).not.toBeNull();
    expect(screen.getAllByText("Consulta médica")).toHaveLength(3);
    expect(screen.getByText("até 01/10")).not.toBeNull();
    expect(screen.getByText("prioritária")).not.toBeNull();
    expect(screen.getByText("controle de pressão")).not.toBeNull();
    expect(screen.getByText("atrasado")).not.toBeNull();
    expect(screen.getByText("sem confirmação")).not.toBeNull();
    expect(screen.getByText("pediu outro horário")).not.toBeNull();
    expect(screen.getByText("precisa remarcar")).not.toBeNull();
    expect(screen.getByText("faltou")).not.toBeNull();
  });

  it("nota do cidadão só no detalhe, com motivo, período e quantas vezes pediu", async () => {
    mocked(api.listUnitRequests).mockResolvedValue([ rows[2] ]);
    mocked(api.getRequest).mockResolvedValue({ ...rows[2], reschedule_note: "não consigo sair do trabalho de manhã" });
    renderRequests();
    await screen.findByText("***.333.444-**");
    expect(screen.queryByText("não consigo sair do trabalho de manhã")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Detalhes" }));
    await waitFor(() => expect(api.getRequest).toHaveBeenCalledWith("r3"));
    expect(await screen.findByText("não consigo sair do trabalho de manhã")).not.toBeNull();
    expect(screen.getByText("trabalho")).not.toBeNull();
    expect(screen.getByText("manhã")).not.toBeNull();
    expect(screen.getByText("1 vez")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Fechar detalhes" }));
    expect(screen.queryByText("não consigo sair do trabalho de manhã")).toBeNull();
  });

  it("nota longa do cidadão aparece inteira, fora do par rótulo/valor de uma linha", async () => {
    const longNote = "trabalho em turno até as 14h de segunda a sexta; ".repeat(4).trim();
    mocked(api.listUnitRequests).mockResolvedValue([ rows[2] ]);
    mocked(api.getRequest).mockResolvedValue({ ...rows[2], reschedule_note: longNote });
    renderRequests();
    await screen.findByText("***.333.444-**");
    fireEvent.click(screen.getByRole("button", { name: "Detalhes" }));
    const note = await screen.findByText(longNote);
    expect(note.textContent).toBe(longNote);
    expect(note.style.whiteSpace).toBe("pre-wrap");
    expect(note.style.textOverflow).toBe("");
  });

  it("detalhe de pedido que sumiu (404 not_found) pede para atualizar a fila", async () => {
    mocked(api.listUnitRequests).mockResolvedValue([ rows[0] ]);
    mocked(api.getRequest).mockRejectedValue(new ApiError(404, { error: "not_found" }, "x"));
    renderRequests();
    await screen.findByText("***.982.247-**");
    fireEvent.click(screen.getByRole("button", { name: "Detalhes" }));
    expect(await screen.findByText("pedido não encontrado — atualize a fila")).not.toBeNull();
  });

  // P5: pedido `scheduled` que precisa remarcar volta na fila com o horário
  // vivo; o api recusa encerrar (409 request_not_open), então a tela não oferece.
  it("pedido marcado que precisa remarcar não oferece Encerrar pedido", async () => {
    mocked(api.listUnitRequests).mockResolvedValue([
      requestRow({ id: "r4", cpf_masked: "***.555.666-**", needs_reschedule: true,
        appointment: appointmentView({ shift_cancelled: true }) })
    ]);
    renderRequests();
    await screen.findByText("***.555.666-**");
    expect(screen.getByText("precisa remarcar")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Encerrar pedido" })).toBeNull();
    expect(screen.getByRole("button", { name: "Detalhes" })).not.toBeNull();
  });

  it("Marcar horário: menos de 48h avisa que o horário nasce confirmado", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00-03:00"));
    mocked(api.listUnitRequests).mockResolvedValue([ rows[0] ]);
    mocked(api.scheduleRequest).mockResolvedValue({ id: "a1", scheduled_at: "x", status: "scheduled", confirmation_deadline_at: "y" });
    renderRequests();
    await screen.findByText("***.982.247-**");
    fireEvent.click(screen.getByRole("button", { name: "Marcar horário" }));
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "2026-09-26T09:00" } });
    expect(await screen.findByText("O horário nasce confirmado")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar horário" }));
    await waitFor(() => expect(api.scheduleRequest).toHaveBeenCalledWith(
      "r1", "2026-09-26T12:00:00.000Z", "u1"
    ));
    await waitFor(() => expect(api.listUnitRequests).toHaveBeenCalledTimes(2));
  });

  it("Marcar horário: 48h ou mais avisa o prazo de confirmação (horário menos 24h)", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00-03:00"));
    mocked(api.listUnitRequests).mockResolvedValue([ rows[0] ]);
    renderRequests();
    await screen.findByText("***.982.247-**");
    fireEvent.click(screen.getByRole("button", { name: "Marcar horário" }));
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "2026-10-02T14:30" } });
    expect(await screen.findByText("O cidadão precisa confirmar até 01/10 14:30")).not.toBeNull();
  });

  it("Marcar horário ocupado: avisa quantos já estão no horário e 'Marcar mesmo assim' envia o encaixe", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00-03:00"));
    mocked(api.listUnitRequests).mockResolvedValue([ rows[0] ]);
    mocked(api.scheduleRequest)
      .mockRejectedValueOnce(new ApiError(409, { error: "slot_taken", taken: 2 }, "x"))
      .mockResolvedValueOnce({ id: "a1", scheduled_at: "x", status: "scheduled", confirmation_deadline_at: "y" });
    renderRequests();
    await screen.findByText("***.982.247-**");
    fireEvent.click(screen.getByRole("button", { name: "Marcar horário" }));
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "2026-10-02T14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar horário" }));
    expect(await screen.findByText(
      "Já há 2 horários marcados na UBS Centro nesse horário. Marcar mesmo assim é um encaixe."
    )).not.toBeNull();
    expect(api.listUnitRequests).toHaveBeenCalledTimes(1); // o painel continua aberto

    fireEvent.click(screen.getByRole("button", { name: "Marcar mesmo assim" }));
    await waitFor(() => expect(api.scheduleRequest).toHaveBeenLastCalledWith(
      "r1", "2026-10-02T17:30:00.000Z", "u1", { allowOverlap: true }
    ));
    await waitFor(() => expect(api.listUnitRequests).toHaveBeenCalledTimes(2));
    vi.useRealTimers();
  });

  it("Marcar horário ocupado: trocar o horário tira o aviso de encaixe", async () => {
    mocked(api.listUnitRequests).mockResolvedValue([ rows[0] ]);
    mocked(api.scheduleRequest).mockRejectedValueOnce(new ApiError(409, { error: "slot_taken", taken: 1 }, "x"));
    renderRequests();
    await screen.findByText("***.982.247-**");
    fireEvent.click(screen.getByRole("button", { name: "Marcar horário" }));
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "2030-10-02T14:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar horário" }));
    expect(await screen.findByText(
      "Já há 1 horário marcado na UBS Centro nesse horário. Marcar mesmo assim é um encaixe."
    )).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "2030-10-02T15:00" } });
    expect(screen.queryByRole("button", { name: "Marcar mesmo assim" })).toBeNull();
  });

  it("Encerrar pedido exige justificativa de 10+ caracteres, e request_not_open recarrega a lista", async () => {
    mocked(api.listUnitRequests).mockResolvedValue([ rows[0] ]);
    mocked(api.dismissRequest).mockRejectedValue(new ApiError(409, { error: "request_not_open" }, "x"));
    renderRequests();
    await screen.findByText("***.982.247-**");
    fireEvent.click(screen.getByRole("button", { name: "Encerrar pedido" }));
    const confirm = screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    expectFrozenNotice(screen.getByLabelText("Justificativa"));
    fireEvent.change(screen.getByLabelText("Justificativa"), { target: { value: "curto" } });
    expect((screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Justificativa"), { target: { value: "cidadão desistiu do retorno" } });
    expect((screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    await waitFor(() => expect(api.dismissRequest).toHaveBeenCalledWith("r1", "cidadão desistiu do retorno", "u1"));
    await waitFor(() => expect(api.listUnitRequests).toHaveBeenCalledTimes(2));
  });
});
