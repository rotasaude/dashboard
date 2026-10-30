import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";

const user = (roles: string[], features = [ "clinical_record", "dental_care" ]) =>
  ({ operator: false, memberships: roles.map((role) => ({ role })), features });
const items = (u: ReturnType<typeof user>) => navGroupsFor(u).find((g) => g.label === "Saúde bucal")?.items.map((i) => i.id) ?? [];

describe("grupo Saúde bucal (módulo 28)", () => {
  it("cada papel vê o seu", () => {
    expect(items(user([ "health_professional" ]))).toEqual([ "dental-prosthesis" ]);
    expect(items(user([ "analyst" ]))).toEqual([ "dental-ceo-goals", "dental-indicators" ]);
    expect(items(user([ "municipal_admin" ]))).toEqual([ "dental-ceo-goals", "dental-indicators", "dental-admin" ]);
    expect(items(user([ "citizen_verifier" ]))).toEqual([]);
  });
  it("sem dental_care, ou sem clinical_record, o grupo some", () => {
    expect(items(user([ "municipal_admin", "health_professional" ], [ "clinical_record" ]))).toEqual([]);
    expect(items(user([ "municipal_admin", "health_professional" ], [ "dental_care" ]))).toEqual([]);
  });
  it("o operador da plataforma nunca vê o grupo", () => {
    expect(items({ ...user([ "municipal_admin" ]), operator: true })).toEqual([]);
  });
  it("grupo e itens no catálogo, com ícone e descrição", () => {
    const group = NAV_GROUPS.find((g) => g.label === "Saúde bucal")!;
    expect(CATALOG.groups["Saúde bucal"]?.description).toBe("Prontuário odontológico, CEO e prótese");
    for (const item of group.items) expect(CATALOG.screens[item.id]?.description).toBeTruthy();
  });
});
