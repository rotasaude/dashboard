import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";

const CARE_IDS = [ "care-lines-team", "care-lines-preview", "care-lines-admin" ];
const ON = { features: [ "clinical_record", "care_lines" ] };
const userWith = (roles: string[], extra: object = ON) => ({ operator: false, memberships: roles.map((role) => ({ role })), ...extra });
const careIds = (user: Parameters<typeof navGroupsFor>[0]) =>
  navGroupsFor(user).flatMap((g) => g.items.map((i) => i.id)).filter((id) => CARE_IDS.includes(id));

describe("grupo Linhas de cuidado (módulo 23)", () => {
  it("fica logo depois do Atendimento, com as três telas, ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Linhas de cuidado")).toBe(labels.indexOf("Atendimento") + 1);
    expect(NAV_GROUPS.find((g) => g.label === "Linhas de cuidado")?.items.map((i) => i.id)).toEqual(CARE_IDS);
    for (const id of CARE_IDS) expect(CATALOG.screens[id]?.description).toBeTruthy();
    expect(CATALOG.groups["Linhas de cuidado"]?.description).toBeTruthy();
  });

  it("sem care_lines, ninguém vê o grupo (nem com clinical_record)", () => {
    for (const role of [ "health_professional", "municipal_admin", "analyst" ]) {
      expect(careIds(userWith([ role ], { features: [ "clinical_record" ] }))).toEqual([]);
    }
    expect(navGroupsFor(userWith([ "health_professional" ], {})).some((g) => g.label === "Linhas de cuidado")).toBe(false);
  });

  it("care_lines sem clinical_record também esconde (P9)", () => {
    for (const role of [ "health_professional", "municipal_admin", "analyst" ]) {
      expect(careIds(userWith([ role ], { features: [ "care_lines" ] }))).toEqual([]);
    }
  });

  it("profissional vê o painel; admin a prévia e as linhas; analyst só a prévia", () => {
    expect(careIds(userWith([ "health_professional" ]))).toEqual([ "care-lines-team" ]);
    expect(careIds(userWith([ "municipal_admin" ]))).toEqual([ "care-lines-preview", "care-lines-admin" ]);
    expect(careIds(userWith([ "analyst" ]))).toEqual([ "care-lines-preview" ]);
    expect(careIds(userWith([ "health_professional", "municipal_admin" ]))).toEqual(CARE_IDS);
    for (const role of [ "citizen_verifier", "billing_clerk", "lab_staff" ]) expect(careIds(userWith([ role ]))).toEqual([]);
  });

  it("operador e sessão vazia nunca", () => {
    expect(careIds({ operator: true, memberships: [], ...ON })).toEqual([]);
    expect(careIds(null)).toEqual([]);
  });
});
