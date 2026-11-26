import { describe, expect, it } from "vitest";
import { navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";

const user = (roles: string[], features: string[] = [ "pharmacy", "bnafar" ], operator = false) =>
  ({ operator, memberships: roles.map((role) => ({ role })), features });
const farm = (u: ReturnType<typeof user>) => navGroupsFor(u).find((g) => g.label === "Farmácia")?.items ?? [];
const ids = (u: ReturnType<typeof user>) => farm(u).map((i) => i.id);
const NEW = [ "external-exits", "opening-import", "bnafar-status", "bnafar-pending" ];
const mine = (u: ReturnType<typeof user>) => ids(u).filter((i) => NEW.includes(i));

describe("grupo Farmácia: BNAFAR, saída externa e saldo inicial (módulo 27b)", () => {
  it("com bnafar e almoxarife, os quatro, na ordem do grupo", () => {
    const list = ids(user([ "stock_keeper" ]));
    expect(mine(user([ "stock_keeper" ]))).toEqual([ "external-exits", "opening-import", "bnafar-status", "bnafar-pending" ]);
    expect(list.indexOf("external-exits")).toBe(list.indexOf("pharmacy-adjustments") + 1);
    expect(list.indexOf("opening-import")).toBe(list.indexOf("pharmacy-adjustments") + 2);
    expect(list.indexOf("bnafar-pending")).toBe(list.length - 1);
  });
  it("com o administrador, os quatro, antes de Locais e configurações", () => {
    const list = ids(user([ "municipal_admin" ]));
    expect(mine(user([ "municipal_admin" ]))).toEqual(NEW);
    expect(list.indexOf("bnafar-pending")).toBe(list.indexOf("pharmacy-admin") - 1);
  });
  it("Q32: o farmacêutico lê status e pendências, sem saída externa nem saldo inicial", () => {
    expect(mine(user([ "pharmacist" ]))).toEqual([ "bnafar-status", "bnafar-pending" ]);
  });
  it("Q32: o profissional com a vacinação ligada vê status e pendências (pode ser chefe de sala)", () => {
    expect(mine(user([ "health_professional" ], [ "vaccination", "bnafar" ]))).toEqual([ "bnafar-status", "bnafar-pending" ]);
    expect(mine(user([ "health_professional" ], [ "pharmacy", "bnafar" ]))).toEqual([]);
  });
  it("Q22/Q19/Q40: sem bnafar abrem saída externa, saldo inicial e pendências; o status não", () => {
    expect(mine(user([ "stock_keeper" ], [ "pharmacy" ]))).toEqual([ "external-exits", "opening-import", "bnafar-pending" ]);
    expect(mine(user([ "municipal_admin" ], [ "pharmacy" ]))).toEqual([ "external-exits", "opening-import", "bnafar-pending" ]);
  });
  it("só com vaccination e almoxarife, os itens de estoque aparecem", () => {
    expect(mine(user([ "stock_keeper" ], [ "vaccination" ]))).toEqual([ "external-exits", "opening-import", "bnafar-pending" ]);
  });
  it("sem estoque nenhum, só o status (Q40: o bnafar ligado basta); o operador nunca", () => {
    expect(mine(user([ "stock_keeper", "municipal_admin" ], [ "bnafar", "clinical_record" ]))).toEqual([ "bnafar-status" ]);
    expect(mine(user([ "stock_keeper", "municipal_admin" ], [ "clinical_record" ]))).toEqual([]);
    expect(mine(user([ "stock_keeper", "municipal_admin" ], [ "pharmacy", "bnafar" ], true))).toEqual([]);
  });
  it("o rótulo difere do da Vacinação", () => {
    const u = user([ "municipal_admin", "stock_keeper", "health_professional" ], [ "pharmacy", "vaccination", "bnafar" ]);
    const all = navGroupsFor(u).flatMap((g) => g.items);
    expect(all.find((i) => i.id === "bnafar-pending")?.label).toBe("Pendências do envio à BNAFAR");
    expect(all.find((i) => i.id === "vaccination-pending")?.label).toBe("Pendências do envio");
    expect(all.find((i) => i.id === "bnafar-status")?.label).toBe("Envio à BNAFAR");
    expect(all.find((i) => i.id === "external-exits")?.label).toBe("Saída externa");
    expect(all.find((i) => i.id === "opening-import")?.label).toBe("Saldo inicial");
  });
  it("o CATALOG tem as quatro descrições", () => {
    expect(CATALOG.screens["bnafar-status"].description).toBe("Situação de cada dia, recusas e prazo de correção");
    expect(CATALOG.screens["bnafar-pending"].description).toBe("Lotes incompletos, locais sem CNES, produtos sem código e saldos com fração");
    expect(CATALOG.screens["external-exits"].description).toBe("Devolução, remanejamento, doação e empréstimo para fora da rede");
    expect(CATALOG.screens["opening-import"].description).toBe("Planilha do saldo inicial, conferência e aplicação");
  });
});
