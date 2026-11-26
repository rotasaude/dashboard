import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn() };
});

import * as api from "../../lib/api";
import { BnafarGate } from "./BnafarGate";
import { BNAFAR_DISABLED, BNAFAR_NO_ROLE } from "../../lib/bnafar";
import { PHARMACY_DISABLED } from "../../lib/pharmacy";
import { renderWithProviders } from "../../test/campaignFixtures";
import { phUser } from "../../test/pharmacyFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

function gate(needs?: "bnafar" | "stock", allow: (r: { admin: boolean; keeper: boolean }) => boolean = (r) => r.admin || r.keeper) {
  return renderWithProviders(<BnafarGate title="BNAFAR" sub="x" needs={needs} allow={allow}>{() => <p>conteúdo</p>}</BnafarGate>);
}

describe("BnafarGate", () => {
  beforeEach(() => mocked(api.fetchCurrentSession).mockReset());

  it("com bnafar e papel, mostra o conteúdo", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ], { features: [ "pharmacy", "bnafar" ] }));
    gate();
    expect(await screen.findByText("conteúdo")).not.toBeNull();
  });

  it("sem bnafar: BNAFAR_DISABLED, mesmo para o administrador", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "municipal_admin" ]));
    gate();
    expect(await screen.findByText(BNAFAR_DISABLED)).not.toBeNull();
    expect(screen.queryByText("conteúdo")).toBeNull();
  });

  it("sem papel: BNAFAR_NO_ROLE", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ], { features: [ "pharmacy", "bnafar" ] }));
    gate();
    expect(await screen.findByText(BNAFAR_NO_ROLE)).not.toBeNull();
    expect(screen.queryByText("conteúdo")).toBeNull();
  });

  it("needs=stock abre sem o bnafar (Q19/Q22) e avisa sem o estoque", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    gate("stock");
    expect(await screen.findByText("conteúdo")).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ], { features: [ "clinical_record" ] }));
    gate("stock");
    expect(await screen.findByText(PHARMACY_DISABLED)).not.toBeNull();
  });

  it("o operador nunca entra", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "municipal_admin" ], { features: [ "pharmacy", "bnafar" ], operator: true }));
    gate();
    expect(await screen.findByText(BNAFAR_DISABLED)).not.toBeNull();
  });
});
