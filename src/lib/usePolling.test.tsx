// Relógio falso só aqui. O que se prova: um pedido por vez, nenhum timer depois de desmontar (o vazamento de polling entre
// testes; precedente wpda ResultStep 82dddf1), troca de chave sem resposta velha, erro sem parar e refresh sem timer dobrado.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { usePolling } from "./usePolling";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

it("um pedido por vez: o próximo só depois da resposta e do intervalo", async () => {
  let resolve!: (v: number) => void;
  const fetcher = vi.fn(() => new Promise<number>((r) => { resolve = r; }));
  const { result } = renderHook(() => usePolling(fetcher, 5000, "a"));
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(20_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => resolve(1));
  expect(result.current.data).toBe(1);
  expect(result.current.updatedAt).not.toBeNull();
  await vi.advanceTimersByTimeAsync(4999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("desmontar com o pedido em voo descarta a resposta e não agenda nada", async () => {
  let resolve!: (v: number) => void;
  const fetcher = vi.fn(() => new Promise<number>((r) => { resolve = r; }));
  const { unmount } = renderHook(() => usePolling(fetcher, 5000, "a"));
  unmount();
  await act(async () => resolve(1));
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("desmontar com o próximo pedido agendado limpa o timer: nenhum disparo depois", async () => {
  const fetcher = vi.fn().mockResolvedValue(1);
  const { unmount } = renderHook(() => usePolling(fetcher, 5000, "a"));
  await vi.advanceTimersByTimeAsync(0);
  expect(vi.getTimerCount()).toBe(1);
  unmount();
  expect(vi.getTimerCount()).toBe(0);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("trocar a chave zera os dados e ignora a resposta da chave antiga", async () => {
  const pending: ((v: string) => void)[] = [];
  const fetcher = vi.fn(() => new Promise<string>((r) => pending.push(r)));
  const { result, rerender } = renderHook(({ k }) => usePolling(fetcher, 5000, k), { initialProps: { k: "upa1" } });
  await act(async () => pending[0]("fila da upa1"));
  expect(result.current.data).toBe("fila da upa1");
  await vi.advanceTimersByTimeAsync(5000);
  rerender({ k: "upa2" });
  // Na mesma renderização da troca, nada da chave velha.
  expect(result.current.data).toBeUndefined();
  expect(result.current.updatedAt).toBeNull();
  await act(async () => pending[1]("fila velha da upa1"));
  expect(result.current.data).toBeUndefined();
  await act(async () => pending[2]("fila da upa2"));
  expect(result.current.data).toBe("fila da upa2");
  // Um timer só: o da chave nova.
  expect(vi.getTimerCount()).toBe(1);
});

it("erro não para o polling; refresh pede na hora sem duplicar o timer", async () => {
  const fetcher = vi.fn().mockRejectedValueOnce(new Error("rede")).mockResolvedValue(2);
  const { result } = renderHook(() => usePolling(fetcher, 5000, "a"));
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(result.current.error).toBeInstanceOf(Error);
  await act(() => vi.advanceTimersByTimeAsync(5000));
  expect(result.current.data).toBe(2);
  expect(result.current.error).toBeNull();
  act(() => result.current.refresh());
  expect(fetcher).toHaveBeenCalledTimes(3);
  await act(() => vi.advanceTimersByTimeAsync(0));
  expect(vi.getTimerCount()).toBe(1);
});

it("refresh com o pedido em voo não abre um segundo: pede de novo logo depois da resposta", async () => {
  const pending: ((v: number) => void)[] = [];
  const fetcher = vi.fn(() => new Promise<number>((r) => pending.push(r)));
  const { result } = renderHook(() => usePolling(fetcher, 5000, "a"));
  act(() => result.current.refresh());
  expect(fetcher).toHaveBeenCalledTimes(1);
  await act(async () => pending[0](1));
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  await act(async () => pending[1](2));
  expect(result.current.data).toBe(2);
  expect(vi.getTimerCount()).toBe(1);
});

it("fetcher nulo não pede; o fetcher novo de cada render não reinicia o ciclo", async () => {
  const idle = renderHook(() => usePolling<number>(null, 5000, "a"));
  await vi.advanceTimersByTimeAsync(60_000);
  expect(idle.result.current.data).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
  idle.unmount();

  const calls: string[] = [];
  const { rerender } = renderHook(({ tag }) => usePolling(() => { calls.push(tag); return Promise.resolve(tag); }, 5000, "a"),
    { initialProps: { tag: "v1" } });
  await vi.advanceTimersByTimeAsync(0);
  rerender({ tag: "v2" });
  expect(calls).toEqual([ "v1" ]);
  await vi.advanceTimersByTimeAsync(5000);
  expect(calls).toEqual([ "v1", "v2" ]);
});
