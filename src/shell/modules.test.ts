import { describe, expect, it } from "vitest";
import { NAV_GROUPS, labelFor, navGroupsFor } from "./modules";

describe("modules", () => {
  it("Segurança fica no grupo Conta", () => {
    const conta = NAV_GROUPS.find((g) => g.label === "Conta");
    expect(conta?.items.map((i) => i.id)).toEqual([ "security" ]);
    expect(labelFor("security")).toBe("Segurança");
  });

  describe("navGroupsFor", () => {
    it("usuário comum vê o grupo Conta", () => {
      const groups = navGroupsFor({ operator: false });
      expect(groups.some((g) => g.label === "Conta")).toBe(true);
    });

    it("operador não vê o grupo Conta (segurança da conta é de usuário de cidade)", () => {
      const groups = navGroupsFor({ operator: true });
      expect(groups.some((g) => g.label === "Conta")).toBe(false);
      expect(groups.length).toBe(NAV_GROUPS.length - 1);
    });

    it("sem sessão, mostra tudo (a tela de login não tem grupos sensíveis)", () => {
      expect(navGroupsFor(null).length).toBe(NAV_GROUPS.length);
    });
  });
});
