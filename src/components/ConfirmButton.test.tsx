import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConfirmButton } from "./ConfirmButton";

afterEach(cleanup);

describe("ConfirmButton", () => {
  it("só executa no segundo passo", async () => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Saiu sem atendimento" question="Marcar que a pessoa saiu sem atendimento?" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Saiu sem atendimento" }));
    expect(onConfirm).not.toHaveBeenCalled();
    const group = screen.getByRole("group", { name: "Marcar que a pessoa saiu sem atendimento?" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirmar" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar" })); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(group.isConnected).toBe(false);
  });

  it.each([ "Cancelar", "Escape" ])("%s volta ao botão com foco, sem executar", (how) => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Gerar outro código" question="Gerar outro código? O atual deixa de valer." onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Gerar outro código" }));
    if (how === "Cancelar") fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    else fireEvent.keyDown(screen.getByRole("button", { name: "Confirmar" }), { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Gerar outro código" }));
  });
});
