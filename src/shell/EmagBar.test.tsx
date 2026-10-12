import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EmagBar } from "./EmagBar";
import { getTheme } from "../theme/theme";

afterEach(() => { cleanup(); document.body.innerHTML = ""; localStorage.clear(); });

describe("EmagBar", () => {
  it("atalhos com accesskey 1, 2 e 3", () => {
    render(<EmagBar />);
    expect(screen.getByRole("link", { name: /Ir para o conteúdo/ }).getAttribute("accesskey")).toBe("1");
    expect(screen.getByRole("link", { name: /Ir para o menu/ }).getAttribute("accesskey")).toBe("2");
    expect(screen.getByRole("link", { name: /Ir para a busca/ }).getAttribute("accesskey")).toBe("3");
    expect(screen.getByRole("link", { name: "Acessibilidade" }).getAttribute("href")).toBe("#/acessibilidade");
  });

  it("Ir para o conteúdo move o foco e não troca o hash", () => {
    window.history.replaceState(null, "", "/dashboard/#/team");
    const main = document.createElement("main");
    main.id = "conteudo";
    document.body.appendChild(main);
    render(<EmagBar />);
    fireEvent.click(screen.getByRole("link", { name: /Ir para o conteúdo/ }));
    expect(document.activeElement).toBe(main);
    expect(window.location.hash).toBe("#/team");
  });

  it("Ir para o menu usa o trilho, ou o botão Menu quando o trilho está oculto", () => {
    const menuBtn = document.createElement("button");
    menuBtn.id = "menu-botao";
    document.body.appendChild(menuBtn);
    render(<EmagBar />);
    fireEvent.click(screen.getByRole("link", { name: /Ir para o menu/ }));
    expect(document.activeElement).toBe(menuBtn);
  });

  it("Alto contraste liga o tema", () => {
    render(<EmagBar />);
    fireEvent.click(screen.getByRole("button", { name: "Alto contraste" }));
    expect(getTheme()).toBe("alto-contraste");
    expect(screen.getByRole("button", { name: "Alto contraste" }).getAttribute("aria-pressed")).toBe("true");
  });
});
