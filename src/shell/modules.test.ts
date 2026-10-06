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
      expect(groups.some((g) => g.label === "Comunicação")).toBe(false);
      expect(groups.some((g) => g.label === "Análise")).toBe(false);
      expect(groups.some((g) => g.label === "e-SUS")).toBe(false);
      expect(groups.length).toBe(NAV_GROUPS.length - 7);
    });

    it("sem sessão, esconde Equipe, Atendimento e Cidade", () => {
      const groups = navGroupsFor(null);
      expect(groups.some((g) => g.label === "Conta")).toBe(true);
      expect(groups.some((g) => g.label === "Equipe")).toBe(false);
      expect(groups.some((g) => g.label === "Atendimento")).toBe(false);
      expect(groups.some((g) => g.label === "Cidade")).toBe(false);
      expect(groups.some((g) => g.label === "Comunicação")).toBe(false);
      expect(groups.some((g) => g.label === "Análise")).toBe(false);
      expect(groups.some((g) => g.label === "e-SUS")).toBe(false);
      expect(groups.length).toBe(NAV_GROUPS.length - 6);
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

  describe("módulo 17 na navegação", () => {
    const user = (roles: string[], operator = false) => ({ operator, memberships: roles.map((role) => ({ role })) });
    const atendimento = (u: Parameters<typeof navGroupsFor>[0]) =>
      navGroupsFor(u).find((g) => g.label === "Atendimento")?.items.map((i) => i.id) ?? [];

    it("Minha agenda só para health_professional, no grupo Atendimento", () => {
      expect(atendimento(user([ "health_professional" ]))).toEqual([ "attendance", "my-agenda" ]);
      expect(atendimento(user([ "municipal_admin" ]))).not.toContain("my-agenda");
      expect(atendimento(user([ "citizen_verifier" ]))).not.toContain("my-agenda");
      expect(navGroupsFor(null).flatMap((g) => g.items.map((i) => i.id))).not.toContain("my-agenda");
      expect(labelFor("my-agenda")).toBe("Minha agenda");
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
  describe("módulo 12 na navegação", () => {
    const user = (roles: string[]) => ({ operator: false, memberships: roles.map((role) => ({ role })) });
    const ids = (u: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(u).flatMap((g) => g.items.map((i) => i.id));

    it("Campanhas para campaign_manager e municipal_admin, e para ninguém mais", () => {
      expect(ids(user([ "campaign_manager" ]))).toContain("campaigns");
      expect(ids(user([ "municipal_admin" ]))).toContain("campaigns");
      for (const role of [ "viewer", "citizen_verifier", "health_professional", "protocol_reviewer", "protocol_publisher" ]) {
        expect(ids(user([ role ]))).not.toContain("campaigns");
      }
      expect(ids(null)).not.toContain("campaigns");
      expect(labelFor("campaigns")).toBe("Campanhas");
    });

    it("gestor de campanhas não ganha Equipe nem Território", () => {
      expect(ids(user([ "campaign_manager" ]))).not.toContain("team");
      expect(ids(user([ "campaign_manager" ]))).not.toContain("territory");
    });
  });

  describe("módulo 14 na navegação", () => {
    const user = (roles: string[], operator = false) => ({ operator, memberships: roles.map((role) => ({ role })) });
    const ids = (u: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(u).flatMap((g) => g.items.map((i) => i.id));

    it("Analytics para analyst e municipal_admin, e para ninguém mais", () => {
      expect(ids(user([ "analyst" ]))).toContain("analytics");
      expect(ids(user([ "municipal_admin" ]))).toContain("analytics");
      for (const role of [ "viewer", "citizen_verifier", "health_professional", "protocol_reviewer", "campaign_manager" ]) {
        expect(ids(user([ role ]))).not.toContain("analytics");
      }
      expect(ids(null)).not.toContain("analytics");
      expect(labelFor("analytics")).toBe("Analytics");
    });

    it("operador nunca vê Analytics, nem com papel na lista (D12)", () => {
      expect(ids(user([], true))).not.toContain("analytics");
      expect(ids(user([ "municipal_admin" ], true))).not.toContain("analytics");
    });

    it("analista não ganha Equipe, Território nem Campanhas", () => {
      expect(ids(user([ "analyst" ]))).not.toContain("team");
      expect(ids(user([ "analyst" ]))).not.toContain("territory");
      expect(ids(user([ "analyst" ]))).not.toContain("campaigns");
    });
  });

  describe("módulo 16 na navegação", () => {
    const user = (roles: string[], features?: unknown, operator = false) =>
      ({ operator, memberships: roles.map((role) => ({ role })), features });
    const ids = (u: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(u).flatMap((g) => g.items.map((i) => i.id));

    it("Integrações e CNES só para municipal_admin", () => {
      expect(ids(user([ "municipal_admin" ]))).toEqual(expect.arrayContaining([ "integrations", "cnes" ]));
      for (const role of [ "analyst", "viewer", "citizen_verifier", "health_professional", "campaign_manager" ]) {
        expect(ids(user([ role ], [ "ledi_export" ]))).not.toContain("integrations");
        expect(ids(user([ role ], [ "ledi_export" ]))).not.toContain("cnes");
      }
      expect(labelFor("integrations")).toBe("Integrações");
      expect(labelFor("cnes")).toBe("CNES");
    });

    it("Produção e-SUS para municipal_admin e analyst, só com ledi_export ligado", () => {
      expect(ids(user([ "municipal_admin" ], [ "ledi_export" ]))).toContain("production");
      expect(ids(user([ "analyst" ], [ "ledi_export" ]))).toContain("production");
      expect(ids(user([ "municipal_admin" ]))).not.toContain("production");
      expect(ids(user([ "municipal_admin" ], [ "cadsus_lookup" ]))).not.toContain("production");
      expect(ids(user([ "viewer" ], [ "ledi_export" ]))).not.toContain("production");
      expect(labelFor("production")).toBe("Produção e-SUS");
    });

    it("grupo e-SUS some quando não sobra item", () => {
      expect(navGroupsFor(user([ "analyst" ])).some((g) => g.label === "e-SUS")).toBe(false);
      expect(navGroupsFor(user([ "analyst" ], [ "ledi_export" ])).find((g) => g.label === "e-SUS")?.items.map((i) => i.id))
        .toEqual([ "production" ]);
    });

    it("operador nunca vê e-SUS, nem com papel e interruptor", () => {
      expect(ids(user([ "municipal_admin" ], [ "ledi_export" ], true))).not.toContain("integrations");
      expect(ids(user([ "municipal_admin" ], [ "ledi_export" ], true))).not.toContain("production");
    });

    it("features fora de formato não quebra o menu", () => {
      expect(ids(user([ "municipal_admin" ], "ledi_export"))).not.toContain("production");
      expect(ids(user([ "municipal_admin" ], null))).toContain("integrations");
    });
  });
});
