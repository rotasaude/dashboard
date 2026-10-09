// src/lib/useAutosave.test.tsx
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { saveStatusLabel, useAutosave } from "./useAutosave";
import { NOW19 } from "../test/consultationFixtures";

afterEach(cleanup);

function deferred() {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function Harness({ save, delayMs = 0, blocked = null }: { save(v: { text: string }): Promise<unknown>; delayMs?: number; blocked?: string | null }) {
  const [ text, setText ] = useState("a");
  const [ flushed, setFlushed ] = useState("");
  const autosave = useAutosave({
    value: { text }, initialKey: JSON.stringify({ text: "a" }), blockedReason: blocked, enabled: true, delayMs,
    save, describe: () => "falhou", now: () => new Date(NOW19)
  });
  return (
    <>
      <input aria-label="texto" value={text} onChange={(e) => setText(e.target.value)} />
      <span data-testid="status">{saveStatusLabel(autosave.status, blocked)}</span>
      <button type="button" onClick={() => void autosave.flush().then((ok) => setFlushed(String(ok)))}>flush</button>
      <span data-testid="flushed">{flushed}</span>
    </>
  );
}
const type = (value: string) => fireEvent.change(screen.getByLabelText("texto"), { target: { value } });
const status = () => screen.getByTestId("status").textContent;

describe("useAutosave", () => {
  it("o valor que o servidor já tem não é salvo", async () => {
    const save = vi.fn(async () => undefined);
    render(<Harness save={save} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(save).not.toHaveBeenCalled();
    expect(status()).toBe("rascunho");
  });

  it("salva depois da pausa e diz a hora", async () => {
    const save = vi.fn(async () => undefined);
    render(<Harness save={save} />);
    type("ab");
    await waitFor(() => expect(save).toHaveBeenCalledWith({ text: "ab" }));
    await waitFor(() => expect(status()).toBe("salvo às 10:00"));
  });

  it("texto digitado durante o salvamento não se perde e é salvo em seguida", async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    render(<Harness save={save} />);
    type("ab");
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(status()).toBe("salvando…");
    type("abc");
    first.resolve();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual({ text: "abc" });
    await waitFor(() => expect(status()).toBe("salvo às 10:00"));
    expect((screen.getByLabelText("texto") as HTMLInputElement).value).toBe("abc");
  });

  it("flush espera o salvamento em curso e salva o que faltava", async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    render(<Harness save={save} delayMs={60_000} />);
    type("ab");
    fireEvent.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    type("abc");
    fireEvent.click(screen.getByRole("button", { name: "flush" }));
    first.resolve();
    await waitFor(() => expect(screen.getByTestId("flushed").textContent).toBe("true"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][0]).toEqual({ text: "abc" });
  });

  it("depois de uma falha, voltar ao texto já salvo ainda manda de novo no flush", async () => {
    const save = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    render(<Harness save={save} delayMs={60_000} />);
    const flushed = () => screen.getByTestId("flushed").textContent;
    type("b");
    fireEvent.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(flushed()).toBe("true"));
    type("bc");
    fireEvent.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(flushed()).toBe("false"));
    type("b");
    fireEvent.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(flushed()).toBe("true"));
    expect(save).toHaveBeenCalledTimes(3);
    expect(save.mock.calls[2][0]).toEqual({ text: "b" });
  });

  it("bloqueado não salva e diz o motivo", async () => {
    const save = vi.fn(async () => undefined);
    render(<Harness save={save} blocked="Plano (P) passa de 20.000 caracteres" />);
    type("ab");
    fireEvent.click(screen.getByRole("button", { name: "flush" }));
    await waitFor(() => expect(screen.getByTestId("flushed").textContent).toBe("false"));
    expect(save).not.toHaveBeenCalled();
    expect(status()).toBe("não salvo — Plano (P) passa de 20.000 caracteres");
  });

  it("erro mostra a frase e a próxima mudança tenta de novo", async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error("x")).mockResolvedValue(undefined);
    render(<Harness save={save} />);
    type("ab");
    await waitFor(() => expect(status()).toBe("não salvo — falhou"));
    type("abc");
    await waitFor(() => expect(status()).toBe("salvo às 10:00"));
    expect(save).toHaveBeenLastCalledWith({ text: "abc" });
  });

  it("fechar a tela com mudança pendente salva", async () => {
    const save = vi.fn(async () => undefined);
    const { unmount } = render(<Harness save={save} delayMs={60_000} />);
    type("ab");
    unmount();
    await waitFor(() => expect(save).toHaveBeenCalledWith({ text: "ab" }));
  });

  it("erro durante o salvamento não deixa o valor mais novo sem tentativa", async () => {
    const first = deferred();
    const save = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(undefined);
    render(<Harness save={save} />);
    type("ab");
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    type("abc");
    await new Promise((r) => setTimeout(r, 20));
    first.reject(new Error("x"));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    expect(save.mock.calls[1][0]).toEqual({ text: "abc" });
    await waitFor(() => expect(status()).toBe("salvo às 10:00"));
  });
});
