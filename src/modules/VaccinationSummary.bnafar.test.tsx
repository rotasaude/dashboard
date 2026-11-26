// src/modules/VaccinationSummary.bnafar.test.tsx
// Q27 (F-25): o resumo mensal traz `external_out` e `opening_reverted` (doses positivas), subtraídos no fechamento da linha.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import { renderWithProviders } from "../test/campaignFixtures";
import { CATALOG29, ROOM, TODAY29, monthly, vacUser } from "../test/vaccinationFixtures";
import * as api from "../lib/api";
import { VaccinationSummary } from "./VaccinationSummary";

vi.mock("../lib/api", async (orig) => ({ ...(await orig<typeof api>()), fetchCurrentSession: vi.fn(), listMyVaccineLocations: vi.fn(),
  getVaccinationCatalog: vi.fn(), getMonthlySummary: vi.fn() }));
beforeEach(() => {
  vi.mocked(api.fetchCurrentSession).mockResolvedValue(vacUser());
  vi.mocked(api.getVaccinationCatalog).mockResolvedValue(CATALOG29);
  vi.mocked(api.listMyVaccineLocations).mockResolvedValue([ ROOM ]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe("resumo mensal de vacinas: saída externa e abertura desfeita (Q27)", () => {
  it("duas colunas novas, por linha e no Total, e o saldo final se reproduz com elas", async () => {
    const base = monthly().rows[0];
    // 100 + 50 + 0 − 0 − 20 (saída externa) − 10 (abertura desfeita) − 30 (frascos) − 5 (unidose) + 0 − 0 = 85.
    const a: typeof base = { ...base, opening_balance: 100, received: 50, transferred_in: 0, transferred_out: 0, external_out: 20, opening_reverted: 10,
      vial_doses: 30, unit_doses: 5, adjustment: 0, physical_loss: {}, closing_balance: 85 };
    const b: typeof base = { ...base, lot: { ...base.lot, id: "lot16", number: "BCG2611" }, opening_balance: 40, received: 0, external_out: 4, opening_reverted: 1,
      vial_doses: 0, unit_doses: 0, adjustment: 0, physical_loss: {}, closing_balance: 35 };
    const calc = (r: typeof base) => r.opening_balance + r.received + r.transferred_in - r.transferred_out - r.external_out - r.opening_reverted
      - r.vial_doses - r.unit_doses + r.adjustment - Object.values(r.physical_loss).reduce((n, v) => n + v, 0);
    expect(calc(a)).toBe(a.closing_balance);
    expect(calc(b)).toBe(b.closing_balance);
    vi.mocked(api.getMonthlySummary).mockResolvedValue(monthly({ rows: [ a, b ] }));
    renderWithProviders(<VaccinationSummary today={TODAY29} />);
    fireEvent.click(await screen.findByRole("button", { name: "Ver resumo" }));
    const table = await screen.findByRole("region", { name: "Movimentação do mês" });
    for (const h of [ "Saídas para fora da rede", "Aberturas desfeitas" ]) expect(within(table).getByText(h)).not.toBeNull();
    const heads = within(table).getAllByRole("columnheader").map((c) => c.textContent);
    expect(heads.indexOf("Saídas para fora da rede")).toBe(heads.indexOf("Transferências enviadas") + 1);
    expect(heads.indexOf("Aberturas desfeitas")).toBe(heads.indexOf("Saídas para fora da rede") + 1);
    const rows = within(table).getAllByRole("row");
    const cells = (i: number) => within(rows[i]).getAllByRole("cell").map((c) => c.textContent);
    const at = (i: number, head: string) => cells(i)[heads.indexOf(head)];
    expect([ at(1, "Saídas para fora da rede"), at(1, "Aberturas desfeitas"), at(1, "Saldo final") ]).toEqual([ "20", "10", "85" ]);
    expect([ at(2, "Saídas para fora da rede"), at(2, "Aberturas desfeitas") ]).toEqual([ "4", "1" ]);
    expect([ at(3, "Saídas para fora da rede"), at(3, "Aberturas desfeitas"), at(3, "Saldo final") ]).toEqual([ "24", "11", "120" ]);
    expect(screen.getByText(/− saídas para fora da rede − aberturas desfeitas/)).not.toBeNull();
  });
});
