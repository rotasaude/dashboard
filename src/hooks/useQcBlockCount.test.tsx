// src/hooks/useQcBlockCount.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QC_BLOCK_REFRESH_MS, useQcBlockCount } from "./useQcBlockCount";
import { QC_BLOCK_COUNT_KEY } from "../lib/qc";

const fetchMock = vi.fn();
const urls = () => fetchMock.mock.calls.map((c) => String(c[0]));

function setup(enabled: boolean, userId: string | null = "u1") {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useQcBlockCount(enabled, userId), { wrapper });
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

describe("useQcBlockCount", () => {
  it("sem o interruptor ou sem papel (enabled false): nenhuma leitura", async () => {
    setup(false);
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(QC_BLOCK_REFRESH_MS * 3); });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("relê só /count a cada minuto e nunca a lista", async () => {
    const { result } = setup(true);
    await flush();
    expect(result.current.data).toBe(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(QC_BLOCK_REFRESH_MS * 2); });
    expect(urls()).toHaveLength(3);
    expect(urls().every((u) => /\/lab\/qc\/blocks\/active\/count$/.test(u))).toBe(true);
    expect(urls().some((u) => /\/lab\/qc\/(blocks|reviews)\?/.test(u))).toBe(false);
    expect(QC_BLOCK_REFRESH_MS).toBe(60_000);
  });

  it("erro do contador: sem número, sem exceção", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: "feature_disabled" }), { status: 403, headers: { "Content-Type": "application/json" } }));
    const { result } = setup(true);
    await flush();
    expect(result.current.data).toBeUndefined();
    expect(result.current.isError).toBe(true);
  });

  it("a chave é [QC_BLOCK_COUNT_KEY, userId]", async () => {
    const { client } = setup(true, "u7");
    await flush();
    expect(client.getQueryCache().getAll().map((q) => q.queryKey)).toEqual([ [ QC_BLOCK_COUNT_KEY, "u7" ] ]);
  });
});
