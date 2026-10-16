import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listPendingAcknowledgements: vi.fn(), listTeamAcknowledgements: vi.fn(), getExamOrder: vi.fn(), acknowledgeExam: vi.fn() };
});

import * as api from "../lib/api";
import { ExamAcknowledgements } from "./ExamAcknowledgements";
import { renderWithProviders } from "../test/campaignFixtures";
import { VALID_CNS, examOrder, examResult, examUser } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

describe("ExamAcknowledgements", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listPendingAcknowledgements, api.listTeamAcknowledgements, api.getExamOrder, api.acknowledgeExam ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser());
    mocked(api.listPendingAcknowledgements).mockResolvedValue({
      orders: [ examOrder({ status: "resulted", result: examResult({ critical: true }), overdue: { stage: "acknowledge", due_on: "2026-10-12", days_late: 1 } }) ],
      denied: [ examOrder({ id: "eo3", status: "denied", label: "Ressonância magnética de crânio" }) ],
      next_before: null
    });
    mocked(api.listTeamAcknowledgements).mockResolvedValue({
      orders: [ examOrder({ id: "eo4", status: "resulted", escalated: true, escalation_reasons: [ "unlinked_requester" ], result: examResult(), requester: { user_id: null, name: "Dr. Externo", cns: VALID_CNS },
        patient: { id: "pa2", display_name: "Carlos Dias" } }) ],
      next_before: null
    });
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "resulted", result: examResult() }));
  });

  it("aguardando ciência com crítico e atraso; negados; fila da equipe com o motivo", async () => {
    renderWithProviders(<ExamAcknowledgements />);
    const mine = await screen.findByRole("region", { name: "Aguardando sua ciência" });
    await within(mine).findByText("Joana Lima");
    expect(within(mine).getByText("crítico")).not.toBeNull();
    expect(within(mine).getByText("ciência · 1 dia de atraso")).not.toBeNull();
    const denied = screen.getByRole("region", { name: "Exames negados" });
    expect(within(denied).getByText("Ressonância magnética de crânio")).not.toBeNull();
    const team = screen.getByRole("region", { name: "Fila da equipe" });
    await within(team).findByText("Carlos Dias");
    expect(within(team).getByText("solicitante sem vínculo")).not.toBeNull();
    expect(within(team).getByText("Dr. Externo")).not.toBeNull();
    expect(api.getExamOrder).not.toHaveBeenCalled();
  });

  it("Abrir mostra o exame para dar ciência", async () => {
    renderWithProviders(<ExamAcknowledgements />);
    const mine = await screen.findByRole("region", { name: "Aguardando sua ciência" });
    fireEvent.click(await within(mine).findByRole("button", { name: "Abrir Hemograma completo de Joana Lima" }));
    expect(await screen.findByRole("region", { name: "Exame Hemograma completo" })).not.toBeNull();
    expect(api.getExamOrder).toHaveBeenCalledWith("eo1");
  });

  it("sem negados, o painel não aparece; listas vazias dizem isso", async () => {
    mocked(api.listPendingAcknowledgements).mockResolvedValue({ orders: [], denied: [], next_before: null });
    mocked(api.listTeamAcknowledgements).mockResolvedValue({ orders: [], next_before: null });
    renderWithProviders(<ExamAcknowledgements />);
    expect(await screen.findByText("nenhum resultado aguardando sua ciência")).not.toBeNull();
    expect(await screen.findByText("a fila da equipe está vazia")).not.toBeNull();
    expect(screen.queryByRole("region", { name: "Exames negados" })).toBeNull();
  });

  it("rastreamento desligado ou papel sem acesso", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "health_professional" ], { features: [] }));
    renderWithProviders(<ExamAcknowledgements />);
    expect(await screen.findByText("o rastreamento de exames está desligado nesta cidade")).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "citizen_verifier" ]));
    renderWithProviders(<ExamAcknowledgements />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.listPendingAcknowledgements).not.toHaveBeenCalled();
  });

  it("403 not_in_team: fila explica, sem alerta de erro", async () => {
    mocked(api.listTeamAcknowledgements).mockRejectedValue(new api.ApiError(403, { error: "not_in_team" }, "forbidden"));
    renderWithProviders(<ExamAcknowledgements />);
    expect(await screen.findByText("você não está numa equipe ativa desta unidade")).not.toBeNull();
    const team = screen.getByRole("region", { name: "Fila da equipe" });
    expect(within(team).queryByRole("alert")).toBeNull();
  });

  it("com próxima página: 50+ e Carregar mais usa o cursor", async () => {
    const first = Array.from({ length: 50 }, (_, i) => examOrder({ id: `p${i}`, status: "resulted", result: examResult(), patient: { id: `x${i}`, display_name: `Paciente ${i}` } }));
    mocked(api.listPendingAcknowledgements)
      .mockResolvedValueOnce({ orders: first, denied: [], next_before: "cur1" })
      .mockResolvedValue({ orders: [ examOrder({ id: "p50", status: "resulted", result: examResult(), patient: { id: "x50", display_name: "Paciente 50" } }) ], denied: [], next_before: null });
    renderWithProviders(<ExamAcknowledgements />);
    const mine = await screen.findByRole("region", { name: "Aguardando sua ciência" });
    await within(mine).findByText("Paciente 0");
    expect(within(mine).getByText("50+ resultados aguardando sua ciência")).not.toBeNull();
    fireEvent.click(within(mine).getByRole("button", { name: "Carregar mais" }));
    await within(mine).findByText("Paciente 50");
    expect(mocked(api.listPendingAcknowledgements)).toHaveBeenLastCalledWith("cur1");
  });

  it("409 invalid_transition ao dar ciência explica e relê", async () => {
    mocked(api.acknowledgeExam).mockRejectedValue(new api.ApiError(409, { error: "invalid_transition" }, "conflict"));
    renderWithProviders(<ExamAcknowledgements />);
    const mine = await screen.findByRole("region", { name: "Aguardando sua ciência" });
    fireEvent.click(await within(mine).findByRole("button", { name: "Abrir Hemograma completo de Joana Lima" }));
    const detail = await screen.findByRole("region", { name: "Exame Hemograma completo" });
    fireEvent.click(await within(detail).findByRole("button", { name: "Dar ciência" }));
    fireEvent.click(await within(detail).findByRole("button", { name: /confirmar|sim/i }));
    expect(await screen.findByText("a situação do exame mudou; a tela foi atualizada")).not.toBeNull();
    const calls = mocked(api.listPendingAcknowledgements).mock.calls.length;
    expect(calls).toBeGreaterThan(1);
  });

  it("negados mostram o motivo (texto escapado) ou — quando não há; singular no resumo", async () => {
    mocked(api.listPendingAcknowledgements).mockResolvedValue({
      orders: [ examOrder({ status: "resulted", result: examResult() }) ],
      denied: [
        { ...examOrder({ id: "eo3", status: "denied", label: "Ressonância magnética de crânio" }), denied_reason: "<b>sem indicação</b>" },
        { ...examOrder({ id: "eo5", status: "denied", label: "Tomografia" }), denied_reason: null }
      ],
      next_before: null
    });
    renderWithProviders(<ExamAcknowledgements />);
    const denied = await screen.findByRole("region", { name: "Exames negados" });
    expect(within(denied).getByText("<b>sem indicação</b>")).not.toBeNull();
    expect(within(denied).getByText("—")).not.toBeNull();
    expect(screen.getByText("1 resultado aguardando sua ciência")).not.toBeNull();
    expect(screen.queryByText(/1 resultados/)).toBeNull();
  });
});
