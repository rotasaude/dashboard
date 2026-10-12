// src/modules/attendance/UnitQueue.timeline.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listUnitQueue: vi.fn(), getTimeline: vi.fn() };
});

import * as api from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { UnitQueue } from "./UnitQueue";
import { PARTIAL_NOTICE } from "../../lib/timeline";
import { page } from "../../test/timelineFixtures";

afterEach(cleanup);
const m = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const inCare = [ {
  id: "a3", cpf_masked: "***.333.444-**", checked_in_at: "2026-09-25T08:00:00Z", protocol_name: "triage-dor", priority: 3,
  source: "triage" as const, appointment_time: null, called_at: "2026-09-25T12:00:00Z", called_by_name: "dr@cidade.gov.br"
} ];

function renderQueue(props: { canCare: boolean; clinicalRecord?: boolean; patientTimeline?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<UnitQueue unit={unit} units={[ unit ]} {...props} />, { wrapper });
}

describe("UnitQueue — linha do tempo no modo integrado (módulo 20)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listUnitQueue, api.getTimeline ]) m(fn).mockReset();
    m(api.fetchCurrentSession).mockResolvedValue({ id: "u1", email_address: "dr@cidade.gov.br", operator: false, mfa_enrolled: true,
      mfa_verified_at: null, features: [ "patient_timeline" ],
      memberships: [ { city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role: "health_professional" } ] });
    m(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: inCare });
    m(api.getTimeline).mockResolvedValue(page({ person: { display_name: "Joana Lima", partial: true, patient_id: null } }));
  });

  it("modo integrado: Linha do tempo no atendimento chamado, com o aviso de parcial", async () => {
    renderQueue({ canCare: true, patientTimeline: true });
    fireEvent.click(await screen.findByRole("button", { name: "Linha do tempo" }));
    expect(await screen.findByText("Linha do tempo de Joana Lima")).not.toBeNull();
    expect(api.getTimeline).toHaveBeenCalledWith({ attendanceId: "a3" }, { kinds: [], from: "", to: "" }, null);
    expect(screen.getByRole("note", { name: "histórico parcial" }).textContent).toBe(PARTIAL_NOTICE);
    fireEvent.click(screen.getByRole("button", { name: "Fechar linha do tempo" }));
    expect(screen.queryByText("Linha do tempo de Joana Lima")).toBeNull();
  });

  it("modo record (clinicalRecord): sem o botão — a linha do tempo está no painel do paciente", async () => {
    renderQueue({ canCare: true, patientTimeline: true, clinicalRecord: true });
    expect(await screen.findByRole("button", { name: "Consulta" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Linha do tempo" })).toBeNull();
  });

  it("sem o interruptor ou sem papel clínico: sem o botão", async () => {
    renderQueue({ canCare: true });
    expect(await screen.findByText("Em atendimento")).not.toBeNull();
    await screen.findByText("***.333.444-**");
    expect(screen.queryByRole("button", { name: "Linha do tempo" })).toBeNull();
    cleanup();
    renderQueue({ canCare: false, patientTimeline: true });
    await screen.findByText("***.333.444-**");
    expect(screen.queryByRole("button", { name: "Linha do tempo" })).toBeNull();
  });
});
