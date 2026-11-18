import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";

vi.mock("../../lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../../lib/api")>();
  const pending = () => vi.fn(() => new Promise(() => {}));
  return { ...real, fetchCurrentSession: vi.fn(), listMyPharmacyLocations: pending(), listAdminLocations: pending(), listAllUnits: pending(),
    listMemberships: pending(), getPharmacySettings: pending() };
});

import * as api from "../../lib/api";
import { PharmacyGate } from "./PharmacyGate";
import { PharmacyAdmin } from "../PharmacyAdmin";
import { PharmacyDispensing } from "../PharmacyDispensing";
import { PharmacyExternal } from "../PharmacyExternal";
import { PharmacyAlerts } from "../PharmacyAlerts";
import { PharmacyUrgencyShortfalls } from "../PharmacyUrgencyShortfalls";
import { PharmacyStock } from "../PharmacyStock";
import { PharmacyTransfers } from "../PharmacyTransfers";
import { PharmacyEntries } from "../PharmacyEntries";
import { PharmacyAdjustments } from "../PharmacyAdjustments";
import { PHARMACY_DISABLED } from "../../lib/pharmacy";
import { VC_FEATURES } from "../../test/vectorControlFixtures";
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

describe("PharmacyGate stock (35a, Q21)", () => {
  beforeEach(() => mocked(api.fetchCurrentSession).mockReset());
  const stockGate = () =>
    renderWithProviders(<PharmacyGate stock title="Farmácia" sub="x" allow={(r) => r.keeper}>{() => <p>conteúdo</p>}</PharmacyGate>);

  it("cidade só com vector_control: a tela de estoque abre; a só da farmácia continua desligada", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ], { features: VC_FEATURES }));
    stockGate();
    expect(await screen.findByText("conteúdo")).not.toBeNull();
    cleanup();
    gate((r) => r.keeper);
    expect(await screen.findByText(PHARMACY_DISABLED)).not.toBeNull();
    expect(screen.queryByText("conteúdo")).toBeNull();
  });

  it("vector_control sem a visita domiciliar utilizável, ou o operador: desligada", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ], { features: [ "clinical_record", "vector_control" ] }));
    stockGate();
    expect(await screen.findByText(PHARMACY_DISABLED)).not.toBeNull();
    cleanup();
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ], { features: VC_FEATURES, operator: true }));
    stockGate();
    expect(await screen.findByText(PHARMACY_DISABLED)).not.toBeNull();
  });

  it("cidade só com pharmacy: nada muda", async () => {
    mocked(api.fetchCurrentSession).mockResolvedValue(phUser([ "stock_keeper" ]));
    stockGate();
    expect(await screen.findByText("conteúdo")).not.toBeNull();
  });

  it("os cinco pontos de estoque abrem só com vector_control; dispensação, receita externa, alertas e faltas da UPA não", async () => {
    const roles = [ "stock_keeper", "pharmacist", "pharmacy_assistant", "municipal_admin" ];
    const stock = [ [ PharmacyStock, "Posição e extrato" ], [ PharmacyTransfers, "Transferências" ], [ PharmacyEntries, "Entradas e abertura" ],
      [ PharmacyAdjustments, "Inventário e ajustes" ], [ PharmacyAdmin, "Locais e configurações" ] ] as const;
    const pharmacyOnly = [ [ PharmacyDispensing, "Dispensação" ], [ PharmacyExternal, "Receita externa" ], [ PharmacyAlerts, "Alertas da farmácia" ],
      [ PharmacyUrgencyShortfalls, "Faltas da UPA" ] ] as const;
    for (const [ Screen, title ] of stock) {
      mocked(api.fetchCurrentSession).mockResolvedValue(phUser(roles, { features: VC_FEATURES }));
      renderWithProviders(<Screen />);
      expect(await screen.findByText(title)).not.toBeNull();
      expect(screen.queryByText(PHARMACY_DISABLED), title).toBeNull();
      cleanup();
    }
    for (const [ Screen, title ] of pharmacyOnly) {
      mocked(api.fetchCurrentSession).mockResolvedValue(phUser(roles, { features: VC_FEATURES }));
      renderWithProviders(<Screen />);
      expect(await screen.findByText(PHARMACY_DISABLED), title).not.toBeNull();
      cleanup();
    }
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
