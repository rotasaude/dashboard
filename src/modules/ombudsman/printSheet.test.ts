// Folha para impressão (módulo 33; comprovante e relatório): a janela abre no clique, o documento é montado por DOM
// (`textContent`, nunca `innerHTML`) e impresso; janela bloqueada devolve a frase POPUP_BLOCKED.
import { afterEach, describe, expect, it, vi } from "vitest";
import { POPUP_BLOCKED } from "../documents/printDocument";
import { printSheet } from "./printSheet";

afterEach(() => { vi.restoreAllMocks(); });

describe("printSheet", () => {
  it("monta o documento por texto, imprime e não usa innerHTML", () => {
    const doc = document.implementation.createHTMLDocument("");
    const win = { document: doc, print: vi.fn(), focus: vi.fn(), close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(win as never);
    expect(printSheet("Comprovante", [ [ "Protocolo", "<b>2026-000130</b>" ] ])).toBeNull();
    expect(doc.body.textContent).toContain("<b>2026-000130</b>");
    expect(doc.querySelector("b")).toBeNull();
    expect(win.print).toHaveBeenCalled();
    vi.spyOn(window, "open").mockReturnValue(null);
    expect(printSheet("x", [])).toBe(POPUP_BLOCKED);
  });

  it("título na aba e no h1; linhas na tabela; parágrafos com e sem título", () => {
    const doc = document.implementation.createHTMLDocument("");
    const win = { document: doc, print: vi.fn(), focus: vi.fn(), close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(win as never);
    printSheet("Relatório <i>2025</i>", [ [ "Tipo", "Reclamação" ], [ "Canal", "Presencial" ] ],
      [ { title: "Ações", text: "<script>x</script>" }, { title: "", text: "Guarde este número." } ]);
    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(doc.title).toBe("Relatório <i>2025</i>");
    expect(doc.querySelector("h1")?.textContent).toBe("Relatório <i>2025</i>");
    expect([ ...doc.querySelectorAll("tr") ].map((r) => r.textContent)).toEqual([ "TipoReclamação", "CanalPresencial" ]);
    expect(doc.querySelectorAll("h2").length).toBe(1);
    expect(doc.querySelector("script")).toBeNull();
    expect(doc.body.textContent).toContain("<script>x</script>");
    expect(doc.body.textContent).toContain("Guarde este número.");
    expect(win.focus).toHaveBeenCalled();
  });
});
