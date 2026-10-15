// src/modules/lab/LabRequisitionDetail.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabRequisition: vi.fn(), fetchLabReceipt: vi.fn(), fetchLabLabels: vi.fn(),
    deliverRequisition: vi.fn() };
});

import * as api from "../../lib/api";
import { LabRequisitionDetail } from "./LabRequisitionDetail";
import { renderWithProviders } from "../../test/campaignFixtures";
import { labReport, labRequisition, labSample, labUser } from "../../test/labFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const PDF = { blob: new Blob([ "%PDF" ]), filename: null };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

beforeEach(() => {
  for (const fn of [ api.fetchCurrentSession, api.getLabRequisition, api.fetchLabReceipt, api.fetchLabLabels, api.deliverRequisition ]) mocked(fn).mockReset();
  mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
  mocked(api.getLabRequisition).mockResolvedValue(labRequisition({
    samples: [ labSample(), labSample({ id: "sa2", barcode: "0000012302", material: "soro", container: "tubo amarelo", status: "rejected", rejection_reason: "hemolisada" }) ]
  }));
  mocked(api.fetchLabReceipt).mockResolvedValue(PDF);
  mocked(api.fetchLabLabels).mockResolvedValue(PDF);
  vi.spyOn(window, "open").mockReturnValue({ location: { href: "" }, close: vi.fn(), opener: null } as unknown as Window);
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:x") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});

describe("LabRequisitionDetail", () => {
  it("mostra situação, prazo previsto, exames e amostras com o motivo da rejeição", async () => {
    renderWithProviders(<LabRequisitionDetail id="rq1" onClose={vi.fn()} />);
    const detail = await screen.findByRole("region", { name: "Requisição 00000123" });
    expect(within(detail).getByText("recebida")).not.toBeNull();
    expect(within(detail).getByText("20/10/2026")).not.toBeNull();
    expect(within(detail).getByText("Hemograma completo")).not.toBeNull();
    expect(within(detail).getByText("aguardando coleta")).not.toBeNull();
    expect(within(detail).getByText("rejeitada — hemolisada")).not.toBeNull();
  });

  it("comprovante e etiquetas de todas as amostras", async () => {
    renderWithProviders(<LabRequisitionDetail id="rq1" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Comprovante" }));
    await waitFor(() => expect(api.fetchLabReceipt).toHaveBeenCalledWith("rq1"));
    fireEvent.click(screen.getByRole("button", { name: "Imprimir etiquetas" }));
    await waitFor(() => expect(api.fetchLabLabels).toHaveBeenCalledWith("rq1", [ "sa1", "sa2" ]));
  });

  it("reimpressão de uma etiqueta pede confirmação (fica na trilha)", async () => {
    renderWithProviders(<LabRequisitionDetail id="rq1" onClose={vi.fn()} />);
    const row = (await screen.findByText("0000012301")).closest("[role='row']") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Reimprimir" }));
    expect(api.fetchLabLabels).not.toHaveBeenCalled();
    expect(screen.getByText("A reimpressão fica registrada. Reimprimir a etiqueta?")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(api.fetchLabLabels).toHaveBeenCalledWith("rq1", [ "sa1" ]));
  });

  it("entrega do laudo liberado: exige quem retirou; 409 relê", async () => {
    mocked(api.getLabRequisition).mockResolvedValue(labRequisition({ status: "released", reports: [ labReport() ] }));
    mocked(api.deliverRequisition).mockRejectedValueOnce(new api.ApiError(409, { error: "invalid_transition" }, "x"));
    renderWithProviders(<LabRequisitionDetail id="rq1" onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Registrar entrega" }));
    expect(screen.getByRole("alert").textContent).toBe("informe quem retirou o laudo");
    fireEvent.change(screen.getByLabelText("Quem retirou"), { target: { value: "Joana Lima (a própria)" } });
    // O botão fica ocupado ("Registrar entrega …") até a ação anterior assentar.
    fireEvent.click(await screen.findByRole("button", { name: "Registrar entrega" }));
    await waitFor(() => expect(api.deliverRequisition).toHaveBeenCalledWith("rq1", "Joana Lima (a própria)"));
    expect((await screen.findByRole("alert")).textContent).toBe("a situação mudou — a tela foi atualizada");
    await waitFor(() => expect(api.getLabRequisition).toHaveBeenCalledTimes(2));
  });

  it("laudo retirado (withdrawn) mostra o rótulo, nunca o código", async () => {
    mocked(api.getLabRequisition).mockResolvedValue(labRequisition({ status: "released", reports: [ labReport({ status: "withdrawn" }) ] }));
    renderWithProviders(<LabRequisitionDetail id="rq1" onClose={vi.fn()} />);
    const list = await screen.findByRole("list", { name: "laudos" });
    expect(list.textContent).toContain("retirado");
    expect(list.textContent).not.toContain("withdrawn");
  });

  it("entregue: mostra quem retirou e quando, sem botão", async () => {
    mocked(api.getLabRequisition).mockResolvedValue(labRequisition({ status: "delivered", delivered_to: "Joana Lima", delivered_at: "2026-10-15T09:30:00-03:00" }));
    renderWithProviders(<LabRequisitionDetail id="rq1" onClose={vi.fn()} />);
    expect(await screen.findByText(/Joana Lima · 15\/10\/2026/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Registrar entrega" })).toBeNull();
  });
});
