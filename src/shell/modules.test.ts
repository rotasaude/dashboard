import { describe, expect, it } from "vitest";
import { NAV_GROUPS, labelFor, navGroupsFor } from "./modules";

describe("modules", () => {
  it("Segurança fica no grupo Conta", () => {
    const conta = NAV_GROUPS.find((g) => g.label === "Conta");
    expect(conta?.items.map((i) => i.id)).toContain("security");
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
      expect(groups.some((g) => g.label === "Equipe")).toBe(false);
      expect(groups.some((g) => g.label === "Atendimento")).toBe(false);
      expect(groups.some((g) => g.label === "Cidade")).toBe(false);
      expect(groups.length).toBe(NAV_GROUPS.length - 4);
    });

    it("sem sessão, esconde Equipe, Atendimento e Cidade", () => {
      const groups = navGroupsFor(null);
      expect(groups.some((g) => g.label === "Conta")).toBe(true);
      expect(groups.some((g) => g.label === "Equipe")).toBe(false);
      expect(groups.some((g) => g.label === "Atendimento")).toBe(false);
      expect(groups.some((g) => g.label === "Cidade")).toBe(false);
      expect(groups.length).toBe(NAV_GROUPS.length - 3);
    });

    it("Equipe só aparece para municipal_admin", () => {
      const admin = { operator: false, memberships: [ { role: "municipal_admin" } ] };
      const publisher = { operator: false, memberships: [ { role: "protocol_publisher" } ] };

      expect(navGroupsFor(admin).some((g) => g.label === "Equipe")).toBe(true);
      expect(navGroupsFor(publisher).some((g) => g.label === "Equipe")).toBe(false);
      expect(navGroupsFor(null).some((g) => g.label === "Equipe")).toBe(false);
    });

    it("Atendimento aparece para citizen_verifier e municipal_admin, some para viewer", () => {
      const verifier = { operator: false, memberships: [ { role: "citizen_verifier" } ] };
      const admin = { operator: false, memberships: [ { role: "municipal_admin" } ] };
      const viewer = { operator: false, memberships: [ { role: "viewer" } ] };

      expect(navGroupsFor(verifier).some((g) => g.label === "Atendimento")).toBe(true);
      expect(navGroupsFor(admin).some((g) => g.label === "Atendimento")).toBe(true);
      expect(navGroupsFor(viewer).some((g) => g.label === "Atendimento")).toBe(false);
    });

    it("Atendimento também aparece para health_professional", () => {
      const professional = { operator: false, memberships: [ { role: "health_professional" } ] };
      expect(navGroupsFor(professional).some((g) => g.label === "Atendimento")).toBe(true);
    });
  });

  describe("módulo 10 na navegação", () => {
    const user = (roles: string[], operator = false) => ({ operator, memberships: roles.map((role) => ({ role })) });
    const ids = (u: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(u).flatMap((g) => g.items.map((i) => i.id));

    it("Profissionais só para municipal_admin", () => {
      expect(ids(user([ "municipal_admin" ]))).toContain("professionals");
      expect(ids(user([ "health_professional" ]))).not.toContain("professionals");
    });

    it("Meu perfil só para health_professional que não é operador", () => {
      expect(ids(user([ "health_professional" ]))).toContain("my-profile");
      expect(ids(user([ "municipal_admin" ]))).not.toContain("my-profile");
      expect(ids(user([], true))).not.toContain("my-profile");
    });
  });

  describe("módulo 11 na navegação", () => {
    const user = (roles: string[]) => ({ operator: false, memberships: roles.map((role) => ({ role })) });
    const ids = (u: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(u).flatMap((g) => g.items.map((i) => i.id));

    it("Território só para municipal_admin", () => {
      expect(ids(user([ "municipal_admin" ]))).toContain("territory");
      for (const role of [ "viewer", "citizen_verifier", "health_professional", "protocol_publisher" ]) {
        expect(ids(user([ role ]))).not.toContain("territory");
      }
      expect(labelFor("territory")).toBe("Território");
    });
  });
});
