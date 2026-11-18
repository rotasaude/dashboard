import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CATEGORY_COLORS, MAP_MARKS, OUTLINE_ROLE, TONE_ROLE, UNKNOWN_MARK, categoryLabel, mapColors, markOf } from "./vectorMap";
import { RISK_CLASSES, riskTone, type VectorMapLayer } from "./vectorControl";

// Os tokens como os guardas do tema os leem (src/theme/contrast.test.ts): o :root base e, por cima, o do tema.
const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../theme/vendor/tokens.css"), "utf8");
const vars = (body: string) =>
  Object.fromEntries([ ...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g) ].map((x) => [ `--${x[1]}`, x[2].toLowerCase() ]));
function theme(name: string): Record<string, string> {
  const base = /:root\s*\{([^}]*)\}/.exec(css);
  const own = new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  if (!own) throw new Error(`tema ${name} não está no tokens.css`);
  return { ...vars(base?.[1] ?? ""), ...vars(own[1]) };
}
const THEMES = [ ...css.matchAll(/:root\[data-theme="([\w-]+)"\]/g) ].map((m) => m[1]);
const LAYERS: VectorMapLayer[] = [ "risk", "ovitraps", "transmission" ];

describe("marcas do mapa do 35a", () => {
  it("os quatro temas do tokens.css entram, alto contraste incluído", () => {
    expect([ ...THEMES ].sort()).toEqual([ "alto-contraste", "govbr", "govbr-escuro", "rota" ]);
  });

  // WCAG 1.4.1: (preenchimento, contorno) distintos dois a dois, com a categoria desconhecida junto.
  describe.each(THEMES)("tema %s", (name) => {
    const t = theme(name);
    const resolve = (role: string) => { const v = t[role]; if (!v) throw new Error(`${role} sem valor em ${name}`); return v; };
    it.each(LAYERS)("camada %s: as categorias têm marcas distintas", (layer) => {
      const marks = [ ...Object.values(MAP_MARKS[layer]), UNKNOWN_MARK ]
        .map((m) => (m.hollow ? `vazio|${resolve(m.role)}` : `${resolve(m.role)}|${resolve(OUTLINE_ROLE)}`));
      expect(new Set(marks).size).toBe(marks.length);
    });
  });

  it("o risco deriva do selo (riskTone); só o roxo vai para --info no mapa; none vazado", () => {
    for (const c of RISK_CLASSES.filter((c) => c !== "purple")) expect(MAP_MARKS.risk[c]).toEqual({ role: TONE_ROLE[riskTone(c)], hollow: false });
    expect(riskTone("purple")).toBe("accent");
    expect(MAP_MARKS.risk.purple).toEqual({ role: "--info", hollow: false });
    expect(MAP_MARKS.risk.none).toEqual({ role: "--ink2", hollow: true });
    expect(markOf("risk", "brand_new")).toEqual({ role: "--ink4", hollow: true });
    expect(CATEGORY_COLORS.risk).toEqual({ green: "--ok", yellow: "--warn", red: "--down", gray: "--ink3", purple: "--info", none: "--ink2" });
  });

  it("mapColors lê cada papel pelo nome e diz quais vazam", () => {
    const t = theme("govbr");
    expect(mapColors("risk", (n) => t[n] ?? "")).toEqual({
      point: t["--ink4"], selected: t["--ink"], outline: t["--panel"],
      categories: { green: t["--ok"], yellow: t["--warn"], red: t["--down"], gray: t["--ink3"], purple: t["--info"], none: t["--ink2"] },
      hollow: [ "none" ], hollowOther: true
    });
    expect(mapColors("ovitraps", (n) => n).hollow).toEqual([]);
  });

  it("categoryLabel: domínios no risco, tabela nas outras, código cru no resto", () => {
    expect(categoryLabel("risk", "red", [ { code: "red", label: "Vermelho (alto)" } ])).toBe("Vermelho (alto)");
    expect(categoryLabel("risk", "red")).toBe("red");
    expect(categoryLabel("risk", "none")).toBe("sem risco avaliado");
    expect(categoryLabel("ovitraps", "alert")).toBe("acima do alerta");
    expect(categoryLabel("transmission", "area")).toBe("área do bloqueio");
    expect(categoryLabel("ovitraps", "brand_new")).toBe("brand_new");
  });
});
