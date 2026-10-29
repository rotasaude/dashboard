import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listMyPharmacyLocations: vi.fn(), listPositions: vi.fn(), recordAdjustment: vi.fn(), approveAdjustment: vi.fn(), rejectAdjustment: vi.fn(), listAdjustments: vi.fn() }));
import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { PharmacyAdjustments } from "./PharmacyAdjustments";
import { renderWithProviders } from "../test/campaignFixtures";
import { CENTRAL, CLONA, TODAY27, UBS_FARM, adjustment, lotBalance, phUser, position, stockLot } from "../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const optionValues = (label: string) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.value);

describe("PharmacyAdjustments", () => {
  beforeEach(() => {
    for (const fn of [ api.recordAdjustment, api.approveAdjustment, api.rejectAdjustment, api.listAdjustments, api.listPositions ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ UBS_FARM ]);
    mocked(api.listPositions).mockResolvedValue({ positions: [ position() ], next_before: null });
    mocked(api.listAdjustments).mockResolvedValue({ adjustments: [ adjustment(), adjustment({ id: "a2", requested_by: { user_id: "u-1", name: "Eu Mesma" } }) ], next_before: null });
  });

  it("contagem: a diferença antes; step-up; ajuste acima do limite fica pendente", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    mocked(api.recordAdjustment).mockResolvedValue(adjustment({ id: "a3", status: "pending" }));
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento"); text("Medicamento", "ci1");
    text("Lote", "lot1"); text("Tipo", "adjustment"); text("Quantidade contada", "20"); text("Motivo", "contagem do fim do mês");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    expect(await screen.findByText("Saldo 30 → 20 (-10)")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar ajuste" }));
    await waitFor(() => expect(mocked(api.recordAdjustment)).toHaveBeenCalledWith({ location_id: "l2", lot_id: "lot1", kind: "adjustment",
      counted_quantity: "20", reason: "contagem do fim do mês" }));
    expect((await screen.findByRole("status")).textContent).toBe("Ajuste acima do limite da cidade: aguardando a aprovação de outra pessoa do local.");
    // A revisão (com o <form> do SensitiveAction) não fica dentro do <form> dos campos.
    expect(errors.mock.calls.map((c) => String(c[0]) + String(c[1] ?? "")).filter((m) => m.includes("validateDOMNesting") || m.includes("cannot be a descendant"))).toEqual([]);
    errors.mockRestore();
  });

  it("contagem a partir de zero: lote com saldo 0 aparece e a contagem vai; a resposta pendente mostra a frase", async () => {
    const zero = lotBalance({ lot: stockLot({ id: "z", lot_number: "ZERO9" }), balance: "0" });
    mocked(api.listPositions).mockResolvedValue({ positions: [ position({ lots: [ zero ], balance: "0" }) ], next_before: null });
    mocked(api.recordAdjustment).mockResolvedValue(adjustment({ id: "a4", status: "pending", balance_at_request: "0", quantity: "3", counted_quantity: "3" }));
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento"); text("Medicamento", "ci1");
    text("Tipo", "adjustment"); text("Lote", "z"); text("Quantidade contada", "3"); text("Motivo", "achei três caixas no fundo da estante");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    expect(await screen.findByText("Saldo 0 → 3 (+3)")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar ajuste" }));
    await waitFor(() => expect(mocked(api.recordAdjustment)).toHaveBeenCalledWith({ location_id: "l2", lot_id: "z", kind: "adjustment",
      counted_quantity: "3", reason: "achei três caixas no fundo da estante" }));
    expect((await screen.findByRole("status")).textContent).toBe("Ajuste acima do limite da cidade: aguardando a aprovação de outra pessoa do local.");
    // Perda não oferece lote sem saldo.
    text("Medicamento", "ci1"); text("Tipo", "loss");
    expect(optionValues("Lote")).toEqual([ "" ]);
  });

  it("medicamentos além da primeira página: Carregar mais", async () => {
    const second = position({ item: CLONA, lots: [ lotBalance({ lot: stockLot({ id: "c1", item: CLONA, lot_number: "CLO1" }), balance: "12" }) ], balance: "12" });
    mocked(api.listPositions).mockImplementation(async (q: { before?: string | null }) =>
      q.before === "cur2" ? { positions: [ second ], next_before: null } : { positions: [ position() ], next_before: "cur2" });
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento");
    expect(optionValues("Medicamento")).toEqual([ "", "ci1" ]);
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais medicamentos" }));
    await waitFor(() => expect(optionValues("Medicamento")).toEqual([ "", "ci1", "ci2" ]));
    expect(mocked(api.listPositions)).toHaveBeenCalledWith({ locationId: "l2", before: "cur2" });
    expect(screen.queryByRole("button", { name: "Carregar mais medicamentos" })).toBeNull();
    text("Medicamento", "ci2");
    expect(optionValues("Lote")).toEqual([ "", "c1" ]);
  });

  it("contagem aplicada na hora: a frase vem do status da resposta", async () => {
    mocked(api.recordAdjustment).mockResolvedValue(adjustment({ id: "a3", status: "applied" }));
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento"); text("Medicamento", "ci1");
    text("Lote", "lot1"); text("Tipo", "adjustment"); text("Quantidade contada", "29"); text("Motivo", "contagem do fim do mês");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar ajuste" }));
    expect((await screen.findByRole("status")).textContent).toBe("Ajuste registrado.");
  });

  it("perda maior que o saldo recusada antes; perda aplicada", async () => {
    mocked(api.recordAdjustment).mockResolvedValue(adjustment({ kind: "loss", status: "applied", quantity: "-2", counted_quantity: null }));
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento"); text("Medicamento", "ci1");
    text("Lote", "lot1"); text("Tipo", "loss"); text("Quantidade", "31"); text("Motivo", "frasco caiu e quebrou no balcão");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    expect((await screen.findByRole("alert")).textContent).toBe("saída maior que o saldo do lote (30)");
    expect(mocked(api.recordAdjustment)).not.toHaveBeenCalled();
    text("Quantidade", "2");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    expect(await screen.findByText("Saldo 30 → 28 (-2)")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar ajuste" }));
    await waitFor(() => expect(mocked(api.recordAdjustment)).toHaveBeenCalledWith({ location_id: "l2", lot_id: "lot1", kind: "loss", quantity: "2",
      reason: "frasco caiu e quebrou no balcão" }));
    expect((await screen.findByRole("status")).textContent).toBe("Perda registrada.");
  });

  it("os lotes dependem do tipo: vencimento só vencido, perda só não vencido; a unidade aparece", async () => {
    const fresh = lotBalance({ lot: stockLot({ id: "f", lot_number: "NOVO1", expires_on: "2026-12-01" }), balance: "10" });
    const old = lotBalance({ lot: stockLot({ id: "o", lot_number: "VELHO1", expires_on: "2026-10-28" }), balance: "5" });
    const empty = lotBalance({ lot: stockLot({ id: "e", lot_number: "ZERO1", expires_on: "2026-10-01" }), balance: "0" });
    mocked(api.listPositions).mockResolvedValue({ positions: [ position({ lots: [ fresh, old, empty ], balance: "15" }) ], next_before: null });
    mocked(api.recordAdjustment).mockResolvedValue(adjustment({ kind: "expiry", status: "applied" }));
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento"); text("Medicamento", "ci1");
    expect(optionValues("Lote")).toEqual([ "", "e", "o", "f" ]); // sem tipo e na contagem: todos, inclusive o de saldo zero
    text("Tipo", "adjustment");
    expect(optionValues("Lote")).toEqual([ "", "e", "o", "f" ]);
    text("Lote", "f"); text("Tipo", "expiry");
    expect(optionValues("Lote")).toEqual([ "", "o" ]);
    expect((screen.getByLabelText("Lote") as HTMLSelectElement).value).toBe("");
    text("Tipo", "loss");
    expect(optionValues("Lote")).toEqual([ "", "f" ]);
    expect(screen.getByRole("option", { name: /NOVO1 · vence 01\/12\/2026 · saldo 10 cápsula/ })).not.toBeNull();
    text("Tipo", "expiry"); text("Lote", "o"); text("Quantidade", "5"); text("Motivo", "lote vencido retirado da prateleira");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    expect(await screen.findByText("Saldo 5 → 0 (-5)")).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Registrar ajuste" }));
    expect((await screen.findByRole("status")).textContent).toBe("Vencimento registrado.");
  });

  it("contagem: passa de 99999,99 se a diferença couber; diferença grande demais é recusada antes", async () => {
    mocked(api.listPositions).mockResolvedValue({ positions: [ position({ lots: [ lotBalance({ balance: "120000" }) ], balance: "120000" }) ], next_before: null });
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento"); text("Medicamento", "ci1");
    text("Lote", "lot1"); text("Tipo", "adjustment"); text("Motivo", "contagem do fim do mês"); text("Quantidade contada", "230000");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    expect((await screen.findByRole("alert")).textContent).toBe("a diferença entre a contagem e o saldo pode ser no máximo 99999,99");
    text("Quantidade contada", "120005,5");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    expect(await screen.findByText("Saldo 120000 → 120005,5 (+5,5)")).not.toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("todas as recusas locais de uma vez; nada enviado", async () => {
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    expect((await screen.findByRole("alert")).textContent).toContain("escolha o medicamento");
    text("Medicamento", "ci1"); text("Tipo", "loss"); text("Lote", "lot1"); text("Quantidade", "2,555"); text("Motivo", "curto");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    const shown = (await screen.findByRole("alert")).textContent ?? "";
    expect(shown).toContain("a quantidade tem no máximo 2 casas depois da vírgula");
    expect(shown).toContain("o motivo tem de 10 a 500 caracteres");
    expect(screen.queryByRole("button", { name: "Registrar ajuste" })).toBeNull();
  });

  it("recusa do api no registro: a frase fica no passo de confirmação e os saldos são relidos", async () => {
    mocked(api.recordAdjustment).mockRejectedValue(new ApiError(422, { error: "insufficient_balance", path: "quantity" }, "422"));
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento"); text("Medicamento", "ci1");
    text("Lote", "lot1"); text("Tipo", "loss"); text("Quantidade", "5"); text("Motivo", "frasco caiu e quebrou no balcão");
    fireEvent.click(screen.getByRole("button", { name: "Revisar ajuste" }));
    fireEvent.click(await screen.findByRole("button", { name: "Registrar ajuste" }));
    expect(await screen.findByText("o saldo do lote mudou — os lotes foram relidos; confira a quantidade")).not.toBeNull();
    await waitFor(() => expect(mocked(api.listPositions).mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("almoxarife do central também ajusta; auxiliar não entra", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL ]);
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByLabelText("Medicamento");
    expect(mocked(api.listPositions)).toHaveBeenCalledWith(expect.objectContaining({ locationId: "l1" }));
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacy_assistant" ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ { ...UBS_FARM, roles: [ "pharmacy_assistant" ] } ]);
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    await screen.findByText(/seu papel não permite|não está vinculado/);
    expect(screen.queryByLabelText("Medicamento")).toBeNull();
  });

  it("pendentes: aprovar e rejeitar com motivo; o próprio não oferece; 409 relê", async () => {
    mocked(api.approveAdjustment).mockRejectedValueOnce(new ApiError(409, { error: "not_pending" }, "409"));
    mocked(api.rejectAdjustment).mockResolvedValue(adjustment({ status: "rejected" }));
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    const panel = within(await screen.findByRole("region", { name: "Ajustes aguardando aprovação" }));
    const mine = await panel.findByRole("row", { name: /Eu Mesma/ });
    expect(within(mine).queryByRole("button", { name: /Aprovar|Rejeitar/ })).toBeNull();
    expect(mine.textContent).toContain("aguardando outra pessoa do local");
    const other = panel.getByRole("row", { name: /Paulo Almeida/ });
    expect(other.textContent).toContain("Contagem");
    expect(other.textContent).toContain("Contagem do fim do mês");
    expect(other.textContent).toContain("30 cápsula");
    fireEvent.click(within(other).getByRole("button", { name: "Aprovar" }));
    expect(await screen.findByText(/Será aplicada ao saldo atual a diferença de -10 cápsula \(no pedido de Paulo Almeida: saldo 30 → contado 20\)\./)).not.toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar ajuste" }));
    expect(await screen.findByText("este ajuste já foi decidido — a lista foi relida")).not.toBeNull();
    await waitFor(() => expect(mocked(api.listAdjustments).mock.calls.length).toBeGreaterThanOrEqual(2));
    fireEvent.click(within(panel.getByRole("row", { name: /Paulo Almeida/ })).getByRole("button", { name: "Rejeitar" }));
    fireEvent.change(await screen.findByLabelText("Motivo da rejeição"), { target: { value: "contagem refeita, saldo confere" } });
    fireEvent.click(screen.getByRole("button", { name: "Rejeitar ajuste" }));
    await waitFor(() => expect(mocked(api.rejectAdjustment)).toHaveBeenCalledWith("a1", "contagem refeita, saldo confere"));
    expect(mocked(api.listAdjustments)).toHaveBeenCalledWith({ locationId: "l2", status: "pending", before: null });
  });

  it("aprovar com sucesso; same_user relê; motivo de rejeição curto não chama o api", async () => {
    mocked(api.approveAdjustment).mockResolvedValueOnce(adjustment({ status: "approved" }));
    mocked(api.approveAdjustment).mockRejectedValueOnce(new ApiError(403, { error: "same_user" }, "403"));
    renderWithProviders(<PharmacyAdjustments today={TODAY27} />);
    const panel = within(await screen.findByRole("region", { name: "Ajustes aguardando aprovação" }));
    await panel.findByRole("row", { name: /Paulo Almeida/ });
    const button = () => within(panel.getByRole("row", { name: /Paulo Almeida/ })).getByRole("button", { name: "Aprovar" });
    fireEvent.click(button());
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar ajuste" }));
    await waitFor(() => expect(mocked(api.approveAdjustment)).toHaveBeenCalledWith("a1"));
    expect((await screen.findByRole("status")).textContent).toBe("Ajuste aprovado: o saldo foi corrigido.");
    fireEvent.click(button());
    fireEvent.click(await screen.findByRole("button", { name: "Aprovar ajuste" }));
    expect(await screen.findByText("outra pessoa do local precisa aprovar este ajuste")).not.toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.click(within(panel.getByRole("row", { name: /Paulo Almeida/ })).getByRole("button", { name: "Rejeitar" }));
    // Motivo curto: a dica aparece e o passo do step-up nem abre (o código do autenticador não é gasto).
    fireEvent.change(await screen.findByLabelText("Motivo da rejeição"), { target: { value: "curto" } });
    expect(await screen.findByText("o motivo tem de 10 a 500 caracteres")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Rejeitar ajuste" })).toBeNull();
    expect(screen.queryByLabelText("Código do autenticador")).toBeNull();
    fireEvent.change(screen.getByLabelText("Motivo da rejeição"), { target: { value: "contagem refeita, saldo confere" } });
    expect(screen.queryByText("o motivo tem de 10 a 500 caracteres")).toBeNull();
    expect(screen.getByRole("button", { name: "Rejeitar ajuste" })).not.toBeNull();
    expect(mocked(api.rejectAdjustment)).not.toHaveBeenCalled();
  });
});
