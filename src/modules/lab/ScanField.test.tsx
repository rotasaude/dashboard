import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SCAN_DUPLICATE, SCAN_FOCUS_HINT, ScanField, type ScanOutcome } from "./ScanField";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function read(input: HTMLElement, code: string) {
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
}

describe("ScanField", () => {
  it("nasce com foco; Enter entrega o código aparado e limpa o campo", async () => {
    const onScan = vi.fn(async (_code: string): Promise<ScanOutcome> => ({ ok: true, text: "coleta registrada" }));
    render(<ScanField label="Etiqueta" onScan={onScan} />);
    const input = screen.getByLabelText("Etiqueta") as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    read(input, "  0000123401 ");
    expect(input.value).toBe("");
    await waitFor(() => expect(onScan).toHaveBeenCalledWith("0000123401", undefined));
    expect(await screen.findByText("0000123401 · coleta registrada")).not.toBeNull();
  });

  it("três leituras seguidas: grava as três, na ordem, uma por vez", async () => {
    const resolvers: ((o: ScanOutcome) => void)[] = [];
    const onScan = vi.fn((_code: string) => new Promise<ScanOutcome>((r) => { resolvers.push(r); }));
    render(<ScanField label="Etiqueta" onScan={onScan} />);
    const input = screen.getByLabelText("Etiqueta");
    read(input, "0000000001"); read(input, "0000000002"); read(input, "0000000003");
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
    expect(screen.getAllByText(/aguardando/).length).toBe(3);
    await act(async () => { resolvers[0]({ ok: true, text: "ok" }); });
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
    await act(async () => { resolvers[1]({ ok: false, text: "não encontrada" }); });
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(3));
    await act(async () => { resolvers[2]({ ok: true, text: "ok" }); });
    expect(onScan.mock.calls.map((c) => c[0])).toEqual([ "0000000001", "0000000002", "0000000003" ]);
    expect(await screen.findByText("0000000002 · não encontrada")).not.toBeNull();
  });

  it("o mesmo código duas vezes em 2 s: a segunda é ignorada com aviso", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-10-15T10:00:00-03:00"));
    const onScan = vi.fn(async (_code: string): Promise<ScanOutcome> => ({ ok: true, text: "ok" }));
    render(<ScanField label="Etiqueta" onScan={onScan} />);
    const input = screen.getByLabelText("Etiqueta");
    read(input, "0000000011");
    read(input, "0000000011");
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
    expect(screen.getByText(`0000000011 · ${SCAN_DUPLICATE}`)).not.toBeNull();
    vi.setSystemTime(new Date("2026-10-15T10:00:03-03:00"));
    read(input, "0000000011");
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
  });

  it("código ilegível não chama quem grava", async () => {
    const onScan = vi.fn();
    render(<ScanField label="Etiqueta" onScan={onScan} />);
    read(screen.getByLabelText("Etiqueta"), "LB 01");
    expect(await screen.findByText(/código ilegível/)).not.toBeNull();
    expect(onScan).not.toHaveBeenCalled();
  });

  it("falha inesperada vira frase, e a fila segue", async () => {
    const onScan = vi.fn()
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValueOnce({ ok: true, text: "ok" });
    render(<ScanField label="Etiqueta" onScan={onScan} />);
    const input = screen.getByLabelText("Etiqueta");
    read(input, "0000000021"); read(input, "0000000022");
    expect(await screen.findByText("0000000021 · não foi possível registrar — leia de novo")).not.toBeNull();
    expect(await screen.findByText("0000000022 · ok")).not.toBeNull();
  });

  it("sem foco: avisa e não rouba o foco", async () => {
    render(<><ScanField label="Etiqueta" onScan={vi.fn()} /><button type="button">Filtro</button></>);
    const other = screen.getByRole("button", { name: "Filtro" });
    other.focus();
    fireEvent.blur(screen.getByLabelText("Etiqueta"));
    expect(await screen.findByText(SCAN_FOCUS_HINT)).not.toBeNull();
    expect(document.activeElement).toBe(other);
    fireEvent.click(screen.getByRole("button", { name: "Voltar a ler" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Etiqueta"));
  });

  // Prova no navegador: o aviso nascia no blur e empurrava os botões de baixo;
  // o clique de mouse (mousedown tira o foco) caía no vazio.
  it("com foco, o lugar do aviso já existe, oculto: perder o foco não desloca a tela", () => {
    render(<ScanField label="Etiqueta" onScan={vi.fn()} />);
    expect(document.activeElement).toBe(screen.getByLabelText("Etiqueta"));
    const hint = screen.getByText(SCAN_FOCUS_HINT);
    expect((hint.parentElement as HTMLElement).style.visibility).toBe("hidden");
    expect(screen.queryByRole("button", { name: "Voltar a ler" })).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    fireEvent.blur(screen.getByLabelText("Etiqueta"));
    expect(screen.getByText(SCAN_FOCUS_HINT)).toBe(hint);
    expect((hint.parentElement as HTMLElement).style.visibility).toBe("visible");
    expect(screen.getByRole("button", { name: "Voltar a ler" })).not.toBeNull();
  });

  it("desmontar no meio da fila não grava as leituras que sobraram", async () => {
    const resolvers: ((o: ScanOutcome) => void)[] = [];
    const onScan = vi.fn((_code: string) => new Promise<ScanOutcome>((r) => { resolvers.push(r); }));
    const { unmount } = render(<ScanField label="Etiqueta" onScan={onScan} />);
    const input = screen.getByLabelText("Etiqueta");
    read(input, "0000000031"); read(input, "0000000032");
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(1));
    unmount();
    await act(async () => { resolvers[0]({ ok: true, text: "ok" }); });
    expect(onScan).toHaveBeenCalledTimes(1);
  });

  it("leitura que falhou, repetida dentro de 2 s, é aceita de novo", async () => {
    vi.useFakeTimers({ toFake: [ "Date" ] });
    vi.setSystemTime(new Date("2026-10-15T10:00:00-03:00"));
    const onScan = vi.fn()
      .mockResolvedValueOnce({ ok: false, text: "não encontrada" })
      .mockRejectedValueOnce(new Error("rede"))
      .mockResolvedValueOnce({ ok: true, text: "ok" });
    render(<ScanField label="Etiqueta" onScan={onScan} />);
    const input = screen.getByLabelText("Etiqueta");
    read(input, "0000000041");
    await screen.findByText("0000000041 · não encontrada");
    read(input, "0000000041");
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(2));
    await screen.findByText("0000000041 · não foi possível registrar — leia de novo");
    read(input, "0000000041");
    await waitFor(() => expect(onScan).toHaveBeenCalledTimes(3));
    expect(screen.queryByText(`0000000041 · ${SCAN_DUPLICATE}`)).toBeNull();
  });
});
