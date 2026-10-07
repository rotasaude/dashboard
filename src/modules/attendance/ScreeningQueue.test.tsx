import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listScreeningQueue: vi.fn(), startScreening: vi.fn(), getScreening: vi.fn(), listAppointmentTypes: vi.fn() };
});
// O formulário tem testes próprios: aqui ele só devolve o desfecho.
vi.mock("./ScreeningForm", () => ({
  ScreeningForm: (p: { screening: { id: string }; onDone(s: unknown): void; onClosed(m: string): void }) => (
    <div>
      <span>{`formulário ${p.screening.id}`}</span>
      <button type="button" onClick={() => p.onDone({ id: p.screening.id, destination: "same_day",
        current_revision: { final_color: "red" } })}>concluir no dia</button>
      <button type="button" onClick={() => p.onDone({ id: p.screening.id, destination: "schedule", current_revision: null })}>
        concluir agendando
      </button>
      <button type="button" onClick={() => p.onClosed("Escuta abandonada: o atendimento voltou para a fila do acolhimento.")}>
        fechar
      </button>
    </div>
  )
}));

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { ScreeningQueue } from "./ScreeningQueue";
import { NOW18, queueItem, screening } from "../../test/screeningFixtures";
import { TYPES } from "../../test/schedulingFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const spy = vi.spyOn(client, "invalidateQueries");
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<ScreeningQueue unit={unit} units={[ unit ]} />, { wrapper });
  return { spy };
}

describe("ScreeningQueue", () => {
  beforeEach(() => {
    for (const fn of [ api.listScreeningQueue, api.startScreening, api.getScreening, api.listAppointmentTypes ]) mocked(fn).mockReset();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW18));
    mocked(api.listAppointmentTypes).mockResolvedValue(TYPES);
    mocked(api.listScreeningQueue).mockResolvedValue([
      queueItem(),
      queueItem({ attendance_id: "a2", citizen: { id: "c2", cpf_masked: "***.111.222-**" }, checked_in_at: "2026-10-07T08:55:00-03:00",
        triage_priority: null, screening: { id: "sc9", status: "in_progress", started_by_name: "Téc. Rui Alves" } })
    ]);
  });

  it("lista por chegada com espera, sinal da triagem digital e situação", async () => {
    renderIt();
    expect(await screen.findByText("***.982.247-**")).not.toBeNull();
    expect(screen.getByText("40 min")).not.toBeNull();
    expect(screen.getByText("1 h 05 min")).not.toBeNull();
    expect(screen.getByText("prioridade 2")).not.toBeNull();
    expect(screen.getByText("em escuta com Téc. Rui Alves")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Retomar escuta" })).not.toBeNull();
  });

  it("iniciar abre o formulário; concluir no dia recarrega as duas filas e avisa", async () => {
    mocked(api.startScreening).mockResolvedValue(screening());
    const { spy } = renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar escuta" }));
    expect(await screen.findByText("formulário sc1")).not.toBeNull();
    expect(api.startScreening).toHaveBeenCalledWith("a1");
    fireEvent.click(screen.getByRole("button", { name: "concluir no dia" }));
    expect(await screen.findByText("Escuta concluída (vermelho): segue na fila do profissional.")).not.toBeNull();
    expect(spy).toHaveBeenCalledWith({ queryKey: [ "screeningQueue", "u1" ] });
    expect(spy).toHaveBeenCalledWith({ queryKey: [ "unitQueue", "u1" ] });
  });

  it("agendar também recarrega os pedidos da recepção", async () => {
    mocked(api.startScreening).mockResolvedValue(screening());
    const { spy } = renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar escuta" }));
    fireEvent.click(await screen.findByRole("button", { name: "concluir agendando" }));
    expect(await screen.findByText("Escuta concluída: pedido de agendamento criado e atendimento encerrado.")).not.toBeNull();
    expect(spy).toHaveBeenCalledWith({ queryKey: [ "unitRequests" ] });
  });

  it("retomar lê a escuta em andamento", async () => {
    mocked(api.getScreening).mockResolvedValue(screening({ id: "sc9", attendance_id: "a2" }));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Retomar escuta" }));
    expect(await screen.findByText("formulário sc9")).not.toBeNull();
    expect(api.getScreening).toHaveBeenCalledWith("sc9");
    expect(api.startScreening).not.toHaveBeenCalled();
  });

  it("already_screening recarrega a fila e avisa, sem abrir formulário", async () => {
    mocked(api.startScreening).mockRejectedValue(new ApiError(409, { error: "already_screening" }, "x"));
    const { spy } = renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar escuta" }));
    expect(await screen.findByText("outra pessoa já começou a escuta deste atendimento — a fila foi atualizada")).not.toBeNull();
    expect(spy).toHaveBeenCalledWith({ queryKey: [ "screeningQueue", "u1" ] });
    expect(screen.queryByText(/formulário/)).toBeNull();
  });

  it("fechar pelo formulário volta à fila com a frase", async () => {
    mocked(api.startScreening).mockResolvedValue(screening());
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar escuta" }));
    fireEvent.click(await screen.findByRole("button", { name: "fechar" }));
    expect(await screen.findByText("Escuta abandonada: o atendimento voltou para a fila do acolhimento.")).not.toBeNull();
    await waitFor(() => expect(screen.getByRole("button", { name: "Iniciar escuta" })).not.toBeNull());
  });

  it("leitura da fila negada (403 forbidden): só a frase, sem a fila", async () => {
    mocked(api.listScreeningQueue).mockRejectedValue(new ApiError(403, { error: "forbidden" }, "x"));
    renderIt();
    expect(await screen.findByText("seu papel não permite esta ação")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("button", { name: "Iniciar escuta" })).toBeNull();
  });

  it.each([
    [ "cbo_not_allowed", "sua ocupação (CBO) não faz acolhimento" ],
    [ "missing_link", "Você não tem vínculo com esta unidade" ]
  ])("iniciar com 403 %s mostra a frase, sem abrir formulário", async (code, phrase) => {
    mocked(api.startScreening).mockRejectedValue(new ApiError(403, { error: code }, "x"));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Iniciar escuta" }));
    expect(await screen.findByText(phrase)).not.toBeNull();
    expect(screen.queryByText(/formulário/)).toBeNull();
  });
});
