// src/modules/ExamsOverdue.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listExamOrders: vi.fn(), listEnabledProviders: vi.fn(), listExamCatalog: vi.fn(), getExamOrder: vi.fn() };
});

import * as api from "../lib/api";
import { ExamsOverdue } from "./ExamsOverdue";
import { OverduePanel } from "./exams/OverduePanel";
import { renderWithProviders } from "../test/campaignFixtures";
import { HBA1C_ENTRY, HEMOGRAM_ENTRY, examOrder, examUser } from "../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

describe("Exames atrasados", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listExamOrders, api.listEnabledProviders, api.listExamCatalog, api.getExamOrder ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "citizen_verifier" ]));
    mocked(api.listExamOrders).mockResolvedValue({
      orders: [ examOrder({ status: "scheduled", overdue: { stage: "collect", due_on: "2026-10-10", days_late: 3 } }) ], next_before: null
    });
    mocked(api.listEnabledProviders).mockResolvedValue([ { id: "pv1", name: "Laboratório Simulado" } ]);
    mocked(api.listExamCatalog).mockResolvedValue([ HEMOGRAM_ENTRY, HBA1C_ENTRY ]);
    mocked(api.getExamOrder).mockResolvedValue(examOrder());
  });

  it("unidade: etapa, prestador e exame vão para a consulta; linha com etapa e dias", async () => {
    renderWithProviders(<OverduePanel unitId="u1" canOpen />);
    const panel = await screen.findByRole("region", { name: "Exames atrasados" });
    await waitFor(() => expect(api.listExamOrders).toHaveBeenCalledWith({ overdue: true, before: null, unitId: "u1" }));
    expect(await within(panel).findByText("3 dias de atraso")).not.toBeNull();
    // "coleta" também é opção do filtro de etapa: confira na linha.
    expect(within(within(panel).getAllByRole("row")[1]).getByText("coleta")).not.toBeNull();
    fireEvent.change(within(panel).getByLabelText("Etapa"), { target: { value: "collect" } });
    fireEvent.change(await within(panel).findByLabelText("Prestador"), { target: { value: "pv1" } });
    fireEvent.change(await within(panel).findByLabelText("Exame"), { target: { value: "0202020380" } });
    await waitFor(() => expect(api.listExamOrders).toHaveBeenLastCalledWith({
      overdue: true, before: null, unitId: "u1", stage: "collect", providerId: "pv1", sigtapCode: "0202020380"
    }));
    expect(within(panel).getByRole("status").textContent).toBe("1 exame atrasado");
    fireEvent.click(within(panel).getByRole("button", { name: "Abrir Hemograma completo de Joana Lima" }));
    expect(await screen.findByRole("region", { name: "Exame Hemograma completo" })).not.toBeNull();
  });

  it("coordenação: a cidade inteira, com a unidade e sem abrir o exame", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "exam_regulator" ]));
    renderWithProviders(<ExamsOverdue />);
    const panel = await screen.findByRole("region", { name: "Exames atrasados" });
    await waitFor(() => expect(api.listExamOrders).toHaveBeenCalledWith({ overdue: true, before: null }));
    expect(await within(panel).findByText("UBS Centro")).not.toBeNull();
    expect(within(panel).queryByRole("button", { name: /^Abrir/ })).toBeNull();
  });

  it("coordenação é do admin e do regulador", async () => {
    renderWithProviders(<ExamsOverdue />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.listExamOrders).not.toHaveBeenCalled();
  });

  it("sem atualização automática: só relê quando o usuário pede", async () => {
    renderWithProviders(<OverduePanel unitId="u1" canOpen />);
    const panel = await screen.findByRole("region", { name: "Exames atrasados" });
    await within(panel).findByText("3 dias de atraso");
    const calls = mocked(api.listExamOrders).mock.calls.length;
    fireEvent.click(within(panel).getByRole("button", { name: "Atualizar" }));
    await waitFor(() => expect(mocked(api.listExamOrders).mock.calls.length).toBe(calls + 1));
  });
});
