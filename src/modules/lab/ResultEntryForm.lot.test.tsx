// src/modules/lab/ResultEntryForm.lot.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn() };
});

import * as api from "../../lib/api";
import { ResultEntryForm } from "./ResultEntryForm";
import { renderWithProviders } from "../../test/campaignFixtures";
import { glucoseEntry, labResultRow, labUser } from "../../test/labFixtures";
import { qcUser } from "../../test/qcFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
beforeEach(() => { mocked(api.fetchCurrentSession).mockReset().mockResolvedValue(qcUser([ "lab_staff" ])); });

const WITH_LOTS = () => glucoseEntry({ results: [
  labResultRow({ reagent_lot: { id: "sl1", lot_number: "R-778" } }),
  labResultRow({ id: "res2", value: "101", effective: false, chosen: false, reagent_lot: null })
] });

describe("ResultEntryForm — lote do reagente (contrato §7)", () => {
  it("valor com lote mostra o número; sem lote, sem rastreio", async () => {
    renderWithProviders(<ResultEntryForm item={WITH_LOTS()} onSaved={vi.fn()} onClose={vi.fn()} />);
    const history = screen.getByRole("list", { name: "valores de Glicose" });
    expect(await within(history).findByText("sem rastreio de reagente")).not.toBeNull();
    expect(within(history).getByText("lote R-778")).not.toBeNull();
  });

  it("api antigo (sem o campo): nada aparece", async () => {
    renderWithProviders(<ResultEntryForm item={glucoseEntry({ results: [ labResultRow() ] })} onSaved={vi.fn()} onClose={vi.fn()} />);
    await vi.waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
    expect(screen.queryByText(/lote |sem rastreio/)).toBeNull();
  });

  it("estoque desligado (21b): nada aparece, mesmo com o campo", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(labUser([ "lab_staff" ]));
    renderWithProviders(<ResultEntryForm item={WITH_LOTS()} onSaved={vi.fn()} onClose={vi.fn()} />);
    await vi.waitFor(() => expect(api.fetchCurrentSession).toHaveBeenCalled());
    await screen.findByRole("list", { name: "valores de Glicose" });
    expect(screen.queryByText(/lote |sem rastreio/)).toBeNull();
  });
});
