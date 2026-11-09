import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(), listActiveUnits: vi.fn(),
  getMyProfessional: vi.fn(), listAllUnits: vi.fn(), listVerifications: vi.fn(), listUnitRequests: vi.fn(), getUnitAgenda: vi.fn(),
  listUnassignedRequests: vi.fn(), listPendingErasures: vi.fn(), listAppointmentTypes: vi.fn(), listUnitQueue: vi.fn(),
  listScreeningQueue: vi.fn() }));

import * as api from "../lib/api";
import { currentUnitKey } from "../lib/attendance";
import { UBS, UPA, urgencyUser } from "../test/urgencyFixtures";
import { Attendance } from "./Attendance";

afterEach(() => { cleanup(); localStorage.clear(); });

function pickUnit(unit: api.HealthUnit) {
  localStorage.setItem(currentUnitKey("u-1"), unit.id);
  vi.mocked(api.listActiveUnits).mockResolvedValue([ UPA, UBS ]);
}
function mountAttendance(user: api.SessionUser) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(user);
  renderWithProviders(<Attendance onNavigate={() => {}} />);
}

const row = (o: Partial<api.QueueRow>): api.QueueRow => ({
  id: "q1", cpf_masked: "***.982.247-**", checked_in_at: "2026-11-05T08:00:00-03:00", protocol_name: null, priority: null,
  source: "triage", appointment_time: null, called_at: null, called_by_name: null, display_name: "Rita Dias", ...o
});

beforeEach(() => {
  vi.mocked(api.getMyProfessional).mockResolvedValue(null);
  vi.mocked(api.listUnitRequests).mockResolvedValue([]);
  vi.mocked(api.getUnitAgenda).mockResolvedValue({ date: "2026-11-05", professionals: [], unassigned: [] });
  vi.mocked(api.listUnassignedRequests).mockResolvedValue([]);
  vi.mocked(api.listAppointmentTypes).mockResolvedValue([]);
  vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: [] });
  vi.mocked(api.listScreeningQueue).mockResolvedValue([]);
});

describe("Atendimento numa UPA com a urgência (§14 Q15)", () => {
  it("UPA com urgency_care: a mesa da UPA no lugar do check-in, da escuta e da fila do 13", async () => {
    pickUnit(UPA); mountAttendance(urgencyUser([ "citizen_verifier" ]));
    expect(await screen.findByRole("heading", { name: "Recepção da UPA" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Check-in de quem chegou" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Fila" })).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Nesta página" })).toBeNull();
    // A validação presencial fica.
    expect(screen.getByRole("heading", { name: "Validar cadastro com documento" })).not.toBeNull();
  });

  it("UPA sem urgency_care e UBS: o Atendimento de hoje", async () => {
    pickUnit(UPA); mountAttendance(urgencyUser([ "citizen_verifier" ], [ "clinical_record" ]));
    expect(await screen.findByRole("heading", { name: "Check-in de quem chegou" })).not.toBeNull();
    cleanup(); pickUnit(UBS); mountAttendance(urgencyUser([ "citizen_verifier" ]));
    expect(await screen.findByRole("heading", { name: "Check-in de quem chegou" })).not.toBeNull();
    expect(screen.queryByRole("heading", { name: "Recepção da UPA" })).toBeNull();
  });

  it("E8: atendimentos do 13 abertos antes da urgência aparecem recolhidos, sem os walk_in", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({
      waiting: [ row({}), row({ id: "q2", source: "walk_in", display_name: "Paulo Walk" }) ], in_care: []
    });
    pickUnit(UPA); mountAttendance(urgencyUser([ "citizen_verifier" ]));
    expect(await screen.findByRole("heading", { name: "Atendimentos de antes da urgência" })).not.toBeNull();
    // Recolhido: montado (nada se perde), mas escondido.
    expect(screen.getByText("Rita Dias").closest("[hidden]")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar" }));
    expect(screen.getByText("Rita Dias").closest("[hidden]")).toBeNull();
    expect(screen.queryByText("Paulo Walk")).toBeNull();
    expect(screen.queryByRole("button", { name: "Chamar próximo" })).toBeNull();
  });

  it("E8: só walk_in na fila do 13 → nada de 'antes da urgência'", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ row({ source: "walk_in" }) ], in_care: [] });
    pickUnit(UPA); mountAttendance(urgencyUser([ "citizen_verifier" ]));
    await screen.findByRole("heading", { name: "Recepção da UPA" });
    await waitFor(() => expect(api.listUnitQueue).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("heading", { name: "Atendimentos de antes da urgência" })).toBeNull();
  });
});
