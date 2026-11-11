import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), fetchCurrentSession: vi.fn(),
  listMyPharmacyLocations: vi.fn(), listUrgencyShortfalls: vi.fn(), reconcileUrgencyShortfall: vi.fn() }));
import * as api from "../lib/api";
import { PharmacyUrgencyShortfalls } from "./PharmacyUrgencyShortfalls";
import { renderWithProviders } from "../test/campaignFixtures";
import { CENTRAL, UBS_FARM, phUser } from "../test/pharmacyFixtures";
import { catalogItem, shortfall } from "../test/urgencyObservationFixtures";

afterEach(cleanup);
const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
const page = (items: api.UrgencyShortfall[], next_before: string | null = null) => ({ items, next_before });
const NOTE = "ajuste feito no estoque da UPA";

function mount(roles: string[], locations: api.PharmacyLocation[]) {
  mocked(api.fetchCurrentSession).mockResolvedValue(phUser(roles));
  mocked(api.listMyPharmacyLocations).mockResolvedValue(locations);
  return renderWithProviders(<PharmacyUrgencyShortfalls />);
}

describe("PharmacyUrgencyShortfalls", () => {
  beforeEach(() => {
    mocked(api.listUrgencyShortfalls).mockReset().mockResolvedValue(page([ shortfall() ]));
    mocked(api.reconcileUrgencyShortfall).mockReset();
  });

  it("lista campo a campo: item, quantidade, causa, senha e hora; nunca o paciente", async () => {
    mocked(api.listUrgencyShortfalls).mockResolvedValue(page([ { ...shortfall(), patient: { name: "João Reis" } } as never ]));
    mount([ "pharmacist" ], [ UBS_FARM ]);
    expect(await screen.findByText("Dipirona 500 mg/mL solução injetável")).not.toBeNull();
    expect(screen.getByText("1 ampola")).not.toBeNull();
    expect(screen.getByText("saldo insuficiente")).not.toBeNull();
    expect(screen.getByText(/U-038 · 10\/11\/2026, 08:05/)).not.toBeNull();
    expect(screen.queryByText(/João Reis/)).toBeNull();
    expect(mocked(api.listUrgencyShortfalls).mock.calls[0][0]).toMatchObject({ locationId: "l2", state: "open" });
  });

  it("causa desconhecida aparece crua", async () => {
    mocked(api.listUrgencyShortfalls).mockResolvedValue(page([ shortfall({ cause: "nova_causa" as never }) ]));
    mount([ "pharmacist" ], [ UBS_FARM ]);
    expect(await screen.findByText("nova_causa")).not.toBeNull();
  });

  it("conciliar: nota de 10 a 500, uma chamada, some das abertas; já conciliada relê", async () => {
    mocked(api.listUrgencyShortfalls).mockResolvedValueOnce(page([ shortfall() ])).mockResolvedValue(page([]));
    mocked(api.reconcileUrgencyShortfall).mockResolvedValue(shortfall({ reconciled_at: "2026-11-10T18:00:00Z" }));
    mount([ "pharmacist" ], [ UBS_FARM ]);
    fireEvent.click(await screen.findByRole("button", { name: /Conciliar falta de Dipirona/ }));
    const note = await screen.findByLabelText("Nota da conciliação");
    fireEvent.change(note, { target: { value: "curta" } });
    fireEvent.click(screen.getByRole("button", { name: "Conciliar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/a nota tem de 10 a 500 caracteres/)).not.toBeNull();
    expect(mocked(api.reconcileUrgencyShortfall)).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Nota da conciliação"), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Conciliar" }));
    const confirm = screen.getByRole("button", { name: "Confirmar" });
    fireEvent.click(confirm); fireEvent.click(confirm);
    expect(await screen.findByText("Falta conciliada.")).not.toBeNull();
    expect(mocked(api.reconcileUrgencyShortfall)).toHaveBeenCalledTimes(1);
    expect(mocked(api.reconcileUrgencyShortfall)).toHaveBeenCalledWith("sf1", NOTE);
    await waitFor(() => expect(screen.queryByText("Dipirona 500 mg/mL solução injetável")).toBeNull());
  });

  it("already_reconciled: frase do api e releitura", async () => {
    mocked(api.reconcileUrgencyShortfall).mockRejectedValue(new api.ApiError(409, { error: "already_reconciled" }, "409"));
    mount([ "pharmacist" ], [ UBS_FARM ]);
    fireEvent.click(await screen.findByRole("button", { name: /Conciliar falta de Dipirona/ }));
    fireEvent.change(await screen.findByLabelText("Nota da conciliação"), { target: { value: NOTE } });
    fireEvent.click(screen.getByRole("button", { name: "Conciliar" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText(/já foi conciliada por outra pessoa/)).not.toBeNull();
    await waitFor(() => expect(mocked(api.listUrgencyShortfalls).mock.calls.length).toBeGreaterThan(1));
  });

  it("conciliadas: data e quem conciliou; sem botão; carregar mais usa next_before", async () => {
    const done = shortfall({ reconciled_at: "2026-11-10T18:00:00Z", reconciled_by: { name: "Ana Souza" } });
    mocked(api.listUrgencyShortfalls).mockImplementation(async (q: { state: string; before?: string | null }) =>
      q.state === "open" ? page([]) : q.before ? page([ shortfall({ shortfall_id: "sf0", catalog_item: catalogItem({ name: "Soro fisiológico" }), reconciled_at: "2026-11-09T18:00:00Z", reconciled_by: null }) ]) : page([ done ], "cur-1"));
    mount([ "pharmacist" ], [ UBS_FARM ]);
    fireEvent.click(await screen.findByRole("tab", { name: "Conciliadas" }));
    expect(await screen.findByText(/10\/11\/2026, 15:00 · Ana Souza/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Conciliar falta/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Carregar mais" }));
    expect(await screen.findByText("Soro fisiológico")).not.toBeNull();
    expect(mocked(api.listUrgencyShortfalls)).toHaveBeenLastCalledWith(expect.objectContaining({ state: "reconciled", before: "cur-1" }));
    expect(screen.getByText(/09\/11\/2026, 15:00 · —/)).not.toBeNull();
  });

  it("auxiliar não entra; local de outro tipo explica", async () => {
    mount([ "pharmacy_assistant" ], [ { ...UBS_FARM, roles: [ "pharmacy_assistant" ] } as never ]);
    await waitFor(() => expect(mocked(api.fetchCurrentSession)).toHaveBeenCalled());
    expect(mocked(api.listUrgencyShortfalls)).not.toHaveBeenCalled();
    cleanup();
    mount([ "pharmacist" ], [ { ...UBS_FARM, kind: "other" } as never ]);
    expect(await screen.findByText(/ficam no local de farmácia da unidade/)).not.toBeNull();
    expect(mocked(api.listUrgencyShortfalls)).not.toHaveBeenCalled();
  });

  it("almoxarife do central lê sem local (todas as UPAs); ninguém mais lê sem local", async () => {
    mount([ "stock_keeper" ], [ CENTRAL ]);
    await waitFor(() => expect(mocked(api.listUrgencyShortfalls)).toHaveBeenCalled());
    expect(mocked(api.listUrgencyShortfalls).mock.calls[0][0]).toMatchObject({ locationId: null, state: "open" });
    expect(screen.getByLabelText("Sem local (todas as UPAs)")).not.toBeNull();
    fireEvent.click(screen.getByLabelText("Sem local (todas as UPAs)"));
    await waitFor(() => expect(mocked(api.listUrgencyShortfalls)).toHaveBeenLastCalledWith(expect.objectContaining({ locationId: "l1" })));
    cleanup();
    mocked(api.listUrgencyShortfalls).mockClear();
    mount([ "pharmacist" ], [ UBS_FARM ]);
    await screen.findByText("Dipirona 500 mg/mL solução injetável");
    expect(mocked(api.listUrgencyShortfalls).mock.calls.every((c) => c[0].locationId === "l2")).toBe(true);
    expect(within(document.body).queryByLabelText("Sem local (todas as UPAs)")).toBeNull();
  });
});
