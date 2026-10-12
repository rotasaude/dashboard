import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Drawer } from "./Drawer";
import type { ShellGroup } from "./types";

afterEach(cleanup);

const groups: ShellGroup[] = [
  { label: "Atendimento", slug: "atendimento", items: [
    { id: "attendance", label: "Atendimento" }, { id: "my-agenda", label: "Minha agenda" } ] }
];

function setup(onClose = vi.fn(), go = vi.fn()) {
  const opener = document.createElement("button");
  document.body.appendChild(opener);
  render(<Drawer open onClose={onClose} groups={groups} route={{ kind: "home" }} go={go} returnFocusTo={opener} />);
  return { onClose, go, opener };
}

describe("Drawer", () => {
  it("é um diálogo modal com o menu completo e foco dentro", () => {
    setup();
    const dialog = screen.getByRole("dialog", { name: "Menu" });
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(screen.getByRole("link", { name: "Minha agenda" }).getAttribute("href")).toBe("#/my-agenda");
  });

  it("Esc fecha", () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("clique no fundo fecha", () => {
    const { onClose } = setup();
    fireEvent.mouseDown(screen.getByTestId("drawer-backdrop"));
    expect(onClose).toHaveBeenCalled();
  });

  it("escolher uma tela navega e fecha", () => {
    const { onClose, go } = setup();
    fireEvent.click(screen.getByRole("link", { name: "Minha agenda" }));
    expect(go).toHaveBeenCalledWith({ kind: "screen", id: "my-agenda" });
    expect(onClose).toHaveBeenCalled();
  });

  it("Tab no último volta ao primeiro (foco preso)", () => {
    setup();
    const focusables = screen.getByRole("dialog").querySelectorAll<HTMLElement>("a,button");
    focusables[focusables.length - 1].focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
  });
});
