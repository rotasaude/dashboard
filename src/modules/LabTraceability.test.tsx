// src/modules/LabTraceability.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listSupplies: vi.fn(), listSupplyLots: vi.fn(), traceSupplyLot: vi.fn(),
    fetchSupplyLotTraceCsv: vi.fn(), getConsumption: vi.fn(), fetchConsumptionCsv: vi.fn(), listLabInstruments: vi.fn() };
});

import * as api from "../lib/api";
import { LabTraceability } from "./LabTraceability";
import { renderWithProviders } from "../test/campaignFixtures";
import { NOW21C, instrument, qcContext, qcUser, supply, supplyLot } from "../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listSupplies, api.listSupplyLots, api.traceSupplyLot, api.fetchSupplyLotTraceCsv,
  api.getConsumption, api.fetchConsumptionCsv, api.listLabInstruments ];
const CSV = { blob: new Blob([ "a,b\n" ], { type: "text/csv" }), filename: null };
const TRACE = {
  lot_id: "sl1", lot_number: "R-778",
  results: [ { requisition_number: "00000123", sigtap_code: "0202010473", entered_at: "2026-10-15T08:30:00-03:00" } ], results_truncated: false,
  qc_values: [ { run_id: "qr1", analyte_key: "glicose", entered_at: "2026-10-15T07:10:00-03:00" } ], qc_values_truncated: false
};

async function pickLot(panel: HTMLElement) {
  await within(panel).findByRole("option", { name: "Glicose GOD-PAP 2×100 mL" });
  fireEvent.change(within(panel).getByLabelText("Item"), { target: { value: "su1" } });
  await within(panel).findByRole("option", { name: "R-778" });
  fireEvent.change(within(panel).getByLabelText("Lote"), { target: { value: "sl1" } });
}

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21C));
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:x") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ]));
  mocked(api.getLabContext).mockResolvedValue(qcContext());
  mocked(api.listSupplies).mockResolvedValue([ supply() ]);
  mocked(api.listSupplyLots).mockResolvedValue([ supplyLot() ]);
  mocked(api.traceSupplyLot).mockResolvedValue(TRACE);
  mocked(api.fetchSupplyLotTraceCsv).mockResolvedValue(CSV);
  // consumption.rb: total + uma linha por aparelho + "sem aparelho"; soma das sub-linhas = total.
  mocked(api.getConsumption).mockResolvedValue([
    { line: "total", supply_id: "su1", name: "Glicose GOD-PAP 2×100 mL", instrument_id: null, tests_performed: 480, tests_opened: 400, deviation_pct: 20 },
    { line: "instrument", supply_id: "su1", name: "Glicose GOD-PAP 2×100 mL", instrument_id: "in1", tests_performed: 450, tests_opened: null, deviation_pct: null },
    { line: "no_instrument", supply_id: "su1", name: "Glicose GOD-PAP 2×100 mL", instrument_id: null, tests_performed: 30, tests_opened: null, deviation_pct: null },
    { line: "total", supply_id: "su2", name: "Ureia UV", instrument_id: null, tests_performed: 12, tests_opened: null, deviation_pct: null }
  ]);
  mocked(api.fetchConsumptionCsv).mockResolvedValue(CSV);
  mocked(api.listLabInstruments).mockResolvedValue([ instrument() ]);
});

describe("LabTraceability", () => {
  it("rastreio só no clique (trilha de leitura); lote esgotado também; requisição e código do exame, sem paciente; CSV", async () => {
    renderWithProviders(<LabTraceability />);
    const panel = await screen.findByRole("region", { name: "Rastreio por lote" });
    await pickLot(panel);
    expect(api.listSupplyLots).toHaveBeenCalledWith({ supplyId: "su1", withBalance: false });
    expect(api.traceSupplyLot).not.toHaveBeenCalled();
    fireEvent.click(within(panel).getByRole("button", { name: "Rastrear" }));
    await waitFor(() => expect(api.traceSupplyLot).toHaveBeenCalledWith("sl1"));
    expect(await within(panel).findByText("00000123")).not.toBeNull();
    expect(within(panel).getByText("0202010473")).not.toBeNull();
    expect(within(panel).queryByText(/cortad/)).toBeNull();
    expect(panel.textContent).not.toContain("Joana");
    fireEvent.click(within(panel).getByRole("button", { name: "Baixar CSV do rastreio" }));
    await waitFor(() => expect(api.fetchSupplyLotTraceCsv).toHaveBeenCalledWith("sl1"));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(api.traceSupplyLot).toHaveBeenCalledTimes(1);
  });

  it("avisa quando o api cortou a lista em 5000", async () => {
    mocked(api.traceSupplyLot).mockResolvedValue({ ...TRACE, results_truncated: true, qc_values_truncated: true });
    renderWithProviders(<LabTraceability />);
    const panel = await screen.findByRole("region", { name: "Rastreio por lote" });
    await pickLot(panel);
    fireEvent.click(within(panel).getByRole("button", { name: "Rastrear" }));
    expect(await within(panel).findByText(/resultados: a lista foi cortada em 5000/)).not.toBeNull();
    expect(within(panel).getByText(/controles: a lista foi cortada em 5000/)).not.toBeNull();
  });

  it("lote de outro laboratório (404) mostra frase própria", async () => {
    mocked(api.traceSupplyLot).mockRejectedValue(new api.ApiError(404, { error: "not_found" }, "404"));
    renderWithProviders(<LabTraceability />);
    const panel = await screen.findByRole("region", { name: "Rastreio por lote" });
    await pickLot(panel);
    fireEvent.click(within(panel).getByRole("button", { name: "Rastrear" }));
    expect(await within(panel).findByRole("alert")).not.toBeNull();
    expect(within(panel).getByRole("alert").textContent).not.toContain("etiqueta");
  });

  it("consumo do mês: total, aparelho, sem aparelho, null como traço; CSV", async () => {
    renderWithProviders(<LabTraceability />);
    const panel = await screen.findByRole("region", { name: "Consumo estimado" });
    expect(await within(panel).findByText("+20,0%")).not.toBeNull();
    expect(api.getConsumption).toHaveBeenCalledWith({ providerId: "pv9", month: "2026-10" });
    expect(within(panel).getByText("BS-200")).not.toBeNull();
    expect(within(panel).getByText("sem aparelho")).not.toBeNull();
    expect(within(panel).getAllByText("total").length).toBe(2);
    expect(panel.textContent).not.toContain("null");
    expect(within(panel).getAllByText("—").length).toBeGreaterThanOrEqual(6);
    fireEvent.click(within(panel).getByRole("button", { name: "Baixar CSV do consumo" }));
    await waitFor(() => expect(api.fetchConsumptionCsv).toHaveBeenCalledWith({ providerId: "pv9", month: "2026-10" }));
  });

  it("mês inválido no api vira frase, não o texto cru", async () => {
    mocked(api.getConsumption).mockRejectedValue(new api.ApiError(422, { error: "invalid_month" }, "422"));
    renderWithProviders(<LabTraceability />);
    const panel = await screen.findByRole("region", { name: "Consumo estimado" });
    expect((await within(panel).findByRole("alert")).textContent).toBe("mês inválido");
  });

  it("equipe do laboratório vê rastreio e consumo (C-E41)", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ]));
    renderWithProviders(<LabTraceability />);
    expect(await screen.findByRole("region", { name: "Rastreio por lote" })).not.toBeNull();
    expect(await screen.findByRole("region", { name: "Consumo estimado" })).not.toBeNull();
    await waitFor(() => expect(api.getConsumption).toHaveBeenCalled());
  });

  it("quem não é do laboratório nem admin não vê", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "unit_manager" ]));
    renderWithProviders(<LabTraceability />);
    expect(await screen.findByText("seu papel não permite ver esta tela")).not.toBeNull();
    expect(api.getConsumption).not.toHaveBeenCalled();
  });
});
