import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tokens, toneColor, toneShape } from "./tokens";

const appRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("tema", () => {
  it("o index.html abre no tema govbr", () => {
    const html = readFileSync(join(appRoot, "index.html"), "utf8");
    expect(html).toMatch(/<html lang="pt-BR" data-theme="govbr">/);
  });

  it("o global.css importa a cópia dos tokens e não redefine papéis", () => {
    const css = readFileSync(join(appRoot, "src/theme/global.css"), "utf8");
    expect(css.trimStart().startsWith('@import "./vendor/tokens.css";')).toBe(true);
    expect(css).not.toMatch(/--ink:\s/);
  });

  it("toneColor lê papéis do tema ativo", () => {
    expect(toneColor("ok")).toEqual({ fg: "var(--ok)", bg: "var(--ok-bg)" });
    expect(toneColor("urgent")).toEqual({ fg: "var(--down)", bg: "var(--down-bg)" });
    expect(toneColor("accent")).toEqual({ fg: "var(--accent)", bg: "var(--accent-bg)" });
    expect(toneColor(undefined)).toEqual({ fg: "var(--ink3)", bg: "var(--sunken)" });
    expect(tokens.color.ink).toBe("var(--ink)");
  });

  it("toneShape dá forma ao nível, além da cor", () => {
    expect(toneShape("down")).toBe("square");
    expect(toneShape("urgent")).toBe("square");
    expect(toneShape("warn")).toBe("triangle");
    expect(toneShape("ok")).toBe("circle");
    expect(toneShape("info")).toBeNull();
    expect(toneShape("accent")).toBeNull();
    expect(toneShape(undefined)).toBeNull();
  });
});
