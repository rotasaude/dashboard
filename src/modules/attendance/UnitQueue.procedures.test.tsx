// src/modules/attendance/UnitQueue.procedures.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listUnitQueue: vi.fn(), listProcedures: vi.fn() };
});

import * as api from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { UnitQueue } from "./UnitQueue";
import { UBS, UPA, billingUser, procedure } from "../../test/billingFixtures";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const inCare = [ {
  id: "a3", cpf_masked: "***.333.444-**", checked_in_at: "2026-10-21T08:00:00-03:00", protocol_name: "triage-dor", priority: 3,
  source: "triage" as const, appointment_time: null, called_at: "2026-10-21T09:00:00-03:00", called_by_name: "Dra. Helena Prado"
} ];

function renderQueue(unit: api.HealthUnit, props: { canCare: boolean; clinicalRecord?: boolean; procedureBilling?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<UnitQueue unit={unit} units={[ unit ]} {...props} />, { wrapper });
}

describe("UnitQueue — procedimentos (módulo 22)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listUnitQueue, api.listProcedures ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue(billingUser([ "health_professional" ], { id: "us1" }));
    m(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: inCare });
    m(api.listProcedures).mockResolvedValue({ procedures: [ procedure() ], next_before: null });
  });

  it("UPA, modo integrado: Procedimentos no atendimento chamado abre o painel do atendimento", async () => {
    renderQueue(UPA, { canCare: true, procedureBilling: true });
    fireEvent.click(await screen.findByRole("button", { name: "Procedimentos" }));
    expect(screen.getByRole("region", { name: "Procedimentos realizados" })).not.toBeNull();
    expect(await screen.findByText("faturável · BPA-I")).not.toBeNull();
    expect(api.listProcedures).toHaveBeenCalledWith({ attendanceId: "a3" });
    fireEvent.click(screen.getByRole("button", { name: "Fechar procedimentos" }));
    expect(screen.queryByRole("region", { name: "Procedimentos realizados" })).toBeNull();
  });

  it("UBS: sem o botão (a produção da APS vai pelo e-SUS)", async () => {
    renderQueue(UBS, { canCare: true, procedureBilling: true });
    await screen.findByText("***.333.444-**");
    expect(screen.queryByRole("button", { name: "Procedimentos" })).toBeNull();
  });

  it("sem o interruptor, sem papel clínico ou com o prontuário (o painel fica na consulta): sem o botão", async () => {
    renderQueue(UPA, { canCare: true });
    await screen.findByText("***.333.444-**");
    expect(screen.queryByRole("button", { name: "Procedimentos" })).toBeNull();
    cleanup();
    renderQueue(UPA, { canCare: false, procedureBilling: true });
    await screen.findByText("***.333.444-**");
    expect(screen.queryByRole("button", { name: "Procedimentos" })).toBeNull();
    cleanup();
    renderQueue(UPA, { canCare: true, procedureBilling: true, clinicalRecord: true });
    expect(await screen.findByRole("button", { name: "Consulta" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Procedimentos" })).toBeNull();
    expect(api.listProcedures).not.toHaveBeenCalled();
  });
});
