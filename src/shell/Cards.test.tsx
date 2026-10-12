import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IconUsers } from "@tabler/icons-react";
import { GroupCards, HomeCards } from "./Cards";
import type { Catalog, ShellGroup } from "./types";

afterEach(cleanup);

const groups: ShellGroup[] = [
  { label: "Visão geral", slug: "visao-geral", items: [ { id: "overview", label: "Visão geral" } ] },
  { label: "Atendimento", slug: "atendimento", items: [
    { id: "attendance", label: "Atendimento" },
    { id: "signature-pending", label: "Pendentes de assinatura", count: 3 }
  ] }
];
const meta = { icon: IconUsers, description: "descrição" };
const catalog: Catalog = {
  groups: { "Visão geral": meta, "Atendimento": meta },
  screens: { overview: meta, attendance: meta, "signature-pending": meta }
};

describe("HomeCards", () => {
  it("um card por grupo; grupo de uma tela vai direto à tela", () => {
    render(<HomeCards groups={groups} catalog={catalog} go={vi.fn()} now={new Date(2026, 9, 12, 9)} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Bom dia");
    expect(screen.getByRole("link", { name: /Visão geral/ }).getAttribute("href")).toBe("#/overview");
    expect(screen.getByRole("link", { name: /Atendimento/ }).getAttribute("href")).toBe("#/grupo/atendimento");
  });

  it("clique primário chama go; Ctrl+clique deixa o navegador abrir em nova aba", () => {
    const go = vi.fn();
    render(<HomeCards groups={groups} catalog={catalog} go={go} />);
    const link = screen.getByRole("link", { name: /Atendimento/ });
    fireEvent.click(link, { ctrlKey: true });
    expect(go).not.toHaveBeenCalled();
    fireEvent.click(link);
    expect(go).toHaveBeenCalledWith({ kind: "group", slug: "atendimento" });
  });
});

describe("GroupCards", () => {
  it("um sub-card por tela, com selo de contagem", () => {
    render(<GroupCards group={groups[1]} catalog={catalog} go={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Atendimento");
    const pending = screen.getByRole("link", { name: /Pendentes de assinatura/ });
    expect(pending.getAttribute("href")).toBe("#/signature-pending");
    expect(pending.textContent).toContain("3");
  });
});
