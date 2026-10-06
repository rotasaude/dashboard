import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, getUnitAgenda: vi.fn(), bookAppointment: vi.fn() };
});

import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { FitInPanel } from "./FitInPanel";
import { agendaShift, NOW, requestRow, unitAgenda } from "../../test/schedulingFixtures";
import { expectFrozenNotice } from "../../test/frozenNotice";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function renderIt() {
  const onDone = vi.fn();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  render(<FitInPanel row={requestRow()} unit={unit} date="2026-10-06" onBack={vi.fn()} onDone={onDone} />, { wrapper });
  return { onDone };
}
const submit = () => screen.getByRole("button", { name: "Confirmar encaixe" }) as HTMLButtonElement;
async function fill(reason = "gestante com dor abdominal") {
  const select = await screen.findByLabelText("Turno");
  await within(select).findByRole("option", { name: "Helena Duarte · 07:00–12:00 · encaixes 1 de 2" });
  fireEvent.change(select, { target: { value: "s1" } });
  fireEvent.change(screen.getByLabelText("Início do encaixe"), { target: { value: "10:10" } });
  fireEvent.change(screen.getByLabelText("Justificativa do encaixe"), { target: { value: reason } });
}

describe("FitInPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW));
    mocked(api.getUnitAgenda).mockResolvedValue(unitAgenda());
  });

  it("lista os turnos do dia com o contador; turno cancelado não entra", async () => {
    renderIt();
    const select = await screen.findByLabelText("Turno");
    await within(select).findByRole("option", { name: "Helena Duarte · 07:00–12:00 · encaixes 1 de 2" });
    expect(within(select).queryByRole("option", { name: /Marta Lima/ })).toBeNull();
    expect(api.getUnitAgenda).toHaveBeenCalledWith("u1", "2026-10-06");
  });

  it("dia só com turno cancelado: sem turno para encaixar", async () => {
    mocked(api.getUnitAgenda).mockResolvedValue(unitAgenda({ professionals: [
      { id: "p2", name: "Marta Lima", shifts: [ agendaShift({ shift_id: "s2", cancelled_at: "2026-10-05T08:00:00-03:00" }) ], appointments: [] } ] }));
    renderIt();
    expect(await screen.findByText("nenhum turno ativo neste dia para encaixar")).not.toBeNull();
    expect(submit().disabled).toBe(true);
  });

  it("justificativa curta trava; completa manda o encaixe no fuso da cidade", async () => {
    const { onDone } = renderIt();
    mocked(api.bookAppointment).mockResolvedValue({ id: "a9", scheduled_at: "x", status: "confirmed", confirmation_deadline_at: null });
    await fill("dor");
    expect(screen.getByText("Encaixes neste turno: 1 de 2")).not.toBeNull();
    expect(submit().disabled).toBe(true);
    expectFrozenNotice(screen.getByLabelText("Justificativa do encaixe"));
    fireEvent.change(screen.getByLabelText("Justificativa do encaixe"), { target: { value: "gestante com dor abdominal" } });
    expect(submit().disabled).toBe(false);
    fireEvent.click(submit());
    await waitFor(() => expect(api.bookAppointment).toHaveBeenCalledWith("r1", "u1", {
      kind: "fit_in", professional_id: "p1", shift_id: "s1", starts_at: "2026-10-06T10:10:00-03:00",
      appointment_type_key: "consulta_medica", reason: "gestante com dor abdominal"
    }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
  });

  it("início fora do turno trava antes da API", async () => {
    renderIt();
    await fill();
    fireEvent.change(screen.getByLabelText("Início do encaixe"), { target: { value: "13:00" } });
    expect(screen.getByText("o encaixe precisa começar dentro do turno (07:00–12:00)")).not.toBeNull();
    expect(submit().disabled).toBe(true);
  });

  it("turno no limite: aviso e botão travado", async () => {
    mocked(api.getUnitAgenda).mockResolvedValue(unitAgenda({ professionals: [
      { id: "p1", name: "Helena Duarte", shifts: [ agendaShift({ fit_in_count: 2 }) ], appointments: [] } ] }));
    renderIt();
    const select = await screen.findByLabelText("Turno");
    await within(select).findByRole("option", { name: "Helena Duarte · 07:00–12:00 · encaixes 2 de 2" });
    fireEvent.change(select, { target: { value: "s1" } });
    expect(screen.getByText("limite de encaixes atingido neste turno")).not.toBeNull();
    expect(submit().disabled).toBe(true);
  });

  it("fit_in_limit recarrega o contador e trava o botão", async () => {
    mocked(api.getUnitAgenda)
      .mockResolvedValueOnce(unitAgenda())
      .mockResolvedValue(unitAgenda({ professionals: [
        { id: "p1", name: "Helena Duarte", shifts: [ agendaShift({ fit_in_count: 2 }) ], appointments: [] } ] }));
    mocked(api.bookAppointment).mockRejectedValueOnce(new ApiError(409, { error: "fit_in_limit" }, "x"));
    const { onDone } = renderIt();
    await fill();
    fireEvent.click(submit());
    expect(await screen.findByText("o turno já chegou ao limite de encaixes")).not.toBeNull();
    expect(await screen.findByText("Encaixes neste turno: 2 de 2")).not.toBeNull();
    expect(api.getUnitAgenda).toHaveBeenCalledTimes(2);
    expect(submit().disabled).toBe(true);
    expect(onDone).not.toHaveBeenCalled();
  });

  // P7/P11: a tela só confere o início; o fim (início + duração do tipo) é o
  // api quem confere, com 422 outside_shift.
  it("type_not_served e outside_shift aparecem traduzidos", async () => {
    mocked(api.bookAppointment)
      .mockRejectedValueOnce(new ApiError(422, { error: "type_not_served" }, "x"))
      .mockRejectedValueOnce(new ApiError(422, { error: "outside_shift" }, "x"));
    const { onDone } = renderIt();
    await fill();
    fireEvent.click(submit());
    expect(await screen.findByText("este profissional não atende este tipo de atendimento")).not.toBeNull();
    fireEvent.change(screen.getByLabelText("Início do encaixe"), { target: { value: "11:50" } });
    await waitFor(() => expect(submit().disabled).toBe(false));
    fireEvent.click(submit());
    expect(await screen.findByText("o encaixe precisa começar e terminar dentro do turno")).not.toBeNull();
    expect(screen.queryByText("este profissional não atende este tipo de atendimento")).toBeNull();
    expect(api.bookAppointment).toHaveBeenCalledTimes(2);
    expect(onDone).not.toHaveBeenCalled();
  });
});
