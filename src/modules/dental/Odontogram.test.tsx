import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Odontogram } from "./Odontogram";
import { SITUATIONS, odontogram } from "../../test/dentalFixtures";

afterEach(cleanup);
const teeth = odontogram().teeth;
const buttons = () => screen.getAllByRole("button").filter((b) => /^Dente \d\d/.test(b.getAttribute("aria-label") ?? ""));

describe("Odontogram", () => {
  it("dentições: 32, 20 e 52 dentes, cada um com rótulo completo", () => {
    const { rerender } = render(<Odontogram teeth={teeth} dentition="permanent" situations={SITUATIONS} selected={null} onSelect={vi.fn()} />);
    expect(buttons()).toHaveLength(32);
    expect(screen.getByRole("button", { name: "Dente 16: hígido; face oclusal/incisal: cariado" })).not.toBeNull();
    expect(screen.getByRole("button", { name: "Dente 36: ausente" })).not.toBeNull();
    rerender(<Odontogram teeth={teeth} dentition="deciduous" situations={SITUATIONS} selected={null} onSelect={vi.fn()} />);
    expect(buttons()).toHaveLength(20);
    expect(screen.getByRole("button", { name: "Dente 55: sem registro" })).not.toBeNull();
    rerender(<Odontogram teeth={teeth} dentition="mixed" situations={SITUATIONS} selected={null} onSelect={vi.fn()} />);
    expect(buttons()).toHaveLength(52);
  });

  it("teclado: tabindex móvel, setas atravessam quadrantes, Enter seleciona, Escape limpa", () => {
    const onSelect = vi.fn();
    render(<Odontogram teeth={teeth} dentition="permanent" situations={SITUATIONS} selected={null} onSelect={onSelect} />);
    const tabbable = buttons().filter((b) => b.tabIndex === 0);
    expect(tabbable.map((b) => b.textContent?.slice(0, 2))).toEqual([ "18" ]);
    const b11 = screen.getByRole("button", { name: /^Dente 11:/ });
    b11.focus();
    fireEvent.keyDown(b11, { key: "ArrowRight" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Dente 21:/);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Dente 31:/);
    fireEvent.keyDown(document.activeElement!, { key: "End" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Dente 38:/);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith({ tooth: "36", face: null });
    expect(buttons().filter((b) => b.tabIndex === 0).map((b) => b.getAttribute("aria-label")?.slice(0, 8))).toEqual([ "Dente 36" ]);
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("toque na face seleciona dente e face; selecionado fica pressionado; pendência marcada", () => {
    const onSelect = vi.fn();
    render(<Odontogram teeth={teeth} dentition="permanent" situations={SITUATIONS} pending={{ "26": 2 }} selected={{ tooth: "16", face: "O" }} onSelect={onSelect} />);
    expect(screen.getByRole("button", { name: /^Dente 16:/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Dente 26:.*2 marcações nesta consulta$/ })).not.toBeNull();
    const face = screen.getByRole("button", { name: /^Dente 46:/ }).querySelector('[data-face="V"]')!;
    fireEvent.pointerUp(face);
    expect(onSelect).toHaveBeenLastCalledWith({ tooth: "46", face: "V" });
  });

  it("raiz no rótulo e no desenho do dente", () => {
    const withRoot = teeth.map((t) => (t.tooth === "46" ? { ...t, root: "endodontics" } : t));
    render(<Odontogram teeth={withRoot} dentition="permanent" situations={SITUATIONS} selected={null} onSelect={vi.fn()} />);
    const b = screen.getByRole("button", { name: /^Dente 46:.*raiz: endodontia/ });
    expect(b.querySelector('[data-part="root"]')).not.toBeNull();
  });

  it("alvo de toque de tablet e situação nunca só por cor", () => {
    render(<Odontogram teeth={teeth} dentition="permanent" situations={SITUATIONS} selected={null} onSelect={vi.fn()} />);
    for (const b of buttons()) {
      expect(parseInt(b.style.minWidth, 10)).toBeGreaterThanOrEqual(44);
      expect(parseInt(b.style.minHeight, 10)).toBeGreaterThanOrEqual(44);
    }
    expect(screen.getByRole("button", { name: /^Dente 36:/ }).textContent).toContain("AUS");
  });

  it("troca de dentição pelo controle", () => {
    const onDentitionChange = vi.fn();
    render(<Odontogram teeth={teeth} dentition="permanent" selected={null} onSelect={vi.fn()} onDentitionChange={onDentitionChange} />);
    fireEvent.click(screen.getByRole("tab", { name: "Mista" }));
    expect(onDentitionChange).toHaveBeenCalledWith("mixed");
  });

  it("pointerUp na face seguido de click no botão mantém dente e face", () => {
    const onSelect = vi.fn();
    render(<Odontogram teeth={teeth} dentition="permanent" situations={SITUATIONS} selected={null} onSelect={onSelect} />);
    const b = screen.getByRole("button", { name: /^Dente 46:/ });
    fireEvent.pointerUp(b.querySelector('[data-face="V"]')!);
    fireEvent.click(b);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenLastCalledWith({ tooth: "46", face: "V" });
    fireEvent.click(b);
    expect(onSelect).toHaveBeenLastCalledWith({ tooth: "46", face: null });
  });

  it("pointerdown limpa a marca de face: um click posterior sem pointerUp seleciona o dente", () => {
    const onSelect = vi.fn();
    render(<Odontogram teeth={teeth} dentition="permanent" situations={SITUATIONS} selected={null} onSelect={onSelect} />);
    const b = screen.getByRole("button", { name: /^Dente 46:/ });
    fireEvent.pointerUp(b.querySelector('[data-face="V"]')!); // sem click depois: a marca ficaria velha
    fireEvent.pointerDown(b);
    fireEvent.click(b);
    expect(onSelect).toHaveBeenLastCalledWith({ tooth: "46", face: null });
  });

  it("face ou raiz registrada ganha marca textual '+' além da cor", () => {
    render(<Odontogram teeth={teeth} dentition="permanent" situations={SITUATIONS} selected={null} onSelect={vi.fn()} />);
    expect(screen.getByRole("button", { name: /^Dente 16:/ }).textContent).toContain("+");
    expect(screen.getByRole("button", { name: /^Dente 11:/ }).textContent).not.toContain("+");
  });

  it("mista: 11 desce para 51 e 51 sobe para 11; Ctrl+seta é ignorada", () => {
    render(<Odontogram teeth={teeth} dentition="mixed" situations={SITUATIONS} selected={null} onSelect={vi.fn()} />);
    const b11 = screen.getByRole("button", { name: /^Dente 11:/ });
    b11.focus();
    fireEvent.keyDown(b11, { key: "ArrowDown", ctrlKey: true });
    expect(document.activeElement).toBe(b11);
    fireEvent.keyDown(b11, { key: "ArrowDown" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Dente 51:/);
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(/^Dente 11:/);
  });
});
