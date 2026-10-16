import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getExamOrder: vi.fn(), listEnabledProviders: vi.fn(), setGalRequisition: vi.fn() };
});

import * as api from "../../lib/api";
import { ExamOrderDetail } from "./ExamOrderDetail";
import { renderWithProviders } from "../../test/campaignFixtures";
import { examOrder, examResult, examUser } from "../../test/examFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getExamOrder, api.listEnabledProviders, api.setGalRequisition ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "health_professional" ], { features: [ "clinical_record", "exam_tracking", "municipal_lab" ] }));
  mocked(api.listEnabledProviders).mockResolvedValue([]);
  mocked(api.setGalRequisition).mockResolvedValue(undefined);
});

describe("ExamOrderDetail — 21b", () => {
  it("origem lab_reception e laudo substituído só como histórico", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({
      origin: "lab_reception", status: "resulted",
      result: examResult({ id: "er2", source: "lab", replaces_result_id: "er1" }),
      superseded_results: [ examResult({ id: "er1", source: "lab", superseded_at: "2026-10-15T11:00:00-03:00" }) ]
    }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    expect(await screen.findByText("recepção do laboratório")).not.toBeNull();
    const old = screen.getByRole("region", { name: "Laudos substituídos" });
    expect(within(old).getByText("o cidadão vê só o laudo vigente")).not.toBeNull();
    expect(within(old).getByRole("region", { name: "Resultado substituído" })).not.toBeNull();
  });

  it("GAL: a unidade registra o número", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "scheduled", gal_requisition: null }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar requisição do GAL" }));
    fireEvent.change(screen.getByLabelText("Número da requisição no GAL"), { target: { value: "GAL 2026/77" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar número do GAL" }));
    expect(screen.getByRole("alert").textContent).toBe("número do GAL inválido — use letras, números e hífen (até 30)");
    fireEvent.change(screen.getByLabelText("Número da requisição no GAL"), { target: { value: "GAL-2026-77" } });
    // o ActionButton ainda está "ocupado" (" …") até a promessa da validação assentar
    fireEvent.click(await screen.findByRole("button", { name: "Salvar número do GAL" }));
    await waitFor(() => expect(api.setGalRequisition).toHaveBeenCalledWith("eo1", "GAL-2026-77"));
    await waitFor(() => expect(api.getExamOrder).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("Requisição do GAL registrada.")).not.toBeNull();
    expect(screen.queryByLabelText("Número da requisição no GAL")).toBeNull();
    expect(api.getExamOrder).toHaveBeenCalledTimes(2);
  });

  it("GAL: sem o interruptor municipal_lab a tela do 21a fica como antes (I5)", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "health_professional" ]));
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "scheduled", gal_requisition: null }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    await screen.findByText("Hemograma completo");
    expect(screen.queryByRole("button", { name: "Registrar requisição do GAL" })).toBeNull();
  });

  it("GAL: só recepção e profissional", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(examUser([ "exam_regulator" ]));
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "scheduled", gal_requisition: null }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    await screen.findByText("Hemograma completo");
    expect(screen.queryByRole("button", { name: "Registrar requisição do GAL" })).toBeNull();
  });

  it.each([ "denied", "cancelled" ])("GAL: escondido com o exame %s", async (status) => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status, gal_requisition: null }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    await screen.findByText("Hemograma completo");
    expect(screen.queryByRole("button", { name: "Registrar requisição do GAL" })).toBeNull();
  });

  it("GAL já registrado: mostra o número e não oferece trocar (B5)", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "scheduled", gal_requisition: "GAL-1" }));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    expect(await screen.findByText("GAL-1")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /requisição do GAL/ })).toBeNull();
  });

  it("gal_already_registered (409) vira frase no formulário", async () => {
    mocked(api.getExamOrder).mockResolvedValue(examOrder({ status: "scheduled", gal_requisition: null }));
    mocked(api.setGalRequisition).mockRejectedValue(new api.ApiError(409, { error: "gal_already_registered" }, "x"));
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar requisição do GAL" }));
    fireEvent.change(screen.getByLabelText("Número da requisição no GAL"), { target: { value: "GAL-2" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar número do GAL" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a requisição do GAL deste exame já foi registrada");
  });

  it("api sem o campo GAL: nada de GAL na tela", async () => {
    const order = examOrder({ status: "scheduled" });
    delete (order as { gal_requisition?: unknown }).gal_requisition;
    mocked(api.getExamOrder).mockResolvedValue(order);
    renderWithProviders(<ExamOrderDetail id="eo1" onClose={vi.fn()} />);
    await screen.findByText("Hemograma completo");
    expect(screen.queryByRole("button", { name: "Registrar requisição do GAL" })).toBeNull();
  });
});
