// src/modules/consultation/PatientPanel.exams.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listExamOrders: vi.fn(), listExternalResults: vi.fn() };
});

import * as api from "../../lib/api";
import { PatientPanel } from "./PatientPanel";
import { renderWithProviders } from "../../test/campaignFixtures";
import { record } from "../../test/consultationFixtures";
import { examUser } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

describe("PatientPanel — aba Exames (módulo 21a)", () => {
  beforeEach(() => {
    for (const fn of [ api.fetchCurrentSession, api.listExamOrders, api.listExternalResults ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser());
    mocked(api.listExamOrders).mockResolvedValue({ orders: [], next_before: null });
    mocked(api.listExternalResults).mockResolvedValue([]);
  });

  it("com exams: abas Resumo e Exames; a lista só lê ao abrir a aba", async () => {
    renderWithProviders(<PatientPanel record={record()} onOpenConsultation={vi.fn()} exams={{ patientId: "pa1" }} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual([ "Resumo", "Exames" ]);
    expect(api.listExamOrders).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("tab", { name: "Exames" }));
    expect(await screen.findByText("nenhum exame pedido")).not.toBeNull();
    expect(api.listExamOrders).toHaveBeenCalledWith({ patientId: "pa1", before: null });
    fireEvent.click(screen.getByRole("tab", { name: "Resumo" }));
    expect(screen.getByText("Problemas ativos")).not.toBeNull();
  });

  it("sem exams nem timeline: sem abas (como antes)", () => {
    renderWithProviders(<PatientPanel record={record()} onOpenConsultation={vi.fn()} />);
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
  });
});
