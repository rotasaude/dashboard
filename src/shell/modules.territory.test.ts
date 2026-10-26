import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";

const user = (roles: string[], features: string[] = [ "clinical_record", "territory_registry" ], operator = false) =>
  ({ operator, memberships: roles.map((role) => ({ role })), features });
const itemsOf = (groups: ReturnType<typeof navGroupsFor>) =>
  groups.find((g) => g.label === "Cadastro territorial")?.items.map((i) => i.id) ?? [];

describe("grupo Cadastro territorial (módulo 24a)", () => {
  it("profissional vê território e validade; admin vê microáreas", () => {
    expect(itemsOf(navGroupsFor(user([ "health_professional" ])))).toEqual([ "territory-team", "registry-status" ]);
    expect(itemsOf(navGroupsFor(user([ "municipal_admin" ])))).toEqual([ "territory-micro-areas" ]);
    expect(itemsOf(navGroupsFor(user([ "municipal_admin", "health_professional" ])))).toEqual([ "territory-team", "registry-status", "territory-micro-areas" ]);
  });
  it("some sem o interruptor, sem o prontuário, para a recepção e para o operador", () => {
    expect(itemsOf(navGroupsFor(user([ "health_professional" ], [ "clinical_record" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([ "health_professional" ], [ "territory_registry" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([ "citizen_verifier" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([ "health_professional" ], undefined, true)))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([ "municipal_admin" ], undefined, true)))).toEqual([]);
    expect(navGroupsFor(user([ "health_professional" ], [])).some((g) => g.label === "Cadastro territorial")).toBe(false);
    expect(navGroupsFor(null).some((g) => g.label === "Cadastro territorial")).toBe(false);
  });
  it("vem depois de Linhas de cuidado, antes de Exames, e tem ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Cadastro territorial")).toBe(labels.indexOf("Linhas de cuidado") + 1);
    expect(labels.indexOf("Exames")).toBe(labels.indexOf("Cadastro territorial") + 1);
    expect(CATALOG.groups["Cadastro territorial"].description).toBe("Microáreas, domicílios, famílias e cadastro individual");
    expect(CATALOG.screens["registry-status"].description).toBe("Vencidos, a vencer e quem falta cadastrar");
    expect(CATALOG.screens["territory-team"].description).toBe("Domicílios, famílias e moradores por microárea");
    expect(CATALOG.screens["territory-micro-areas"].description).toBe("Microáreas das equipes e o ACS responsável");
  });
});
