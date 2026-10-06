import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, getUnitAvailability: vi.fn(), bookAppointment: vi.fn(), getUnitAgenda: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { BookPanel } from "./BookPanel";
import { NOW, appointmentView, requestRow, slot } from "../../test/schedulingFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };
const APPOINTMENT = { id: "a1", scheduled_at: "x", status: "scheduled", confirmation_deadline_at: null };

const AVAILABILITY: api.Availability = {
  slots: [
    slot(),
    slot({ starts_at: "2026-10-06T09:20:00-03:00", ends_at: "2026-10-06T09:40:00-03:00" }),
    slot({ professional_id: "p2", professional_name: "Marta Lima", shift_id: "s2" })
  ],
  legacy_days: [ "2026-10-07" ]
};

function renderIt(row = requestRow()) {
  const onDone = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<BookPanel row={row} unit={unit} onCancel={vi.fn()} onDone={onDone} />, { wrapper });
  return { onDone };
}
const pickDay = async (value: string) => {
  const select = await screen.findByLabelText("Dia");
  fireEvent.change(select, { target: { value } });
};
const confirm = () => screen.getByRole("button", { name: "Confirmar horário" }) as HTMLButtonElement;

describe("BookPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW));
    mocked(api.getUnitAvailability).mockResolvedValue(AVAILABILITY);
  });

  it("pede 14 dias do tipo do pedido, a partir de hoje na cidade", async () => {
    renderIt();
    await waitFor(() => expect(api.getUnitAvailability).toHaveBeenCalledWith("u1", "consulta_medica", "2026-10-05", "2026-10-18"));
    expect(screen.getByText("Marcar horário — Consulta médica · prazo até 20/10")).not.toBeNull();
    const day = await screen.findByLabelText("Dia");
    expect(within(day).getByRole("option", { name: "ter 06/10 · 3 vagas" })).not.toBeNull();
    expect(within(day).getByRole("option", { name: "qua 07/10 · sem turno (marcação livre)" })).not.toBeNull();
    expect(within(day).getByRole("option", { name: "qui 08/10 · sem vaga" })).not.toBeNull();
  });

  it("vaga: escolher dia e profissional, avisar a confirmação e marcar", async () => {
    const { onDone } = renderIt();
    mocked(api.bookAppointment).mockResolvedValue(APPOINTMENT);
    await pickDay("2026-10-06");
    fireEvent.change(screen.getByLabelText("Profissional"), { target: { value: "p1" } });
    expect(screen.queryByRole("radio", { name: "09:00 · Marta Lima" })).toBeNull();
    expect(confirm().disabled).toBe(true);
    fireEvent.click(screen.getByRole("radio", { name: "09:20 · Helena Duarte" }));
    expect(screen.getByText("O horário nasce confirmado")).not.toBeNull();
    fireEvent.click(confirm());
    await waitFor(() => expect(api.bookAppointment).toHaveBeenCalledWith("r1", "u1", {
      kind: "slot", professional_id: "p1", starts_at: "2026-10-06T09:20:00-03:00", appointment_type_key: "consulta_medica"
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("slot_taken recarrega as vagas, avisa e não marca outra", async () => {
    const { onDone } = renderIt();
    mocked(api.bookAppointment).mockRejectedValueOnce(new ApiError(409, { error: "slot_taken" }, "x"));
    await pickDay("2026-10-06");
    fireEvent.click(screen.getByRole("radio", { name: "09:00 · Helena Duarte" }));
    fireEvent.click(confirm());
    expect(await screen.findByText("Essa vaga acabou de ser ocupada. As vagas foram recarregadas — escolha outra.")).not.toBeNull();
    await waitFor(() => expect(api.getUnitAvailability).toHaveBeenCalledTimes(2));
    expect(api.bookAppointment).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getAllByRole("radio").some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(confirm().disabled).toBe(true);
  });

  it("slot_unavailable também recarrega, com a frase da recusa", async () => {
    renderIt();
    mocked(api.bookAppointment).mockRejectedValueOnce(new ApiError(409, { error: "slot_unavailable" }, "x"));
    await pickDay("2026-10-06");
    fireEvent.click(screen.getByRole("radio", { name: "09:00 · Helena Duarte" }));
    fireEvent.click(confirm());
    expect(await screen.findByText("essa vaga não está mais disponível — as vagas foram recarregadas")).not.toBeNull();
    await waitFor(() => expect(api.getUnitAvailability).toHaveBeenCalledTimes(2));
  });

  it("citizen_busy fica como erro, sem recarregar", async () => {
    renderIt();
    mocked(api.bookAppointment).mockRejectedValueOnce(new ApiError(409, { error: "citizen_busy" }, "x"));
    await pickDay("2026-10-06");
    fireEvent.click(screen.getByRole("radio", { name: "09:00 · Helena Duarte" }));
    fireEvent.click(confirm());
    expect(await screen.findByText("o cidadão já tem outro horário nesse período")).not.toBeNull();
    expect(api.getUnitAvailability).toHaveBeenCalledTimes(1);
  });

  it("dia sem turno: marcação livre com hora da cidade", async () => {
    renderIt();
    mocked(api.bookAppointment).mockResolvedValue(APPOINTMENT);
    await pickDay("2026-10-07");
    expect(screen.queryByRole("radio")).toBeNull();
    fireEvent.change(screen.getByLabelText("Horário (marcação livre)"), { target: { value: "14:30" } });
    expect(screen.getByText("O cidadão precisa confirmar até 06/10 14:30")).not.toBeNull(); // 52h30 à frente
    fireEvent.click(confirm());
    await waitFor(() => expect(api.bookAppointment).toHaveBeenCalledWith("r1", "u1",
      { kind: "legacy", scheduled_at: "2026-10-07T17:30:00.000Z" }));
  });

  it("marcação livre ocupada: avisa quantos e 'Marcar mesmo assim' manda allow_overlap", async () => {
    renderIt();
    mocked(api.bookAppointment)
      .mockRejectedValueOnce(new ApiError(409, { error: "slot_taken", taken: 2 }, "x"))
      .mockResolvedValueOnce(APPOINTMENT);
    await pickDay("2026-10-07");
    fireEvent.change(screen.getByLabelText("Horário (marcação livre)"), { target: { value: "14:30" } });
    fireEvent.click(confirm());
    expect(await screen.findByText("Já há 2 horários marcados na UBS Centro nesse horário. Marcar mesmo assim deixa os dois no mesmo horário."))
      .not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Marcar mesmo assim" }));
    await waitFor(() => expect(api.bookAppointment).toHaveBeenLastCalledWith("r1", "u1",
      { kind: "legacy", scheduled_at: "2026-10-07T17:30:00.000Z", allow_overlap: true }));
  });

  it("use_slots num dia de marcação livre recarrega e some a marcação livre", async () => {
    // O mock vem antes do render: a primeira leitura sai no mount.
    mocked(api.getUnitAvailability)
      .mockResolvedValueOnce(AVAILABILITY)
      .mockResolvedValueOnce({ slots: [ ...AVAILABILITY.slots, slot({ starts_at: "2026-10-07T08:00:00-03:00", ends_at: "2026-10-07T08:20:00-03:00" }) ],
        legacy_days: [] });
    mocked(api.bookAppointment).mockRejectedValueOnce(new ApiError(409, { error: "use_slots" }, "x"));
    renderIt();
    await pickDay("2026-10-07");
    fireEvent.change(screen.getByLabelText("Horário (marcação livre)"), { target: { value: "14:30" } });
    fireEvent.click(confirm());
    expect(await screen.findByText("a unidade tem turno neste dia — marque numa vaga ou faça um encaixe")).not.toBeNull();
    expect(await screen.findByRole("radio", { name: "08:00 · Helena Duarte" })).not.toBeNull();
    expect(screen.queryByLabelText("Horário (marcação livre)")).toBeNull();
  });

  it("14 dias → pede o período seguinte; ← volta e nunca passa de hoje", async () => {
    renderIt();
    await screen.findByLabelText("Dia");
    expect((screen.getByRole("button", { name: "← 14 dias" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "14 dias →" }));
    await waitFor(() => expect(api.getUnitAvailability).toHaveBeenLastCalledWith("u1", "consulta_medica", "2026-10-19", "2026-11-01"));
    fireEvent.click(screen.getByRole("button", { name: "← 14 dias" }));
    await waitFor(() => expect(api.getUnitAvailability).toHaveBeenLastCalledWith("u1", "consulta_medica", "2026-10-05", "2026-10-18"));
  });

  it("request_not_open fecha o painel (outra recepção já marcou)", async () => {
    const { onDone } = renderIt();
    mocked(api.bookAppointment).mockRejectedValueOnce(new ApiError(409, { error: "request_not_open" }, "x"));
    await pickDay("2026-10-06");
    fireEvent.click(screen.getByRole("radio", { name: "09:00 · Helena Duarte" }));
    fireEvent.click(confirm());
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  // P6: o relógio passou do início da vaga entre a leitura e o clique — o api
  // devolve 422 invalid_time (commands/appointments/book.rb:11). Recarrega como
  // a vaga ocupada e nunca marca outra sozinha.
  it("invalid_time numa vaga (o início já passou) recarrega as vagas e não marca outra", async () => {
    const { onDone } = renderIt();
    mocked(api.bookAppointment).mockRejectedValueOnce(new ApiError(422, { error: "invalid_time" }, "x"));
    await pickDay("2026-10-06");
    fireEvent.click(screen.getByRole("radio", { name: "09:00 · Helena Duarte" }));
    fireEvent.click(confirm());
    expect(await screen.findByText("Essa vaga já começou. As vagas foram recarregadas — escolha outra.")).not.toBeNull();
    await waitFor(() => expect(api.getUnitAvailability).toHaveBeenCalledTimes(2));
    expect(api.bookAppointment).toHaveBeenCalledTimes(1);
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getAllByRole("radio").some((r) => (r as HTMLInputElement).checked)).toBe(false);
    expect(confirm().disabled).toBe(true);
  });

  // P5: pedido já marcado que precisa remarcar — o api recusa a marcação livre
  // (409 request_not_open, commands/appointments/schedule.rb:28) mas remarca
  // numa vaga (Placement bookable? = open|scheduled).
  it("pedido já marcado: dia sem turno não oferece marcação livre, mas a vaga remarca", async () => {
    const { onDone } = renderIt(requestRow({ needs_reschedule: true, appointment: appointmentView({ shift_cancelled: true }) }));
    mocked(api.bookAppointment).mockResolvedValue(APPOINTMENT);
    const day = await screen.findByLabelText("Dia");
    expect(within(day).getByRole("option", { name: "qua 07/10 · sem turno" })).not.toBeNull();
    await pickDay("2026-10-07");
    expect(screen.queryByLabelText("Horário (marcação livre)")).toBeNull();
    expect(screen.getByText("Sem turno neste dia. Este pedido já tem horário: remarque numa vaga de outro dia.")).not.toBeNull();
    expect(confirm().disabled).toBe(true);
    await pickDay("2026-10-06");
    fireEvent.click(screen.getByRole("radio", { name: "09:00 · Helena Duarte" }));
    fireEvent.click(confirm());
    await waitFor(() => expect(api.bookAppointment).toHaveBeenCalledWith("r1", "u1", {
      kind: "slot", professional_id: "p1", starts_at: "2026-10-06T09:00:00-03:00", appointment_type_key: "consulta_medica"
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });
});
