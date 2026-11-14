import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { fieldMapStyle } from "./fieldMapStyle";
import vendored from "./vendor/map-style/style-light.json";
import manifest from "./vendor/map-style/manifest.json";

const publicDir = join(dirname(fileURLToPath(import.meta.url)), "../../public");

describe("fieldMapStyle", () => {
  it("estilo: toda URL é do próprio dashboard; fonte pmtiles; atribuição OSM; nenhum marcador sobra", () => {
    const s = fieldMapStyle({ base: "/dashboard/", mapUrl: "http://curitiba.localhost:5218/territory/map" });
    expect(s.glyphs).toBe("/dashboard/map/fonts/{fontstack}/{range}.pbf");
    expect(s.sprite).toBe("/dashboard/map/sprites/light");
    expect(s.sources.protomaps).toMatchObject({
      type: "vector", url: "pmtiles://http://curitiba.localhost:5218/territory/map", attribution: "© OpenStreetMap"
    });
    const text = JSON.stringify(s);
    expect(text).not.toMatch(/__(PMTILES|GLYPHS|SPRITE)__/);
    const urls = text.match(/https?:\/\/[^"\s]+/g) ?? [];
    expect(urls.every((u) => u.startsWith("http://curitiba.localhost:5218/territory/map"))).toBe(true);
  });

  it("toda fonte que as camadas pedem existe na cópia", () => {
    // `text-font` é uma lista de pilhas ou uma expressão (["case", …, ["literal", [pilhas]], …]).
    const literals = (v: unknown): string[] => {
      if (!Array.isArray(v)) return [];
      return v[0] === "literal" ? (v[1] as string[]) : v.flatMap(literals);
    };
    const stacksOf = (v: unknown): string[] =>
      Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : literals(v);
    const stacks = new Set(
      fieldMapStyle({ base: "/", mapUrl: "x" }).layers.flatMap((l) => stacksOf((l.layout as Record<string, unknown> | undefined)?.["text-font"]))
    );
    expect(stacks.size).toBeGreaterThan(0);
    for (const font of stacks) expect(manifest.fonts, font).toContain(font);
    // Faixa pedida e sem arquivo derruba o mapa inteiro (Q61): confere a primeira e a última de
    // cada pilha do manifesto (inclui a que só aparece dentro do `text-field`, em `format`).
    for (const font of manifest.fonts) {
      expect(existsSync(join(publicDir, "map/fonts", font, "0-255.pbf")), font).toBe(true);
      expect(existsSync(join(publicDir, "map/fonts", font, "65280-65535.pbf")), font).toBe(true);
    }
  });

  it("o sprite light existe na cópia, nas duas densidades", () => {
    for (const f of [ "light.json", "light.png", "light@2x.json", "light@2x.png" ]) {
      expect(existsSync(join(publicDir, "map/sprites", f)), f).toBe(true);
    }
  });

  it("mantém as camadas e os rótulos em português", () => {
    const s = fieldMapStyle({ base: "/dashboard/", mapUrl: "x" });
    expect(s.version).toBe(8);
    expect(s.layers).toHaveLength(vendored.layers.length);
    expect(JSON.stringify(s.layers)).toContain("name:pt");
  });

  it("não altera a cópia vendorizada (função pura)", () => {
    const a = fieldMapStyle({ base: "/a/", mapUrl: "http://a.test/territory/map" });
    const b = fieldMapStyle({ base: "/b/", mapUrl: "http://b.test/territory/map" });
    expect(a.glyphs).toBe("/a/map/fonts/{fontstack}/{range}.pbf");
    expect(b.glyphs).toBe("/b/map/fonts/{fontstack}/{range}.pbf");
    expect(a.layers).not.toBe(b.layers);
    expect(vendored.glyphs).toBe("__GLYPHS__/{fontstack}/{range}.pbf");
    expect(vendored.sprite).toBe("__SPRITE__/light");
    expect(vendored.sources.protomaps.url).toBe("__PMTILES__");
  });
});
