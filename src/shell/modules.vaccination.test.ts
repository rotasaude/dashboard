import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";

const user = (roles: string[], features: string[] | undefined = [ "clinical_record", "vaccination" ], operator = false) =>
  ({ operator, memberships: roles.map((role) => ({ role })), features });
const itemsOf = (groups: ReturnType<typeof navGroupsFor>) => groups.find((g) => g.label === "Vacinação")?.items.map((i) => i.id) ?? [];

describe("grupo Vacinação (módulo 29)", () => {
  it("cada papel vê o seu", () => {
    expect(itemsOf(navGroupsFor(user([ "health_professional" ])))).toEqual([
      "vaccination-room", "vaccination-pending", "vaccination-stock", "vaccination-cold-chain", "vaccination-summary" ]);
    expect(itemsOf(navGroupsFor(user([ "stock_keeper" ])))).toEqual([ "vaccination-stock", "vaccination-cold-chain", "vaccination-summary" ]);
    expect(itemsOf(navGroupsFor(user([ "municipal_admin" ])))).toEqual([ "vaccination-panel", "vaccination-admin" ]);
    expect(itemsOf(navGroupsFor(user([ "analyst" ])))).toEqual([ "vaccination-panel" ]);
  });
  it("some sem o interruptor, para outros papéis e para o operador; não depende da farmácia", () => {
    expect(itemsOf(navGroupsFor(user([ "health_professional", "municipal_admin" ], [ "clinical_record", "pharmacy" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([ "citizen_verifier", "campaign_manager", "pharmacist" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([], undefined, true)))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([ "stock_keeper" ], [ "vaccination" ])))).toEqual([ "vaccination-stock", "vaccination-cold-chain", "vaccination-summary" ]);
  });
  it("vem depois da Farmácia, com ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Vacinação")).toBe(labels.indexOf("Farmácia") + 1);
    expect(CATALOG.groups["Vacinação"].description).toBe("Sala de vacina, caderneta, envio à RNDS, estoque e cadeia de frio");
    expect(CATALOG.screens["vaccination-room"].description).toBe("Caderneta do cidadão, dose com lote e frasco, transcrição");
    expect(CATALOG.screens["vaccination-pending"].description).toBe("Doses paradas, recusadas ou perto do prazo de 24 h");
    expect(CATALOG.screens["vaccination-stock"].description).toBe("Entrada, transferência, frascos abertos, posição e perdas");
    expect(CATALOG.screens["vaccination-cold-chain"].description).toBe("Equipamentos, temperatura duas vezes ao dia e conduta");
    expect(CATALOG.screens["vaccination-summary"].description).toBe("Movimentação do mês para lançar no SIES/SIPNI");
    expect(CATALOG.screens["vaccination-panel"].description).toBe("Doses, cobertura do C2, envio à RNDS e perdas");
    expect(CATALOG.screens["vaccination-admin"].description).toBe("Salas, vacinadores, rede de frio e início na cidade");
  });
});
