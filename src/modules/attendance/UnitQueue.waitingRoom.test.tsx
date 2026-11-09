// A fila do 13 e o check-in da UBS com o painel da sala de espera (módulo 32a, F-32.5; contrato §6, §14 Q7): a senha na fila e no
// check-in, o local da chamada lembrado (obrigatório com TV ativa) e "Chamar de novo" em quem já foi chamado. Sem o interruptor,
// tudo como antes (a chamada sai sem o segundo argumento).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (orig) => ({
  ...(await orig<typeof import("../../lib/api")>()),
  fetchCurrentSession: vi.fn(), listUnitQueue: vi.fn(), callAttendance: vi.fn(), callNext: vi.fn(), closeAttendance: vi.fn(),
  listCallLocations: vi.fn(), recallAttendance: vi.fn(), lookupCheckIn: vi.fn(), checkIn: vi.fn(), searchCheckIn: vi.fn(),
  checkInByException: vi.fn()
}));

import * as api from "../../lib/api";
import { ApiError, type Attendance, type HealthUnit, type QueueRow } from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { readCallLocation } from "../../lib/urgency";
import { sessionWith } from "../../test/campaignFixtures";
import { UBS, UPA } from "../../test/urgencyFixtures";
import { CheckIn } from "./CheckIn";
import { UnitQueue } from "./UnitQueue";

afterEach(cleanup);
beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.listUnitQueue, api.callAttendance, api.callNext, api.closeAttendance,
    api.listCallLocations, api.recallAttendance, api.lookupCheckIn, api.checkIn, api.searchCheckIn, api.checkInByException ]) {
    vi.mocked(fn as ReturnType<typeof vi.fn>).mockReset();
  }
  sessionStorage.clear();
});

const queueRow = (o: Partial<QueueRow> = {}): QueueRow => ({
  id: "a1", cpf_masked: "***.982.247-**", checked_in_at: "2026-11-05T09:40:00-03:00", protocol_name: "triage-respiratoria",
  priority: 2, source: "triage", appointment_time: null, called_at: null, called_by_name: null, ...o
});
const attendanceFixture = (o: Partial<Attendance> = {}): Attendance => ({
  id: "a1", triage_id: "t1", health_unit_id: "ubs1", unit_name: "UBS Centro", status: "in_care", checked_in_at: "2026-11-05T09:40:00-03:00",
  check_in_method: "code", outcome: null, referral_unit_name: null, referral_note: null, closed_at: null, ...o
});
const LOCS = { items: [ { id: "loc1", health_unit_id: "ubs1", name: "Consultório 1", active: true } ], location_required: true };

function mountUnitQueue(unit: HealthUnit, features = [ "waiting_room_display" ], preUrgency = false) {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(sessionWith([ "health_professional" ], { features } as never));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<UnitQueue unit={unit} units={[ unit ]} canCare preUrgency={preUrgency} />, { wrapper });
}

describe("fila do 13 com a TV (UBS)", () => {
  it("UBS com TV: senha na fila, 'Chamar próximo' leva o local, 'Chamar de novo' em quem foi chamado", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ queueRow({ id: "a1", ticket: "A-007" }) ],
      in_care: [ queueRow({ id: "a2", ticket: "A-006", called_at: "2026-11-05T09:58:00-03:00", called_by_name: "Dra. Lia" }) ] });
    vi.mocked(api.listCallLocations).mockResolvedValue(LOCS);
    vi.mocked(api.callNext).mockResolvedValue({ attendance: attendanceFixture({ id: "a1" }) });
    vi.mocked(api.recallAttendance).mockResolvedValue({ call_id: "c9" } as never);
    mountUnitQueue(UBS);
    expect(await screen.findByText("A-007")).not.toBeNull();
    expect(screen.getByText("A-006")).not.toBeNull();
    expect(screen.getAllByText("Senha").length).toBe(2);
    await screen.findByRole("option", { name: "Consultório 1" });
    fireEvent.change(screen.getByLabelText("Local da chamada"), { target: { value: "loc1" } });
    expect(readCallLocation("u-1", "ubs1")).toBe("loc1");
    fireEvent.click(screen.getByRole("button", { name: "Chamar próximo" }));
    await waitFor(() => expect(vi.mocked(api.callNext).mock.calls[0]).toEqual([ "ubs1", "loc1" ]));
    fireEvent.click(screen.getByRole("button", { name: "Chamar de novo A-006" }));
    await waitFor(() => expect(vi.mocked(api.recallAttendance).mock.calls[0]).toEqual([ "a2", "loc1" ]));
    expect(await screen.findByText("A-006 chamada de novo em Consultório 1")).not.toBeNull();
    expect(vi.mocked(api.listCallLocations).mock.calls[0]).toEqual([ "ubs1" ]);
  });

  it("'Chamar' na linha também leva o local; a resposta do recall com o local dele vence", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ queueRow({ id: "a1", ticket: "A-007" }) ],
      in_care: [ queueRow({ id: "a2", ticket: "A-006", called_at: "2026-11-05T09:58:00-03:00", called_by_name: "Dra. Lia" }) ] });
    vi.mocked(api.listCallLocations).mockResolvedValue(LOCS);
    vi.mocked(api.callAttendance).mockResolvedValue({ attendance: attendanceFixture({ id: "a1" }) });
    vi.mocked(api.recallAttendance).mockResolvedValue({ call_id: "c9",
      call: { id: "c9", kind: "care", ticket: "A-006", location: "Consultório 1", called_at: "2026-11-05T10:00:00-03:00" } });
    mountUnitQueue(UBS);
    await screen.findByRole("option", { name: "Consultório 1" });
    fireEvent.change(screen.getByLabelText("Local da chamada"), { target: { value: "loc1" } });
    fireEvent.click(screen.getByRole("button", { name: "Chamar" }));
    await waitFor(() => expect(vi.mocked(api.callAttendance).mock.calls[0]).toEqual([ "a1", "ubs1", "loc1" ]));
    fireEvent.click(screen.getByRole("button", { name: "Chamar de novo A-006" }));
    expect(await screen.findByText("A-006 chamada de novo em Consultório 1")).not.toBeNull();
  });

  it("local obrigatório: sem escolha não chama; call_location_required do api põe a frase e o foco no seletor", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ queueRow({ id: "a1", ticket: "A-007" }) ], in_care: [] });
    vi.mocked(api.listCallLocations).mockResolvedValue(LOCS);
    mountUnitQueue(UBS);
    await screen.findByRole("option", { name: "Consultório 1" });
    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
    expect(screen.getByText("escolha o local da chamada — a unidade tem TV na sala de espera")).not.toBeNull();
    expect(api.callNext).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByLabelText("Local da chamada"));
  });

  it("a recusa do api sobre o local fica junto do seletor; invalid_call_location esquece o lembrado", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ queueRow({ id: "a1", ticket: "A-007" }) ], in_care: [] });
    vi.mocked(api.listCallLocations).mockResolvedValue({ ...LOCS, location_required: false });
    vi.mocked(api.callNext).mockRejectedValueOnce(new ApiError(422, { error: "call_location_required" }, "x"))
      .mockRejectedValueOnce(new ApiError(422, { error: "invalid_call_location" }, "x"));
    mountUnitQueue(UBS);
    await screen.findByRole("option", { name: "Consultório 1" });
    fireEvent.click(screen.getByRole("button", { name: "Chamar próximo" }));
    expect(await screen.findByText("escolha o local da chamada — a unidade tem TV na sala de espera")).not.toBeNull();
    expect(vi.mocked(api.callNext).mock.calls[0]).toEqual([ "ubs1" ]);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("Local da chamada")));
    fireEvent.change(screen.getByLabelText("Local da chamada"), { target: { value: "loc1" } });
    fireEvent.click(screen.getByRole("button", { name: "Chamar próximo" }));
    expect(await screen.findByText("o local escolhido não está ativo nesta unidade — escolha outro")).not.toBeNull();
    expect(readCallLocation("u-1", "ubs1")).toBeNull();
    await waitFor(() => expect(api.listCallLocations).toHaveBeenCalledTimes(2));
  });

  it("'Chamar de novo' de quem não foi chamado: a frase do api", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [],
      in_care: [ queueRow({ id: "a2", ticket: "A-006", called_at: "2026-11-05T09:58:00-03:00", called_by_name: "Dra. Lia" }) ] });
    vi.mocked(api.listCallLocations).mockResolvedValue({ ...LOCS, location_required: false });
    vi.mocked(api.recallAttendance).mockRejectedValue(new ApiError(422, { error: "not_called" }, "x"));
    mountUnitQueue(UBS);
    await screen.findByRole("option", { name: "Consultório 1" });
    fireEvent.click(screen.getByRole("button", { name: "Chamar de novo A-006" }));
    expect(await screen.findByText("esta pessoa ainda não foi chamada")).not.toBeNull();
    expect(vi.mocked(api.recallAttendance).mock.calls[0]).toEqual([ "a2", null ]);
  });

  it("'Chamar de novo' sem local na resposta nem escolhido: o aviso sem 'em —'", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [],
      in_care: [ queueRow({ id: "a2", ticket: "A-006", called_at: "2026-11-05T09:58:00-03:00", called_by_name: "Dra. Lia" }) ] });
    vi.mocked(api.listCallLocations).mockResolvedValue({ ...LOCS, location_required: false });
    vi.mocked(api.recallAttendance).mockResolvedValue({ call_id: "c9",
      call: { id: "c9", kind: "care", ticket: "A-006", location: null, called_at: "2026-11-05T10:00:00-03:00" } });
    mountUnitQueue(UBS);
    await screen.findByRole("option", { name: "Consultório 1" });
    fireEvent.click(screen.getByRole("button", { name: "Chamar de novo A-006" }));
    expect(await screen.findByText("A-006 chamada de novo")).not.toBeNull();
    expect(screen.queryByText(/em —/)).toBeNull();
  });

  it("E8 (UPA): os atendimentos de antes da urgência chamam com o local do seletor próprio", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ queueRow({ id: "a1", ticket: "U-001" }),
      queueRow({ id: "w1", ticket: "U-042", source: "walk_in" }) ], in_care: [] });
    vi.mocked(api.listCallLocations).mockResolvedValue({ ...LOCS, items: [ { ...LOCS.items[0], health_unit_id: "upa1" } ] });
    vi.mocked(api.callAttendance).mockResolvedValue({ attendance: attendanceFixture({ id: "a1", health_unit_id: "upa1" }) });
    mountUnitQueue(UPA, [ "waiting_room_display" ], true);
    fireEvent.click(await screen.findByRole("button", { name: "Mostrar" }));
    await screen.findByRole("option", { name: "Consultório 1" });
    expect(screen.queryByLabelText("Local da chamada")).toBeNull();
    fireEvent.change(screen.getByLabelText("Local da chamada (antes da urgência)"), { target: { value: "loc1" } });
    expect(screen.queryByText("U-042")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Chamar" }));
    await waitFor(() => expect(vi.mocked(api.callAttendance).mock.calls[0]).toEqual([ "a1", "upa1", "loc1" ]));
  });

  it("numa UPA, encerrar um walk_in sem o desfecho da urgência: a frase da urgência", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [],
      in_care: [ queueRow({ id: "a2", ticket: "U-042", called_at: "2026-11-05T09:58:00-03:00", called_by_name: "Dra. Lia" }) ] });
    vi.mocked(api.closeAttendance).mockRejectedValue(new ApiError(422, { error: "urgency_outcome_required" }, "x"));
    mountUnitQueue(UPA, [ "clinical_record" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Encerrar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar encerramento" }));
    expect(await screen.findByText("numa UPA, o atendimento termina pelo desfecho da urgência")).not.toBeNull();
  });

  it("sem waiting_room_display: a fila e a chamada do 13 iguais a hoje", async () => {
    vi.mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ queueRow({ id: "a1" }) ],
      in_care: [ queueRow({ id: "a2", called_at: "2026-11-05T09:58:00-03:00", called_by_name: "Dra. Lia" }) ] });
    vi.mocked(api.callNext).mockResolvedValue({ attendance: attendanceFixture({ id: "a1" }) });
    mountUnitQueue(UBS, [ "clinical_record" ]);
    // A sessão carrega antes da chamada (o AuthProvider lê a sessão ao montar).
    await waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
    await screen.findAllByText("***.982.247-**");
    fireEvent.click(await screen.findByRole("button", { name: "Chamar próximo" }));
    await waitFor(() => expect(vi.mocked(api.callNext).mock.calls[0]).toEqual([ "ubs1" ]));
    expect(screen.queryByLabelText("Local da chamada")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Chamar de novo/ })).toBeNull();
    expect(screen.queryByText("Senha")).toBeNull();
    expect(api.listCallLocations).not.toHaveBeenCalled();
  });
});

describe("check-in da UBS com senha", () => {
  function renderCheckIn(unit: HealthUnit) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><CheckIn unit={unit} onUnitInvalid={vi.fn()} /></QueryClientProvider>);
  }
  function doCheckIn(unit: HealthUnit) {
    vi.mocked(api.lookupCheckIn).mockResolvedValue({
      citizen: { id: "c1", cpf_masked: "***.982.247-**", phone_masked: "(**) *****-5432", verification_level: "declared" },
      triage: { id: "t1", date: "2026-11-05T08:00:00-03:00", protocol_name: "triage-respiratoria", priority: 2 }, appointment: null
    } as never);
    renderCheckIn(unit);
    fireEvent.change(screen.getByLabelText("CPF do cidadão (check-in)"), { target: { value: "52998224725" } });
    fireEvent.change(screen.getByLabelText("Código de check-in"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar check-in" }));
    return screen.findByRole("button", { name: "Iniciar atendimento" }).then((b) => fireEvent.click(b));
  }

  it("check-in da UBS com senha mostra o número para entregar", async () => {
    vi.mocked(api.checkIn).mockResolvedValue({ attendance: attendanceFixture({ ticket: "A-008" }), verified: false });
    await doCheckIn(UBS);
    expect(await screen.findByText("Senha A-008 — entregue à pessoa")).not.toBeNull();
    expect(screen.getByText("Atendimento iniciado")).not.toBeNull();
  });

  it("sem senha, só 'Atendimento iniciado'", async () => {
    vi.mocked(api.checkIn).mockResolvedValue({ attendance: attendanceFixture({ ticket: null }), verified: false });
    await doCheckIn(UBS);
    expect(await screen.findByText("Atendimento iniciado")).not.toBeNull();
    expect(screen.queryByText(/^Senha /)).toBeNull();
  });

  it("check-in por exceção também mostra a senha", async () => {
    vi.mocked(api.searchCheckIn).mockResolvedValue({ appointments: [],
      triages: [ { id: "t1", date: "2026-11-05T08:00:00-03:00", protocol_name: "triage-respiratoria", priority: 2 } ] } as never);
    vi.mocked(api.checkInByException).mockResolvedValue({ attendance: attendanceFixture({ ticket: "A-009" }) });
    renderCheckIn(UBS);
    fireEvent.click(screen.getByRole("button", { name: "Cidadão sem o código" }));
    fireEvent.change(screen.getByLabelText("CPF do cidadão (exceção)"), { target: { value: "52998224725" } });
    fireEvent.click(screen.getByRole("button", { name: "Buscar triagens" }));
    fireEvent.click(await screen.findByText("triage-respiratoria"));
    fireEvent.change(screen.getByLabelText("Motivo"), { target: { value: "documento perdido" } });
    fireEvent.click(screen.getByRole("button", { name: "Iniciar atendimento" }));
    expect(await screen.findByText("Senha A-009 — entregue à pessoa")).not.toBeNull();
  });
});
