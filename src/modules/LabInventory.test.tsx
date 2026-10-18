// src/modules/LabInventory.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), getLabContext: vi.fn(), listLabExams: vi.fn(), listSupplies: vi.fn(), createSupply: vi.fn(),
    updateSupply: vi.fn(), listSupplyLots: vi.fn(), receiveSupplyLot: vi.fn(), listSupplyMovements: vi.fn(), recordSupplyMovement: vi.fn(),
    listLabInstruments: vi.fn(), listInUse: vi.fn(), setInUse: vi.fn(), getInventoryAlerts: vi.fn() };
});

import * as api from "../lib/api";
import { LabInventory } from "./LabInventory";
import { INVENTORY_DISABLED } from "../lib/inventory";
import { renderWithProviders } from "../test/campaignFixtures";
import { GLU_EXAM, NOW21C, instrument, qcContext, qcUser, supply, supplyLot, supplyMovement } from "../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.getLabContext, api.listLabExams, api.listSupplies, api.createSupply, api.updateSupply, api.listSupplyLots,
  api.receiveSupplyLot, api.listSupplyMovements, api.recordSupplyMovement, api.listLabInstruments, api.listInUse, api.setInUse, api.getInventoryAlerts ];

afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });
beforeEach(() => {
  for (const fn of ALL) mocked(fn).mockReset();
  vi.useFakeTimers({ toFake: [ "Date" ] });
  vi.setSystemTime(new Date(NOW21C));
  mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ]));
  mocked(api.getLabContext).mockResolvedValue(qcContext());
  mocked(api.listLabExams).mockResolvedValue([ GLU_EXAM ]);
  mocked(api.listSupplies).mockResolvedValue([ supply() ]);
  mocked(api.createSupply).mockResolvedValue(supply({ id: "su2" }));
  mocked(api.listSupplyLots).mockResolvedValue([ supplyLot() ]);
  mocked(api.receiveSupplyLot).mockResolvedValue(supplyLot({ id: "sl2", lot_number: "R-901" }));
  mocked(api.listSupplyMovements).mockResolvedValue([ supplyMovement() ]);
  mocked(api.recordSupplyMovement).mockResolvedValue(supplyMovement({ id: "mv2", kind: "opening", quantity: -1 }));
  mocked(api.listLabInstruments).mockResolvedValue([ instrument() ]);
  mocked(api.listInUse).mockResolvedValue([]);
  mocked(api.getInventoryAlerts).mockResolvedValue({ expiring: [], below_minimum: [], untraced_results: 0 });
});

// Leituras dos lotes do item escolhido (o painel de lote em uso, da Task 15, lê os do laboratório inteiro).
const lotReads = (supplyId: string) => mocked(api.listSupplyLots).mock.calls.filter(([ q ]) => (q as { supplyId?: string }).supplyId === supplyId).length;

async function lotsPanel() {
  renderWithProviders(<LabInventory />);
  const panel = await screen.findByRole("region", { name: "Lotes e movimentos" });
  await within(panel).findByRole("option", { name: "Glicose GOD-PAP 2×100 mL" });
  fireEvent.change(within(panel).getByLabelText("Item"), { target: { value: "su1" } });
  await within(panel).findByText("R-778");
  return panel;
}

async function movementForm() {
  const panel = await lotsPanel();
  fireEvent.click(within(panel).getByRole("button", { name: "Movimentos" }));
  const box = within(panel).getByRole("group", { name: "Movimentos do lote R-778" });
  await within(box).findByText("NF 1234");
  return box;
}

describe("LabInventory — itens, lotes e movimentos", () => {
  it("admin cadastra reagente: rendimento e exame obrigatórios", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ]));
    renderWithProviders(<LabInventory />);
    const panel = await screen.findByRole("region", { name: "Itens de estoque" });
    fireEvent.click(within(panel).getByRole("button", { name: "Novo item" }));
    const form = within(panel).getByRole("group", { name: "Novo item" });
    fireEvent.change(within(form).getByLabelText("Nome"), { target: { value: "Colesterol CHOD-PAP" } });
    fireEvent.change(within(form).getByLabelText("Tipo"), { target: { value: "reagent" } });
    fireEvent.change(within(form).getByLabelText("Unidade"), { target: { value: "kit" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar item" }));
    expect(within(form).getByRole("alert").textContent).toBe("informe quantos testes rende cada embalagem do reagente");
    fireEvent.change(within(form).getByLabelText("Testes por embalagem"), { target: { value: "200" } });
    fireEvent.click(await within(form).findByLabelText("Glicose"));
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar item" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar item" }));
    await waitFor(() => expect(api.createSupply).toHaveBeenCalledWith({
      provider_id: "pv9", name: "Colesterol CHOD-PAP", kind: "reagent", unit: "kit", tests_per_package: 200, minimum_stock: 0,
      expiry_alert_days: 30, lab_exam_ids: [ "le1" ], active: true
    }));
  });

  it("equipe não cadastra item; entrada de lote vencido é recusada; a válida grava e relê", async () => {
    const panel = await lotsPanel();
    expect(screen.queryByRole("button", { name: "Novo item" })).toBeNull();
    const form = within(panel).getByRole("group", { name: "Entrada de lote" });
    fireEvent.change(within(form).getByLabelText("Número do lote"), { target: { value: "R-901" } });
    fireEvent.change(within(form).getByLabelText("Validade"), { target: { value: "2026-10-01" } });
    fireEvent.change(within(form).getByLabelText("Fornecedor"), { target: { value: "Distribuidora Sul" } });
    fireEvent.change(within(form).getByLabelText("Origem"), { target: { value: "donation" } });
    fireEvent.change(within(form).getByLabelText("Quantidade"), { target: { value: "4" } });
    fireEvent.click(await within(form).findByRole("button", { name: "Registrar entrada" }));
    expect(within(form).getByRole("alert").textContent).toBe("lote vencido — não entra no estoque");
    fireEvent.change(within(form).getByLabelText("Validade"), { target: { value: "2027-05-31" } });
    fireEvent.click(await within(form).findByRole("button", { name: "Registrar entrada" }));
    await waitFor(() => expect(api.receiveSupplyLot).toHaveBeenCalledWith({
      supply_id: "su1", lot_number: "R-901", expires_on: "2027-05-31", supplier: "Distribuidora Sul", origin: "donation", quantity: 4
    }));
    expect(await within(panel).findByText("Entrada registrada.")).not.toBeNull();
    await waitFor(() => expect(lotReads("su1")).toBe(2));
  });

  it("movimento: saída maior que o saldo bloqueada; ajuste só para o admin; abertura grava", async () => {
    const box = await movementForm();
    const kinds = [ ...(within(box).getByLabelText("Movimento") as HTMLSelectElement).options ].map((o) => o.value);
    expect(kinds).toEqual([ "", "opening", "loss", "expiry" ]);
    fireEvent.change(within(box).getByLabelText("Movimento"), { target: { value: "loss" } });
    fireEvent.change(within(box).getByLabelText("Quantidade"), { target: { value: "6" } });
    fireEvent.change(within(box).getByLabelText("Motivo"), { target: { value: "frasco quebrado" } });
    fireEvent.click(await within(box).findByRole("button", { name: "Registrar movimento" }));
    expect(within(box).getByRole("alert").textContent).toBe("saída maior que o saldo do lote (5)");
    expect(api.recordSupplyMovement).not.toHaveBeenCalled();
    fireEvent.change(within(box).getByLabelText("Movimento"), { target: { value: "opening" } });
    expect(within(box).queryByLabelText("Motivo")).toBeNull();
    fireEvent.change(within(box).getByLabelText("Quantidade"), { target: { value: "1" } });
    fireEvent.click(await within(box).findByRole("button", { name: "Registrar movimento" }));
    await waitFor(() => expect(api.recordSupplyMovement).toHaveBeenCalledWith({ lot_id: "sl1", kind: "opening", quantity: 1 }));
  });

  it("422 insufficient_balance: relê os lotes e mantém o formulário", async () => {
    mocked(api.recordSupplyMovement).mockRejectedValueOnce(new api.ApiError(422, { error: "insufficient_balance" }, "x"));
    const box = await movementForm();
    fireEvent.change(within(box).getByLabelText("Movimento"), { target: { value: "opening" } });
    fireEvent.change(within(box).getByLabelText("Quantidade"), { target: { value: "2" } });
    fireEvent.click(await within(box).findByRole("button", { name: "Registrar movimento" }));
    expect((await within(box).findByRole("alert")).textContent).toBe("saída maior que o saldo do lote — o saldo foi relido");
    await waitFor(() => expect(lotReads("su1")).toBe(2));
    expect((within(box).getByLabelText("Quantidade") as HTMLInputElement).value).toBe("2");
  });

  it("admin vê o ajuste (com sinal) e grava só depois da confirmação", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ]));
    mocked(api.recordSupplyMovement).mockResolvedValue(supplyMovement({ id: "mv3", kind: "adjustment", quantity: -2, reason: "contagem" }));
    const box = await movementForm();
    expect([ ...(within(box).getByLabelText("Movimento") as HTMLSelectElement).options ].map((o) => o.value)).toContain("adjustment");
    fireEvent.change(within(box).getByLabelText("Movimento"), { target: { value: "adjustment" } });
    fireEvent.change(within(box).getByLabelText("Quantidade"), { target: { value: "-2" } });
    fireEvent.click(within(box).getByRole("button", { name: "Revisar e registrar ajuste" }));
    expect(within(box).getByRole("alert").textContent).toBe("escreva o motivo");
    fireEvent.change(within(box).getByLabelText("Motivo"), { target: { value: "contagem" } });
    fireEvent.click(within(box).getByRole("button", { name: "Revisar e registrar ajuste" }));
    expect(api.recordSupplyMovement).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar ajuste" }));
    await waitFor(() => expect(api.recordSupplyMovement).toHaveBeenCalledWith({ lot_id: "sl1", kind: "adjustment", quantity: -2, reason: "contagem" }));
    await waitFor(() => expect(lotReads("su1")).toBe(2));
  });

  it("movimentos mostram a quantidade com o sinal do api", async () => {
    mocked(api.listSupplyMovements).mockResolvedValue([ supplyMovement(), supplyMovement({ id: "mv2", kind: "loss", quantity: -1, reason: "frasco quebrado", document: null }) ]);
    const box = await movementForm();
    expect(within(box).getByText("+6")).not.toBeNull();
    expect(within(box).getByText("-1")).not.toBeNull();
  });

  it("estoque abaixo do mínimo vem do api (below_minimum), não do saldo", async () => {
    mocked(api.listSupplies).mockResolvedValue([ supply({ balance: 1, minimum_stock: 2, below_minimum: false }), supply({ id: "su3", name: "Controle", balance: 9, below_minimum: true }) ]);
    renderWithProviders(<LabInventory />);
    const panel = await screen.findByRole("region", { name: "Itens de estoque" });
    await within(panel).findByText("Controle");
    expect(within(panel).getAllByText("abaixo do mínimo")).toHaveLength(1);
  });

  it("lote de outro laboratório (404): relê e diz que a tela foi atualizada", async () => {
    mocked(api.recordSupplyMovement).mockRejectedValueOnce(new api.ApiError(404, { error: "not_found" }, "x"));
    const box = await movementForm();
    fireEvent.change(within(box).getByLabelText("Movimento"), { target: { value: "opening" } });
    fireEvent.change(within(box).getByLabelText("Quantidade"), { target: { value: "1" } });
    fireEvent.click(await within(box).findByRole("button", { name: "Registrar movimento" }));
    expect((await within(box).findByRole("alert")).textContent).toBe("não encontrado neste laboratório — a tela foi atualizada");
    await waitFor(() => expect(lotReads("su1")).toBe(2));
  });

  it("admin edita item existente por PATCH; trocar para não-reagente limpa o rendimento", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "municipal_admin" ]));
    mocked(api.updateSupply).mockResolvedValue(supply());
    renderWithProviders(<LabInventory />);
    const panel = await screen.findByRole("region", { name: "Itens de estoque" });
    fireEvent.click(await within(panel).findByRole("button", { name: "Editar" }));
    const form = within(panel).getByRole("group", { name: "Editar Glicose GOD-PAP 2×100 mL" });
    fireEvent.change(within(form).getByLabelText("Testes por embalagem"), { target: { value: "abc" } });
    fireEvent.change(within(form).getByLabelText("Tipo"), { target: { value: "consumable" } });
    fireEvent.change(within(form).getByLabelText("Estoque mínimo"), { target: { value: "3" } });
    fireEvent.click(within(form).getByRole("button", { name: "Revisar e salvar item" }));
    fireEvent.click(await screen.findByRole("button", { name: "Salvar item" }));
    await waitFor(() => expect(api.updateSupply).toHaveBeenCalledWith("su1", expect.objectContaining({ kind: "consumable", tests_per_package: null, minimum_stock: 3 })));
  });

  it("entrada: 404 relê; trocar o item limpa o rascunho; lote esgotado é marcado; motivo acima de 1000 é recusado", async () => {
    mocked(api.listSupplies).mockResolvedValue([ supply(), supply({ id: "su2", name: "Controle" }) ]);
    mocked(api.listSupplyLots).mockResolvedValue([ supplyLot(), supplyLot({ id: "sl0", lot_number: "R-100", balance: 0 }) ]);
    mocked(api.receiveSupplyLot).mockRejectedValueOnce(new api.ApiError(404, { error: "not_found" }, "x"));
    const panel = await lotsPanel();
    expect(within(panel).getAllByText("esgotado")).toHaveLength(1);
    const form = within(panel).getByRole("group", { name: "Entrada de lote" });
    fireEvent.change(within(form).getByLabelText("Número do lote"), { target: { value: "R-901" } });
    fireEvent.change(within(form).getByLabelText("Validade"), { target: { value: "2027-05-31" } });
    fireEvent.change(within(form).getByLabelText("Fornecedor"), { target: { value: "X" } });
    fireEvent.change(within(form).getByLabelText("Origem"), { target: { value: "purchase" } });
    fireEvent.change(within(form).getByLabelText("Quantidade"), { target: { value: "4" } });
    fireEvent.click(await within(form).findByRole("button", { name: "Registrar entrada" }));
    expect((await within(form).findByRole("alert")).textContent).toBe("não encontrado neste laboratório — a tela foi atualizada");
    await waitFor(() => expect(lotReads("su1")).toBe(2));
    fireEvent.change(within(panel).getByLabelText("Item"), { target: { value: "su2" } });
    expect((within(panel).getByLabelText("Número do lote") as HTMLInputElement).value).toBe("");
    fireEvent.change(within(panel).getByLabelText("Item"), { target: { value: "su1" } });
    await within(panel).findByText("R-778");
    fireEvent.click(within(panel).getAllByRole("button", { name: "Movimentos" })[0]);
    const box = await within(panel).findByRole("group", { name: /Movimentos do lote/ });
    fireEvent.change(within(box).getByLabelText("Movimento"), { target: { value: "loss" } });
    fireEvent.change(within(box).getByLabelText("Quantidade"), { target: { value: "1" } });
    fireEvent.change(within(box).getByLabelText("Motivo"), { target: { value: "x".repeat(1001) } });
    fireEvent.click(await within(box).findByRole("button", { name: "Registrar movimento" }));
    expect(within(box).getByRole("alert").textContent).toContain("1000");
    expect(api.recordSupplyMovement).not.toHaveBeenCalled();
  });

  it("estoque desligado: a frase", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(qcUser([ "lab_staff" ], { features: [ "exam_tracking", "municipal_lab", "lab_quality_control" ] }));
    renderWithProviders(<LabInventory />);
    expect(await screen.findByText(INVENTORY_DISABLED)).not.toBeNull();
  });
});
