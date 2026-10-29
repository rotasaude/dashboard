import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  return { ...real, fetchCurrentSession: vi.fn() };
});

import * as api from "../../lib/api";
import { PharmacyGate } from "./PharmacyGate";
import { PharmacyAdmin } from "../PharmacyAdmin";
import { PharmacyDispensing } from "../PharmacyDispensing";
import { renderWithProviders } from "../../test/campaignFixtures";
import { phUser } from "../../test/pharmacyFixtures";

const mocked = (fn: unknown) => fn as ReturnType<typeof vi.fn>;
afterEach(cleanup);

function gate(allow: (r: { pharmacist: boolean; assistant: boolean; keeper: boolean; admin: boolean }) => boolean = (r) => r.pharmacist) {
  return renderWithProviders(<PharmacyGate title="Farmácia" sub="x" allow={allow}>{() => <p>conteúdo</p>}</PharmacyGate>);
}

describe("PharmacyGate", () => {
  beforeEach(() => mocked(api.fetchCurrentSession).mockReset());

  it("com interruptor e papel, mostra o conteúdo", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    gate();
    expect(await screen.findByText("conteúdo")).not.toBeNull();
  });

  it("sem o interruptor: avisa, mesmo para o administrador", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist", "municipal_admin" ], { features: [ "clinical_record" ] }));
    gate((r) => r.pharmacist || r.admin);
    expect(await screen.findByText("a farmácia e o almoxarifado estão desligados nesta cidade")).not.toBeNull();
    expect(screen.queryByText("conteúdo")).toBeNull();
  });

  it("sem o papel: avisa", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "health_professional" ]));
    gate();
    expect(await screen.findByText("seu papel não permite usar a farmácia")).not.toBeNull();
    expect(screen.queryByText("conteúdo")).toBeNull();
  });

  it("o operador da plataforma nunca entra", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ], { operator: true }));
    gate();
    expect(await screen.findByText("a farmácia e o almoxarifado estão desligados nesta cidade")).not.toBeNull();
  });
});

describe("telas-portão da farmácia", () => {
  beforeEach(() => mocked(api.fetchCurrentSession).mockReset());

  it("o interruptor desligado vale também para Locais e configurações", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "municipal_admin" ], { features: [] }));
    renderWithProviders(<PharmacyAdmin />);
    expect(await screen.findByText("a farmácia e o almoxarifado estão desligados nesta cidade")).not.toBeNull();
  });

  it("Locais e configurações é só do administrador; a dispensação não é dele", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "municipal_admin" ]));
    renderWithProviders(<PharmacyDispensing />);
    expect(await screen.findByText("seu papel não permite usar a farmácia")).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "pharmacist" ]));
    renderWithProviders(<PharmacyAdmin />);
    expect(await screen.findByText("seu papel não permite usar a farmácia")).not.toBeNull();
  });
});
