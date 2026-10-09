// src/modules/attendance/UnitQueue.consultation.test.tsx
// Módulo 19: consulta no atendimento chamado; nome de exibição e cor para a recepção.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listUnitQueue: vi.fn(), callAttendance: vi.fn(), callNext: vi.fn(),
    closeAttendance: vi.fn(), getScreening: vi.fn(), getAttendanceRecord: vi.fn() };
});
const workspaceRender = vi.hoisted(() => vi.fn());
vi.mock("../consultation/ConsultationWorkspace", () => ({
  ConsultationWorkspace: (p: { attendanceId: string; onFinalized(): void; onClose(): void }) => {
    workspaceRender(p.attendanceId);
    return (
    <div>
      <span>{`consulta de ${p.attendanceId}`}</span>
      <button type="button" onClick={p.onFinalized}>finalizar (dublê)</button>
    </div>
    );
  }
}));

import * as api from "../../lib/api";
import type { QueueRow } from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { UnitQueue } from "./UnitQueue";
import { revision, screening } from "../../test/screeningFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function row(over: Partial<QueueRow>): QueueRow {
  return { id: "a1", cpf_masked: "***.982.247-**", checked_in_at: "2026-10-07T09:20:00-03:00", protocol_name: null, priority: null,
    source: "triage", appointment_time: null, called_at: null, called_by_name: null, screening: null, display_name: null, ...over };
}
const waitingRow = row({ id: "a1", display_name: "Joana Lima", screening: { id: "sc1", color: "red", destination: "same_day", waited_minutes: 25 } });
const inCareRow = row({ id: "a3", cpf_masked: "***.333.444-**", display_name: "Carlos Souza", called_at: "2026-10-07T09:50:00-03:00",
  called_by_name: "Dra. Helena" });

function session(role: string) {
  return { id: "us1", email_address: "x@cidade.gov.br", operator: false, mfa_enrolled: true, mfa_verified_at: null,
    memberships: [ { city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role } ], features: [ "clinical_record" ] };
}
function renderQueue(canCare: boolean, clinicalRecord = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<UnitQueue unit={unit} units={[ unit ]} canCare={canCare} clinicalRecord={clinicalRecord} />, { wrapper });
}
const section = async (title: string) => (await screen.findByText(title)).parentElement as HTMLElement;

describe("UnitQueue — consulta (módulo 19)", () => {
  beforeEach(() => {
    workspaceRender.mockClear();
    for (const fn of [ api.fetchCurrentSession, api.listUnitQueue, api.callAttendance, api.callNext, api.closeAttendance,
      api.getScreening, api.getAttendanceRecord ]) {
      mocked(fn).mockReset();
    }
    mocked(api.fetchCurrentSession).mockResolvedValue(session("health_professional"));
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ waitingRow ], in_care: [ inCareRow ] });
  });

  it("quem cuida vê Consulta em Em atendimento e abre a consulta daquele atendimento", async () => {
    renderQueue(true);
    const inCare = await section("Em atendimento");
    fireEvent.click(await within(inCare).findByRole("button", { name: "Consulta" }));
    expect(screen.getByText("consulta de a3")).not.toBeNull();
  });

  it("Chamar abre a consulta do atendimento chamado, no lugar da escuta solta", async () => {
    mocked(api.callAttendance).mockResolvedValue({ attendance: { id: "a1",
      screening: screening({ status: "completed", destination: "same_day", current_revision: revision(), revisions_count: 1 }) } } as never);
    renderQueue(true);
    const waiting = await section("Aguardando");
    fireEvent.click(await within(waiting).findByRole("button", { name: "Chamar" }));
    expect(await screen.findByText("consulta de a1")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Escuta inicial do atendimento" })).toBeNull();
  });

  it("sem o interruptor, Chamar abre a escuta como no módulo 18", async () => {
    mocked(api.callAttendance).mockResolvedValue({ attendance: { id: "a1",
      screening: screening({ status: "completed", destination: "same_day", current_revision: revision(), revisions_count: 1 }) } } as never);
    renderQueue(true, false);
    const waiting = await section("Aguardando");
    fireEvent.click(await within(waiting).findByRole("button", { name: "Chamar" }));
    expect(await screen.findByRole("region", { name: "Escuta inicial do atendimento" })).not.toBeNull();
    expect(workspaceRender).not.toHaveBeenCalled();
  });

  it("recepção vê nome e cor, sem Consulta e sem ler o prontuário", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session("citizen_verifier"));
    renderQueue(false);
    const waiting = await section("Aguardando");
    expect(await within(waiting).findByText("Joana Lima")).not.toBeNull();
    expect(within(waiting).getByText("vermelho")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Consulta" })).toBeNull();
    expect(screen.queryByText(/consulta de/)).toBeNull();
    expect(workspaceRender).not.toHaveBeenCalled();
  });

  it("sem o interruptor: nem Consulta nem coluna Nome", async () => {
    renderQueue(true, false);
    const inCare = await section("Em atendimento");
    await within(inCare).findByRole("button", { name: "Encerrar" });
    expect(within(inCare).queryByRole("button", { name: "Consulta" })).toBeNull();
    expect(screen.queryByText("Nome")).toBeNull();
  });

  it("finalizar pela consulta recarrega a fila e avisa", async () => {
    renderQueue(true);
    const inCare = await section("Em atendimento");
    fireEvent.click(await within(inCare).findByRole("button", { name: "Consulta" }));
    fireEvent.click(screen.getByRole("button", { name: "finalizar (dublê)" }));
    expect(await screen.findByText("Consulta finalizada e atendimento encerrado.")).not.toBeNull();
    await waitFor(() => expect(api.listUnitQueue).toHaveBeenCalledTimes(2));
  });
});
