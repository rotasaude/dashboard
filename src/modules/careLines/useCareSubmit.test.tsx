import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { ApiError } from "../../lib/api";
import { useCareSubmit } from "./useCareSubmit";

afterEach(cleanup);

describe("useCareSubmit", () => {
  it("roda a ação, fica ocupado enquanto ela corre e devolve true", async () => {
    const { result } = renderHook(() => useCareSubmit());
    let release: () => void = () => {};
    const action = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    let outcome: Promise<boolean> = Promise.resolve(false);
    act(() => { outcome = result.current.submit(action, vi.fn()); });
    expect(result.current.busy).toBe(true);
    await act(async () => { release(); await outcome; });
    expect(await outcome).toBe(true);
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("segundo envio durante o primeiro é ignorado (sem duplicar a escrita)", async () => {
    const { result } = renderHook(() => useCareSubmit());
    let release: () => void = () => {};
    const action = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    let first: Promise<boolean> = Promise.resolve(false);
    let second: Promise<boolean> = Promise.resolve(true);
    act(() => { first = result.current.submit(action, vi.fn()); second = result.current.submit(action, vi.fn()); });
    await act(async () => { release(); await first; });
    expect(action).toHaveBeenCalledTimes(1);
    expect(await second).toBe(false);
  });

  it("erro conhecido vira frase em `error`, nunca o código, e devolve false", async () => {
    const { result } = renderHook(() => useCareSubmit());
    const onStale = vi.fn();
    let ok = true;
    await act(async () => { ok = await result.current.submit(() => Promise.reject(new ApiError(422, { error: "json_required_xyz" }, "x")), onStale); });
    expect(ok).toBe(false);
    expect(result.current.error).not.toBeNull();
    expect(result.current.error).not.toContain("json_required_xyz");
    expect(onStale).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it("registro defasado (409 invalid_transition) vai a onStale com a frase, sem `error`", async () => {
    const { result } = renderHook(() => useCareSubmit());
    const onStale = vi.fn();
    let ok = true;
    await act(async () => { ok = await result.current.submit(() => Promise.reject(new ApiError(409, { error: "invalid_transition" }, "x")), onStale); });
    expect(ok).toBe(false);
    expect(onStale).toHaveBeenCalledWith("isso já foi decidido ou encerrado por outra pessoa — a lista foi relida");
    expect(result.current.error).toBeNull();
  });

  it("setError limpa ou define a mensagem, e um novo envio limpa a anterior", async () => {
    const { result } = renderHook(() => useCareSubmit());
    act(() => result.current.setError("escolha como foi o contato"));
    expect(result.current.error).toBe("escolha como foi o contato");
    await act(async () => { await result.current.submit(async () => {}, vi.fn()); });
    expect(result.current.error).toBeNull();
  });
});
