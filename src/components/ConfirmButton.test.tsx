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
    // O foco vai para a pergunta, nunca para Confirmar: um segundo Enter não executa.
    expect(document.activeElement?.textContent).toBe("Marcar que a pessoa saiu sem atendimento?");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar" })); });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(group.isConnected).toBe(false);
  });

  it.each([ "Cancelar", "Escape" ])("%s volta ao botão com foco, sem executar", (how) => {
    const onConfirm = vi.fn();
    render(<ConfirmButton label="Gerar outro código" question="Gerar outro código? O atual deixa de valer." onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Gerar outro código" }));
    if (how === "Cancelar") fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    else fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Gerar outro código" }));
  });
});

describe("ConfirmButton com a ação em andamento", () => {
  it("Cancelar e Escape não fazem nada enquanto a ação roda; ao terminar, volta ao botão", async () => {
    let resolve!: () => void;
    const onConfirm = vi.fn(() => new Promise<void>((r) => { resolve = r; }));
    render(<ConfirmButton label="Saiu sem atendimento" question="Confirmar saída?" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Saiu sem atendimento" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    const cancel = screen.getByRole("button", { name: "Cancelar" });
    expect(cancel.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(cancel);
    fireEvent.keyDown(cancel, { key: "Escape" });
    expect(screen.getByRole("group", { name: "Confirmar saída?" })).toBeTruthy();
    await act(async () => { resolve(); });
    expect(screen.queryByRole("group")).toBeNull();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("se a ação falhar, sai do segundo passo do mesmo jeito", async () => {
    const onConfirm = vi.fn(() => Promise.reject(new Error("recusada")));
    render(<ConfirmButton label="Gerar outro código" question="Gerar outro?" onConfirm={onConfirm} />);
    fireEvent.click(screen.getByRole("button", { name: "Gerar outro código" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar" })); });
    expect(screen.queryByRole("group")).toBeNull();
  });
});
