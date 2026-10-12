import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContaMenu } from "./ContaMenu";
import { getTheme } from "../theme/theme";

afterEach(() => { cleanup(); localStorage.clear(); });

describe("ContaMenu", () => {
  it("mantém o botão Conta e o Sair", () => {
    const onLogout = vi.fn();
    render(<ContaMenu email="admin@curitiba.demo" onLogout={onLogout} />);
    fireEvent.click(screen.getByRole("button", { name: "Conta" }));
    expect(screen.getByText("admin@curitiba.demo")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: "Sair" }));
    expect(onLogout).toHaveBeenCalled();
  });

  it("escolhe o tema entre gov.br, Rota Saúde e Alto contraste", () => {
    render(<ContaMenu email="a@b.c" onLogout={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Conta" }));
    expect(screen.getByRole("menuitemradio", { name: "gov.br" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Rota Saúde" }));
    expect(getTheme()).toBe("rota");
  });
});
