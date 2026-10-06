import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listUnassignedRequests: vi.fn(), assignRequestUnit: vi.fn(), listActiveUnits: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { UnassignedRequests } from "./UnassignedRequests";
import { requestRow } from "../../test/schedulingFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ROW = requestRow({
  id: "r9", kind: "triage", origin: "triage", origin_unit_name: null, target_unit_id: null,
  priority: "priority", due_on: "2026-10-08"
});

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<UnassignedRequests />, { wrapper });
  return { client };
}

async function chooseAndConfirm(unitId: string, unitName: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Atribuir unidade" }));
  await screen.findByRole("option", { name: unitName });
  fireEvent.change(screen.getByLabelText("Unidade que vai marcar"), { target: { value: unitId } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar unidade" }));
}

describe("UnassignedRequests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked(api.listUnassignedRequests).mockResolvedValue([ ROW ]);
    mocked(api.listActiveUnits).mockResolvedValue([ { id: "u1", name: "UBS Centro", kind: "ubs" }, { id: "u2", name: "UBS Xaxim", kind: "ubs" } ]);
  });

  it("lista os pedidos sem unidade com pedido, atendimento, prazo e prioridade", async () => {
    renderIt();
    expect(await screen.findByText("Triagem")).not.toBeNull();
    expect(screen.getByText("Consulta médica")).not.toBeNull();
    expect(screen.getByText("até 08/10")).not.toBeNull();
    expect(screen.getByText("prioritária")).not.toBeNull();
  });

  it("atribuir manda a unidade, relê a fila e invalida os pedidos da unidade escolhida", async () => {
    mocked(api.assignRequestUnit).mockResolvedValue({ ...ROW, target_unit_id: "u2" });
    const { client } = renderIt();
    client.setQueryData([ "unitRequests", "u2" ], []);
    client.setQueryData([ "unitRequests", "u1" ], []);
    fireEvent.click(await screen.findByRole("button", { name: "Atribuir unidade" }));
    const confirm = screen.getByRole("button", { name: "Confirmar unidade" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await screen.findByRole("option", { name: "UBS Xaxim" });
    fireEvent.change(screen.getByLabelText("Unidade que vai marcar"), { target: { value: "u2" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar unidade" }));
    await waitFor(() => expect(api.assignRequestUnit).toHaveBeenCalledWith("r9", "u2"));
    await waitFor(() => expect(api.listUnassignedRequests).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Confirmar unidade" })).toBeNull();
    expect(client.getQueryState([ "unitRequests", "u2" ])?.isInvalidated).toBe(true);
    expect(client.getQueryState([ "unitRequests", "u1" ])?.isInvalidated).toBe(false);
  });

  it("409 already_assigned avisa, fecha e relê", async () => {
    mocked(api.assignRequestUnit).mockRejectedValue(new ApiError(409, { error: "already_assigned" }, "x"));
    renderIt();
    await chooseAndConfirm("u1", "UBS Centro");
    expect(await screen.findByText("este pedido já foi atribuído a uma unidade")).not.toBeNull();
    await waitFor(() => expect(api.listUnassignedRequests).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Confirmar unidade" })).toBeNull();
  });

  it("409 request_not_open avisa, fecha e relê", async () => {
    mocked(api.assignRequestUnit).mockRejectedValue(new ApiError(409, { error: "request_not_open" }, "x"));
    renderIt();
    await chooseAndConfirm("u1", "UBS Centro");
    expect(await screen.findByText("este pedido já foi encerrado")).not.toBeNull();
    await waitFor(() => expect(api.listUnassignedRequests).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: "Confirmar unidade" })).toBeNull();
  });

  it("422 invalid_unit mostra a frase traduzida e mantém o painel aberto", async () => {
    mocked(api.assignRequestUnit).mockRejectedValue(new ApiError(422, { error: "invalid_unit" }, "x"));
    renderIt();
    await chooseAndConfirm("u2", "UBS Xaxim");
    expect(await screen.findByText("unidade inválida ou desativada — escolha outra")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Confirmar unidade" })).not.toBeNull();
    expect(api.listUnassignedRequests).toHaveBeenCalledTimes(1);
  });

  it("fila vazia: estado vazio", async () => {
    mocked(api.listUnassignedRequests).mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText("nenhum pedido sem unidade")).not.toBeNull();
  });
});
