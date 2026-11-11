import { describe, expect, it } from "vitest";
import { NAV_GROUPS, navGroupsFor } from "./modules";
import { CATALOG } from "./catalog";
import { urgencyUser } from "../test/urgencyFixtures";

const ids = (u: ReturnType<typeof urgencyUser>) => navGroupsFor(u).flatMap((g) => g.items.map((i) => i.id));

describe("menu da urgência (módulo 32a)", () => {
  it("painel para admin e analista, com urgency_care e clinical_record", () => {
    expect(ids(urgencyUser([ "municipal_admin" ]))).toContain("urgency-panel");
    expect(ids(urgencyUser([ "analyst" ]))).toContain("urgency-panel");
    expect(ids(urgencyUser([ "health_professional" ]))).not.toContain("urgency-panel");
    expect(ids(urgencyUser([ "municipal_admin" ], [ "urgency_care", "waiting_room_display" ]))).not.toContain("urgency-panel");
  });
  it("senhas, locais e TVs só do admin e só com waiting_room_display (vale também sem urgency_care)", () => {
    expect(ids(urgencyUser([ "municipal_admin" ], [ "waiting_room_display" ]))).toContain("waiting-room-settings");
    expect(ids(urgencyUser([ "municipal_admin" ], [ "urgency_care", "clinical_record" ]))).not.toContain("waiting-room-settings");
    expect(ids(urgencyUser([ "analyst" ]))).not.toContain("waiting-room-settings");
  });
  it("leitos de observação só do admin, com urgency_care e clinical_record (sem depender do waiting_room_display)", () => {
    expect(ids(urgencyUser([ "municipal_admin" ], [ "urgency_care", "clinical_record" ]))).toContain("urgency-beds");
    expect(ids(urgencyUser([ "municipal_admin" ], [ "waiting_room_display" ]))).not.toContain("urgency-beds");
    expect(ids(urgencyUser([ "analyst" ]))).not.toContain("urgency-beds");
    expect(ids(urgencyUser([ "health_professional" ]))).not.toContain("urgency-beds");
    expect(CATALOG.screens["urgency-beds"].description).toBe("Leitos da observação da UPA, com step-up");
    const items = NAV_GROUPS.find((g) => g.label === "Urgência")!.items.map((i) => i.id);
    expect(items).toEqual([ "urgency-panel", "waiting-room-settings", "urgency-beds" ]);
  });
  it("o grupo some inteiro sem nada visível e tem ícone e descrição no catálogo", () => {
    expect(navGroupsFor(urgencyUser([ "citizen_verifier" ])).some((g) => g.label === "Urgência")).toBe(false);
    expect(CATALOG.groups["Urgência"].description).toBe("UPA: tempos por cor, desfechos e o painel de chamada da sala de espera");
    expect(CATALOG.screens["urgency-panel"].description).toBe("Tempos por cor, fora do tempo, desfechos e evasão");
    expect(CATALOG.screens["waiting-room-settings"].description).toBe("Locais de chamada e TVs da sala de espera");
    expect(CATALOG.groups["Urgência"].icon).toBeTruthy();
  });
  it("vem logo depois do CAPS", () => {
    const labels = NAV_GROUPS.map((g) => g.label);
    expect(labels.indexOf("Urgência")).toBe(labels.indexOf("CAPS") + 1);
  });
});
