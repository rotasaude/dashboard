import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/api", async (importOriginal) => ({ ...(await importOriginal<typeof import("../lib/api")>()), countNotifications: vi.fn() }));
import * as api from "../lib/api";
import { SURVEILLANCE_COUNT_REFRESH_MS, useSurveillanceCount } from "./useSurveillanceCount";
import { counts } from "../test/surveillanceFixtures";

afterEach(() => { cleanup(); vi.useRealTimers(); });
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;

describe("useSurveillanceCount", () => {
  it("a contagem relê a cada minuto e acende o item com as imediatas", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const fn = api.countNotifications as unknown as ReturnType<typeof vi.fn>;
    fn.mockResolvedValue(counts({ immediate_open: 2 }));
    const { result } = renderHook(() => useSurveillanceCount(true, "u-1"), { wrapper });
    await waitFor(() => expect(result.current.data?.immediate_open).toBe(2));
    expect(SURVEILLANCE_COUNT_REFRESH_MS).toBe(60_000);
    await act(async () => { vi.advanceTimersByTime(60_000); });
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(2));
  });
  it("desligado não lê", async () => {
    const fn = api.countNotifications as unknown as ReturnType<typeof vi.fn>;
    fn.mockReset();
    renderHook(() => useSurveillanceCount(false, "u-1"), { wrapper });
    // Um tick: uma consulta ligada por engano dispararia a leitura aqui.
    await act(async () => { await Promise.resolve(); });
    expect(fn).not.toHaveBeenCalled();
  });
});
