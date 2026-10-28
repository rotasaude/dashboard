import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor, withSurveillanceCount } from "./modules";
import { CATALOG } from "./catalog";

const user = (roles: string[], features: string[] | undefined = [ "surveillance" ], operator = false) => ({ operator, memberships: roles.map((role) => ({ role })), features });
const itemsOf = (groups: ReturnType<typeof navGroupsFor>) => groups.find((g) => g.label === "Vigilância")?.items.map((i) => i.id) ?? [];

describe("grupo Vigilância (módulo 25)", () => {
  it("a vigilância vê tudo; o analyst só o painel; sem exigir o prontuário", () => {
    expect(itemsOf(navGroupsFor(user([ "surveillance" ])))).toEqual([
      "surveillance-queue", "surveillance-negatives", "surveillance-reports", "surveillance-panel", "surveillance-diseases" ]);
    expect(itemsOf(navGroupsFor(user([ "analyst" ])))).toEqual([ "surveillance-panel" ]);
  });
  it("some sem o interruptor, para o profissional, o admin e o operador", () => {
    expect(itemsOf(navGroupsFor(user([ "surveillance" ], [])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([ "health_professional", "municipal_admin" ])))).toEqual([]);
    expect(itemsOf(navGroupsFor(user([], undefined, true)))).toEqual([]);
  });
  it("vem depois do Cadastro territorial, com ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Vigilância")).toBe(labels.indexOf("Cadastro territorial") + 1);
    expect(CATALOG.groups["Vigilância"].description).toBe("Notificação compulsória, prazos, negativa semanal e painel");
    expect(CATALOG.screens["surveillance-queue"].description).toBe("Notificações com prazo, imediatas e vencidas primeiro");
  });
  it("as imediatas abertas no rótulo da fila", () => {
    const groups = navGroupsFor(user([ "surveillance" ]));
    expect(withSurveillanceCount(groups, 0)).toBe(groups);
    const label = (n: number) => withSurveillanceCount(groups, n).find((g) => g.label === "Vigilância")!.items[0].label;
    expect(label(1)).toBe("Fila da vigilância (1 imediata)");
    expect(label(3)).toBe("Fila da vigilância (3 imediatas)");
  });
});
