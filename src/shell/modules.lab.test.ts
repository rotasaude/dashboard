import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor, withLabCriticalCount } from "./modules";

const ON = { features: [ "exam_tracking", "municipal_lab" ] };
const userWith = (roles: string[], extra: object = ON) => ({ operator: false, memberships: roles.map((role) => ({ role })), ...extra });
const LAB_IDS = [ "lab-requisitions", "lab-collection", "lab-shipments", "lab-reception", "lab-worklist", "lab-entry", "lab-release", "lab-admin", "lab-reports" ];
const labIds = (user: Parameters<typeof navGroupsFor>[0]) =>
  navGroupsFor(user).flatMap((g) => g.items.map((i) => i.id)).filter((id) => LAB_IDS.includes(id));

describe("grupo Laboratório (módulo 21b)", () => {
  it("fica logo depois de Exames, com as nove telas", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Laboratório")).toBe(labels.indexOf("Exames") + 1);
    expect(NAV_GROUPS.find((g) => g.label === "Laboratório")?.items.map((i) => i.id)).toEqual(LAB_IDS);
  });

  it("sem municipal_lab, nenhuma tela do laboratório para ninguém", () => {
    for (const role of [ "municipal_admin", "health_professional", "lab_staff", "lab_releaser" ]) {
      expect(labIds(userWith([ role ], { features: [ "exam_tracking" ] }))).toEqual([]);
    }
    expect(navGroupsFor(userWith([ "lab_staff" ], {})).some((g) => g.label === "Laboratório")).toBe(false);
  });

  // Prova no navegador: o patologista (só lab_releaser, CRM) libera com ICP e a tela
  // manda assinar em Pendentes — que ficava escondido com o grupo Atendimento.
  it("liberador só do laboratório, com assinatura digital: vê Pendentes de assinatura e nada mais do Atendimento", () => {
    const groups = navGroupsFor(userWith([ "lab_releaser" ], { features: [ "exam_tracking", "municipal_lab", "digital_signature" ] }));
    expect(groups.find((g) => g.label === "Atendimento")?.items.map((i) => i.id)).toEqual([ "signature-pending" ]);
    const noSignature = navGroupsFor(userWith([ "lab_releaser" ]));
    expect(noSignature.some((g) => g.label === "Atendimento")).toBe(false);
  });

  it("cada papel vê o seu", () => {
    expect(labIds(userWith([ "lab_staff" ]))).toEqual([
      "lab-requisitions", "lab-collection", "lab-shipments", "lab-reception", "lab-worklist", "lab-entry"
    ]);
    expect(labIds(userWith([ "lab_releaser" ]))).toEqual([ "lab-worklist", "lab-release", "lab-reports" ]);
    expect(labIds(userWith([ "health_professional" ]))).toEqual([ "lab-requisitions", "lab-collection", "lab-shipments" ]);
    expect(labIds(userWith([ "municipal_admin" ]))).toEqual([ "lab-admin", "lab-reports" ]);
    expect(labIds(userWith([ "citizen_verifier" ]))).toEqual([]);
    expect(labIds({ operator: true, memberships: [], ...ON })).toEqual([]);
  });

  it("o prestador do 21a continua só com o portal e a Segurança", () => {
    expect(navGroupsFor(userWith([ "exam_provider" ])).flatMap((g) => g.items.map((i) => i.id))).toEqual([ "exam-provider", "security" ]);
  });

  it("contador de críticos sem aviso no rótulo da liberação", () => {
    const item = (n: number) => withLabCriticalCount(NAV_GROUPS, n).flatMap((g) => g.items).find((i) => i.id === "lab-release");
    expect(item(0)?.label).toBe("Liberação de laudos");
    expect(item(2)?.label).toBe("Liberação de laudos (2 sem aviso)");
  });
});
