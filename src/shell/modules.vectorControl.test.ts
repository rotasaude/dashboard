// Módulo 35a (F-35.1): o grupo "Endemias", "Ovitrampas de campo" na visita e "Faltas de insumo de campo" na Farmácia.
// Os portões seguem o api mergeado (apps/api ab32775c): relatórios pelo ReportsController#readable?, faltas pelo
// StockShortfallsController#readable_scope (sem conferir `pharmacy`, Q21).
import { IconBug } from "@tabler/icons-react";
import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";
import { VC_FEATURES, vcUser } from "../test/vectorControlFixtures";

const ids = (u: Parameters<typeof navGroupsFor>[0], label = "Endemias") => navGroupsFor(u).find((g) => g.label === label)?.items.map((i) => i.id) ?? [];
const ALL = [ "vector-blocks", "vector-cycles", "vector-ovitraps", "vector-samples", "vector-liraa", "vector-transmission", "vector-tasks", "vector-reports", "vector-settings" ];
const VC_SCREENS = [ ...ALL, "field-ovitraps", "vector-stock-shortfalls" ] as const;

describe("grupo Endemias (módulo 35a)", () => {
  it("coordenação vê o grupo inteiro; laboratório, ovitrampas, amostras e relatórios; admin, só relatórios", () => {
    expect(ids(vcUser([ "endemic_coordinator" ]))).toEqual(ALL);
    expect(ids(vcUser([ "vector_lab" ]))).toEqual([ "vector-ovitraps", "vector-samples", "vector-reports" ]);
    expect(ids(vcUser([ "municipal_admin" ]))).toEqual([ "vector-reports" ]);
    expect(ids(vcUser([ "health_professional", "stock_keeper", "analyst" ]))).toEqual([]);
  });

  it("sem vector_control ou sem a visita domiciliar o grupo some; operador nunca", () => {
    expect(ids(vcUser([ "endemic_coordinator" ], [ "clinical_record", "territory_registry", "home_visits" ]))).toEqual([]);
    expect(ids(vcUser([ "endemic_coordinator" ], [ "clinical_record", "territory_registry", "vector_control" ]))).toEqual([]);
    expect(ids({ ...vcUser([ "endemic_coordinator", "vector_lab", "municipal_admin" ]), operator: true })).toEqual([]);
    expect(navGroupsFor(null).some((g) => g.label === "Endemias")).toBe(false);
  });

  it("profissional: Ovitrampas de campo na visita; almoxarife e coordenação: faltas de insumo na Farmácia", () => {
    expect(ids(vcUser([ "health_professional" ]), "Visita e atividade coletiva")).toContain("field-ovitraps");
    expect(ids(vcUser([ "health_professional" ]), "Visita e atividade coletiva").at(-1)).toBe("field-ovitraps");
    expect(ids(vcUser([ "health_professional" ], [ "clinical_record", "territory_registry", "home_visits" ]), "Visita e atividade coletiva"))
      .not.toContain("field-ovitraps");
    expect(ids(vcUser([ "endemic_coordinator" ]), "Visita e atividade coletiva")).not.toContain("field-ovitraps");
    expect(ids(vcUser([ "stock_keeper" ], [ ...VC_FEATURES, "pharmacy" ]), "Farmácia")).toContain("vector-stock-shortfalls");
    expect(ids(vcUser([ "endemic_coordinator" ]), "Farmácia")).toEqual([ "vector-stock-shortfalls" ]);
    expect(ids(vcUser([ "pharmacist" ], [ ...VC_FEATURES, "pharmacy" ]), "Farmácia")).not.toContain("vector-stock-shortfalls");
  });

  it("Q21: o almoxarife vê as faltas de insumo com vector_control e SEM pharmacy; sem vector_control, nunca", () => {
    // Com as telas de estoque abertas a vector_control (fix da Task 4, I1), a Farmácia traz também o razão do 27a.
    expect(ids(vcUser([ "stock_keeper" ]), "Farmácia")).toEqual([
      "pharmacy-transfers", "pharmacy-entries", "pharmacy-stock", "pharmacy-adjustments", "vector-stock-shortfalls" ]);
    expect(ids(vcUser([ "stock_keeper" ], [ "clinical_record", "territory_registry", "home_visits", "pharmacy" ]), "Farmácia"))
      .not.toContain("vector-stock-shortfalls");
    const farmacia = ids(vcUser([ "stock_keeper" ], [ ...VC_FEATURES, "pharmacy" ]), "Farmácia");
    expect(farmacia.indexOf("vector-stock-shortfalls")).toBe(farmacia.indexOf("pharmacy-urgency-shortfalls") + 1);
  });

  it("Endemias vem logo depois de Vigilância, com ícone e descrição", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Endemias")).toBe(labels.indexOf("Vigilância") + 1);
    expect(CATALOG.groups.Endemias.description).toBe("Quarteirões, ciclos, ovitrampas, LIRAa, bloqueio, amostras e relatórios do controle vetorial");
    expect(CATALOG.groups.Endemias.icon).toBe(IconBug);
    expect(NAV_GROUPS.find((g) => g.label === "Endemias")?.items.map((i) => i.id)).toEqual(ALL);
  });

  it("as onze telas têm rótulo, ícone do menu e descrição no catálogo", () => {
    const items = NAV_GROUPS.flatMap((g) => g.items);
    const label = (id: string) => items.find((i) => i.id === id)?.label;
    expect(VC_SCREENS.map(label)).toEqual([
      "Quarteirões e imóveis", "Ciclos e cadência", "Ovitrampas", "Amostras de larvas", "LIRAa", "Bloqueio de transmissão",
      "Tarefas de endemias", "Relatórios de endemias", "Produtos e parâmetros", "Ovitrampas de campo", "Faltas de insumo de campo"
    ]);
    expect(VC_SCREENS.map((id) => items.find((i) => i.id === id)?.icon)).toEqual([ "▦", "↻", "◎", "⚗", "⚄", "⛨", "☑", "▤", "⚙", "◎", "⚠" ]);
    for (const id of VC_SCREENS) {
      expect(CATALOG.screens[id]?.description, id).toBeTruthy();
      expect(CATALOG.screens[id]?.icon, id).toBeTruthy();
    }
  });
});
