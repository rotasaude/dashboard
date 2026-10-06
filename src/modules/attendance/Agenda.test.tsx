import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, getUnitAgenda: vi.fn() };
});

import * as api from "../../lib/api";
import { Agenda } from "./Agenda";
import { agendaShift, appointmentView, unitAgenda } from "../../test/schedulingFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function renderAgenda() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<Agenda unit={unit} />, { wrapper });
  return { client };
}

describe("Agenda", () => {
  beforeEach(() => { mocked(api.getUnitAgenda).mockReset(); });

  it("por profissional: turno com contador, faixas, horários com marcas e o motivo do encaixe", async () => {
    mocked(api.getUnitAgenda).mockResolvedValue(unitAgenda({ professionals: [
      { id: "p1", name: "Helena Duarte", shifts: [ agendaShift() ], appointments: [
        appointmentView(),
        appointmentView({ id: "a2", scheduled_at: "2026-10-06T10:10:00-03:00", ends_at: "2026-10-06T10:30:00-03:00",
          booking_kind: "fit_in", fit_in: true, fit_in_reason: "gestante com dor", citizen: { id: "c2", cpf_masked: "***.111.222-**" } }),
        appointmentView({ id: "a3", scheduled_at: "2026-10-06T11:20:00-03:00", ends_at: "2026-10-06T11:40:00-03:00",
          outside_template: true, status: "scheduled", citizen: { id: "c3", cpf_masked: "***.333.444-**" } })
      ] },
      { id: "p2", name: "Marta Lima", shifts: [ agendaShift({ shift_id: "s2", cancelled_at: "2026-10-05T08:00:00-03:00" }) ],
        appointments: [ appointmentView({ id: "a4", shift_cancelled: true, professional: { id: "p2", name: "Marta Lima" },
          citizen: { id: "c4", cpf_masked: "***.555.666-**" } }) ] }
    ] }));
    renderAgenda();
    const helena = await screen.findByRole("region", { name: "Helena Duarte" });
    expect(within(helena).getByText("Turno 07:00–12:00 · encaixes 1 de 2")).not.toBeNull();
    expect(within(helena).getByText("09:00–11:00 · agendável · consulta_medica")).not.toBeNull();
    expect(within(helena).getByText("09:00–09:20")).not.toBeNull();
    expect(within(helena).getByText("encaixe")).not.toBeNull();
    expect(within(helena).getByText("gestante com dor")).not.toBeNull();
    expect(within(helena).getByText("fora do modelo")).not.toBeNull();
    expect(within(helena).getByText("aguardando confirmação")).not.toBeNull();
    const marta = screen.getByRole("region", { name: "Marta Lima" });
    expect(within(marta).getByText("Turno 07:00–12:00 · encaixes 1 de 2 · cancelado")).not.toBeNull();
    expect(within(marta).getByText("turno cancelado")).not.toBeNull();
  });

  it("motivo do encaixe só aparece quando o api manda (o api filtra por papel)", async () => {
    mocked(api.getUnitAgenda).mockResolvedValue(unitAgenda({ professionals: [
      { id: "p1", name: "Helena Duarte", shifts: [ agendaShift() ], appointments: [
        appointmentView({ id: "a2", booking_kind: "fit_in", fit_in: true }) ] }
    ] }));
    renderAgenda();
    const helena = await screen.findByRole("region", { name: "Helena Duarte" });
    expect(within(helena).getByText("encaixe")).not.toBeNull();
    expect(within(helena).queryByText("gestante com dor")).toBeNull();
  });

  // P9: legacy sai do api com tipo, fim, profissional e turno nulos
  // (appointment_presenter.rb:22-23); a coluna do tipo mostra "—".
  it("marcação livre aparece em 'Sem profissional', com o tipo como '—'", async () => {
    mocked(api.getUnitAgenda).mockResolvedValue(unitAgenda({ professionals: [], unassigned: [
      appointmentView({ id: "l1", booking_kind: "legacy", professional: null, ends_at: null, shift_id: null,
        appointment_type_key: null, appointment_type_name: null, scheduled_at: "2026-10-06T14:00:00-03:00" }) ] }));
    renderAgenda();
    const legacy = await screen.findByRole("region", { name: "Sem profissional (marcação livre)" });
    expect(within(legacy).getByText("14:00")).not.toBeNull();
    expect(within(legacy).getByText("***.982.247-**")).not.toBeNull();
    expect(within(legacy).getAllByText("—").length).toBe(2); // tipo e marcas
  });

  it("dia sem turno nem horário: estado vazio", async () => {
    mocked(api.getUnitAgenda).mockResolvedValue(unitAgenda({ professionals: [], unassigned: [] }));
    renderAgenda();
    expect(await screen.findByText("nenhum turno nem horário neste dia")).not.toBeNull();
  });

  it("seletor de data começa em hoje na cidade e trocar recarrega; usa a chave do encaixe", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-10-05T10:00:00-03:00"));
    mocked(api.getUnitAgenda).mockResolvedValue(unitAgenda({ professionals: [], unassigned: [] }));
    const { client } = renderAgenda();
    await waitFor(() => expect(api.getUnitAgenda).toHaveBeenCalledWith("u1", "2026-10-05"));
    expect((screen.getByLabelText("Data") as HTMLInputElement).value).toBe("2026-10-05");
    expect(client.getQueryData([ "unitAgenda", "u1", "2026-10-05" ])).toBeDefined();
    fireEvent.change(screen.getByLabelText("Data"), { target: { value: "2026-10-06" } });
    await waitFor(() => expect(api.getUnitAgenda).toHaveBeenCalledWith("u1", "2026-10-06"));
  });
});
