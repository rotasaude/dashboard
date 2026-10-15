import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { LAB_CRITICAL_REFRESH_MS, useLabCriticalCount } from "./useLabCriticalCount";
import { LAB_CRITICAL_COUNT_KEY } from "../lib/lab";

const fetchMock = vi.fn();
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

function setup(enabled: boolean, userId: string | null = "u1") {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useLabCriticalCount(enabled, userId), { wrapper });
  return { client, ...hook };
}
const flush = () => act(async () => { await vi.advanceTimersByTimeAsync(0); });

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ count: 2 }), { status: 200, headers: { "Content-Type": "application/json" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("useLabCriticalCount", () => {
  it("desligado: nenhuma requisição, nem passado o intervalo", async () => {
    setup(false);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(LAB_CRITICAL_REFRESH_MS * 3); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ligado: lê só a rota /count e repete a cada 60 s", async () => {
    const { result } = setup(true);
    await flush();
    expect(urls()).toHaveLength(1);
    expect(urls()[0]).toMatch(/\/lab\/criticals\/unnotified\/count$/);
    expect(result.current.data).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(LAB_CRITICAL_REFRESH_MS); });
    expect(urls()).toHaveLength(2);
    expect(urls().every((u) => /\/lab\/criticals\/unnotified\/count$/.test(u))).toBe(true);
    expect(LAB_CRITICAL_REFRESH_MS).toBe(60_000);
  });

  it("a chave é [LAB_CRITICAL_COUNT_KEY, userId]", async () => {
    const { client } = setup(true, "u7");
    await flush();
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([ [ LAB_CRITICAL_COUNT_KEY, "u7" ] ]);
  });

  it("depois de desmontar, nenhuma requisição nova", async () => {
    const { unmount } = setup(true);
    await flush();
    unmount();
    const before = fetchMock.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(LAB_CRITICAL_REFRESH_MS * 3); });
    expect(fetchMock.mock.calls.length).toBe(before);
  });
});
