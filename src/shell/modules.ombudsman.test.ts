import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";
import { ombudsmanUser } from "../test/ombudsmanFixtures";

const ids = (u: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(u).find((g) => g.label === "Ouvidoria")?.items.map((i) => i.id) ?? [];
const STAFF = [ "ombudsman-manifestations", "ombudsman-new", "ombudsman-panel" ];

describe("menu da ouvidoria (módulo 33)", () => {
  it("técnico: caixa, nova e painel; ouvidor: também relatório e configuração", () => {
    expect(ids(ombudsmanUser([ "ombudsman_staff" ]))).toEqual(STAFF);
    expect(ids(ombudsmanUser([ "ombudsman" ]))).toEqual([ ...STAFF, "ombudsman-annual-report", "ombudsman-settings" ]);
  });
  it("respondente só as respostas; respondente e técnico, as duas coisas", () => {
    expect(ids(ombudsmanUser([ "ombudsman_responder" ]))).toEqual([ "ombudsman-replies" ]);
    expect(ids(ombudsmanUser([ "ombudsman_responder", "ombudsman_staff" ]))).toEqual([ "ombudsman-manifestations", "ombudsman-new", "ombudsman-replies", "ombudsman-panel" ]);
  });
  it("admin só os setores; sem o interruptor some tudo, menos os setores do admin (Q12)", () => {
    expect(ids(ombudsmanUser([ "municipal_admin" ]))).toEqual([ "departments" ]);
    expect(ids(ombudsmanUser([ "ombudsman", "municipal_admin" ], []))).toEqual([ "departments" ]);
    expect(ids(ombudsmanUser([ "ombudsman" ], []))).toEqual([]);
    expect(navGroupsFor(ombudsmanUser([ "health_professional" ])).some((g) => g.label === "Ouvidoria")).toBe(false);
  });
  it("vem logo depois de Urgência e tem ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Ouvidoria")).toBe(labels.indexOf("Urgência") + 1);
    expect(CATALOG.groups["Ouvidoria"].description).toBe("Manifestações do cidadão, encaminhamentos, prazos e relatório anual");
    expect(CATALOG.screens["ombudsman-manifestations"].description).toBe("Manifestações por estado e cor de prazo");
    expect(CATALOG.screens["ombudsman-replies"].description).toBe("Encaminhamentos do seu setor ou unidade");
    expect(CATALOG.screens["departments"].description).toBe("Setores da secretaria que recebem encaminhamentos");
  });
});
