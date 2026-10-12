// Guardas dos CSS do ciclo (spec do subprojeto 3): !important só em display
// e grid-template-columns, e só dentro de @media (max-width: 1023px); fora
// do @media, só as regras de .dt-cell (antes estilo inline da célula).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const src = join(dirname(fileURLToPath(import.meta.url)), "..");
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function splitMedia(css: string): { inside: string; outside: string } {
  const at = css.indexOf("@media (max-width: 1023px)");
  if (at < 0) return { inside: "", outside: css };
  let depth = 0;
  let end = -1;
  for (let i = css.indexOf("{", at); i < css.length; i++) {
    if (css[i] === "{") depth++;
    if (css[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  return { inside: css.slice(at, end + 1), outside: css.slice(0, at) + css.slice(end + 1) };
}

function check(file: string, outsideSelectors: RegExp | null) {
  const css = strip(readFileSync(join(src, file), "utf8"));
  const { inside, outside } = splitMedia(css);
  expect((css.match(/@media/g) ?? []).length, "um único @media").toBe(1);
  const importants = css.match(/[\w-]+\s*:[^;{}]*!important/g) ?? [];
  importants.forEach((d) => expect(d, d).toMatch(/^(display|grid-template-columns)\s*:/));
  expect(outside, "nada de !important fora do @media").not.toMatch(/!important/);
  const outsideRules = outside.match(/[^{}]+(?=\{)/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
  if (outsideSelectors) outsideRules.forEach((sel) => expect(sel, sel).toMatch(outsideSelectors));
  else expect(outsideRules).toEqual([]);
  expect(inside).not.toMatch(/\.dt-head[^{]*\{[^}]*display\s*:\s*none/);
}

describe("CSS do ciclo de interface", () => {
  it("datatable.css", () => check("components/datatable.css", /^\.dt-cell(\[data-align="(right|center)"\])?$/));
  it.skipIf(!existsSync(join(src, "theme/responsive.css")))("responsive.css", () => check("theme/responsive.css", null));
});
