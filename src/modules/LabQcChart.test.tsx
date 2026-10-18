import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listLabInstruments: vi.fn(), listLabExams: vi.fn(), listQcLots: vi.fn(),
    listQcMaterials: vi.fn(), getQcChart: vi.fn() };
});

import * as api from "../lib/api";
import { LabQcChart } from "./LabQcChart";
import { renderWithProviders } from "../test/campaignFixtures";
import { GLU_EXAM, NOW21C, SizedResizeObserver, instrument, qcChart, qcContext, qcLot, qcMaterial, qcUser } from "../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listLabInstruments, api.listLabExams, api.listQcLots, api.listQcMaterials, api.getQcChart ];
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  vi.stubGlobal("ResizeObserver", SizedResizeObserver);
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21C));
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_releaser" ]));
  mocked(api.getLabContext).mockResolvedValue(qcContext({ releaser_of: [ "pv9" ] }));
  mocked(api.listLabInstruments).mockResolvedValue([ instrument() ]);
  mocked(api.listLabExams).mockResolvedValue([ GLU_EXAM ]);
  mocked(api.listQcLots).mockResolvedValue([ qcLot() ]);
  mocked(api.listQcMaterials).mockResolvedValue([ qcMaterial() ]);
  mocked(api.getQcChart).mockResolvedValue(qcChart());
});

async function pick() {
  renderWithProviders(<LabQcChart />);
  await screen.findByRole("option", { name: "L2026A · Controle bioquímico" });
  fireEvent.change(screen.getByLabelText("Lote"), { target: { value: "ql1" } });
  fireEvent.change(screen.getByLabelText("Nível"), { target: { value: "normal" } });
  fireEvent.change(screen.getByLabelText("Analito"), { target: { value: "glicose" } });
}

describe("LabQcChart", () => {
  it("lote, nível, analito e aparelho; últimos 30 dias; mostra o gráfico", async () => {
    await pick();
    await waitFor(() => expect(api.getQcChart).toHaveBeenCalledWith({
      lot_id: "ql1", level: "normal", analyte_key: "glicose", instrument_id: "in1", from: "2026-09-18", to: "2026-10-18"
    }));
    expect(await screen.findByRole("figure", { name: "Levey-Jennings · Glicose (Glicose) · normal · lote L2026A · BS-200" })).not.toBeNull();
  });

  it("período invertido não consulta", async () => {
    await pick();
    await waitFor(() => expect(api.getQcChart).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2026-10-19" } });
    expect(screen.getByRole("alert").textContent).toBe("o início do período é depois do fim");
    expect(api.getQcChart).toHaveBeenCalledTimes(1);
  });

  it("período acima de 366 dias não consulta", async () => {
    await pick();
    await waitFor(() => expect(api.getQcChart).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText("De"), { target: { value: "2025-10-01" } });
    expect(screen.getByRole("alert").textContent).toBe("o período vai até 366 dias");
    expect(api.getQcChart).toHaveBeenCalledTimes(1);
  });

  it("recusa do api vira a frase, sem releitura automática", async () => {
    mocked(api.getQcChart).mockRejectedValue(new api.ApiError(404, { error: "not_found" }, "404"));
    await pick();
    expect((await screen.findByRole("alert")).textContent).toContain("não encontrado neste laboratório");
  });

  it("administrador municipal vê; equipe sem papel de liberador não", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ]));
    renderWithProviders(<LabQcChart />);
    await screen.findByRole("option", { name: "L2026A · Controle bioquímico" });
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ]));
    renderWithProviders(<LabQcChart />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.getQcChart).not.toHaveBeenCalled();
  });
});
