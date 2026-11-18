import { describe, expect, it } from "vitest";
import { boundsOf, boundsOfPoints, roundCoord, toCategoryCollection, toFeatureCollection } from "./points";
import { mapHousehold } from "../../../test/territoryMapFixtures";

describe("pontos do mapa da microárea (24c)", () => {
  it("roundCoord: no máximo 8 casas, sem inventar casas", () => {
    expect(roundCoord(-25.428471234567)).toBe(-25.42847123);
    expect(roundCoord(-49.273254119999)).toBe(-49.27325412);
    expect(roundCoord(-49.2733)).toBe(-49.2733);
    expect(roundCoord(0)).toBe(0);
  });

  it("toFeatureCollection: [longitude, latitude], selected só no escolhido e rótulo de endereço", () => {
    const fc = toFeatureCollection([
      mapHousehold(),
      mapHousehold({ id: "hh2", location: { latitude: -25.5, longitude: -49.3, source: "map" }, address: { street: null, number: null } }),
      mapHousehold({ id: "hh3", address: { street: "Ipê Amarelo", number: null } })
    ], "hh2");
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.map((f) => f.geometry.coordinates)).toEqual([ [ -49.27325411, -25.42847123 ], [ -49.3, -25.5 ], [ -49.27325411, -25.42847123 ] ]);
    expect(fc.features.map((f) => f.properties)).toEqual([
      { id: "hh1", selected: false, label: "das Flores, 120" },
      { id: "hh2", selected: true, label: "S/N" },
      { id: "hh3", selected: false, label: "Ipê Amarelo, S/N" }
    ]);
    for (const f of fc.features) expect(Object.keys(f.properties).sort()).toEqual([ "id", "label", "selected" ]);
  });

  it("boundsOf: a caixa [[oeste, sul], [leste, norte]] dos pontos; vazio = null", () => {
    expect(boundsOf([])).toBeNull();
    expect(boundsOf([ mapHousehold() ])).toEqual([ [ -49.27325411, -25.42847123 ], [ -49.27325411, -25.42847123 ] ]);
    expect(boundsOf([ mapHousehold(), mapHousehold({ id: "hh2", location: { latitude: -25.5, longitude: -49.2, source: "map" } }) ]))
      .toEqual([ [ -49.27325411, -25.5 ], [ -49.2, -25.42847123 ] ]);
  });

  it("toCategoryCollection (35a): [longitude, latitude] e só id, selected, label e category", () => {
    const fc = toCategoryCollection([ { id: "h1", latitude: -25.4, longitude: -49.27, category: "red", label: "Quarteirão 12" } ]);
    expect(fc.type).toBe("FeatureCollection");
    expect(fc.features.map((f) => f.geometry.coordinates)).toEqual([ [ -49.27, -25.4 ] ]);
    expect(fc.features.map((f) => f.properties)).toEqual([ { id: "h1", selected: false, label: "Quarteirão 12", category: "red" } ]);
    expect(Object.keys(fc.features[0].properties).sort()).toEqual([ "category", "id", "label", "selected" ]);
    expect(toCategoryCollection([]).features).toEqual([]);
  });

  it("boundsOfPoints (35a): a caixa dos pontos; vazio = null", () => {
    expect(boundsOfPoints([])).toBeNull();
    expect(boundsOfPoints([ { latitude: -25.4, longitude: -49.27 }, { latitude: -25.5, longitude: -49.2 } ]))
      .toEqual([ [ -49.27, -25.5 ], [ -49.2, -25.4 ] ]);
  });
});
