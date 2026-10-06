import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getMyAgenda: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { AuthProvider } from "../lib/auth";
import { MyAgenda } from "./MyAgenda";
import { MORNING, NOW, appointmentView } from "../test/schedulingFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

function renderIt() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<MyAgenda />, { wrapper });
}

const DAY: api.MyAgenda = { days: [ { date: "2026-10-05", shifts: [
  { shift_id: "s1", unit: { id: "u1", name: "UBS Centro" }, starts_at: "2026-10-05T07:00:00-03:00",
    ends_at: "2026-10-05T12:00:00-03:00", cancelled_at: null, blocks: MORNING.blocks,
    appointments: [ appointmentView({ scheduled_at: "2026-10-05T09:00:00-03:00", ends_at: "2026-10-05T09:20:00-03:00" }) ] } ] } ] };

describe("MyAgenda", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW));
    mocked(api.fetchCurrentSession).mockResolvedValue({ id: "u-prof", email_address: "medica@c.gov.br", operator: false,
      mfa_enrolled: true, mfa_verified_at: null,
      memberships: [ { city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role: "health_professional" } ] });
    mocked(api.getMyAgenda).mockResolvedValue(DAY);
  });

  it("dia: pede hoje a hoje e mostra unidade, faixas e horários, sem botão de ação", async () => {
    renderIt();
    await waitFor(() => expect(api.getMyAgenda).toHaveBeenCalledWith("2026-10-05", "2026-10-05"));
    const day = await screen.findByRole("region", { name: "seg 05/10" });
    expect(within(day).getByText("UBS Centro")).not.toBeNull();
    expect(within(day).getByText("Turno 07:00–12:00")).not.toBeNull();
    expect(within(day).getByText("09:00–11:00 · agendável · consulta_medica")).not.toBeNull();
    expect(within(day).getByText("09:00–09:20")).not.toBeNull();
    expect(within(day).getByText("***.982.247-**")).not.toBeNull();
    expect(within(day).queryAllByRole("button")).toHaveLength(0);
  });

  it("turno cancelado aparece marcado", async () => {
    mocked(api.getMyAgenda).mockResolvedValue({ days: [ { date: "2026-10-05", shifts: [
      { ...DAY.days[0].shifts[0], cancelled_at: "2026-10-04T18:00:00-03:00", appointments: [] } ] } ] });
    renderIt();
    expect(await screen.findByText("Turno 07:00–12:00 · cancelado")).not.toBeNull();
  });

  it("semana pede de segunda a domingo; próximo avança 7 dias", async () => {
    vi.setSystemTime(new Date("2026-10-08T10:00:00-03:00")); // quinta
    renderIt();
    await waitFor(() => expect(api.getMyAgenda).toHaveBeenCalledWith("2026-10-08", "2026-10-08"));
    fireEvent.click(await screen.findByRole("tab", { name: "Semana" }));
    await waitFor(() => expect(api.getMyAgenda).toHaveBeenLastCalledWith("2026-10-05", "2026-10-11"));
    fireEvent.click(screen.getByRole("button", { name: "próximo →" }));
    await waitFor(() => expect(api.getMyAgenda).toHaveBeenLastCalledWith("2026-10-12", "2026-10-18"));
  });

  it("semana num domingo ainda começa na segunda anterior (fuso da cidade)", async () => {
    // 2026-10-12T01:00Z = domingo 11/10 22:00 em São Paulo.
    vi.setSystemTime(new Date("2026-10-12T01:00:00Z"));
    renderIt();
    await waitFor(() => expect(api.getMyAgenda).toHaveBeenCalledWith("2026-10-11", "2026-10-11"));
    fireEvent.click(await screen.findByRole("tab", { name: "Semana" }));
    await waitFor(() => expect(api.getMyAgenda).toHaveBeenLastCalledWith("2026-10-05", "2026-10-11"));
  });

  it("dia sem turno: estado vazio", async () => {
    // O api sempre devolve um item por dia, com shifts vazio (professional_agenda.rb).
    mocked(api.getMyAgenda).mockResolvedValue({ days: [ { date: "2026-10-05", shifts: [] } ] });
    renderIt();
    expect(await screen.findByText("nenhum turno no período")).not.toBeNull();
  });

  it("sem cadastro profissional (404): a frase de 'Meu perfil'", async () => {
    mocked(api.getMyAgenda).mockRejectedValue(new ApiError(404, { error: "no_profile" }, "x"));
    renderIt();
    expect(await screen.findByText("Seu cadastro profissional ainda não foi feito. Fale com a administração da cidade.")).not.toBeNull();
  });

  it("sem o papel (403 missing_role): mensagem traduzida", async () => {
    mocked(api.getMyAgenda).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "x"));
    renderIt();
    expect((await screen.findByRole("alert")).textContent).toBe("seu papel não permite esta ação");
  });
});
