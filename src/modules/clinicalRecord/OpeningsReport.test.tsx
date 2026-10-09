// src/modules/clinicalRecord/OpeningsReport.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, listOpenings: vi.fn(), listMemberships: vi.fn() };
});

import * as api from "../../lib/api";
import { OpeningsReport } from "./OpeningsReport";
import { TODAY19, openingRow, adminReadRow } from "../../test/consultationFixtures";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const member = (id: string, email: string, role = "health_professional") =>
  ({ id: `m-${id}-${role}`, user: { id, email_address: email }, role, granted_at: "2026-09-01T00:00:00Z" });

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><OpeningsReport today={TODAY19} /></QueryClientProvider>);
}

describe("OpeningsReport", () => {
  beforeEach(() => {
    m(api.listOpenings).mockReset();
    m(api.listMemberships).mockReset();
    m(api.listOpenings).mockResolvedValue([ openingRow() ]);
    m(api.listMemberships).mockResolvedValue([
      member("us9", "lucia@curitiba.demo"), member("us9", "lucia@curitiba.demo", "citizen_verifier"), member("us2", "helena@curitiba.demo")
    ]);
  });

  it("lista os últimos 30 dias: quem, quando, CPF mascarado e motivo", async () => {
    renderIt();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Enf. Lúcia Prado")).not.toBeNull();
    expect(within(table).getByText("***.982.247-**")).not.toBeNull();
    expect(within(table).getByText("Revisão de caso")).not.toBeNull();
    expect(within(table).getByText("06/10/2026, 15:10")).not.toBeNull();
    expect(api.listOpenings).toHaveBeenCalledWith({ from: "2026-09-07", to: "2026-10-07", userId: "" });
  });

  it("filtra por profissional (cada pessoa uma vez) e período", async () => {
    renderIt();
    await screen.findByRole("table");
    const select = screen.getByLabelText("Profissional") as HTMLSelectElement;
    await waitFor(() => expect(select.options).toHaveLength(3));
    fireEvent.change(select, { target: { value: "us9" } });
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    await waitFor(() => expect(api.listOpenings).toHaveBeenLastCalledWith({ from: "2026-10-01", to: "2026-10-07", userId: "us9" }));
  });

  it("período invertido não busca", async () => {
    renderIt();
    await screen.findByRole("table");
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-08" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar" }));
    expect(screen.getByRole("alert").textContent).toBe("a data inicial precisa ser igual ou anterior à final");
    expect(api.listOpenings).toHaveBeenCalledTimes(1);
  });

  it("sem aberturas no período", async () => {
    m(api.listOpenings).mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText("nenhuma abertura no período")).not.toBeNull();
  });

  it("mostra o tipo e traço no motivo e na validade da leitura administrativa", async () => {
    m(api.listOpenings).mockResolvedValue([ openingRow(), adminReadRow() ]);
    renderIt();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("abertura justificada")).not.toBeNull();
    expect(within(table).getByText("leitura administrativa")).not.toBeNull();
    const row = within(table).getByText("Admin Curitiba").closest("[role=row]") ?? within(table).getByText("Admin Curitiba").parentElement!;
    expect(within(row as HTMLElement).getAllByText("—")).toHaveLength(2);
  });

  it("ids iguais de tipos diferentes não colidem", async () => {
    m(api.listOpenings).mockResolvedValue([ openingRow({ id: "x" }), adminReadRow({ id: "x" }) ]);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    renderIt();
    await screen.findByRole("table");
    expect(spy.mock.calls.filter((c) => String(c[0]).includes("same key"))).toHaveLength(0);
    spy.mockRestore();
  });

  const many = (n: number) => Array.from({ length: n }, (_, i) => openingRow({ id: `o${i}` }));

  it("avisa quando chega a 500 linhas", async () => {
    m(api.listOpenings).mockResolvedValue(many(500));
    renderIt();
    await screen.findByRole("table");
    expect(screen.getByRole("status").textContent).toBe("mostrando as 500 mais recentes; refine o período");
  });

  it("não avisa com 499 linhas", async () => {
    m(api.listOpenings).mockResolvedValue(many(499));
    renderIt();
    await screen.findByRole("table");
    expect(screen.queryByRole("status")).toBeNull();
  });
});
