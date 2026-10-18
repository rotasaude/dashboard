// src/modules/inventory/InUsePanel.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listLabInstruments: vi.fn(), listSupplies: vi.fn(), listSupplyLots: vi.fn(), listInUse: vi.fn(),
    setInUse: vi.fn(), getInventoryAlerts: vi.fn() };
});

import * as api from "../../lib/api";
import { InUsePanel } from "./InUsePanel";
import { AlertsPanel } from "./AlertsPanel";
import { INV_ALERTS_KEY } from "../../lib/inventory";
import { renderWithProviders } from "../../test/campaignFixtures";
import { CHOL_EXAM, GLU_EXAM, NOW21C, inUse, instrument, qcUser, supply, supplyLot } from "../../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listLabInstruments, api.listSupplies, api.listSupplyLots, api.listInUse, api.setInUse, api.getInventoryAlerts ];
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21C));
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ]));
  mocked(api.listLabInstruments).mockResolvedValue([ instrument(), instrument({ id: "in2", name: "Velho", active: false }) ]);
  mocked(api.listSupplies).mockResolvedValue([
    supply(), supply({ id: "su2", name: "Ponteiras", kind: "consumable", tests_per_package: null, lab_exam_ids: [] }),
    supply({ id: "su3", name: "Colesterol CHOD-PAP", lab_exam_ids: [ "le2" ] })
  ]);
  mocked(api.listSupplyLots).mockResolvedValue([
    supplyLot(), supplyLot({ id: "sl9", lot_number: "R-500", expires_on: "2026-10-01" }),
    supplyLot({ id: "sl3", supply_id: "su2", supply_name: "Ponteiras", lot_number: "P-1" }),
    supplyLot({ id: "sl4", supply_id: "su3", supply_name: "Colesterol CHOD-PAP", lot_number: "C-7" })
  ]);
  mocked(api.listInUse).mockResolvedValue([ inUse({ id: "iu0", lot_id: "sl8", lot_number: "R-700" }) ]);
  mocked(api.setInUse).mockResolvedValue(inUse({ id: "iu2", lot_id: "sl1" }));
  mocked(api.getInventoryAlerts).mockResolvedValue({
    expiring: [
      { ...supplyLot({ expires_on: "2026-11-05", balance: 5 }), lot_id: "sl1" },
      { ...supplyLot({ id: "sl9", lot_number: "R-500", expires_on: "2026-10-01", expired: true, balance: 1 }), lot_id: "sl9" }
    ],
    below_minimum: [ { ...supply({ id: "su2", name: "Ponteiras", unit: "caixa", balance: 1, minimum_stock: 3, below_minimum: true }), supply_id: "su2" } ],
    untraced_results: 3
  });
});

async function open() {
  renderWithProviders(<InUsePanel providerId="pv9" exams={[ GLU_EXAM, CHOL_EXAM ]} />);
  const panel = await screen.findByRole("region", { name: "Lote em uso por aparelho" });
  expect(await within(panel).findByText("R-700 · Glicose GOD-PAP 2×100 mL")).not.toBeNull();
  return panel;
}

function pick(panel: HTMLElement, exam: string, lot: string) {
  fireEvent.change(within(panel).getByLabelText("Exame"), { target: { value: exam } });
  fireEvent.change(within(panel).getByLabelText("Lote do reagente"), { target: { value: lot } });
  fireEvent.click(within(panel).getByRole("button", { name: "Pôr em uso" }));
}

describe("InUsePanel", () => {
  it("um aparelho ativo só: lista o lote em uso; troca só com reagente do exame, não vencido, sem step-up", async () => {
    const panel = await open();
    expect(api.listInUse).toHaveBeenCalledWith("in1");
    expect([ ...(within(panel).getByLabelText("Aparelho") as HTMLSelectElement).options ].map((o) => o.value)).toEqual([ "", "in1" ]);
    fireEvent.change(within(panel).getByLabelText("Exame"), { target: { value: "le1" } });
    const lots = [ ...(within(panel).getByLabelText("Lote do reagente") as HTMLSelectElement).options ].map((o) => o.value);
    expect(lots).toEqual([ "", "sl1" ]);
    fireEvent.change(within(panel).getByLabelText("Lote do reagente"), { target: { value: "sl1" } });
    fireEvent.click(within(panel).getByRole("button", { name: "Pôr em uso" }));
    await waitFor(() => expect(api.setInUse).toHaveBeenCalledWith({ lot_id: "sl1", instrument_id: "in1", lab_exam_id: "le1" }));
    expect(await within(panel).findByText("Lote em uso trocado — o anterior deste aparelho e exame foi encerrado.")).not.toBeNull();
    await waitFor(() => expect(api.listInUse).toHaveBeenCalledTimes(2));
  });

  it("o mesmo lote de novo (C-E6): diz que já estava em uso, sem falar em encerrar o anterior", async () => {
    mocked(api.listInUse).mockResolvedValue([ inUse() ]);
    renderWithProviders(<InUsePanel providerId="pv9" exams={[ GLU_EXAM ]} />);
    const panel = await screen.findByRole("region", { name: "Lote em uso por aparelho" });
    await within(panel).findByText("R-778 · Glicose GOD-PAP 2×100 mL");
    pick(panel, "le1", "sl1");
    expect(await within(panel).findByText("Este lote já estava em uso neste aparelho e exame — nada mudou.")).not.toBeNull();
    expect(screen.queryByText(/encerrado/)).toBeNull();
  });

  it("sem lote anterior no par: diz só que o lote foi posto em uso", async () => {
    mocked(api.listInUse).mockResolvedValue([]);
    renderWithProviders(<InUsePanel providerId="pv9" exams={[ GLU_EXAM ]} />);
    const panel = await screen.findByRole("region", { name: "Lote em uso por aparelho" });
    await within(panel).findByText("nenhum lote em uso neste aparelho");
    pick(panel, "le1", "sl1");
    expect(await within(panel).findByText("Lote posto em uso.")).not.toBeNull();
  });

  it("422 exam_not_linked, 422 invalid_instrument e 404 viram frase própria", async () => {
    mocked(api.setInUse).mockRejectedValueOnce(new api.ApiError(422, { error: "exam_not_linked" }, "x"));
    const panel = await open();
    pick(panel, "le1", "sl1");
    expect((await within(panel).findByRole("alert")).textContent).toBe("este exame não está ligado ao item — o administrador liga no cadastro do item");
    mocked(api.setInUse).mockRejectedValueOnce(new api.ApiError(422, { error: "invalid_instrument" }, "x"));
    fireEvent.click(within(panel).getByRole("button", { name: "Pôr em uso" }));
    await waitFor(() => expect(within(panel).getByRole("alert").textContent).toBe("aparelho inválido — ele precisa estar ativo e ser deste laboratório"));
    mocked(api.setInUse).mockRejectedValueOnce(new api.ApiError(404, { error: "not_found" }, "x"));
    fireEvent.click(within(panel).getByRole("button", { name: "Pôr em uso" }));
    await waitFor(() => expect(within(panel).getByRole("alert").textContent).toBe("não encontrado neste laboratório — a tela foi atualizada"));
  });

  it("sem lote de reagente do exame com saldo e validade: avisa e não oferece lote", async () => {
    mocked(api.listSupplyLots).mockResolvedValue([ supplyLot({ id: "sl9", lot_number: "R-500", expires_on: "2026-10-01" }) ]);
    const panel = await open();
    fireEvent.change(within(panel).getByLabelText("Exame"), { target: { value: "le1" } });
    expect(await within(panel).findByText("nenhum lote de reagente ligado a este exame, com saldo e dentro da validade")).not.toBeNull();
    expect((within(panel).getByLabelText("Lote do reagente") as HTMLSelectElement).options).toHaveLength(1);
  });
});

describe("AlertsPanel", () => {
  it("vencendo (com vencido marcado), abaixo do mínimo e resultados sem rastreio", async () => {
    renderWithProviders(<AlertsPanel providerId="pv9" />);
    const panel = await screen.findByRole("region", { name: "Alertas do estoque" });
    expect(await within(panel).findByText("R-778 · Glicose GOD-PAP 2×100 mL")).not.toBeNull();
    expect(within(panel).getByText("R-500 · Glicose GOD-PAP 2×100 mL")).not.toBeNull();
    expect(within(panel).getAllByText("vencido")).toHaveLength(1);
    expect(within(panel).getByText("1 caixa (mínimo 3)")).not.toBeNull();
    expect(within(panel).getByText("3 resultados sem rastreio de reagente")).not.toBeNull();
    expect(api.getInventoryAlerts).toHaveBeenCalledWith("pv9");
  });

  it("é relido pelo react-query a cada minuto (rota sem trilha)", async () => {
    const { client } = renderWithProviders(<AlertsPanel providerId="pv9" />);
    await screen.findByRole("region", { name: "Alertas do estoque" });
    await waitFor(() => expect(api.getInventoryAlerts).toHaveBeenCalled());
    const query = client.getQueryCache().find({ queryKey: [ INV_ALERTS_KEY, "pv9" ] });
    expect(query?.observers[0].options.refetchInterval).toBe(60_000);
  });

  it("tudo em ordem: frases vazias", async () => {
    mocked(api.getInventoryAlerts).mockResolvedValue({ expiring: [], below_minimum: [], untraced_results: 0 });
    renderWithProviders(<AlertsPanel providerId="pv9" />);
    const panel = await screen.findByRole("region", { name: "Alertas do estoque" });
    expect(await within(panel).findByText("nenhum lote vencendo")).not.toBeNull();
    expect(within(panel).getByText("nenhum item abaixo do mínimo")).not.toBeNull();
    expect(within(panel).getByText("todos os resultados com lote de reagente")).not.toBeNull();
  });
});
