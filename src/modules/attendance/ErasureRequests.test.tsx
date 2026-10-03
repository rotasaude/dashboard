import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...real, fetchCurrentSession: vi.fn(), stepUpMfa: vi.fn(),
    listPendingErasures: vi.fn(), confirmErasure: vi.fn(), rejectErasure: vi.fn()
  };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { ErasureRequests } from "./ErasureRequests";
import { expectFrozenNotice } from "../../test/frozenNotice";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const row: api.PendingErasure = {
  id: "e1", created_at: "2026-10-01T10:00:00Z", requested_by: "atendente@cidade.gov.br", pairs: 2, phone_masked: "(41) *****-1234"
};

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<ErasureRequests onGoToSecurity={vi.fn()} />, { wrapper });
}

describe("ErasureRequests", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.stepUpMfa, api.listPendingErasures, api.confirmErasure, api.rejectErasure ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue({
      id: "u1", email_address: "admin@cidade.gov.br", operator: false, memberships: [],
      mfa_enrolled: true, mfa_verified_at: new Date().toISOString()
    });
    m(api.listPendingErasures).mockResolvedValue({ requests: [ row ] });
  });

  it("lista data, quem pediu, nº de cadastros e celular mascarado", async () => {
    renderIt();
    expect(await screen.findByText("atendente@cidade.gov.br")).not.toBeNull();
    expect(screen.getByText("(41) *****-1234")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
  });

  it("confirmar: pede confirmação, roda pelo step-up, mostra o resultado e recarrega", async () => {
    m(api.confirmErasure).mockResolvedValue({ request: { id: "e1", status: "confirmed", created_at: row.created_at } });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar exclusão" }));
    expect(screen.getByText(/A exclusão é irreversível/)).not.toBeNull();
    m(api.listPendingErasures).mockResolvedValue({ requests: [] });
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Cadastro excluído.")).not.toBeNull();
    expect(api.confirmErasure).toHaveBeenCalledWith("e1");
    await waitFor(() => expect(api.listPendingErasures).toHaveBeenCalledTimes(2));
  });

  it("confirmar retido: mostra a retenção", async () => {
    m(api.confirmErasure).mockResolvedValue({ request: { id: "e1", status: "retained", created_at: row.created_at } });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar exclusão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Cadastro retido por base legal: há registro de atendimento. Nada foi apagado.")).not.toBeNull();
  });

  it.each([
    [ 403, "own_request", "Quem registrou o pedido não pode confirmá-lo." ],
    [ 409, "try_again", "Outra operação estava em andamento. Tente de novo." ]
  ])("confirmar %i %s", async (status, error, text) => {
    m(api.confirmErasure).mockRejectedValue(new ApiError(status, { error }, String(status)));
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar exclusão" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    expect((await screen.findByRole("alert")).textContent).toBe(text);
  });

  it("recusar exige motivo de 10+ caracteres", async () => {
    m(api.rejectErasure).mockResolvedValue({ request: { id: "e1", status: "rejected", created_at: row.created_at } });
    renderIt();
    fireEvent.click(await screen.findByRole("button", { name: "Recusar" }));
    const confirm = screen.getByRole("button", { name: "Confirmar recusa" }) as HTMLButtonElement;
    expectFrozenNotice(screen.getByLabelText("Motivo"));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "curto" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento não confere" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(api.rejectErasure).toHaveBeenCalledWith("e1", "documento não confere"));
  });
});
