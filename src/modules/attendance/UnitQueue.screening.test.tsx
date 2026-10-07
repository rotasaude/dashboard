// src/modules/attendance/UnitQueue.screening.test.tsx
// Módulo 18: cor, destaque do vermelho, espera, escuta no atendimento chamado e reavaliação.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listUnitQueue: vi.fn(), callAttendance: vi.fn(), callNext: vi.fn(),
    closeAttendance: vi.fn(), getScreening: vi.fn() };
});
vi.mock("./ScreeningForm", () => ({
  ScreeningForm: (p: { mode: string; screening: { id: string }; onDone(s: unknown): void }) => (
    <div>
      <span>{`formulário ${p.mode} ${p.screening.id}`}</span>
      <button type="button" onClick={() => p.onDone(p.screening)}>salvar formulário</button>
    </div>
  )
}));

import * as api from "../../lib/api";
import type { QueueRow } from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { UnitQueue } from "./UnitQueue";
import { NOW18, revision, screening } from "../../test/screeningFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function row(over: Partial<QueueRow>): QueueRow {
  return { id: "a1", cpf_masked: "***.982.247-**", checked_in_at: "2026-10-07T09:20:00-03:00", protocol_name: null, priority: null,
    source: "triage", appointment_time: null, called_at: null, called_by_name: null, screening: null, ...over };
}
const red = row({ id: "a1", screening: { id: "sc1", color: "red", destination: "same_day", waited_minutes: 25 } });
const plain = row({ id: "a2", cpf_masked: "***.111.222-**", checked_in_at: "2026-10-07T09:00:00-03:00" });
const noScreening = row({ id: "a4", cpf_masked: "***.555.666-**", screening: null });
const awaiting = row({ id: "a5", cpf_masked: "***.777.888-**", awaiting_screening: true });
const inCare = row({ id: "a3", cpf_masked: "***.333.444-**", called_at: "2026-10-07T09:50:00-03:00", called_by_name: "Dra. Helena",
  screening: { id: "sc3", color: "yellow", destination: "same_day", waited_minutes: 30 } });

function session(role: string) {
  return { id: "us1", email_address: "x@cidade.gov.br", operator: false, mfa_enrolled: true, mfa_verified_at: null,
    memberships: [ { city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role } ] };
}
function renderQueue(canCare: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<UnitQueue unit={unit} units={[ unit ]} canCare={canCare} />, { wrapper });
}
const waitingRows = async () => {
  const section = (await screen.findByText("Aguardando")).parentElement as HTMLElement;
  return within(section).getAllByRole("row").slice(1);
};

describe("UnitQueue — acolhimento (módulo 18)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listUnitQueue, api.callAttendance, api.callNext, api.closeAttendance, api.getScreening ]) {
      mocked(fn).mockReset();
    }
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date(NOW18));
    mocked(api.fetchCurrentSession).mockResolvedValue(session("health_professional"));
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ red, plain, noScreening ], in_care: [ inCare ] });
  });

  it("cor, vermelho destacado e espera (da escuta ou desde a chegada)", async () => {
    renderQueue(true);
    const rows = await waitingRows();
    expect(within(rows[0]).getByText("vermelho")).not.toBeNull();
    expect(rows[0].style.background).toBe("var(--down-bg)");
    expect(within(rows[0]).getByText("25 min")).not.toBeNull();
    expect(rows[1].style.background).toBe("transparent");
    expect(within(rows[1]).getByText("1 h 00 min")).not.toBeNull();
  });

  it("recepção vê só a cor: sem Reavaliar nem Ver escuta, e nada é lido", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(session("citizen_verifier"));
    renderQueue(false);
    const rows = await waitingRows();
    expect(within(rows[0]).getByText("vermelho")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Reavaliar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver escuta" })).toBeNull();
    expect(api.getScreening).not.toHaveBeenCalled();
  });

  it("chamar mostra a escuta que veio na chamada", async () => {
    mocked(api.callAttendance).mockResolvedValue({ attendance: { id: "a1",
      screening: screening({ status: "completed", destination: "same_day", current_revision: revision(), revisions_count: 1 }) } } as never);
    renderQueue(true);
    const rows = await waitingRows();
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Chamar" }));
    const detail = await screen.findByRole("region", { name: "Escuta inicial do atendimento" });
    expect(within(detail).getByText("K86")).not.toBeNull();
    expect(within(detail).getByText("Pressão sistólica: 185 mmHg")).not.toBeNull();
    expect(within(detail).getByText("Pressão sistólica: acima da faixa de alerta · Pressão diastólica: acima da faixa de alerta")).not.toBeNull();
    expect(api.getScreening).not.toHaveBeenCalled();
    fireEvent.click(within(detail).getByRole("button", { name: "Fechar escuta" }));
    expect(screen.queryByRole("region", { name: "Escuta inicial do atendimento" })).toBeNull();
  });

  it("Ver escuta lê pelo id (trilha de leitura) e mostra as revisões anteriores", async () => {
    const older = revision({ id: "rv0", final_color: "red", created_at: "2026-10-07T09:10:00-03:00" });
    mocked(api.getScreening).mockResolvedValue(screening({ id: "sc3", status: "completed", destination: "same_day",
      current_revision: revision({ final_color: "yellow" }), revisions: [ older, revision({ final_color: "yellow" }) ], revisions_count: 2 }));
    renderQueue(true);
    fireEvent.click(await screen.findByRole("button", { name: "Ver escuta" }));
    const detail = await screen.findByRole("region", { name: "Escuta inicial do atendimento" });
    expect(api.getScreening).toHaveBeenCalledWith("sc3");
    expect(within(detail).getByText("2 revisões")).not.toBeNull();
    expect(within(detail).getByText("07/10/2026, 09:10 · Enf. Lúcia Prado · vermelho · K86")).not.toBeNull();
  });

  it("Reavaliar só em quem espera com escuta no dia; salvar recarrega e avisa", async () => {
    mocked(api.getScreening).mockResolvedValue(screening({ status: "completed", destination: "same_day", current_revision: revision() }));
    renderQueue(true);
    const rows = await waitingRows();
    expect(within(rows[1]).queryByRole("button", { name: "Reavaliar" })).toBeNull();
    expect(within(rows[2]).queryByRole("button", { name: "Reavaliar" })).toBeNull();
    expect(within(rows[2]).queryByText("vermelho")).toBeNull();
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Reavaliar" }));
    expect(await screen.findByText("formulário reassess sc1")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "salvar formulário" }));
    expect(await screen.findByText("Reavaliação registrada.")).not.toBeNull();
    await waitFor(() => expect(api.listUnitQueue).toHaveBeenCalledTimes(2));
  });

  it("sem escuta (screening: null) não há cor, Ver escuta nem Reavaliar", async () => {
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ noScreening ], in_care: [ { ...inCare, screening: null } ] });
    renderQueue(true);
    const rows = await waitingRows();
    expect(within(rows[0]).queryByText(/vermelho|amarelo|verde|azul|aguardando acolhimento/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Reavaliar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Ver escuta" })).toBeNull();
  });

  it.each([ [ "profissional", true, "health_professional" ], [ "recepção", false, "citizen_verifier" ] ])(
    "marcador neutro 'aguardando acolhimento' só na linha sinalizada (%s)", async (_n, canCare, role) => {
      mocked(api.fetchCurrentSession).mockResolvedValue(session(role));
      mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ awaiting, plain ], in_care: [] });
      renderQueue(canCare);
      const rows = await waitingRows();
      expect(within(rows[0]).getByText("aguardando acolhimento")).not.toBeNull();
      expect(within(rows[1]).queryByText("aguardando acolhimento")).toBeNull();
    });

  it("o marcador não tem o estilo do azul (baixo risco)", async () => {
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ awaiting, { ...plain, screening: { id: "scb", color: "blue", destination: "same_day", waited_minutes: 3 } } ], in_care: [] });
    renderQueue(true);
    const rows = await waitingRows();
    const marker = within(rows[0]).getByText("aguardando acolhimento");
    const blue = within(rows[1]).getByText("azul");
    expect(marker.style.color).not.toBe(blue.style.color);
    expect(marker.style.background).not.toBe(blue.style.background);
  });

  it("Ver escuta recusada: mostra a frase, Fechar escuta funciona e a recusa clínica é tratada", async () => {
    const onClinicalRefused = vi.fn();
    mocked(api.getScreening).mockRejectedValue(new api.ApiError(403, { error: "missing_link" }, "403"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider>
      <UnitQueue unit={unit} units={[ unit ]} canCare onClinicalRefused={onClinicalRefused} /></AuthProvider></QueryClientProvider>);
    fireEvent.click(await screen.findByRole("button", { name: "Ver escuta" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    await waitFor(() => expect(onClinicalRefused).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Fechar escuta" }));
    expect(screen.queryByRole("region", { name: "Leitura da escuta" })).toBeNull();
  });

  it("Reavaliar recusado trata a recusa clínica e mostra a frase", async () => {
    const onClinicalRefused = vi.fn();
    mocked(api.getScreening).mockRejectedValue(new api.ApiError(403, { error: "missing_link" }, "403"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><AuthProvider>
      <UnitQueue unit={unit} units={[ unit ]} canCare onClinicalRefused={onClinicalRefused} /></AuthProvider></QueryClientProvider>);
    const rows = await waitingRows();
    fireEvent.click(within(rows[0]).getByRole("button", { name: "Reavaliar" }));
    expect(await screen.findByRole("alert")).not.toBeNull();
    expect(onClinicalRefused).toHaveBeenCalled();
  });
});
