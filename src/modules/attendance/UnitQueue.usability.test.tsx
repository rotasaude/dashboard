// Usabilidade da fila (spec 6b, achados FC-01..FC-19 do percurso de 2026-10-12).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listUnitQueue: vi.fn(), callAttendance: vi.fn(), callNext: vi.fn(),
    closeAttendance: vi.fn(), getScreening: vi.fn() };
});
vi.mock("../consultation/ConsultationWorkspace", () => ({
  ConsultationWorkspace: (p: { attendanceId: string }) => <div>{`consulta de ${p.attendanceId}`}</div>
}));

import * as api from "../../lib/api";
import type { QueueRow } from "../../lib/api";
import { AuthProvider } from "../../lib/auth";
import { UnitQueue } from "./UnitQueue";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const unit = { id: "u1", name: "UBS Centro", kind: "ubs" };

function row(over: Partial<QueueRow>): QueueRow {
  return { id: "a1", cpf_masked: "***.982.247-**", checked_in_at: "2026-10-12T12:00:00Z", protocol_name: null, priority: 1,
    source: "triage", appointment_time: null, called_at: null, called_by_name: null, screening: null, display_name: null, ...over };
}
const w1 = row({ id: "a1", display_name: "Luíza Alves", cpf_masked: "***.343.399-**" });
const w2 = row({ id: "a2", cpf_masked: "***.111.222-**" });
const c1 = row({ id: "c1", display_name: "Carlos Souza", cpf_masked: "***.333.444-**", called_at: "2026-10-12T13:00:00Z", called_by_name: "Dra. Helena" });
const c2 = row({ id: "c2", display_name: "Ana Reis", cpf_masked: "***.555.666-**", called_at: "2026-10-12T13:10:00Z", called_by_name: "Dra. Helena" });

function session() {
  return { id: "us1", email_address: "x@cidade.gov.br", operator: false, mfa_enrolled: true, mfa_verified_at: null,
    memberships: [ { city_slug: "m1", city_name: "Curitiba", city_uf: "PR", role: "health_professional" } ], features: [ "clinical_record" ] };
}

function renderQueue(props: { canCare: boolean; clinicalRecord?: boolean; now?: () => Date }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) =>
    <QueryClientProvider client={client}><AuthProvider>{children}</AuthProvider></QueryClientProvider>;
  render(<UnitQueue unit={unit} units={[ unit ]} {...props} />, { wrapper });
  return { client };
}

describe("UnitQueue — usabilidade (6b)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listUnitQueue, api.callAttendance, api.callNext, api.closeAttendance, api.getScreening ]) {
      mocked(fn).mockReset();
    }
    mocked(api.fetchCurrentSession).mockResolvedValue(session());
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ w1, w2 ], in_care: [] });
    mocked(api.closeAttendance).mockResolvedValue({ attendance: { id: "a1" }, appointmentRequest: null });
  });

  it("FC-01: 'Saiu sem atendimento' pede confirmação nomeando a pessoa e só então encerra", async () => {
    renderQueue({ canCare: false, clinicalRecord: true });
    fireEvent.click((await screen.findAllByRole("button", { name: "Saiu sem atendimento" }))[0]);
    expect(api.closeAttendance).not.toHaveBeenCalled();
    expect(screen.getByRole("group", { name: "Confirmar que Luíza Alves saiu sem atendimento?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.closeAttendance).toHaveBeenCalledWith("a1", "left", undefined, undefined));
    expect((await screen.findByRole("status")).textContent).toBe("Luíza Alves marcado como saiu sem atendimento");
  });

  it("FC-02: a mensagem da ação anterior some quando outra ação começa", async () => {
    mocked(api.callAttendance).mockResolvedValue({ attendance: { id: "a2", screening: null } });
    renderQueue({ canCare: true, clinicalRecord: true });
    fireEvent.click((await screen.findAllByRole("button", { name: "Saiu sem atendimento" }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Luíza Alves marcado como saiu sem atendimento")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Chamar" })[1]);
    await waitFor(() => expect(screen.queryByText("Luíza Alves marcado como saiu sem atendimento")).toBeNull());
  });

  it("FC-04/FC-13: Encerrar rola até o painel e foca o título com a pessoa; Escape fecha e devolve o foco", async () => {
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: [ c1 ] });
    const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
    renderQueue({ canCare: true, clinicalRecord: true });
    const opener = await screen.findByRole("button", { name: "Encerrar" });
    opener.focus();
    fireEvent.click(opener);
    const title = screen.getByRole("heading", { name: "Encerrar atendimento de Carlos Souza" });
    expect(scroll).toHaveBeenCalled();
    expect(document.activeElement).toBe(title);
    fireEvent.keyDown(title, { key: "Escape" });
    expect(screen.queryByRole("heading", { name: /Encerrar atendimento de/ })).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("FC-03: o painel da consulta diz de quem é e só fecha quando ESSA pessoa sai de Em atendimento", async () => {
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: [ c1, c2 ] });
    const { client } = renderQueue({ canCare: true, clinicalRecord: true });
    fireEvent.click((await screen.findAllByRole("button", { name: "Consulta" }))[0]);
    expect(screen.getByRole("heading", { name: /^Consulta de Carlos Souza · chamada às/ })).toBeTruthy();

    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: [ c1 ] });
    await act(async () => { await client.invalidateQueries({ queryKey: [ "unitQueue", "u1" ] }); });
    expect(screen.getByText("consulta de c1")).toBeTruthy();

    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [], in_care: [] });
    await act(async () => { await client.invalidateQueries({ queryKey: [ "unitQueue", "u1" ] }); });
    await waitFor(() => expect(screen.queryByText("consulta de c1")).toBeNull());
  });

  it("FC-05: Chamar mantém o foco no botão durante a chamada", async () => {
    let resolve!: (v: unknown) => void;
    mocked(api.callAttendance).mockReturnValue(new Promise((r) => { resolve = r; }));
    renderQueue({ canCare: true, clinicalRecord: true });
    const call = (await screen.findAllByRole("button", { name: "Chamar" }))[0];
    call.focus();
    fireEvent.click(call);
    expect(call.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(call);
    await act(async () => { resolve({ attendance: { id: "a1", screening: null } }); });
  });

  it("FC-19: a mesma pessoa não se repete em Aguardando nem aparece também em Em atendimento", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    mocked(api.listUnitQueue).mockResolvedValue({ waiting: [ w1, w1, w2, c1 ], in_care: [ c1 ] });
    renderQueue({ canCare: false, clinicalRecord: true });
    const waitingSection = (await screen.findByText("Aguardando")).parentElement as HTMLElement;
    expect(within(waitingSection).getAllByRole("button", { name: "Saiu sem atendimento" })).toHaveLength(2);
    expect(within(waitingSection).queryByText("Carlos Souza")).toBeNull();
    expect(error.mock.calls.some((c) => String(c[0]).includes("same key"))).toBe(false);
    error.mockRestore();
  });
});
