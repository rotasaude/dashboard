// src/modules/attendance/UnitDeclarations.test.tsx
// api#59: as declarações do dia na unidade (recepção), recolhidas por padrão.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listUnitDeclarations: vi.fn(), fetchDocumentPdf: vi.fn(), cancelDocument: vi.fn() };
});

import * as api from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { UnitDeclarations } from "./UnitDeclarations";
import { NOW19C, declRow, docUser } from "../../test/documentFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(() => { cleanup(); vi.useRealTimers(); });

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<UnitDeclarations unitId="u1" />, { wrapper });
}

describe("UnitDeclarations (api#59)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW19C));
    for (const fn of [ api.fetchCurrentSession, api.listUnitDeclarations, api.fetchDocumentPdf, api.cancelDocument ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "citizen_verifier" ], { id: "us5", email_address: "recepcao@curitiba.demo" }));
  });

  it("começa recolhida e só busca ao abrir", async () => {
    mocked(api.listUnitDeclarations).mockResolvedValue([ declRow() ]);
    renderIt();
    const details = screen.getByText("Declarações de hoje").closest("details") as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(api.listUnitDeclarations).not.toHaveBeenCalled();
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(api.listUnitDeclarations).toHaveBeenCalledWith("u1", "2026-10-09"));
    const item = (await screen.findAllByRole("listitem"))[0];
    expect(item.textContent).toContain("Joana Lima");
    expect(item.textContent).toContain("09:40 · Marta Recepção · emitida");
    expect(within(item).getByRole("button", { name: "Reimprimir" })).not.toBeNull();
    expect(within(item).getByRole("button", { name: "Cancelar" })).not.toBeNull();
  });

  it("lista vazia diz que não houve declaração hoje", async () => {
    mocked(api.listUnitDeclarations).mockResolvedValue([]);
    renderIt();
    const details = screen.getByText("Declarações de hoje").closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    expect(await screen.findByText("nenhuma declaração emitida hoje nesta unidade")).not.toBeNull();
  });

  it("profissional (sem recepção) só tem os botões nas declarações que emitiu", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(docUser([ "health_professional" ], { id: "us1" }));
    mocked(api.listUnitDeclarations).mockResolvedValue([
      declRow({ id: "doc3", author: { id: "us7", name: "Marta Recepção" } }),
      declRow({ id: "doc4", author: { id: "us1", name: "Dra. Helena" } })
    ]);
    renderIt();
    const details = screen.getByText("Declarações de hoje").closest("details") as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    const [ colleague, mine ] = screen.getAllByRole("listitem");
    expect(within(colleague).queryByRole("button")).toBeNull();
    expect(within(mine).getByRole("button", { name: "Cancelar" })).not.toBeNull();
  });
});
