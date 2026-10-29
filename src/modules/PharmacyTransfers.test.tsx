// src/modules/PharmacyTransfers.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listMyPharmacyLocations: vi.fn(), listPositions: vi.fn(), sendTransfer: vi.fn(), receiveTransfer: vi.fn(), listTransfers: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { PharmacyTransfers } from "./PharmacyTransfers";
import { renderWithProviders } from "../test/campaignFixtures";
import { CENTRAL, CENTRAL_REF, TODAY27, UBS_FARM, UBS_REF, lotBalance, phUser, position, stockLot, transfer } from "../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

const centralPositions = () => ({ positions: [ position({ location: CENTRAL_REF, balance: "600", lots: [
  lotBalance({ lot: stockLot({ id: "lotB", lot_number: "AMX2702", expires_on: "2027-02-01" }), balance: "500" }),
  lotBalance({ balance: "100" }) ] }) ], next_before: null });

describe("PharmacyTransfers", () => {
  beforeEach(() => {
    for (const fn of [ api.sendTransfer, api.receiveTransfer, api.listTransfers, api.listPositions ]) mocked(fn).mockReset();
    mocked(api.listTransfers).mockResolvedValue({ transfers: [ transfer() ], next_before: null });
  });

  it("central envia: destino, lote que vence primeiro sugerido, quantidade até o saldo; corpo", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL, { ...UBS_FARM, roles: [] } ]);
    mocked(api.listPositions).mockResolvedValue(centralPositions());
    mocked(api.sendTransfer).mockResolvedValue(transfer());
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    await screen.findByLabelText("Destino"); text("Destino", "l2");
    fireEvent.click(await screen.findByRole("button", { name: "Acrescentar Amoxicilina 500 mg cápsula" }));
    expect((screen.getByLabelText("Lote") as HTMLSelectElement).value).toBe("lot1");
    // Desvio: a opção traz a unidade de dispensação (emenda H12) — o texto do plano não tinha "cápsula".
    expect(screen.getByRole("option", { name: "AMX2611 · vence 20/11/2026 · saldo 100 cápsula · sugerido (vence primeiro)" })).not.toBeNull();
    expect(screen.getByRole("option", { name: "AMX2702 · vence 01/02/2027 · saldo 500 cápsula" })).not.toBeNull();
    text("Quantidade", "150");
    fireEvent.click(screen.getByRole("button", { name: "Enviar transferência" }));
    // Desvio: a frase do transferProblems (Task 2) traz o lote: "<item>, lote <n>: …".
    expect((await screen.findByRole("alert")).textContent).toBe("Amoxicilina 500 mg cápsula, lote AMX2611: saída maior que o saldo do lote (100)");
    expect(mocked(api.sendTransfer)).not.toHaveBeenCalled();
    text("Quantidade", "100");
    fireEvent.click(screen.getByRole("button", { name: "Enviar transferência" }));
    await waitFor(() => expect(mocked(api.sendTransfer)).toHaveBeenCalledWith({ to_location_id: "l2", items: [ { lot_id: "lot1", quantity: "100" } ] }));
    expect((await screen.findByRole("status")).textContent).toBe("Transferência enviada: fica em trânsito até a unidade receber.");
    expect(screen.queryByLabelText("Lote")).toBeNull();
  });

  it("só destinos de unidade ativos; sem destino, nada é enviado; o corpo usa vírgula → ponto", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL, { ...UBS_FARM, roles: [] }, { ...UBS_FARM, id: "l3", name: "Farmácia fechada", active: false, roles: [] } ]);
    mocked(api.listPositions).mockResolvedValue(centralPositions());
    mocked(api.sendTransfer).mockResolvedValue(transfer());
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    await screen.findByLabelText("Destino");
    const options = within(screen.getByLabelText("Destino")).getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([ "Escolha a farmácia de destino", "Farmácia UBS Centro — Farmácia da unidade" ]);
    fireEvent.click(await screen.findByRole("button", { name: "Acrescentar Amoxicilina 500 mg cápsula" }));
    text("Quantidade", "10,5");
    fireEvent.click(screen.getByRole("button", { name: "Enviar transferência" }));
    expect((await screen.findByRole("alert")).textContent).toBe("escolha o destino da transferência");
    expect(mocked(api.sendTransfer)).not.toHaveBeenCalled();
    text("Destino", "l2");
    fireEvent.click(screen.getByRole("button", { name: "Enviar transferência" }));
    await waitFor(() => expect(mocked(api.sendTransfer)).toHaveBeenCalledWith({ to_location_id: "l2", items: [ { lot_id: "lot1", quantity: "10.5" } ] }));
  });

  it("recusa do api com problems: cada linha com o nome do item; o índice é o do corpo enviado; nada reenviado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL, { ...UBS_FARM, roles: [] } ]);
    mocked(api.listPositions).mockResolvedValue(centralPositions());
    mocked(api.sendTransfer).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "items[0].quantity", problems: [
      { path: "items[0].quantity", error: "insufficient_balance" } ] }, "422"));
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    await screen.findByLabelText("Destino"); text("Destino", "l2");
    fireEvent.click(await screen.findByRole("button", { name: "Acrescentar Amoxicilina 500 mg cápsula" }));
    text("Quantidade", "100");
    fireEvent.click(screen.getByRole("button", { name: "Enviar transferência" }));
    expect((await screen.findByRole("alert")).textContent).toBe(
      "Amoxicilina 500 mg cápsula: o saldo do lote mudou — os lotes foram relidos; confira a quantidade");
    // O formulário fica como estava (quantidade digitada) e as posições são relidas.
    expect((screen.getByLabelText("Quantidade") as HTMLInputElement).value).toBe("100");
    await waitFor(() => expect(mocked(api.listPositions).mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(mocked(api.sendTransfer)).toHaveBeenCalledTimes(1);
  });

  it("unidade recebe: conferência lote a lote; diferença pede motivo; frase da diferença", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacy_assistant" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [ "pharmacy_assistant" ] } ]);
    mocked(api.receiveTransfer).mockResolvedValue(transfer({ status: "received_with_difference" }));
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    expect(screen.queryByRole("button", { name: "Enviar transferência" })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Receber transferência de Almoxarifado Central" }));
    expect((screen.getByLabelText("Recebido do lote AMX2611 (enviado 100)") as HTMLInputElement).value).toBe("");
    text("Recebido do lote AMX2611 (enviado 100)", "90");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    expect((await screen.findByRole("alert")).textContent).toBe("AMX2611: recebido diferente do enviado — escreva o motivo (10 a 500 caracteres)");
    expect(mocked(api.receiveTransfer)).not.toHaveBeenCalled();
    text("Motivo da diferença do lote AMX2611", "uma caixa de 10 chegou molhada");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    await waitFor(() => expect(mocked(api.receiveTransfer)).toHaveBeenCalledWith("t1",
      { items: [ { lot_id: "lot1", quantity_received: "90", reason: "uma caixa de 10 chegou molhada" } ] }));
    expect((await screen.findByRole("status")).textContent).toBe("Recebida com diferença: a diferença entrou como perda, com o motivo.");
    expect(screen.queryByRole("button", { name: "Confirmar recebimento" })).toBeNull();
  });

  it("recebimento sem diferença: sem campo de motivo, corpo sem reason, frase simples; motivo velho não vai", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    mocked(api.receiveTransfer).mockResolvedValue(transfer({ status: "received" }));
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    fireEvent.click(await screen.findByRole("button", { name: "Receber transferência de Almoxarifado Central" }));
    expect(screen.queryByLabelText("Motivo da diferença do lote AMX2611")).toBeNull();
    text("Recebido do lote AMX2611 (enviado 100)", "99,5");
    text("Motivo da diferença do lote AMX2611", "caixa amassada na entrega");
    text("Recebido do lote AMX2611 (enviado 100)", "100");
    expect(screen.queryByLabelText("Motivo da diferença do lote AMX2611")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    await waitFor(() => expect(mocked(api.receiveTransfer)).toHaveBeenCalledWith("t1", { items: [ { lot_id: "lot1", quantity_received: "100" } ] }));
    expect((await screen.findByRole("status")).textContent).toBe("Recebida.");
  });

  it("recebido maior que o enviado e vírgula/ponto: recusa local, nada enviado", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    fireEvent.click(await screen.findByRole("button", { name: "Receber transferência de Almoxarifado Central" }));
    text("Recebido do lote AMX2611 (enviado 100)", "110");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    expect((await screen.findByRole("alert")).textContent).toBe("AMX2611: recebido maior que o enviado (100)");
    expect(mocked(api.receiveTransfer)).not.toHaveBeenCalled();
  });

  it("recusa do api no recebimento com problems: mostra no lote; o formulário continua", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    mocked(api.receiveTransfer).mockRejectedValue(new ApiError(422, { error: "invalid_request", path: "items[0].reason", problems: [
      { path: "items[0].reason", error: "invalid_request" } ] }, "422"));
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    fireEvent.click(await screen.findByRole("button", { name: "Receber transferência de Almoxarifado Central" }));
    text("Recebido do lote AMX2611 (enviado 100)", "90");
    text("Motivo da diferença do lote AMX2611", "uma caixa de 10 chegou molhada");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    expect((await screen.findByRole("alert")).textContent).toBe("AMX2611: o motivo tem de 10 a 500 caracteres");
    expect((screen.getByLabelText("Motivo da diferença do lote AMX2611") as HTMLInputElement).value).toBe("uma caixa de 10 chegou molhada");
  });

  it("já recebida por outra pessoa: frase e a lista relida", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    mocked(api.receiveTransfer).mockRejectedValue(new ApiError(409, { error: "already_received" }, "409"));
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    fireEvent.click(await screen.findByRole("button", { name: "Receber transferência de Almoxarifado Central" }));
    text("Recebido do lote AMX2611 (enviado 100)", "100");
    fireEvent.click(screen.getByRole("button", { name: "Confirmar recebimento" }));
    expect(await screen.findByText("esta transferência já foi recebida — a lista foi relida")).not.toBeNull();
    await waitFor(() => expect(mocked(api.listTransfers).mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("button", { name: "Confirmar recebimento" })).toBeNull();
  });

  it("lista: recebida mostra o recebido e a diferença; só o destino recebe; origem não vê Receber", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL ]);
    mocked(api.listPositions).mockResolvedValue({ positions: [], next_before: null });
    mocked(api.listTransfers).mockResolvedValue({ transfers: [
      transfer(),
      transfer({ id: "t2", to: UBS_REF, status: "received_with_difference", received_at: "2026-10-28T14:00:00-03:00",
        items: [ { lot: stockLot(), quantity_sent: "100.00", quantity_received: "90.00", difference: "10.00" } ] }) ], next_before: null });
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    const rows = await screen.findAllByRole("row", { name: /Almoxarifado Central/ });
    expect(rows).toHaveLength(2);
    expect(rows[1].textContent).toContain("recebido 90 cápsula (faltaram 10 cápsula)");
    expect(rows[1].textContent).toContain("Recebida com diferença");
    expect(rows[0].textContent).toContain("Em trânsito");
    expect(screen.queryByRole("button", { name: /Receber transferência/ })).toBeNull();
    expect(mocked(api.listTransfers)).toHaveBeenCalledWith({ locationId: "l1", before: null });
  });

  it("farmacêutico sem papel de almoxarife no central não envia; sem interruptor nada abre", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...CENTRAL, roles: [ "pharmacist" ] } ]);
    renderWithProviders(<PharmacyTransfers today={TODAY27} />);
    await screen.findByText("Transferências do local");
    expect(screen.queryByRole("button", { name: "Enviar transferência" })).toBeNull();
    expect(mocked(api.listPositions)).not.toHaveBeenCalled();
  });
});
