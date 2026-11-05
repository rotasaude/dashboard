import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";
import { psyUser } from "../test/psychosocialFixtures";

const ids = (u: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(u).find((g) => g.label === "CAPS")?.items.map((i) => i.id) ?? [];
const TEAM = [ "caps-reception", "caps-today", "caps-enrollments", "caps-groups", "caps-beds", "caps-matrix", "caps-raas" ];

describe("menu do CAPS (módulo 31)", () => {
  it("equipe vê o trabalho do CAPS; coordenação vê também o painel", () => {
    expect(ids(psyUser([ "psychosocial_staff" ]))).toEqual(TEAM);
    expect(ids(psyUser([ "psychosocial_lead" ]))).toEqual([ ...TEAM, "caps-panel" ]);
  });
  it("faturista só a RAAS; analista só o painel; admin painel e cadastro; profissional da UBS nada", () => {
    expect(ids(psyUser([ "billing_clerk" ]))).toEqual([ "caps-raas" ]);
    expect(ids(psyUser([ "analyst" ]))).toEqual([ "caps-panel" ]);
    expect(ids(psyUser([ "municipal_admin" ]))).toEqual([ "caps-panel", "caps-settings" ]);
    expect(ids(psyUser([ "health_professional" ]))).toEqual([]);
  });
  it("sem psychosocial_care ou sem clinical_record, o grupo some", () => {
    expect(ids(psyUser([ "psychosocial_lead" ], [ "clinical_record" ]))).toEqual([]);
    expect(ids(psyUser([ "psychosocial_lead" ], [ "psychosocial_care" ]))).toEqual([]);
    expect(ids(psyUser([ "municipal_admin", "billing_clerk", "analyst" ], [ "clinical_record" ]))).toEqual([]);
  });
  it("a equipe do CAPS assina e pede o estoque do SNCR (R10): Pendentes, Assinatura digital e SNCR, sem o resto do Atendimento", () => {
    const groupIds = (u: Parameters<typeof navGroupsFor>[0], label: string) => navGroupsFor(u).find((g) => g.label === label)?.items.map((i) => i.id) ?? [];
    const signer = psyUser([ "psychosocial_staff" ], [ "psychosocial_care", "clinical_record", "digital_signature", "clinical_documents", "controlled_prescriptions" ]);
    expect(groupIds(signer, "Atendimento")).toEqual([ "signature-pending" ]);
    expect(groupIds(signer, "Conta")).toEqual(expect.arrayContaining([ "signature", "sncr" ]));
    const plain = psyUser([ "psychosocial_staff" ]);
    expect(groupIds(plain, "Atendimento")).toEqual([]);
    expect(groupIds(plain, "Conta")).not.toContain("signature");
    expect(groupIds(plain, "Conta")).not.toContain("sncr");
  });
  it("vem logo depois do TFD e tem ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("CAPS")).toBe(labels.indexOf("TFD") + 1);
    expect(CATALOG.groups.CAPS.description).toBe("Atenção psicossocial: acolhimento, PTS, grupos, leitos e RAAS");
    expect(CATALOG.screens["caps-raas"].description).toBe("Pendências, fechamento, remessa e fichas espelho");
  });
});
