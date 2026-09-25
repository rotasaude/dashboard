import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listUnitAgenda: vi.fn() };
});

import * as api from "../../lib/api";
import { Agenda } from "./Agenda";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function renderAgenda() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<Agenda unit={unit} />, { wrapper });
}

describe("Agenda", () => {
  beforeEach(() => { mocked(api.listUnitAgenda).mockReset(); });

  it("mostra hora, CPF mascarado, tipo e estado dos horários de hoje", async () => {
    mocked(api.listUnitAgenda).mockResolvedValue([
      { id: "a1", scheduled_at: "2026-09-25T13:00:00Z", cpf_masked: "***.982.247-**", kind: "return", status: "scheduled" },
      { id: "a2", scheduled_at: "2026-09-25T14:00:00Z", cpf_masked: "***.111.222-**", kind: "referral", status: "confirmed" },
      { id: "a3", scheduled_at: "2026-09-25T15:00:00Z", cpf_masked: "***.333.444-**", kind: "return", status: "checked_in" },
      { id: "a4", scheduled_at: "2026-09-25T16:00:00Z", cpf_masked: "***.555.666-**", kind: "return", status: "no_show" }
    ]);
    renderAgenda();
    expect(await screen.findByText("***.982.247-**")).not.toBeNull();
    expect(screen.getByText("***.111.222-**")).not.toBeNull();
    expect(screen.getAllByText("Retorno").length).toBe(3);
    expect(screen.getByText("Encaminhamento")).not.toBeNull();
    expect(screen.getByText("aguardando confirmação")).not.toBeNull();
    expect(screen.getByText("confirmado")).not.toBeNull();
    expect(screen.getByText("check-in feito")).not.toBeNull();
    expect(screen.getByText("faltou")).not.toBeNull();
  });

  it("tem um seletor de data com hoje como padrão, e troca recarrega a agenda", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-09-25T10:00:00-03:00"));
    mocked(api.listUnitAgenda).mockResolvedValue([]);
    renderAgenda();
    await waitFor(() => expect(api.listUnitAgenda).toHaveBeenCalledWith("u1", "2026-09-25"));
    const input = screen.getByLabelText("Data") as HTMLInputElement;
    expect(input.value).toBe("2026-09-25");
    fireEvent.change(input, { target: { value: "2026-09-26" } });
    await waitFor(() => expect(api.listUnitAgenda).toHaveBeenCalledWith("u1", "2026-09-26"));
  });
});
