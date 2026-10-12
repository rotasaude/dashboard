import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { IconUsers } from "@tabler/icons-react";
import { Rail } from "./Rail";
import type { Catalog, ShellGroup } from "./types";

afterEach(cleanup);

const groups: ShellGroup[] = [
  { label: "Visão geral", slug: "visao-geral", items: [ { id: "overview", label: "Visão geral" } ] },
  { label: "Atendimento", slug: "atendimento", items: [
    { id: "attendance", label: "Atendimento" }, { id: "my-agenda", label: "Minha agenda" } ] }
];
const meta = { icon: IconUsers, description: "d" };
const catalog: Catalog = { groups: { "Visão geral": meta, "Atendimento": meta }, screens: {} };

describe("Rail", () => {
  it("Início e um link por grupo, marcando o grupo da tela atual", () => {
    render(<Rail groups={groups} catalog={catalog} route={{ kind: "screen", id: "my-agenda" }} go={vi.fn()} />);
    const nav = screen.getByRole("navigation", { name: "Grupos" });
    expect(nav.className).toContain("shell-rail");
    expect(screen.getByRole("link", { name: "Início" }).getAttribute("href")).toBe("#/");
    expect(screen.getByRole("link", { name: "Atendimento" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Visão geral" }).getAttribute("href")).toBe("#/overview");
  });
});
