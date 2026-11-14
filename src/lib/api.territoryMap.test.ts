import { afterEach, describe, expect, it, vi } from "vitest";
import { fieldMapUrl, listMapHouseholds, updateHousehold, type HouseholdInput } from "./api";
import { household } from "../test/territoryFixtures";
import { LOC_MAP, MAP_MANIFEST, mapHousehold } from "../test/territoryMapFixtures";

const calls: { url: string; init: RequestInit }[] = [];
function stub(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }));
}
afterEach(() => { calls.length = 0; vi.unstubAllGlobals(); });
const last = () => calls[calls.length - 1];
const bodyOf = () => JSON.parse(String(last().init.body));
const input = (): HouseholdInput => ({ micro_area_id: "ma1", property_type: "1", contact_phone: null, refused: false });

describe("cliente do mapa da microárea (módulo 24c)", () => {
  it("pontos: só o micro_area_id na URL; envelope ausente = { map: null, items: [] }", async () => {
    stub(200, {});
    expect(await listMapHouseholds("ma-1")).toEqual({ map: null, items: [] });
    expect(last().url).toBe("/territory/map/households?micro_area_id=ma-1");
  });

  it("pontos: o map da cidade vem junto (Q14)", async () => {
    stub(200, { map: MAP_MANIFEST, items: [ mapHousehold() ] });
    expect(await listMapHouseholds("ma-1")).toEqual({ map: MAP_MANIFEST, items: [ mapHousehold() ] });
  });

  it("fieldMapUrl: /territory/map da origem", () => {
    expect(fieldMapUrl()).toBe(`${window.location.origin}/territory/map`);
  });

  it("PATCH do domicílio leva location e version no corpo, nunca na URL", async () => {
    stub(200, household());
    await updateHousehold("hh-1", { ...input(), location: LOC_MAP }, 4);
    expect(last().url).toBe("/territory/households/hh-1");
    expect(bodyOf()).toMatchObject({ location: LOC_MAP, version: 4 });
    expect(last().url).not.toMatch(/25\.4|49\.2/);
  });

  it("PATCH sem location não manda a chave (o ponto fica como está)", async () => {
    stub(200, household());
    await updateHousehold("hh-1", input(), 4);
    expect(Object.keys(bodyOf())).not.toContain("location");
  });
});
