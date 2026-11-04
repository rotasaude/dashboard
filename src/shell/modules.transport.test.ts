import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";
import { trUser } from "../test/transportFixtures";

const ids = (u: Parameters<typeof navGroupsFor>[0], group: string) => navGroupsFor(u).find((g) => g.label === group)?.items.map((i) => i.id) ?? [];

describe("menu do transporte e do TFD (módulo 30)", () => {
  it("central vê viagens, séries, pendências, frota e painel; não vê o motorista nem o TFD", () => {
    expect(ids(trUser([ "transport_dispatcher" ]), "Transporte")).toEqual([ "transport-trips", "transport-series", "transport-pending", "transport-fleet", "transport-panel" ]);
    expect(ids(trUser([ "transport_dispatcher" ]), "TFD")).toEqual([]);
  });
  it("comissão vê a fila e o painel; médico vê os próprios pedidos; admin vê regras e painel", () => {
    expect(ids(trUser([ "tfd_committee" ]), "TFD")).toEqual([ "tfd-queue" ]);
    expect(ids(trUser([ "tfd_committee" ]), "Transporte")).toEqual([ "transport-panel" ]);
    expect(ids(trUser([ "health_professional" ]), "TFD")).toEqual([ "tfd-my-cases" ]);
    expect(ids(trUser([ "municipal_admin" ]), "Transporte")).toEqual([ "transport-panel", "transport-settings" ]);
  });
  it("sem tfd: grupo TFD some; sem sanitary_transport: os dois somem", () => {
    expect(ids(trUser([ "tfd_committee" ], [ "sanitary_transport", "clinical_record" ]), "TFD")).toEqual([]);
    const off = trUser([ "transport_dispatcher", "tfd_committee" ], [ "tfd", "clinical_record" ]);
    expect(navGroupsFor(off).some((g) => g.label === "Transporte" || g.label === "TFD")).toBe(false);
  });
  it("sem clinical_record: grupo TFD some, Transporte fica", () => {
    expect(ids(trUser([ "tfd_committee" ], [ "sanitary_transport", "tfd" ]), "TFD")).toEqual([]);
    expect(ids(trUser([ "tfd_committee" ], [ "sanitary_transport", "tfd" ]), "Transporte")).toEqual([ "transport-panel" ]);
  });
  it("motorista só com o papel driver: Minhas viagens e Segurança, mais nada", () => {
    const groups = navGroupsFor(trUser([ "driver" ]));
    expect(groups.flatMap((g) => g.items.map((i) => i.id))).toEqual([ "transport-my-trips", "security" ]);
    expect(groups.map((g) => g.label)).toEqual([ "Transporte", "Conta" ]);
    expect(navGroupsFor(trUser([ "driver" ], [])).flatMap((g) => g.items.map((i) => i.id))).toEqual([ "security" ]);
  });
  it("motorista com outro papel vê o menu normal mais Minhas viagens", () => {
    const groups = navGroupsFor(trUser([ "driver", "viewer" ]));
    expect(groups.some((g) => g.label === "Visão geral")).toBe(true);
    expect(ids(trUser([ "driver", "viewer" ]), "Transporte")).toEqual([ "transport-my-trips" ]);
  });
  it("Transporte e TFD vêm depois da Saúde bucal, com ícone e descrição no catálogo", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Transporte")).toBe(labels.indexOf("Saúde bucal") + 1);
    expect(labels.indexOf("TFD")).toBe(labels.indexOf("Transporte") + 1);
    expect(CATALOG.groups["Transporte"].description).toBe("Frota, viagens, séries, motorista e lista de passageiros");
    expect(CATALOG.groups["TFD"].description).toBe("Laudo, comissão, ajuda de custo e prestação de contas");
    expect(CATALOG.screens["transport-my-trips"].description).toBe("Viagens do dia, embarque e fechamento");
  });
});
