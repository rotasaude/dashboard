import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Breadcrumb } from "./Breadcrumb";
import type { ShellGroup } from "./types";

afterEach(cleanup);

const groups: ShellGroup[] = [
  { label: "Visão geral", slug: "visao-geral", items: [ { id: "overview", label: "Visão geral" } ] },
  { label: "Atendimento", slug: "atendimento", items: [
    { id: "attendance", label: "Atendimento" }, { id: "my-agenda", label: "Minha agenda" } ] }
];
const titleFor = (id: string) => groups.flatMap((g) => g.items).find((i) => i.id === id)?.label ?? id;

describe("Breadcrumb", () => {
  it("Início › Grupo › Tela, e troca de tela no grupo", () => {
    const go = vi.fn();
    render(<Breadcrumb groups={groups} route={{ kind: "screen", id: "my-agenda" }} go={go} titleFor={titleFor} />);
    const nav = screen.getByRole("navigation", { name: "Trilha" });
    expect(nav.textContent).toContain("Início");
    expect(screen.getByRole("link", { name: "Atendimento" }).getAttribute("href")).toBe("#/grupo/atendimento");
    fireEvent.click(screen.getByRole("button", { name: /Minha agenda/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Atendimento" }));
    expect(go).toHaveBeenCalledWith({ kind: "screen", id: "attendance" });
  });

  it("grupo de uma tela: Início › Tela", () => {
    render(<Breadcrumb groups={groups} route={{ kind: "screen", id: "overview" }} go={vi.fn()} titleFor={titleFor} />);
    expect(screen.queryByRole("link", { name: "Visão geral" })).toBeNull();
    expect(screen.getByRole("navigation", { name: "Trilha" }).textContent).toContain("Visão geral");
  });

  it("tela fora do menu: Início › Tela", () => {
    render(<Breadcrumb groups={groups} route={{ kind: "screen", id: "security" }} go={vi.fn()} titleFor={() => "Segurança"} />);
    expect(screen.getByRole("navigation", { name: "Trilha" }).textContent).toBe("Início›Segurança");
  });
});

describe("menu da trilha (A-08, A-09)", () => {
  const three: ShellGroup[] = [ { label: "Atendimento", slug: "atendimento", items: [
    { id: "attendance", label: "Atendimento" }, { id: "my-agenda", label: "Minha agenda" }, { id: "queues", label: "Filas" } ] } ];

  it("itens são links com href e navegam por setas; Escape devolve o foco", () => {
    render(<Breadcrumb groups={three} route={{ kind: "screen", id: "my-agenda" }} go={vi.fn()}
      titleFor={(id) => three[0].items.find((i) => i.id === id)!.label} />);
    fireEvent.click(screen.getByRole("button", { name: /Minha agenda/ }));
    const items = screen.getAllByRole("menuitem");
    expect(items[0].tagName).toBe("A");
    expect(items[0].getAttribute("href")).toBe("#/attendance");
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1], { key: "End" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2], { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement?.getAttribute("aria-haspopup")).toBe("menu");
  });
});
