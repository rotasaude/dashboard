// src/modules/pharmacy/DispenseForm.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../../lib/api")>()), fetchCurrentSession: vi.fn(),
  listPositions: vi.fn(), recordDispensation: vi.fn(), searchPharmacyItems: vi.fn() }));
import * as api from "../../lib/api";
import { ApiError } from "../../lib/api";
import { DispenseForm } from "./DispenseForm";
import { renderWithProviders } from "../../test/campaignFixtures";
import { AMOXI, CLONA, TODAY27, UBS_FARM, dispensation, lotBalance, phUser, position, prescription, rxItem, stockLot } from "../../test/pharmacyFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const text = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const AMOX = "Amoxicilina 500 mg cápsula"; const CLON = "Clonazepam 2 mg comprimido";
const CLONA_ITEM = rxItem({ id: "pi2", catalog_item_id: "ci2", printed_description: CLON, quantity: "30", quantity_unit: "comprimido",
  dosage_instructions: "1 comprimido à noite", controlled: true });
const CLONA_POS = position({ item: CLONA, lots: [ lotBalance({ lot: stockLot({ id: "lot2", item: CLONA, lot_number: "CLZ2701", expires_on: "2027-01-10" }), balance: "60" }) ] });

function renderForm(p = prescription(), pharmacist = true, handlers = { onDone: vi.fn(), onStale: vi.fn(), onCancel: vi.fn() }) {
  const loc = { ...UBS_FARM, roles: [ pharmacist ? "pharmacist" : "pharmacy_assistant" ] };
  renderWithProviders(<DispenseForm location={loc} prescription={p} today={TODAY27} delayMs={0} {...handlers} />);
  return handlers;
}

describe("DispenseForm", () => {
  beforeEach(() => {
    for (const fn of [ api.listPositions, api.recordDispensation, api.searchPharmacyItems ]) mocked(fn).mockReset();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    mocked(api.listPositions).mockImplementation(({ catalogItemId }: { catalogItemId: string }) => Promise.resolve({ next_before: null,
      positions: catalogItemId === "ci2" ? [ CLONA_POS ] : [ position({ lots: [
        lotBalance({ lot: stockLot({ id: "lotB", lot_number: "AMX2702", expires_on: "2027-02-01" }), balance: "500" }), lotBalance() ] }) ] }));
    mocked(api.recordDispensation).mockResolvedValue(dispensation());
  });

  it("lote que vence primeiro sugerido; o texto da receita à vista; corpo com completo e retenção (amoxicilina, H12)", async () => {
    const h = renderForm();
    expect(await screen.findByText("Prescrito: 21 cápsula")).not.toBeNull();
    expect(screen.getByText("1 cápsula de 8 em 8 horas por 7 dias")).not.toBeNull();
    await waitFor(() => expect((screen.getByLabelText(`Lote — ${AMOX}`) as HTMLSelectElement).value).toBe("lot1"));
    expect(screen.getByRole("option", { name: "AMX2611 · vence 20/11/2026 · saldo 30 cápsula · sugerido (vence primeiro)" })).not.toBeNull();
    expect(mocked(api.listPositions)).toHaveBeenCalledWith({ locationId: "l2", catalogItemId: "ci1" });
    text(`Quantidade — ${AMOX} (cápsula)`, "21");
    fireEvent.click(screen.getByLabelText(`Dispensado por completo — ${AMOX}`));
    // H12: a amoxicilina é antimicrobiano — a receita é retida (sem número digitado: o api grava notification_number null).
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    expect((await screen.findAllByRole("listitem")).map((li) => li.textContent)).toContain("medicamento controlado: registre a retenção da receita");
    expect(mocked(api.recordDispensation)).not.toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    await waitFor(() => expect(mocked(api.recordDispensation)).toHaveBeenCalledWith({ location_id: "l2", prescription: { kind: "digital", id: "doc1" },
      items: [ { prescription_item_id: "pi1", lot_id: "lot1", quantity: "21", complete: true } ], retention: {} }));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledWith(dispensation()));
  });

  it("todas as recusas de uma vez, antes de enviar", async () => {
    renderForm(prescription({ items: [ rxItem(), CLONA_ITEM ] }));
    await waitFor(() => expect((screen.getByLabelText(`Lote — ${CLON}`) as HTMLSelectElement).value).toBe("lot2"));
    text(`Quantidade — ${AMOX} (cápsula)`, "40"); text(`Quantidade — ${CLON} (comprimido)`, "2,555");
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    const items = (await screen.findAllByRole("listitem")).map((li) => li.textContent);
    expect(items).toEqual(expect.arrayContaining([ `${AMOX}: saída maior que o saldo do lote (30)`,
      `${CLON}: a quantidade tem no máximo 2 casas depois da vírgula`, "medicamento controlado: registre a retenção da receita" ]));
    expect(mocked(api.recordDispensation)).not.toHaveBeenCalled();
  });

  it("auxiliar: controlado e texto livre bloqueados com o motivo; contínuo antes do dia", async () => {
    renderForm(prescription({ items: [ CLONA_ITEM, rxItem({ id: "pi3", catalog_item_id: null, free_text: "xarope de guaco", printed_description: "xarope de guaco" }),
      rxItem({ id: "pi4", printed_description: "Losartana 50 mg comprimido", continuous: true, next_allowed_on: "2026-11-03", last_dispensed_on: "2026-10-09", dispensed_total: "30" }) ] }), false);
    expect(await screen.findByText("medicamento controlado: só o farmacêutico dispensa")).not.toBeNull();
    expect(screen.getByText("item em texto livre: só o farmacêutico dispensa, escolhendo o item do catálogo")).not.toBeNull();
    expect(screen.getByText("uso contínuo: próxima retirada a partir de 03/11/2026")).not.toBeNull();
    expect(screen.getByText("Já dispensado: 30 · última retirada 09/10/2026")).not.toBeNull();
    expect(screen.queryByLabelText(`Quantidade — ${CLON} (comprimido)`)).toBeNull();
    expect(screen.queryByLabelText("Quantidade — Losartana 50 mg comprimido (cápsula)")).toBeNull();
  });

  it("texto livre: o farmacêutico escolhe o item do catálogo; a escolha vai no corpo", async () => {
    mocked(api.searchPharmacyItems).mockResolvedValue([ AMOXI ]);
    renderForm(prescription({ items: [ rxItem({ catalog_item_id: null, free_text: "amoxil 500", printed_description: "amoxil 500", retention_required: false }) ] }));
    await screen.findByLabelText("Item do catálogo para amoxil 500"); text("Item do catálogo para amoxil 500", "amox");
    fireEvent.click(await screen.findByRole("button", { name: `${AMOX} · cápsula` }));
    await waitFor(() => expect((screen.getByLabelText("Lote — amoxil 500") as HTMLSelectElement).value).toBe("lot1"));
    text("Quantidade — amoxil 500 (cápsula)", "21");
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    await waitFor(() => expect(mocked(api.recordDispensation).mock.calls[0][0].items).toEqual([
      { prescription_item_id: "pi1", catalog_item_id: "ci1", lot_id: "lot1", quantity: "21" } ]));
  });

  it("controlado: retenção obrigatória; vai a marca, sem número digitado", async () => {
    renderForm(prescription({ items: [ CLONA_ITEM ] }));
    await waitFor(() => expect((screen.getByLabelText(`Lote — ${CLON}`) as HTMLSelectElement).value).toBe("lot2"));
    text(`Quantidade — ${CLON} (comprimido)`, "30");
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    expect((await screen.findAllByRole("listitem")).map((li) => li.textContent)).toContain("medicamento controlado: registre a retenção da receita");
    expect(screen.queryByLabelText(/Número da notificação/)).toBeNull();
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    await waitFor(() => expect(mocked(api.recordDispensation).mock.calls[0][0].retention).toEqual({}));
  });

  it("insufficient_balance: relê os lotes e mantém o que foi digitado; too_early com a data", async () => {
    mocked(api.recordDispensation).mockRejectedValueOnce(new ApiError(422, { error: "insufficient_balance", path: "items[0].quantity" }, "422"))
      .mockRejectedValueOnce(new ApiError(422, { error: "too_early", next_allowed_on: "2026-11-03", path: "items[0]" }, "422"));
    renderForm();
    await waitFor(() => expect((screen.getByLabelText(`Lote — ${AMOX}`) as HTMLSelectElement).value).toBe("lot1"));
    const reads = mocked(api.listPositions).mock.calls.length;
    text(`Quantidade — ${AMOX} (cápsula)`, "21");
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia")); // H12: amoxicilina retém
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    expect(await screen.findByText("o saldo do lote mudou — os lotes foram relidos; confira a quantidade")).not.toBeNull();
    await waitFor(() => expect(mocked(api.listPositions).mock.calls.length).toBeGreaterThan(reads));
    expect((screen.getByLabelText(`Quantidade — ${AMOX} (cápsula)`) as HTMLInputElement).value).toBe("21");
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    expect(await screen.findByText("uso contínuo: próxima retirada deste item a partir de 03/11/2026")).not.toBeNull();
    expect(mocked(api.recordDispensation)).toHaveBeenCalledTimes(2);
  });

  it("receita cancelada enquanto dispensava: frase e nova busca", async () => {
    mocked(api.recordDispensation).mockRejectedValue(new ApiError(422, { error: "prescription_cancelled" }, "422"));
    const h = renderForm();
    await waitFor(() => expect((screen.getByLabelText(`Lote — ${AMOX}`) as HTMLSelectElement).value).toBe("lot1"));
    text(`Quantidade — ${AMOX} (cápsula)`, "21");
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    expect(await screen.findByText("a receita mudou enquanto você dispensava — busque a receita de novo")).not.toBeNull();
    expect(h.onStale).toHaveBeenCalledTimes(1);
    expect(mocked(api.recordDispensation)).toHaveBeenCalledTimes(1);
  });

  it("auxiliar dispensa o antimicrobiano e retém a receita, sem número", async () => {
    const h = renderForm(prescription(), false);
    await waitFor(() => expect((screen.getByLabelText(`Lote — ${AMOX}`) as HTMLSelectElement).value).toBe("lot1"));
    text(`Quantidade — ${AMOX} (cápsula)`, "21");
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    expect(screen.queryByLabelText(/Número da notificação/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    await waitFor(() => expect(mocked(api.recordDispensation).mock.calls[0][0].retention).toEqual({}));
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
  });

  it("texto livre mapeado: 422 retention_required abre a retenção na linha e deixa reenviar", async () => {
    mocked(api.searchPharmacyItems).mockResolvedValue([ AMOXI ]);
    mocked(api.recordDispensation).mockRejectedValueOnce(new ApiError(422, { error: "retention_required", path: "items[0]" }, "422"));
    const h = renderForm(prescription({ items: [ rxItem({ catalog_item_id: null, free_text: "amoxil 500", printed_description: "amoxil 500", retention_required: false }) ] }));
    await screen.findByLabelText("Item do catálogo para amoxil 500"); text("Item do catálogo para amoxil 500", "amox");
    fireEvent.click(await screen.findByRole("button", { name: `${AMOX} · cápsula` }));
    await waitFor(() => expect((screen.getByLabelText("Lote — amoxil 500") as HTMLSelectElement).value).toBe("lot1"));
    text("Quantidade — amoxil 500 (cápsula)", "21");
    expect(screen.queryByLabelText("Receita retida na farmácia")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    expect(await screen.findByText("medicamento controlado: registre a retenção da receita")).not.toBeNull();
    expect(mocked(api.recordDispensation).mock.calls[0][0].retention).toBeUndefined();
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    await waitFor(() => expect(mocked(api.recordDispensation)).toHaveBeenCalledTimes(2));
    expect(mocked(api.recordDispensation).mock.calls[1][0].retention).toEqual({});
    await waitFor(() => expect(h.onDone).toHaveBeenCalledTimes(1));
  });

  it("problems pelo índice do corpo enviado: duas linhas, recusa items[1] (não o índice da receita)", async () => {
    mocked(api.recordDispensation).mockRejectedValueOnce(new ApiError(422, { error: "too_early", path: "items[1]",
      problems: [ { path: "items[1]", error: "too_early", next_allowed_on: "2026-11-03" } ] }, "422"));
    const DIPI = rxItem({ id: "pi5", printed_description: "Dipirona 500 mg comprimido", retention_required: false });
    renderForm(prescription({ items: [ rxItem({ retention_required: false }), CLONA_ITEM, DIPI ] }));
    await waitFor(() => expect((screen.getByLabelText(`Lote — ${CLON}`) as HTMLSelectElement).value).toBe("lot2"));
    await waitFor(() => expect((screen.getByLabelText("Lote — Dipirona 500 mg comprimido") as HTMLSelectElement).value).toBe("lot1"));
    text(`Quantidade — ${CLON} (comprimido)`, "30"); text("Quantidade — Dipirona 500 mg comprimido (cápsula)", "10");
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    const li = await screen.findAllByRole("listitem");
    expect(li.map((x) => x.textContent)).toEqual([ "Dipirona 500 mg comprimido: uso contínuo: próxima retirada deste item a partir de 03/11/2026" ]);
    expect(mocked(api.recordDispensation).mock.calls[0][0].items.map((i: { prescription_item_id: string }) => i.prescription_item_id)).toEqual([ "pi2", "pi5" ]);
  });

  it("403 de papel vem sozinho, sem problems: só a frase", async () => {
    mocked(api.recordDispensation).mockRejectedValueOnce(new ApiError(403, { error: "controlled_requires_pharmacist" }, "403"));
    renderForm();
    await waitFor(() => expect((screen.getByLabelText(`Lote — ${AMOX}`) as HTMLSelectElement).value).toBe("lot1"));
    text(`Quantidade — ${AMOX} (cápsula)`, "21");
    fireEvent.click(screen.getByLabelText("Receita retida na farmácia"));
    fireEvent.click(screen.getByRole("button", { name: "Registrar dispensação" }));
    expect(await screen.findByText("medicamento controlado: só o farmacêutico dispensa")).not.toBeNull();
  });
});
