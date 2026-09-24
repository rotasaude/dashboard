import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listOpenAttendances: vi.fn(), closeAttendance: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { OpenAttendances } from "./OpenAttendances";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const otherUnit = { id: "u2", name: "UPA Norte", kind: "upa" };

const rows = [
  { id: "a1", cpf_masked: "***.982.247-**", checked_in_at: "2026-09-24T09:00:00Z", protocol_name: "triage-respiratoria", priority: 1 },
  { id: "a2", cpf_masked: "***.111.222-**", checked_in_at: "2026-09-24T09:10:00Z", protocol_name: "triage-dor", priority: 3 }
];

function renderOpen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<OpenAttendances unit={unit} units={[ unit, otherUnit ]} />, { wrapper });
}

describe("OpenAttendances", () => {
  beforeEach(() => {
    for (const fn of [ api.listOpenAttendances, api.closeAttendance ]) mocked(fn).mockReset();
    mocked(api.listOpenAttendances).mockResolvedValue(rows);
  });

  it("lista ordenada como veio da API", async () => {
    renderOpen();
    const cells = await screen.findAllByText(/^triage-/);
    expect(cells.map((c) => c.textContent)).toEqual([ "triage-respiratoria", "triage-dor" ]);
  });

  it("Encerrar com desfecho 'Atendido e liberado'", async () => {
    mocked(api.closeAttendance).mockResolvedValue({});
    renderOpen();
    fireEvent.click((await screen.findAllByRole("button", { name: "Encerrar" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a1", "discharged", undefined, undefined));
  });

  it("Encerrar com desfecho 'Saiu sem atendimento'", async () => {
    mocked(api.closeAttendance).mockResolvedValue({});
    renderOpen();
    fireEvent.click((await screen.findAllByRole("button", { name: "Encerrar" }))[0]);
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "left" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a1", "left", undefined, undefined));
  });

  it("Encerrar com desfecho 'Encaminhado' manda a unidade e a descrição", async () => {
    mocked(api.closeAttendance).mockResolvedValue({});
    renderOpen();
    fireEvent.click((await screen.findAllByRole("button", { name: "Encerrar" }))[0]);
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
    fireEvent.change(screen.getByLabelText("Unidade de destino"), { target: { value: "u2" } });
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "encaminhado para avaliação" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a1", "referred", "u2", "encaminhado para avaliação"));
  });

  it("'Encaminhado' sem destino e sem descrição fica desabilitado", async () => {
    renderOpen();
    fireEvent.click((await screen.findAllByRole("button", { name: "Encerrar" }))[0]);
    fireEvent.change(screen.getByLabelText("Desfecho"), { target: { value: "referred" } });
    const confirm = screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Descrição"), { target: { value: "algo" } });
    expect((screen.getByRole("button", { name: "Confirmar encerramento" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("already_closed recarrega a lista", async () => {
    mocked(api.closeAttendance).mockRejectedValue(new ApiError(409, { error: "already_closed" }, "x"));
    mocked(api.listOpenAttendances).mockResolvedValueOnce(rows).mockResolvedValueOnce([ rows[1] ]);
    renderOpen();
    fireEvent.click((await screen.findAllByRole("button", { name: "Encerrar" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    await waitFor(() => expect(screen.queryByText("triage-respiratoria")).toBeNull());
    expect(await screen.findByText("triage-dor")).not.toBeNull();
  });
});
