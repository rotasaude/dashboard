import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";

const BILLING_IDS = [ "billing-procedures", "billing-periods", "billing-settings" ];
const ON = { features: [ "procedure_billing" ] };
const userWith = (roles: string[], extra: object = ON) => ({ operator: false, memberships: roles.map((role) => ({ role })), ...extra });
const billingIds = (user: Parameters<typeof navGroupsFor>[0]) =>
  navGroupsFor(user).flatMap((g) => g.items.map((i) => i.id)).filter((id) => BILLING_IDS.includes(id));

describe("grupo Faturamento (módulo 22)", () => {
  it("fica logo depois do Laboratório, com as três telas", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Faturamento")).toBe(labels.indexOf("Laboratório") + 1);
    expect(NAV_GROUPS.find((g) => g.label === "Faturamento")?.items.map((i) => i.id)).toEqual(BILLING_IDS);
  });

  it("sem procedure_billing, ninguém vê o grupo", () => {
    for (const role of [ "billing_clerk", "municipal_admin" ]) {
      expect(billingIds(userWith([ role ], { features: [ "municipal_lab" ] }))).toEqual([]);
    }
    expect(navGroupsFor(userWith([ "billing_clerk" ], {})).some((g) => g.label === "Faturamento")).toBe(false);
  });

  it("faturista: procedimentos e competências; admin: as três; profissional, laboratório e operador: nada", () => {
    expect(billingIds(userWith([ "billing_clerk" ]))).toEqual([ "billing-procedures", "billing-periods" ]);
    expect(billingIds(userWith([ "municipal_admin" ]))).toEqual(BILLING_IDS);
    expect(billingIds(userWith([ "billing_clerk", "municipal_admin" ]))).toEqual(BILLING_IDS);
    for (const role of [ "health_professional", "lab_releaser", "citizen_verifier", "analyst" ]) expect(billingIds(userWith([ role ]))).toEqual([]);
    expect(billingIds({ operator: true, memberships: [], ...ON })).toEqual([]);
    expect(billingIds(null)).toEqual([]);
  });

  it("o faturista sem outro papel não ganha Atendimento nem Laboratório", () => {
    const labels = navGroupsFor(userWith([ "billing_clerk" ], { features: [ "procedure_billing", "municipal_lab", "exam_tracking" ] })).map((g) => g.label);
    expect(labels).toContain("Faturamento");
    expect(labels).not.toContain("Atendimento");
    expect(labels).not.toContain("Laboratório");
  });
});
