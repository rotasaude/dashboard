import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, listUnitRequests: vi.fn(), scheduleRequest: vi.fn(), dismissRequest: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { Requests } from "./Requests";

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
  {
    id: "r1", kind: "return", origin_unit_name: "UBS Centro", created_at: "2026-09-24T10:00:00Z",
    cpf_masked: "***.982.247-**", priority: 2, note: "controle de pressão", reopened_reason: null
  },
  {
    id: "r2", kind: "referral", origin_unit_name: "UPA Norte", created_at: "2026-09-23T09:00:00Z",
    cpf_masked: "***.111.222-**", priority: 1, note: null, reopened_reason: "expired"
  },
  {
    id: "r3", kind: "return", origin_unit_name: "UBS Centro", created_at: "2026-09-22T09:00:00Z",
    cpf_masked: "***.333.444-**", priority: null, note: null, reopened_reason: "no_show"
  }
];

describe("Requests", () => {
  beforeEach(() => {
    for (const fn of [ api.listUnitRequests, api.scheduleRequest, api.dismissRequest ]) mocked(fn).mockReset();
  });

  it("lista os pedidos com tipo, data, CPF, prioridade, nota e a marca", async () => {
    mocked(api.listUnitRequests).mockResolvedValue(rows);
    renderRequests();
    expect((await screen.findAllByText("Retorno")).length).toBe(2);
    expect(screen.getByText("Encaminhado de UPA Norte")).not.toBeNull();
    expect(screen.getByText("***.982.247-**")).not.toBeNull();
    expect(screen.getByText("controle de pressão")).not.toBeNull();
    expect(screen.getByText("novo")).not.toBeNull();
    expect(screen.getByText("sem confirmação")).not.toBeNull();
    expect(screen.getByText("faltou")).not.toBeNull();
  });

  it("Marcar horário: menos de 48h avisa que o horário nasce confirmado", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00-03:00"));
    mocked(api.listUnitRequests).mockResolvedValue([ rows[0] ]);
    mocked(api.scheduleRequest).mockResolvedValue({ id: "a1", scheduled_at: "x", status: "scheduled", confirmation_deadline_at: "y" });
    renderRequests();
    await screen.findByText("Retorno");
    fireEvent.click(screen.getByRole("button", { name: "Marcar horário" }));
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "2026-09-26T09:00" } });
    expect(await screen.findByText("O horário nasce confirmado")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar horário" }));
    await waitFor(() => expect(api.scheduleRequest).toHaveBeenCalledWith(
      "r1", new Date("2026-09-26T09:00").toISOString(), "u1"
    ));
    await waitFor(() => expect(api.listUnitRequests).toHaveBeenCalledTimes(2));
  });

  it("Marcar horário: 48h ou mais avisa o prazo de confirmação (horário menos 24h)", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00-03:00"));
    mocked(api.listUnitRequests).mockResolvedValue([ rows[0] ]);
    renderRequests();
    await screen.findByText("Retorno");
    fireEvent.click(screen.getByRole("button", { name: "Marcar horário" }));
    fireEvent.change(screen.getByLabelText("Horário"), { target: { value: "2026-10-02T14:30" } });
    expect(await screen.findByText("O cidadão precisa confirmar até 01/10 14:30")).not.toBeNull();
  });

  it("Encerrar pedido exige justificativa de 10+ caracteres, e request_not_open recarrega a lista", async () => {
    mocked(api.listUnitRequests).mockResolvedValue([ rows[0] ]);
    mocked(api.dismissRequest).mockRejectedValue(new ApiError(409, { error: "request_not_open" }, "x"));
    renderRequests();
    await screen.findByText("Retorno");
    fireEvent.click(screen.getByRole("button", { name: "Encerrar pedido" }));
    const confirm = screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Justificativa"), { target: { value: "curto" } });
    expect((screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Justificativa"), { target: { value: "cidadão desistiu do retorno" } });
    expect((screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    await waitFor(() => expect(api.dismissRequest).toHaveBeenCalledWith("r1", "cidadão desistiu do retorno", "u1"));
    await waitFor(() => expect(api.listUnitRequests).toHaveBeenCalledTimes(2));
  });
});
