// O index.html aplica o tema salvo antes do React montar (sem flash).
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../../index.html"), "utf8");
const inline = /<script data-theme-boot>([\s\S]*?)<\/script>/.exec(html)?.[1];

beforeEach(() => { localStorage.clear(); document.documentElement.dataset.theme = "govbr"; });

describe("script inline do tema", () => {
  it("existe no <head>, antes do módulo da aplicação", () => {
    expect(inline).toBeTruthy();
    expect(html.indexOf("data-theme-boot")).toBeLessThan(html.indexOf('type="module"'));
  });

  it("aplica o tema salvo", () => {
    localStorage.setItem("rotasaude:theme", "alto-contraste");
    new Function(inline!)();
    expect(document.documentElement.dataset.theme).toBe("alto-contraste");
  });

  it("ignora valor inválido", () => {
    localStorage.setItem("rotasaude:theme", "<script>");
    new Function(inline!)();
    expect(document.documentElement.dataset.theme).toBe("govbr");
  });
});
