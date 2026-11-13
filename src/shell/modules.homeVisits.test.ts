import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import type { ModuleId } from "./modules";
import { CATALOG } from "./catalog";
import { hvUser } from "../test/homeVisitFixtures";

const ids = (u: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(u).flatMap((g) => g.items.map((i) => i.id)) as string[];
const GROUP = "Visita e atividade coletiva";
const FIVE = [ "home-visit-day", "who-to-visit", "home-visits-team", "micro-area-assignments", "collective-activities" ];

describe("grupo Visita e atividade coletiva (módulo 24b)", () => {
  it("o grupo vem depois de Cadastro territorial", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf(GROUP)).toBe(labels.indexOf("Cadastro territorial") + 1);
  });
  it("profissional com os dois interruptores vê tudo, menos a lista da cidade", () => {
    expect(ids(hvUser())).toEqual(expect.arrayContaining([ ...FIVE, "field-devices" ]));
    expect(ids(hvUser())).not.toContain("field-devices-admin");
  });
  it("sem home_visits só a atividade coletiva e os aparelhos; sem collective_activities, só a visita", () => {
    const onlyCa = ids(hvUser(undefined, [ "clinical_record", "collective_activities" ]));
    expect(onlyCa).toContain("collective-activities");
    expect(onlyCa).not.toContain("home-visit-day");
    const onlyHv = ids(hvUser(undefined, [ "clinical_record", "territory_registry", "home_visits" ]));
    expect(onlyHv).toContain("home-visit-day");
    expect(onlyHv).not.toContain("collective-activities");
  });
  it("home_visits sem territory_registry não abre a visita", () => {
    expect(ids(hvUser(undefined, [ "clinical_record", "home_visits" ]))).not.toContain("home-visit-day");
  });
  it("Q75: com home_visits desligado os aparelhos ficam (profissional e admin) e as outras cinco somem", () => {
    const off = [ "clinical_record" ];
    const prof = ids(hvUser(undefined, off));
    expect(prof).toContain("field-devices");
    for (const id of FIVE) expect(prof, id).not.toContain(id);
    const admin = ids(hvUser([ "municipal_admin" ], off));
    expect(admin).toContain("field-devices-admin");
    expect(admin).not.toContain("home-visit-day");
    expect(ids(hvUser(undefined, []))).toContain("field-devices");
  });
  it("admin vê só a lista da cidade; operador nada", () => {
    expect(ids(hvUser([ "municipal_admin" ]))).toContain("field-devices-admin");
    expect(ids(hvUser([ "municipal_admin" ]))).not.toContain("home-visit-day");
    expect(ids(hvUser([ "municipal_admin" ]))).not.toContain("field-devices");
    const op = { ...hvUser(), operator: true };
    expect(ids(op)).not.toContain("home-visit-day");
    expect(ids(op)).not.toContain("field-devices");
    expect(ids({ ...hvUser([ "municipal_admin" ]), operator: true })).not.toContain("field-devices-admin");
  });
  it("toda tela nova tem ícone e descrição no catálogo", () => {
    for (const id of [ ...FIVE, "field-devices", "field-devices-admin" ]) {
      expect(CATALOG.screens[id as ModuleId], id).toBeTruthy();
      expect(CATALOG.screens[id as ModuleId].description, id).toBeTruthy();
    }
    expect(CATALOG.groups[GROUP]).toBeTruthy();
  });
});
