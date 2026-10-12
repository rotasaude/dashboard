// Pares de contraste que a tela usa e o contracts não testava (A-05): link
// (accent) e tom sobre o painel e sobre o fundo do próprio tom, nos temas dos
// painéis. Valores do tema por cima dos do :root base.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "vendor/tokens.css"), "utf8");
const vars = (body: string) =>
  Object.fromEntries([ ...body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})\b/g) ].map((x) => [ x[1], x[2] ]));
function theme(name: string): Record<string, string> {
  const base = /:root\s*\{([^}]*)\}/.exec(css);
  const own = new RegExp(`:root\\[data-theme="${name}"\\]\\s*\\{([^}]*)\\}`).exec(css);
  if (!own) throw new Error(`tema ${name} não está no tokens.css`);
  return { ...vars(base?.[1] ?? ""), ...vars(own[1]) };
}
function lum(hex: string) {
  const c = [ 1, 3, 5 ].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const ratio = (a: string, b: string) => { const [ x, y ] = [ lum(a), lum(b) ]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

describe.each([ "govbr", "rota", "alto-contraste" ])("tema %s", (name) => {
  const t = theme(name);
  it.each([ "accent", "ok", "warn", "down", "info" ])("--%s sobre --panel ≥ 4,5:1", (role) => {
    expect(ratio(t[role], t.panel)).toBeGreaterThanOrEqual(4.5);
  });
  it.each([ "ok", "warn", "down", "info" ])("--%s sobre --%s-bg ≥ 4,5:1", (role) => {
    expect(ratio(t[role], t[`${role}-bg`])).toBeGreaterThanOrEqual(4.5);
  });
});
