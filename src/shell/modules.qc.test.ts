// src/shell/modules.qc.test.ts
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor, withQcBlockCount } from "./modules";

const QC_IDS = [ "lab-qc-runs", "lab-qc-chart", "lab-qc-blocks", "lab-qc-setup", "lab-eqa", "lab-inventory", "lab-traceability", "lab-instruments" ];
const BOTH = { features: [ "exam_tracking", "municipal_lab", "lab_quality_control", "lab_inventory" ] };
const userWith = (roles: string[], extra: object = BOTH) => ({ operator: false, memberships: roles.map((role) => ({ role })), ...extra });
const qcIds = (user: Parameters<typeof navGroupsFor>[0]) =>
  navGroupsFor(user).flatMap((g) => g.items.map((i) => i.id)).filter((id) => QC_IDS.includes(id));

describe("telas do 21c no grupo Laboratório", () => {
  it("ficam depois da liberação e antes do admin do laboratório", () => {
    const ids = NAV_GROUPS.find((g) => g.label === "Laboratório")!.items.map((i) => i.id);
    expect(ids.slice(ids.indexOf("lab-release") + 1, ids.indexOf("lab-admin"))).toEqual(QC_IDS);
  });

  it("sem os interruptores do 21c ninguém vê; sem municipal_lab também não", () => {
    for (const role of [ "municipal_admin", "lab_staff", "lab_releaser" ]) {
      expect(qcIds(userWith([ role ], { features: [ "exam_tracking", "municipal_lab" ] }))).toEqual([]);
      expect(qcIds(userWith([ role ], { features: [ "exam_tracking", "lab_quality_control", "lab_inventory" ] }))).toEqual([]);
    }
  });

  it("cada papel vê o seu", () => {
    expect(qcIds(userWith([ "lab_staff" ]))).toEqual([ "lab-qc-runs", "lab-qc-blocks", "lab-inventory", "lab-traceability", "lab-instruments" ]);
    expect(qcIds(userWith([ "lab_releaser" ]))).toEqual(QC_IDS);
    expect(qcIds(userWith([ "municipal_admin" ]))).toEqual([ "lab-qc-chart", "lab-qc-setup", "lab-eqa", "lab-inventory", "lab-traceability", "lab-instruments" ]);
    expect(qcIds(userWith([ "health_professional" ]))).toEqual([]);
    expect(qcIds({ operator: true, memberships: [], ...BOTH })).toEqual([]);
  });

  it("interruptores independentes; aparelhos com qualquer um dos dois", () => {
    expect(qcIds(userWith([ "lab_staff" ], { features: [ "exam_tracking", "municipal_lab", "lab_quality_control" ] })))
      .toEqual([ "lab-qc-runs", "lab-qc-blocks", "lab-instruments" ]);
    expect(qcIds(userWith([ "lab_staff" ], { features: [ "exam_tracking", "municipal_lab", "lab_inventory" ] })))
      .toEqual([ "lab-inventory", "lab-traceability", "lab-instruments" ]);
  });

  it("contador de bloqueios ativos no rótulo; zero não muda nada", () => {
    const item = (n: number) => withQcBlockCount(NAV_GROUPS, n).flatMap((g) => g.items).find((i) => i.id === "lab-qc-blocks");
    expect(item(0)?.label).toBe("Bloqueios e revisões do CIQ");
    expect(item(1)?.label).toBe("Bloqueios e revisões do CIQ (1 ativo)");
    expect(item(3)?.label).toBe("Bloqueios e revisões do CIQ (3 ativos)");
  });
});
