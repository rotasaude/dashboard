import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ActionButton } from "./ActionButton";

afterEach(cleanup);

describe("ActionButton", () => {
  it("bloqueado mostra o motivo, ignora o clique e continua focável", () => {
    const onClick = vi.fn();
    render(<ActionButton onClick={onClick} disabledReason="o motivo precisa de pelo menos 10 caracteres">Encerrar</ActionButton>);
    const b = screen.getByRole("button", { name: "Encerrar" });
    expect(b.getAttribute("aria-disabled")).toBe("true");
    expect(b.hasAttribute("disabled")).toBe(false);
    const reason = document.getElementById(b.getAttribute("aria-describedby")!);
    expect(reason?.textContent).toBe("o motivo precisa de pelo menos 10 caracteres");
    fireEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("duplo clique durante a ação roda uma vez e o foco fica no botão", async () => {
    let resolve!: () => void;
    const onClick = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<ActionButton onClick={onClick}>Chamar</ActionButton>);
    const b = screen.getByRole("button", { name: "Chamar" });
    b.focus();
    fireEvent.click(b);
    fireEvent.click(b);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(b.getAttribute("aria-busy")).toBe("true");
    expect(document.activeElement).toBe(b);
    await act(async () => { resolve(); });
    expect(b.getAttribute("aria-busy")).toBeNull();
  });
});
