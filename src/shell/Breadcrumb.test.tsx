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
