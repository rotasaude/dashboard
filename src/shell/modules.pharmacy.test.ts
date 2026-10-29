import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";

const user = (roles: string[], features: string[] | undefined = [ "pharmacy" ], operator = false) =>
  ({ operator, memberships: roles.map((role) => ({ role })), features });
const itemsOf = (groups: ReturnType<typeof navGroupsFor>) => groups.find((g) => g.label === "Farmácia")?.items.map((i) => i.id) ?? [];

describe("grupo Farmácia (módulo 27a)", () => {
  it("cada papel vê o seu", () => {
    expect(itemsOf(navGroupsFor(user([ "pharmacist" ])))).toEqual([
      "pharmacy-dispensing", "pharmacy-external", "pharmacy-transfers", "pharmacy-entries", "pharmacy-stock", "pharmacy-adjustments", "pharmacy-alerts" ]);
    expect(itemsOf(navGroupsFor(user([ "pharmacy_assistant" ])))).toEqual([
      "pharmacy-dispensing", "pharmacy-external", "pharmacy-transfers", "pharmacy-stock", "pharmacy-alerts" ]);
    expect(itemsOf(navGroupsFor(user([ "stock_keeper" ])))).toEqual([
      "pharmacy-transfers", "pharmacy-entries", "pharmacy-stock", "pharmacy-adjustments", "pharmacy-alerts" ]);
    expect(itemsOf(navGroupsFor(user([ "municipal_admin" ])))).toEqual([ "pharmacy-admin" ]);
  });
  it("some sem o interruptor, para outros papéis e para o operador", () => {
    expect(itemsOf(navGroupsFor(user([ "pharmacist", "stock_keeper", "municipal_admin" ], [ "clinical_record" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([ "health_professional", "citizen_verifier", "care_regulator" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([], undefined, true)))).toEqual([]);
  });
  it("vem depois da Regulação, com ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Farmácia")).toBe(labels.indexOf("Regulação") + 1);
    expect(CATALOG.groups["Farmácia"].description).toBe("Almoxarifado, farmácia da unidade, dispensação e alertas");
    expect(CATALOG.screens["pharmacy-dispensing"].description).toBe("Receita pelo código ou pelo paciente, lote e retirada");
    expect(CATALOG.screens["pharmacy-external"].description).toBe("Receita de fora da rede, com profissional e conselho");
    expect(CATALOG.screens["pharmacy-transfers"].description).toBe("Envio do almoxarifado e recebimento conferido na unidade");
    expect(CATALOG.screens["pharmacy-entries"].description).toBe("Nota fiscal, doação e inventário de abertura, com lote");
    expect(CATALOG.screens["pharmacy-stock"].description).toBe("Saldo por local e lote, extrato e estoque mínimo");
    expect(CATALOG.screens["pharmacy-adjustments"].description).toBe("Ajustes, perdas e vencimentos, com aprovação");
    expect(CATALOG.screens["pharmacy-alerts"].description).toBe("Vencendo, abaixo do mínimo, em trânsito e pendências");
    expect(CATALOG.screens["pharmacy-admin"].description).toBe("Locais de estoque, equipe por local e prazos");
  });
});
