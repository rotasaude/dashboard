// src/modules/VectorStockShortfalls.test.tsx
// "Faltas de insumo de campo" (módulo 35a, Task 18; F-35.3; contrato §4, §12; Q9, Q21): insumo aplicado no boletim sem saldo no local.
// StockShortfallsController#readable_scope: a coordenação lê todas (inclusive as no_location) sem local; o almoxarife só as do(s) seu(s)
// local(is) vector_control (outro → 403 missing_role). "Conciliar" com nota 10–500 → POST /stock_shortfalls/:id/reconcile { note }
// (ReconcileShortfall: não mexe no saldo). 409 already_reconciled → a frase e UMA releitura, sem reenvio. Nenhuma pessoa na lista.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn(), listMyPharmacyLocations: vi.fn(), listVectorShortfalls: vi.fn(), reconcileVectorShortfall: vi.fn() };
});

import * as api from "../lib/api";
import { ApiError } from "../lib/api";
import { VC_NO_ROLE } from "../lib/vectorControl";
import { VECTOR_CONTROL_DISABLED, VECTOR_ERRORS } from "../lib/vectorErrors";
import { renderWithProviders } from "../test/campaignFixtures";
import { CENTRAL } from "../test/pharmacyFixtures";
import { VC_FEATURES, VC_LOCATION, shortfall, vcUser } from "../test/vectorControlFixtures";
import {
  RECONCILE_HINT, SHORTFALLS_OPEN_EMPTY, SHORTFALL_RECONCILED, SHORTFALL_UNCERTAIN, VC_NO_STOCK_LOCATION, VectorStockShortfalls
} from "./VectorStockShortfalls";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const ALL = [ api.fetchCurrentSession, api.listMyPharmacyLocations, api.listVectorShortfalls, api.reconcileVectorShortfall ];
const page = (items: ReturnType<typeof shortfall>[], next_before: string | null = null) => ({ items, next_before });

const OPEN = shortfall();
const NO_LOC = shortfall({ id: "sf2", stock_location: null, cause: "no_location", quantity: "12.50",
  product: { id: "pr2", code: "MAL", name: "Malationa 44% EW", unit: "ml" }, visit_on: "2026-11-14" });
const DONE = shortfall({ id: "sf3", reconciled_at: "2026-11-16T15:00:00Z", reconciled_by: { name: "Paulo Almoxarife" }, cause: "no_lot" });
const NOTE = "reposto pela nota NF 77 no inventário";

const keeper = (features = VC_FEATURES) => vcUser([ "stock_keeper" ], features);
const coordinator = () => vcUser([ "endemic_coordinator" ]);
const conciliar = (s = OPEN) => screen.getByRole("button", { name: `Conciliar falta de ${s.product.code} — ${s.product.name}` });

describe("VectorStockShortfalls", () => {
  beforeEach(() => {
    for (const fn of ALL) mocked(fn).mockReset();
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ VC_LOCATION ]);
    mocked(api.listVectorShortfalls).mockResolvedValue(page([ OPEN ]));
  });

  it("coordenação: lê todas sem local, inclusive a no_location; não lê os locais da pessoa; colunas e a frase da conciliação", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(coordinator());
    mocked(api.listVectorShortfalls).mockResolvedValue(page([ OPEN, NO_LOC ]));
    renderWithProviders(<VectorStockShortfalls />);
    const row = await screen.findByRole("row", { name: /Malationa/ });
    expect(row.textContent).toContain("14/11/2026");
    expect(row.textContent).toContain("MAL — Malationa 44% EW");
    expect(row.textContent).toContain("12,5 ml");
    expect(row.textContent).toContain("sem local de estoque configurado");
    expect(row.textContent).toContain("sem local");
    const other = screen.getByRole("row", { name: /Pyriproxyfen/ });
    expect(other.textContent).toContain("Almoxarifado de endemias");
    expect(other.textContent).toContain("saldo insuficiente");
    expect(other.textContent).toContain("4 g");
    expect(screen.getByText(RECONCILE_HINT)).not.toBeNull();
    expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(1);
    expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledWith({ state: "open", locationId: null, before: null });
    expect(mocked(api.listMyPharmacyLocations)).not.toHaveBeenCalled();
    // A coordenação concilia também a no_location.
    expect(conciliar(NO_LOC)).not.toBeNull();
  });

  it("almoxarife: só o local vector_control em que é almoxarife (o central e o vector_control alheio, com roles [], ficam fora)", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(keeper([ "pharmacy", ...VC_FEATURES ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL, { ...VC_LOCATION, id: "loc-other", name: "Base alheia", roles: [] }, VC_LOCATION ]);
    renderWithProviders(<VectorStockShortfalls />);
    expect(await screen.findByRole("row", { name: /Pyriproxyfen/ })).not.toBeNull();
    expect(screen.queryByLabelText("Local")).toBeNull();
    expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(1);
    expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledWith({ state: "open", locationId: "loc-vc", before: null });
  });

  it("almoxarife com dois locais vector_control escolhe o local; trocar relê pelo novo local", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(keeper());
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ VC_LOCATION, { ...VC_LOCATION, id: "loc-vc2", name: "Base de campo Norte" } ]);
    renderWithProviders(<VectorStockShortfalls />);
    await screen.findByRole("row", { name: /Pyriproxyfen/ });
    fireEvent.change(screen.getByLabelText("Local"), { target: { value: "loc-vc2" } });
    await waitFor(() => expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(2));
    expect(mocked(api.listVectorShortfalls).mock.calls[1][0]).toEqual({ state: "open", locationId: "loc-vc2", before: null });
  });

  it("almoxarife sem local vector_control: o aviso antes de ler as faltas; 403 missing_role vira a mesma frase", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(keeper([ "pharmacy", ...VC_FEATURES ]));
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ CENTRAL ]);
    renderWithProviders(<VectorStockShortfalls />);
    expect(await screen.findByText(VC_NO_STOCK_LOCATION)).not.toBeNull();
    expect(mocked(api.listVectorShortfalls)).not.toHaveBeenCalled();
    cleanup();
    mocked(api.listMyPharmacyLocations).mockResolvedValue([ VC_LOCATION ]);
    mocked(api.listVectorShortfalls).mockRejectedValue(new ApiError(403, { error: "missing_role" }, "403"));
    renderWithProviders(<VectorStockShortfalls />);
    expect(await screen.findByText(VC_NO_STOCK_LOCATION)).not.toBeNull();
    expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(1);
  });

  it("cidade só com pharmacy: a tela diz que o 35a está desligado e não lê nada; o farmacêutico não tem papel aqui", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "stock_keeper" ], [ "pharmacy" ]));
    renderWithProviders(<VectorStockShortfalls />);
    expect(await screen.findByText(VECTOR_CONTROL_DISABLED)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(vcUser([ "pharmacist" ], [ "pharmacy", ...VC_FEATURES ]));
    renderWithProviders(<VectorStockShortfalls />);
    expect(await screen.findByText(VC_NO_ROLE)).not.toBeNull();
    expect(mocked(api.listVectorShortfalls)).not.toHaveBeenCalled();
    expect(mocked(api.listMyPharmacyLocations)).not.toHaveBeenCalled();
  });

  it("conciliar sem nota (ou curta) não envia; com a nota, um envio só (duplo clique), a frase e UMA releitura", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(keeper());
    let resolve: (v: unknown) => void = () => {};
    mocked(api.reconcileVectorShortfall).mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderWithProviders(<VectorStockShortfalls />);
    await screen.findByRole("row", { name: /Pyriproxyfen/ });
    fireEvent.click(conciliar());
    const form = within(screen.getByRole("form", { name: "Conciliar falta de PYR — Pyriproxyfen 0,5% G" }));
    fireEvent.click(form.getByRole("button", { name: "Conciliar falta" }));
    expect(await form.findByText("escreva de 10 a 500 caracteres")).not.toBeNull();
    fireEvent.change(form.getByLabelText("Nota da conciliação"), { target: { value: "  curta   " } });
    fireEvent.click(form.getByRole("button", { name: "Conciliar falta" }));
    expect(mocked(api.reconcileVectorShortfall)).not.toHaveBeenCalled();
    fireEvent.change(form.getByLabelText("Nota da conciliação"), { target: { value: `  ${NOTE}  ` } });
    fireEvent.click(form.getByRole("button", { name: "Conciliar falta" }));
    fireEvent.click(form.getByRole("button", { name: "Conciliar falta" }));
    expect(mocked(api.reconcileVectorShortfall)).toHaveBeenCalledTimes(1);
    expect(mocked(api.reconcileVectorShortfall)).toHaveBeenCalledWith("sf1", NOTE);
    mocked(api.listVectorShortfalls).mockResolvedValue(page([]));
    resolve(shortfall({ reconciled_at: "2026-11-16T15:00:00Z" }));
    expect((await screen.findByRole("status")).textContent).toBe(SHORTFALL_RECONCILED);
    await waitFor(() => expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(SHORTFALLS_OPEN_EMPTY)).not.toBeNull();
    expect(screen.queryByRole("form")).toBeNull();
    expect(mocked(api.reconcileVectorShortfall)).toHaveBeenCalledTimes(1);
  });

  it("409 already_reconciled: a frase, UMA releitura, nenhum reenvio", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(coordinator());
    mocked(api.reconcileVectorShortfall).mockRejectedValue(new ApiError(409, { error: "already_reconciled" }, "409"));
    renderWithProviders(<VectorStockShortfalls />);
    await screen.findByRole("row", { name: /Pyriproxyfen/ });
    fireEvent.click(conciliar());
    fireEvent.change(screen.getByLabelText("Nota da conciliação"), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Conciliar falta" }));
    expect(await screen.findByText(VECTOR_ERRORS.already_reconciled)).not.toBeNull();
    await waitFor(() => expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(2));
    expect(mocked(api.reconcileVectorShortfall)).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("rede/5xx: não se sabe se gravou — a frase própria e UMA releitura; 422 path note fica no campo, sem releitura", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(coordinator());
    mocked(api.reconcileVectorShortfall).mockRejectedValueOnce(new ApiError(422, { error: "invalid_request", path: "note" }, "422"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderWithProviders(<VectorStockShortfalls />);
    await screen.findByRole("row", { name: /Pyriproxyfen/ });
    fireEvent.click(conciliar());
    fireEvent.change(screen.getByLabelText("Nota da conciliação"), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Conciliar falta" }));
    await waitFor(() => expect(mocked(api.reconcileVectorShortfall)).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("form")).not.toBeNull();
    expect((screen.getByLabelText("Nota da conciliação") as HTMLTextAreaElement).value).toBe(NOTE);
    expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Conciliar falta" }));
    expect(await screen.findByText(SHORTFALL_UNCERTAIN)).not.toBeNull();
    await waitFor(() => expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(2));
    expect(mocked(api.reconcileVectorShortfall)).toHaveBeenCalledTimes(2);
  });

  it("aba Conciliadas: lê state=reconciled; mostra a data da conciliação e nenhuma pessoa (nem quem conciliou); sem botão", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(coordinator());
    mocked(api.listVectorShortfalls).mockImplementation(async (q: { state: string }) => page(q.state === "open" ? [ OPEN ] : [ DONE ]));
    renderWithProviders(<VectorStockShortfalls />);
    await screen.findByRole("row", { name: /Pyriproxyfen/ });
    fireEvent.click(screen.getByRole("tab", { name: "Conciliadas" }));
    await waitFor(() => expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(2));
    expect(mocked(api.listVectorShortfalls).mock.calls[1][0]).toEqual({ state: "reconciled", locationId: null, before: null });
    const row = await screen.findByRole("row", { name: /sem lote do produto/ });
    expect(row.textContent).toContain("16/11/2026");
    expect(document.body.textContent).not.toContain("Paulo Almoxarife");
    expect(screen.queryByRole("button", { name: /Conciliar falta de/ })).toBeNull();
  });

  it("Carregar mais segue o cursor da aba", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(coordinator());
    mocked(api.listVectorShortfalls).mockResolvedValueOnce(page([ OPEN ], "cur-1")).mockResolvedValueOnce(page([ NO_LOC ]));
    renderWithProviders(<VectorStockShortfalls />);
    fireEvent.click(await screen.findByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByRole("row", { name: /Malationa/ })).not.toBeNull();
    expect(mocked(api.listVectorShortfalls)).toHaveBeenCalledTimes(2);
    expect(mocked(api.listVectorShortfalls).mock.calls[1][0]).toEqual({ state: "open", locationId: null, before: "cur-1" });
  });
});
