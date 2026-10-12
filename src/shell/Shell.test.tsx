import { afterEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IconUsers } from "@tabler/icons-react";
import { Shell } from "./Shell";
import type { Route } from "./router";
import type { Catalog, ShellGroup } from "./types";

afterEach(cleanup);

const groups: ShellGroup[] = [
  { label: "Atendimento", slug: "atendimento", items: [
    { id: "attendance", label: "Atendimento" }, { id: "my-agenda", label: "Minha agenda" } ] }
];
const meta = { icon: IconUsers, description: "d" };
const catalog: Catalog = { groups: { Atendimento: meta }, screens: { attendance: meta, "my-agenda": meta } };
const titleFor = (id: string) => (id === "my-agenda" ? "Minha agenda" : "Atendimento");

function renderShell(route: Route) {
  return render(
    <Shell product="Dashboard" groups={groups} catalog={catalog} route={route} go={vi.fn()} titleFor={titleFor}
      context={<span>contexto</span>} notifications={<span>sino</span>} account={<span>conta</span>}>
      {route.kind === "screen" ? <h1>{titleFor(route.id)}</h1> : <h1>Início</h1>}
    </Shell>
  );
}

describe("Shell", () => {
  it("tem os marcos: header, nav Grupos, main#conteudo e a trilha nas telas", () => {
    renderShell({ kind: "screen", id: "my-agenda" });
    expect(screen.getByRole("banner")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Grupos" })).toBeTruthy();
    expect(screen.getByRole("main").id).toBe("conteudo");
    expect(screen.getByRole("navigation", { name: "Trilha" })).toBeTruthy();
    expect(screen.getByText("contexto")).toBeTruthy();
  });

  it("título da aba por rota e foco no h1 ao trocar", () => {
    const { rerender } = renderShell({ kind: "home" });
    expect(document.title).toBe("Início · Rota Saúde");
    rerender(
      <Shell product="Dashboard" groups={groups} catalog={catalog} route={{ kind: "screen", id: "my-agenda" }} go={vi.fn()}
        titleFor={titleFor} context={null} notifications={null} account={null}>
        <h1>Minha agenda</h1>
      </Shell>
    );
    expect(document.title).toBe("Minha agenda · Rota Saúde");
    expect(document.activeElement?.textContent).toBe("Minha agenda");
  });

  it("no carregamento (inclusive em StrictMode) o foco não é movido", () => {
    render(
      <StrictMode>
        <Shell product="Dashboard" groups={groups} catalog={catalog} route={{ kind: "screen", id: "my-agenda" }} go={vi.fn()}
          titleFor={titleFor} context={null} notifications={null} account={null}>
          <h1>Minha agenda</h1>
        </Shell>
      </StrictMode>
    );
    expect(document.activeElement).toBe(document.body);
  });

  it("botão Menu abre a gaveta", () => {
    renderShell({ kind: "home" });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
  });
});

describe("gaveta e largura da janela (A-10)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a gaveta fecha quando a janela passa de 1024px", () => {
    let listener: ((e: { matches: boolean }) => void) | null = null;
    vi.stubGlobal("matchMedia", (q: string) => ({ matches: false, media: q,
      addEventListener: (_: string, l: (e: { matches: boolean }) => void) => { listener = l; },
      removeEventListener: () => { listener = null; } }));
    renderShell({ kind: "home" });
    fireEvent.click(screen.getByRole("button", { name: "Menu" }));
    expect(screen.getByRole("dialog", { name: "Menu" })).toBeTruthy();
    act(() => listener?.({ matches: true }));
    expect(screen.queryByRole("dialog", { name: "Menu" })).toBeNull();
  });
});
