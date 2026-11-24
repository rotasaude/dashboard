import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";
import { ZOO_FEATURES, zooUser } from "../test/zoonosesFixtures";

const ids = (u: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(u).find((g) => g.label === "Zoonoses")?.items.map((i) => i.id) ?? [];
const TEAM = [ "zoo-animals", "zoo-campaigns", "zoo-demands", "zoo-observations", "zoo-leish", "zoo-shelter", "zoo-reports" ];

describe("menu Zoonoses", () => {
  it("equipe vê tudo menos parâmetros; coordenação, tudo; admin, campanhas e relatórios", () => {
    expect(ids(zooUser([ "zoonoses_team" ], [ ...ZOO_FEATURES, "ombudsman" ]))).toEqual(TEAM);
    expect(ids(zooUser([ "endemic_coordinator" ], [ ...ZOO_FEATURES, "ombudsman" ]))).toEqual([ ...TEAM, "zoo-settings" ]);
    expect(ids(zooUser([ "municipal_admin" ]))).toEqual([ "zoo-campaigns", "zoo-reports" ]);
  });
  it("Q35: sem a ouvidoria, sem Demandas", () => {
    expect(ids(zooUser())).toEqual(TEAM.filter((i) => i !== "zoo-demands"));
  });
  it("sem zoonoses, sem cadastro territorial ou só health_professional: o grupo some", () => {
    expect(ids(zooUser(undefined, [ "clinical_record", "territory_registry" ]))).toEqual([]);
    expect(ids(zooUser(undefined, [ "clinical_record", "zoonoses" ]))).toEqual([]);
    expect(ids(zooUser([ "health_professional" ]))).toEqual([]);
  });
  it("Zoonoses vem logo depois de Endemias, com ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Zoonoses")).toBe(labels.indexOf("Endemias") + 1);
    expect(CATALOG.groups.Zoonoses.description).toBe("Animais com tutor, vacinação antirrábica, demandas, observação do agressor, leishmaniose canina e canil");
  });
});
