import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor, withRegulationCount } from "./modules";
import { CATALOG } from "./catalog";

const user = (roles: string[], features: string[] | undefined = [ "care_regulation", "clinical_record" ], operator = false) =>
  ({ operator, memberships: roles.map((role) => ({ role })), features });
const itemsOf = (groups: ReturnType<typeof navGroupsFor>) => groups.find((g) => g.label === "Regulação")?.items.map((i) => i.id) ?? [];

describe("grupo Regulação (módulo 26a)", () => {
  it("cada papel vê o seu", () => {
    expect(itemsOf(navGroupsFor(user([ "care_regulator" ])))).toEqual([ "regulation-queue", "regulation-offers" ]);
    expect(itemsOf(navGroupsFor(user([ "health_professional" ])))).toEqual([ "regulation-returned" ]);
    expect(itemsOf(navGroupsFor(user([ "municipal_admin" ])))).toEqual([ "regulation-offers", "regulation-settings" ]);
    expect(itemsOf(navGroupsFor(user([ "care_regulator", "municipal_admin" ])))).toEqual([
      "regulation-queue", "regulation-offers", "regulation-settings" ]);
  });
  it("some sem o interruptor, para outros papéis e para o operador", () => {
    expect(itemsOf(navGroupsFor(user([ "care_regulator", "municipal_admin", "health_professional" ], [ "clinical_record" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([ "citizen_verifier", "analyst", "exam_regulator" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([], undefined, true)))).toEqual([]);
  });
  it("vem depois da Vigilância, com ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Regulação")).toBe(labels.indexOf("Vigilância") + 1);
    expect(CATALOG.groups["Regulação"].description).toBe("Encaminhamentos a especialista e procedimento, fila, cotas e prazos");
    expect(CATALOG.screens["regulation-queue"].description).toBe("Pedidos por cor e espera, vencidos primeiro");
    expect(CATALOG.screens["regulation-returned"].description).toBe("Pedidos da unidade devolvidos para complementar");
    expect(CATALOG.screens["regulation-offers"].description).toBe("Prestadores, ofertas e cota mensal com saldo");
    expect(CATALOG.screens["regulation-settings"].description).toBe("Prazos por cor e o que o enfermeiro pode pedir");
  });
  it("os vencidos no rótulo da fila", () => {
    const groups = navGroupsFor(user([ "care_regulator" ]));
    expect(withRegulationCount(groups, 0)).toBe(groups);
    const label = (n: number) => withRegulationCount(groups, n).find((g) => g.label === "Regulação")!.items[0].label;
    expect(label(1)).toBe("Fila regulada (1 vencido)");
    expect(label(4)).toBe("Fila regulada (4 vencidos)");
  });
});
